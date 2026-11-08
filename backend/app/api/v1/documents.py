# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Project documents and their revisions (inherited names: a course is the
project, a resource a document, a version a revision), and the optional
live analysis of one document's current revision."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.demo_auth import ViewerDep, forbid_unless_readable
from app.api.deps import SessionDep
from app.api.schemas.assessment import LiveRequirementRead, LiveRequirementsRead, LiveTokenUsage
from app.api.v1.assessments import _LIVE_LOCK, LIVE_PROVIDER_LABEL, LiveProviderDep
from app.db.models import Course, Resource, ResourceVersion, SourceSpan
from app.domain.enums import ResourceType
from app.extraction.live_preview import (
    DOCUMENT_PROMPT_VERSION,
    Brief,
    BriefTooLongError,
    EmptyBriefError,
    preview_requirements,
)
from app.reasoning.revisions import names_previous, revision_label, supersession_statement

router = APIRouter(tags=["documents"])


class SupersessionRead(BaseModel):
    """The revision's own sentence saying what it supersedes, exactly as
    stored, and whether it names the previous stored revision."""

    quote: str
    source_span_id: uuid.UUID
    page_number: int | None
    names_revision: str
    names_previous_revision: bool


class RevisionRead(BaseModel):
    id: uuid.UUID
    version_number: int
    # Derived from the version order (1 -> "Rev A"), not parsed from the source.
    revision_label: str
    file_name: str
    content_hash: str
    current: bool
    imported_at: datetime
    # The revision this one replaced (the previous version of the same document).
    supersedes_version_id: uuid.UUID | None
    superseded_by_version_id: uuid.UUID | None
    supersession: SupersessionRead | None
    pages: int


class DocumentRead(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    type: ResourceType
    current_version_id: uuid.UUID | None
    revisions: list[RevisionRead]  # oldest first


async def _revisions(session: SessionDep, resource: Resource) -> list[RevisionRead]:
    versions = (
        await session.scalars(
            select(ResourceVersion)
            .where(ResourceVersion.resource_id == resource.id)
            .order_by(ResourceVersion.version_number)
        )
    ).all()
    counts: dict[uuid.UUID, int] = dict(
        (  # type: ignore[arg-type]
            await session.execute(
                select(
                    SourceSpan.resource_version_id,
                    func.count(func.distinct(SourceSpan.page_number)),
                )
                .where(SourceSpan.resource_version_id.in_([v.id for v in versions]))
                .group_by(SourceSpan.resource_version_id)
            )
        ).all()
    )
    out = []
    for i, v in enumerate(versions):
        previous = versions[i - 1] if i > 0 else None
        following = versions[i + 1] if i + 1 < len(versions) else None
        statement = await supersession_statement(session, v.id)
        out.append(
            RevisionRead(
                id=v.id,
                version_number=v.version_number,
                revision_label=revision_label(v.version_number),
                file_name=v.display_name,
                content_hash=v.content_hash,
                current=resource.current_version_id == v.id,
                imported_at=v.created_at,
                supersedes_version_id=previous.id if previous else None,
                superseded_by_version_id=following.id if following else None,
                supersession=(
                    SupersessionRead(
                        quote=statement.quote,
                        source_span_id=statement.span_id,
                        page_number=statement.page_number,
                        names_revision=f"Rev {statement.names}",
                        names_previous_revision=(
                            previous is not None
                            and names_previous(statement, previous.version_number)
                        ),
                    )
                    if statement
                    else None
                ),
                pages=counts.get(v.id, 0),
            )
        )
    return out


async def _read(session: SessionDep, resource: Resource) -> DocumentRead:
    return DocumentRead(
        id=resource.id,
        course_id=resource.course_id,
        title=resource.title,
        type=resource.type,
        current_version_id=resource.current_version_id,
        revisions=await _revisions(session, resource),
    )


async def readable_document(
    session: SessionDep, viewer: ViewerDep, resource_id: uuid.UUID
) -> Resource:
    """The document, if the signed-in identity may read it: 404 when it does
    not exist, 403 when its type is outside the identity's permissions.
    Declared before any other dependency, so it is checked first."""
    resource = await session.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="document not found")
    forbid_unless_readable(viewer, resource.type)
    return resource


ReadableDocumentDep = Annotated[Resource, Depends(readable_document)]


@router.get("/courses/{course_id}/documents")
async def get_project_documents(
    session: SessionDep, viewer: ViewerDep, course_id: uuid.UUID
) -> list[DocumentRead]:
    """The project documents the viewer may read, each with every stored
    revision, oldest first."""
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    query = select(Resource).where(Resource.course_id == course_id)
    if viewer.type_scope is not None:
        query = query.where(Resource.type.in_(sorted(viewer.type_scope)))
    resources = (await session.scalars(query.order_by(Resource.title))).all()
    return [await _read(session, r) for r in resources]


@router.get("/documents/{resource_id}")
async def get_document(session: SessionDep, resource: ReadableDocumentDep) -> DocumentRead:
    return await _read(session, resource)


@router.post("/documents/{resource_id}/live-requirements")
async def analyze_document_live(
    request: Request,
    session: SessionDep,
    resource: ReadableDocumentDep,  # first: permission before any provider setup
    provider: LiveProviderDep,
) -> LiveRequirementsRead:
    """Ask the model, live, for the requirements in the document's current
    revision. Nothing is persisted but the model call record; without model
    credentials this answers 503 (see ``/capabilities``)."""
    from app.ai.model_calls import RecordedCallError

    version = (
        await session.get(ResourceVersion, resource.current_version_id)
        if resource.current_version_id
        else None
    )
    if version is None:
        raise HTTPException(status_code=404, detail="the document has no current revision")
    if _LIVE_LOCK.locked():
        raise HTTPException(status_code=409, detail="a live analysis is already running")
    async with _LIVE_LOCK:
        try:
            preview = await preview_requirements(
                provider,
                request.app.state.session_factory,
                assessment_title=resource.title,
                brief=Brief(resource, version),
                prompt_version=DOCUMENT_PROMPT_VERSION,
            )
        except (BriefTooLongError, EmptyBriefError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except RecordedCallError as exc:
            raise HTTPException(
                status_code=502, detail=f"live analysis failed ({exc.error.category.value})"
            ) from None
    result = preview.recorded.result
    return LiveRequirementsRead(
        assessment_id=None,
        resource_id=resource.id,
        resource_title=resource.title,
        resource_version_id=version.id,
        version_number=version.version_number,
        requirements=[
            LiveRequirementRead(
                requirement=line.requirement, quote=line.quote, quote_found=line.quote_found
            )
            for line in preview.lines
        ],
        provider=LIVE_PROVIDER_LABEL,
        model=result.model,
        prompt_version=DOCUMENT_PROMPT_VERSION,
        model_call_id=preview.recorded.model_call_id,
        latency_ms=preview.latency_ms,
        usage=LiveTokenUsage(
            prompt_tokens=result.usage.prompt_tokens,
            completion_tokens=result.usage.completion_tokens,
            reasoning_tokens=result.usage.reasoning_tokens,
        ),
    )
