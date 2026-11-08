# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""``POST /courses/{id}/ask``: Ask project documents (live model, real tool
calling; ``app.orchestration.project_chat``).

The signed-in demo identity fixes the document scope of every search the
model makes. Without model credentials this answers 503 and says where they
go; nothing is simulated. Retrieval is hybrid only when live embeddings are
configured and every readable revision in force is embedded; otherwise it is
lexical, and the response says which.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.demo_auth import IdentityRead, ViewerDep, identity_read
from app.api.deps import SessionDep, SettingsDep
from app.api.schemas.assessment import LiveTokenUsage
from app.api.v1.assessments import LIVE_PROVIDER_LABEL
from app.api.v1.search import build_search_status
from app.db.models import Course
from app.domain.enums import ModelRole, ResourceType
from app.orchestration.project_chat import (
    MAX_QUESTION_CHARS,
    MAX_TOOL_CALLS,
    PROMPT_VERSION,
    ChatProviderError,
    ChatSource,
    ProjectChat,
    ToolCallTrace,
)
from app.retrieval.project_search import ProjectSearchMode, ProjectSearchService

router = APIRouter(tags=["ask"])

# One live chat at a time: a second request is refused, never queued.
_CHAT_LOCK = asyncio.Lock()

CHAT_NOT_CONFIGURED = (
    "live chat is not configured: set NEBIUS_API_KEY, NEBIUS_BASE_URL, MODEL_FAST and "
    "MODEL_STRONG in the git-ignored .env file at the repository root, then restart with "
    "`docker compose --env-file .env -f infra/demo/compose.yml up -d`"
)


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    question: Annotated[str, Field(min_length=1, max_length=MAX_QUESTION_CHARS)]


class AskSourceRead(BaseModel):
    source_id: str
    document_id: uuid.UUID
    document_title: str
    document_type: ResourceType
    version_id: uuid.UUID
    file_name: str
    pages: list[int]
    stated_revision: str | None
    stored_label: str
    in_force: bool
    superseded_by_revision: str | None
    excerpt: str


class ToolCallRead(BaseModel):
    name: str
    query: str | None
    include_superseded: bool
    retrieval_mode: str | None
    source_ids: list[str]
    ignored_arguments: list[str]  # argument names the backend did not apply
    error: str | None


class AskRead(BaseModel):
    answer: str
    live: Literal[True] = True  # always a live model response, never a fixture
    provider: str
    model: str
    prompt_version: str
    grounded: bool  # cites at least one retrieved source
    citations: list[AskSourceRead]
    retrieved: list[AskSourceRead]
    removed_citations: list[str]
    tool_calls: list[ToolCallRead]
    max_tool_calls: int
    tool_call_limit_reached: bool
    retrieval_mode: ProjectSearchMode
    identity: IdentityRead
    model_call_ids: list[uuid.UUID]
    usage: LiveTokenUsage
    turns: int
    latency_ms: int


def _source(s: ChatSource) -> AskSourceRead:
    return AskSourceRead(
        source_id=s.source_id, document_id=s.document_id, document_title=s.document_title,
        document_type=s.document_type, version_id=s.version_id, file_name=s.file_name,
        pages=list(s.pages), stated_revision=s.stated_revision, stored_label=s.stored_label,
        in_force=s.in_force, superseded_by_revision=s.superseded_by_revision, excerpt=s.excerpt,
    )  # fmt: skip


def _trace(t: ToolCallTrace) -> ToolCallRead:
    return ToolCallRead(
        name=t.name, query=t.query, include_superseded=t.include_superseded,
        retrieval_mode=t.retrieval_mode, source_ids=t.source_ids,
        ignored_arguments=t.ignored_arguments, error=t.error,
    )  # fmt: skip


@router.post("/courses/{course_id}/ask")
async def ask_project_documents(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    viewer: ViewerDep,
    course_id: uuid.UUID,
    body: AskBody,
) -> AskRead:
    from app.ai.errors import AIConfigurationError
    from app.ai.nebius import NebiusTokenFactoryProvider
    from app.ai.nebius_embeddings import NebiusEmbeddingProvider
    from app.extraction.live_preview import LIVE_MODEL

    if settings.app_env == "production":
        raise HTTPException(status_code=503, detail="not offered in production")
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        chat_provider = NebiusTokenFactoryProvider.from_settings(
            settings, models={ModelRole.FAST: LIVE_MODEL}
        )
    except AIConfigurationError:
        raise HTTPException(status_code=503, detail=CHAT_NOT_CONFIGURED) from None
    embedder = None
    try:
        status = await build_search_status(session, settings, viewer, course_id)
        await session.close()  # release the connection before the slow part
        mode = ProjectSearchMode.LEXICAL
        if status.hybrid.available:
            embedder = NebiusEmbeddingProvider.from_settings(settings)
            mode = ProjectSearchMode.HYBRID
        if _CHAT_LOCK.locked():
            raise HTTPException(status_code=409, detail="another question is being answered")
        async with _CHAT_LOCK:
            sessions = request.app.state.session_factory
            search = ProjectSearchService(
                sessions, provider=embedder, embeddings="live" if embedder else None
            )
            chat = ProjectChat(chat_provider, sessions, search, search_mode=mode)
            answer = await chat.ask(
                course_id, body.question, resource_types=viewer.type_scope, viewer=viewer.id
            )
    except ChatProviderError as error:
        raise HTTPException(
            status_code=502, detail=f"the live model call failed ({error.category.value})"
        ) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid question") from None
    finally:
        await chat_provider.aclose()
        if embedder is not None:
            await embedder.aclose()
    return AskRead(
        answer=answer.answer,
        provider=LIVE_PROVIDER_LABEL,
        model=answer.model,
        prompt_version=PROMPT_VERSION,
        grounded=answer.grounded,
        citations=[_source(s) for s in answer.cited],
        retrieved=[_source(s) for s in answer.retrieved],
        removed_citations=list(answer.removed_citations),
        tool_calls=[_trace(t) for t in answer.tool_calls],
        max_tool_calls=MAX_TOOL_CALLS,
        tool_call_limit_reached=answer.tool_call_limit_reached,
        retrieval_mode=mode,
        identity=identity_read(viewer),
        model_call_ids=list(answer.model_call_ids),
        usage=LiveTokenUsage(
            prompt_tokens=answer.usage.prompt_tokens,
            completion_tokens=answer.usage.completion_tokens,
            reasoning_tokens=answer.usage.reasoning_tokens,
        ),
        turns=answer.turns,
        latency_ms=answer.latency_ms,
    )
