# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Chunk a course's stored versions for lexical search, with no embeddings.

The same deterministic chunk set ``IndexingService`` publishes
(``span-pack/v1`` over the stored SourceSpans), written the same way (per
version, under the version lock, verified before commit), but no provider,
no vectors and no links: nothing is embedded, so nothing can be invented.
Lexical (PostgreSQL full-text) search needs only these chunks. A later live
``IndexingService`` run finds them exact and adds only the embedding links.

Idempotent: a version whose stored chunks are already exactly the
deterministic set is reused, never rewritten. One WorkflowRun
(``chunk/v1``) records each run; its summary holds counts and IDs only.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import exists, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import Course, WorkflowRun, workflow_run_inputs
from app.domain.enums import WorkflowRunStatus
from app.retrieval import store
from app.retrieval.chunking import SPAN_PACK_V1, ChunkingParams
from app.retrieval.indexing import (
    CourseNotFoundError,
    FailureStage,
    SourceContent,
    VersionFailure,
    derive_chunks,
)
from app.retrieval.store import ChunkState

logger = logging.getLogger(__name__)

CHUNK_WORKFLOW_VERSION = "chunk/v1"


class ChunkRunSummary(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    workflow_version: Literal["chunk/v1"] = CHUNK_WORKFLOW_VERSION
    chunker_version: str
    versions_considered: int = 0
    versions_chunked: int = 0
    versions_already_chunked: int = 0
    versions_without_text: int = 0
    versions_failed: int = 0
    chunks_created: int = 0
    chunks_reused: int = 0
    failures: list[VersionFailure] = []


@dataclass(frozen=True, slots=True)
class ChunkRunResult:
    run_id: uuid.UUID
    status: WorkflowRunStatus
    summary: ChunkRunSummary


class _Failed(Exception):
    def __init__(self, stage: FailureStage, error: str | None = None) -> None:
        super().__init__(stage.value)
        self.stage, self.error = stage, error


class ChunkIndexer:
    """Chunks every stored version of a course (all revisions): lexical
    search may then rank current and historical revisions alike."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        params: ChunkingParams = SPAN_PACK_V1,
    ) -> None:
        self._sessions = session_factory
        self._params = params

    async def index_course(self, course_id: uuid.UUID) -> ChunkRunResult:
        run_id, version_ids = await self._start(course_id)
        counts: dict[str, int] = {"versions_considered": len(version_ids)}
        failures: list[VersionFailure] = []
        for version_id in version_ids:
            try:
                outcome, created, reused = await self._chunk_version(version_id)
            except _Failed as failed:
                counts["versions_failed"] = counts.get("versions_failed", 0) + 1
                failures.append(
                    VersionFailure(
                        resource_version_id=version_id, stage=failed.stage, error=failed.error
                    )
                )
                logger.warning(
                    "retrieval.chunk_version_failed",
                    extra={"run_id": str(run_id), "resource_version_id": str(version_id),
                           "stage": failed.stage.value, "error": failed.error},
                )  # fmt: skip
                continue
            counts[outcome] = counts.get(outcome, 0) + 1
            counts["chunks_created"] = counts.get("chunks_created", 0) + created
            counts["chunks_reused"] = counts.get("chunks_reused", 0) + reused
        summary = ChunkRunSummary(chunker_version=self._params.version, failures=failures, **counts)
        status = WorkflowRunStatus.FAILED if failures else WorkflowRunStatus.SUCCEEDED
        async with self._sessions() as session, session.begin():
            run = await session.get_one(WorkflowRun, run_id)
            run.status = status
            run.finished_at = max(datetime.now(UTC), run.started_at or datetime.now(UTC))
            run.summary = summary.model_dump(mode="json")
        logger.info(
            "retrieval.chunk_finished",
            extra={"run_id": str(run_id), "status": status.value}
            | summary.model_dump(mode="json", exclude={"failures"}),
        )
        return ChunkRunResult(run_id, status, summary)

    async def _start(self, course_id: uuid.UUID) -> tuple[uuid.UUID, list[uuid.UUID]]:
        async with self._sessions() as session, session.begin():
            if not await session.scalar(select(exists().where(Course.id == course_id))):
                raise CourseNotFoundError(f"course {course_id} does not exist")
            version_ids = await store.all_versions(session, course_id)
            run = WorkflowRun(
                workflow_version=CHUNK_WORKFLOW_VERSION,
                course_id=course_id,
                status=WorkflowRunStatus.RUNNING,
                started_at=datetime.now(UTC),
            )
            session.add(run)
            await session.flush()
            if version_ids:
                await session.execute(
                    insert(workflow_run_inputs),
                    [{"run_id": run.id, "resource_version_id": v} for v in version_ids],
                )
        return run.id, version_ids

    async def _chunk_version(self, version_id: uuid.UUID) -> tuple[str, int, int]:
        """(outcome counter, chunks created, chunks reused)."""
        chunker = self._params.version
        async with self._sessions() as session:
            source = await store.load_version(session, version_id)
        content, drafts = derive_chunks(source, self._params)
        if content is SourceContent.NO_VISIBLE_TEXT:
            return "versions_without_text", 0, 0  # nothing to retrieve; not an error
        if content is SourceContent.INVALID:
            raise _Failed(FailureStage.CHUNK, "ChunkingError")
        try:
            async with self._sessions() as session, session.begin():
                await store.lock_version(session, version_id)
                existing = await store.existing_chunks(session, version_id, chunker)
                state = store.compare_chunks(existing, drafts)
                if state is ChunkState.MISMATCH:
                    raise _Failed(FailureStage.CHUNK_STATE)
                if state is ChunkState.EXACT:
                    return "versions_already_chunked", 0, len(existing)
                await store.insert_chunks(session, version_id, chunker, drafts)
                stored = await store.existing_chunks(session, version_id, chunker)
                if store.compare_chunks(stored, drafts) is not ChunkState.EXACT:
                    raise _Failed(FailureStage.PERSIST_VERSION, "ChunkVerification")
        except IntegrityError as exc:
            raise _Failed(FailureStage.PERSIST_VERSION, type(exc).__name__) from None
        return "versions_chunked", len(drafts), 0
