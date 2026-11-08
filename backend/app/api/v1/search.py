# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Search a project's documents (``app.retrieval.project_search``).

- ``POST /courses/{id}/search``: the query travels in the body, never in the
  URL (and is never logged). ``mode=lexical`` runs offline; ``mode=hybrid``
  embeds the query with the configured live provider (a paid call) and is
  refused, never downgraded, when live embeddings are not configured or the
  revisions are not embedded yet. Results are source excerpts with file
  name, page and revision; there is no answer generation.
- ``GET /courses/{id}/search/status``: which revisions are indexed for which
  mode, which are in force, and what each mode needs. Never a credential.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.demo_auth import DemoIdentity, ViewerDep
from app.api.deps import SessionDep, SettingsDep
from app.core.config import Settings
from app.db.models import Course, Resource, ResourceVersion
from app.reasoning.revisions import SUPERSESSION_RULES_VERSION, revision_label, revision_statuses
from app.retrieval.chunking import SPAN_PACK_V1
from app.retrieval.indexing import inspect_versions_in_session
from app.retrieval.project_search import (
    MAX_K,
    IndexNotReady,
    ProjectNotFoundError,
    ProjectSearchMode,
    ProjectSearchResult,
    ProjectSearchService,
    RevisionScope,
)
from app.retrieval.search import IndexStateError, QueryCallNotRecordedError, SearchProviderError
from app.retrieval.store import ChunkState, LinkState

router = APIRouter(tags=["search"])

NOT_CONFIGURED = (
    "live embeddings are not configured (NEBIUS_API_KEY, NEBIUS_BASE_URL and EMBEDDING_MODEL "
    "are needed); offline search is lexical only"
)


def live_embeddings_problem(settings: Settings) -> str | None:
    """Why hybrid search cannot embed live here, or None. Checks presence only."""
    if settings.app_env == "production":
        return "not offered in production"
    if None in (settings.nebius_api_key, settings.nebius_base_url, settings.embedding_model):
        return NOT_CONFIGURED
    return None


class SearchBody(BaseModel):
    # hide_input_in_errors: a validation error must never echo the query.
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    query: Annotated[str, Field(min_length=1, max_length=2000)]
    mode: ProjectSearchMode = ProjectSearchMode.LEXICAL
    revisions: RevisionScope = RevisionScope.CURRENT
    k: Annotated[int, Field(ge=1, le=MAX_K)] = 10


class CitationRead(BaseModel):
    source_span_id: uuid.UUID
    page_number: int | None
    section_path: str | None
    quote: str  # the part of the stored span inside the hit, exactly as stored
    coverage: Literal["full", "partial"]


class HitRevisionRead(BaseModel):
    version_id: uuid.UUID
    version_number: int
    stored_label: str  # from the stored order; display only
    stated_revision: str | None  # what the revision itself states
    file_name: str
    latest: bool
    in_force: bool
    superseded_by_version_id: uuid.UUID | None
    superseded_by_revision: str | None
    supersession_quote: str | None
    supersession_page: int | None


class SearchHitRead(BaseModel):
    rank: int
    score: float
    document_id: uuid.UUID
    document_title: str
    document_type: str
    revision: HitRevisionRead
    pages: list[int]
    excerpt: str  # the matched chunk: retrieval context, verbatim
    citations: list[CitationRead]
    lexical_rank: int | None
    vector_rank: int | None


class SearchRead(BaseModel):
    mode: ProjectSearchMode
    # Where vectors came from: "none" (lexical), "live" (the configured provider).
    embeddings: Literal["none", "live", "replay"]
    revisions: RevisionScope
    score_kind: str  # a ranking score: never a confidence
    chunker_version: str
    lexical_version: str
    fusion_version: str | None
    supersession_rules: str
    query_format: str | None
    query_model_call_id: uuid.UUID | None
    revisions_searched: int
    revisions_excluded_as_superseded: int
    hits: list[SearchHitRead]


def _read(result: ProjectSearchResult) -> SearchRead:
    hits = []
    for item in result.hits:
        hit, rev = item.hit, item.revision
        hits.append(
            SearchHitRead(
                rank=hit.rank, score=hit.score, document_id=hit.resource.id,
                document_title=hit.resource.title, document_type=hit.resource.type.value,
                revision=HitRevisionRead(
                    version_id=rev.version_id, version_number=rev.version_number,
                    stored_label=rev.stored_label, stated_revision=rev.stated_revision,
                    file_name=rev.file_name, latest=rev.latest, in_force=rev.in_force,
                    superseded_by_version_id=rev.superseded_by_version_id,
                    superseded_by_revision=rev.superseded_by_revision,
                    supersession_quote=rev.supersession_quote,
                    supersession_page=rev.supersession_page,
                ),
                pages=sorted({s.page_number for s in hit.spans if s.page_number is not None}),
                excerpt=hit.text,
                citations=[
                    CitationRead(
                        source_span_id=s.span_id, page_number=s.page_number,
                        section_path=s.section_path,
                        quote=s.excerpt[s.relative_start : s.relative_end], coverage=s.coverage,
                    )
                    for s in hit.spans
                ],
                lexical_rank=hit.lexical_rank, vector_rank=hit.vector_rank,
            )
        )  # fmt: skip
    return SearchRead(
        mode=result.mode, embeddings=result.embeddings, revisions=result.revisions,
        score_kind=result.score_kind, chunker_version=result.chunker_version,
        lexical_version=result.lexical_version, fusion_version=result.fusion_version,
        supersession_rules=result.supersession_rules, query_format=result.query_format,
        query_model_call_id=result.query_model_call_id,
        revisions_searched=result.revisions_searched,
        revisions_excluded_as_superseded=result.revisions_excluded_as_superseded, hits=hits,
    )  # fmt: skip


@router.post("/courses/{course_id}/search")
async def search_project(
    request: Request,
    settings: SettingsDep,
    viewer: ViewerDep,
    course_id: uuid.UUID,
    body: SearchBody,
) -> SearchRead:
    sessions = request.app.state.session_factory
    provider = None
    if body.mode is ProjectSearchMode.HYBRID:
        problem = live_embeddings_problem(settings)
        if problem is not None:
            raise HTTPException(status_code=503, detail=f"hybrid search unavailable: {problem}")
        from app.ai.nebius_embeddings import NebiusEmbeddingProvider

        provider = NebiusEmbeddingProvider.from_settings(settings)
    try:
        service = ProjectSearchService(
            sessions, provider=provider, embeddings="live" if provider else None
        )
        result = await service.search(
            course_id,
            body.query,
            mode=body.mode,
            revisions=body.revisions,
            k=body.k,
            resource_types=viewer.type_scope,
        )
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="project not found") from None
    except IndexNotReady as error:
        raise HTTPException(status_code=409, detail=f"search index not ready: {error}") from None
    except IndexStateError:
        raise HTTPException(
            status_code=409, detail="the search index is inconsistent; search refused"
        ) from None
    except SearchProviderError as error:
        raise HTTPException(
            status_code=502, detail=f"the live query embedding failed ({error.category.value})"
        ) from None
    except QueryCallNotRecordedError:
        raise HTTPException(
            status_code=503, detail="the query call could not be recorded"
        ) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid search request") from None
    finally:
        if provider is not None:
            await provider.aclose()
    return _read(result)


class ModeStatus(BaseModel):
    available: bool
    reason: str | None


class RevisionIndexRead(BaseModel):
    document_id: uuid.UUID
    document_title: str
    version_id: uuid.UUID
    version_number: int
    stored_label: str
    stated_revision: str | None
    file_name: str
    latest: bool
    in_force: bool
    superseded_by_revision: str | None
    chunked: bool
    # In the configured embedding space; None when no space is configured.
    embedded: bool | None


class SpaceRead(BaseModel):
    provider: str
    model: str
    dimensions: int
    space_version: str


class SearchStatusRead(BaseModel):
    lexical: ModeStatus
    hybrid: ModeStatus
    embedding_space: SpaceRead | None
    chunker_version: str
    supersession_rules: str
    revisions: list[RevisionIndexRead]


@router.get("/courses/{course_id}/search/status")
async def search_status(
    session: SessionDep, settings: SettingsDep, viewer: ViewerDep, course_id: uuid.UUID
) -> SearchStatusRead:
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await build_search_status(session, settings, viewer, course_id)


async def build_search_status(
    session: AsyncSession, settings: Settings, viewer: DemoIdentity, course_id: uuid.UUID
) -> SearchStatusRead:
    """Index state of the revisions ``viewer`` may read, and what each mode needs."""
    from app.ai.nebius_embeddings import embedding_space_from_settings

    space = (
        embedding_space_from_settings(settings) if settings.embedding_model is not None else None
    )
    readable = select(Resource.id).where(Resource.course_id == course_id)
    if viewer.type_scope is not None:
        readable = readable.where(Resource.type.in_(sorted(viewer.type_scope)))
    allowed = set(await session.scalars(readable))
    statuses = {
        v: s for v, s in (await revision_statuses(session, course_id)).items()
        if s.resource_id in allowed
    }  # fmt: skip
    reports = {
        r.resource_version_id: r
        for r in await inspect_versions_in_session(session, list(statuses), space)
    }
    rows = (
        await session.execute(
            select(ResourceVersion.id, ResourceVersion.display_name, Resource.id, Resource.title)
            .join(Resource, Resource.id == ResourceVersion.resource_id)
            .where(Resource.course_id == course_id, Resource.id.in_(allowed))
            .order_by(Resource.title, ResourceVersion.version_number)
        )
    ).all()
    revisions = []
    for version_id, file_name, document_id, title in rows:
        status, report = statuses[version_id], reports[version_id]
        chunked = report.chunk_state is ChunkState.EXACT
        revisions.append(
            RevisionIndexRead(
                document_id=document_id, document_title=title, version_id=version_id,
                version_number=status.version_number,
                stored_label=revision_label(status.version_number),
                stated_revision=status.stated_revision, file_name=file_name,
                latest=status.latest, in_force=status.in_force,
                superseded_by_revision=(
                    status.superseded_by.stated_revision if status.superseded_by else None
                ),
                chunked=chunked,
                embedded=None if space is None
                else chunked and report.link_state is LinkState.COMPLETE,
            )
        )  # fmt: skip
    in_force = [r for r in revisions if r.in_force]
    unchunked = sum(not r.chunked for r in in_force)
    lexical = ModeStatus(
        available=unchunked == 0,
        reason=None if unchunked == 0 else f"{unchunked} revision(s) in force are not chunked yet",
    )
    problem = live_embeddings_problem(settings)
    unembedded = sum(not r.embedded for r in in_force)
    if problem is not None:
        hybrid = ModeStatus(available=False, reason=problem)
    elif unembedded:
        hybrid = ModeStatus(
            available=False,
            reason=f"{unembedded} revision(s) in force are not embedded in the live space yet "
            "(run the live indexing command)",
        )
    else:
        hybrid = ModeStatus(available=True, reason=None)
    space_read = (
        SpaceRead(
            provider=space.provider,
            model=space.model,
            dimensions=space.dimensions,
            space_version=space.space_version,
        )
        if space
        else None
    )
    return SearchStatusRead(
        lexical=lexical,
        hybrid=hybrid,
        embedding_space=space_read,
        chunker_version=SPAN_PACK_V1.version,
        supersession_rules=SUPERSESSION_RULES_VERSION,
        revisions=revisions,
    )
