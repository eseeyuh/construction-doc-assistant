# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Search one construction project's documents, by revision.

Built from the course search's parts (``rankers``, ``fusion``, the recorded
embedding call and the span-evidence assembly), with two differences:

- Revisions. ``revisions="current"`` (the default) searches the revisions IN
  FORCE: every stored revision that no other revision of the same document
  explicitly supersedes (``revision-supersession/v1``). Once Revision B
  states that it supersedes Revision A, Revision A is excluded; a newer
  upload that states nothing excludes nothing. ``revisions="all"`` searches
  every stored revision, and each hit says whether its revision is
  superseded and by which statement.
- Modes and where vectors come from, never mixed or substituted:
  * ``lexical``: PostgreSQL full-text ranking over the deterministic chunks.
    No embeddings, no provider, no network: the offline mode.
  * ``hybrid``: vector and lexical rankings fused by RRF. Needs an embedding
    provider, named by ``embeddings``: ``live`` (the configured provider,
    a paid call per query) or ``replay`` (a recorded snapshot, evaluation
    only). Without a provider hybrid search refuses (``ProviderUnavailable``);
    it never falls back to lexical results.

Fails closed, never searches a partial corpus: every selected revision must
be chunked exactly (lexical), and also embedded in the provider's space
(hybrid); otherwise ``IndexNotReady``. Inconsistent stored chunks or links
raise ``IndexStateError``. Logs carry IDs and counts only, never query text.
"""

from __future__ import annotations

import enum
import logging
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.embeddings import EmbeddingProvider, construction_query_input
from app.ai.model_calls import RecordedCallError, VectorStorageError, call_embeddings_recorded
from app.db.models import Course, Resource, ResourceVersion
from app.db.session import read_only_snapshot
from app.domain.enums import ResourceType
from app.reasoning.revisions import (
    SUPERSESSION_RULES_VERSION,
    RevisionStatus,
    revision_label,
    revision_statuses,
)
from app.retrieval import store
from app.retrieval.chunking import SPAN_PACK_V1, ChunkingParams
from app.retrieval.fusion import CANDIDATE_DEPTH, FUSION_VERSION, fuse_rrf
from app.retrieval.indexing import SourceContent, inspect_versions_in_session
from app.retrieval.rankers import LEXICAL_VERSION, SearchScope, rank_lexical, rank_vector
from app.retrieval.search import (
    IndexStateError,
    QueryCallNotRecordedError,
    SearchHit,
    SearchProviderError,
    assemble_hits,
    fused_ranked,
    lexical_ranked,
)
from app.retrieval.store import ChunkState, LinkState

logger = logging.getLogger(__name__)

MAX_K = 20


class ProjectSearchMode(enum.StrEnum):
    LEXICAL = "lexical"
    HYBRID = "hybrid"


class RevisionScope(enum.StrEnum):
    CURRENT = "current"  # revisions in force
    ALL = "all"  # every stored revision, superseded ones marked


Embeddings = Literal["none", "live", "replay"]


class ProjectNotFoundError(LookupError):
    pass


class ProviderUnavailable(RuntimeError):
    """Hybrid search was asked for without an embedding provider."""


class IndexNotReady(RuntimeError):
    """Selected revisions are not indexed for the mode. Counts only."""

    def __init__(self, mode: ProjectSearchMode, not_ready: int, selected: int) -> None:
        need = "embedded in the active space" if mode is ProjectSearchMode.HYBRID else "chunked"
        super().__init__(f"{not_ready} of {selected} selected revision(s) are not {need}")
        self.mode, self.not_ready, self.selected = mode, not_ready, selected


@dataclass(frozen=True, slots=True)
class RevisionInfo:
    version_id: uuid.UUID
    version_number: int
    stored_label: str  # derived from version order; display only
    stated_revision: str | None  # what the revision itself says it is
    file_name: str
    latest: bool
    in_force: bool
    superseded_by_version_id: uuid.UUID | None
    superseded_by_revision: str | None
    supersession_quote: str | None
    supersession_page: int | None


@dataclass(frozen=True, slots=True)
class ProjectHit:
    hit: SearchHit  # rank, scores, chunk text and SourceSpan evidence
    revision: RevisionInfo


@dataclass(frozen=True, slots=True)
class ProjectSearchResult:
    course_id: uuid.UUID
    mode: ProjectSearchMode
    embeddings: Embeddings
    revisions: RevisionScope
    score_kind: str
    chunker_version: str
    lexical_version: str
    fusion_version: str | None
    supersession_rules: str
    query_format: str | None
    query_model_call_id: uuid.UUID | None
    revisions_searched: int
    revisions_excluded_as_superseded: int
    hits: tuple[ProjectHit, ...]


@dataclass(frozen=True, slots=True)
class _Corpus:
    statuses: dict[uuid.UUID, RevisionStatus]
    selected: tuple[uuid.UUID, ...]  # with text to search
    excluded: int


class ProjectSearchService:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        provider: EmbeddingProvider | None = None,
        embeddings: Literal["live", "replay"] | None = None,
        params: ChunkingParams = SPAN_PACK_V1,
    ) -> None:
        if (provider is None) != (embeddings is None):
            raise ValueError("an embedding provider must say whether it is live or replay")
        self._sessions = session_factory
        self._provider = provider
        self._embeddings: Embeddings = embeddings or "none"
        self._params = params

    async def search(
        self,
        course_id: uuid.UUID,
        query: str,
        *,
        mode: ProjectSearchMode = ProjectSearchMode.LEXICAL,
        revisions: RevisionScope = RevisionScope.CURRENT,
        k: int = 10,
        resource_types: frozenset[ResourceType] | None = None,
    ) -> ProjectSearchResult:
        """``resource_types``: the caller's permission scope (None: unrestricted,
        for internal and evaluation use). Revisions of other document types are
        dropped before anything is selected, ranked or counted."""
        started = time.perf_counter()
        query = query.strip()
        if not query or len(query) > 2000 or chr(0) in query:
            raise ValueError("query must be 1-2000 characters")
        if not 1 <= k <= MAX_K:
            raise ValueError(f"k must be between 1 and {MAX_K}")
        if mode is ProjectSearchMode.LEXICAL:
            result = await self._lexical(course_id, query, revisions, k, resource_types)
        else:
            result = await self._hybrid(course_id, query, revisions, k, resource_types)
        logger.info(
            "retrieval.project_search_completed",
            extra={"course_id": str(course_id), "mode": mode.value,
                   "embeddings": result.embeddings, "revisions": revisions.value, "k": k,
                   "hits": len(result.hits), "revisions_searched": result.revisions_searched,
                   "latency_ms": round((time.perf_counter() - started) * 1000)},
        )  # fmt: skip
        return result

    # --- modes ---------------------------------------------------------------------------

    async def _lexical(
        self,
        course_id: uuid.UUID,
        query: str,
        revisions: RevisionScope,
        k: int,
        types: frozenset[ResourceType] | None,
    ) -> ProjectSearchResult:
        async with read_only_snapshot(self._sessions) as session:
            corpus = await self._corpus(
                session, course_id, revisions, ProjectSearchMode.LEXICAL, types
            )
            ranked = await rank_lexical(session, self._scope(course_id, corpus, types), query, k)
            hits = await assemble_hits(session, [lexical_ranked(c) for c in ranked])
            out = await self._decorate(session, corpus, hits)
        return self._result(course_id, ProjectSearchMode.LEXICAL, "none", revisions, corpus, out,
                            None, None)  # fmt: skip

    async def _hybrid(
        self,
        course_id: uuid.UUID,
        query: str,
        revisions: RevisionScope,
        k: int,
        types: frozenset[ResourceType] | None,
    ) -> ProjectSearchResult:
        if self._provider is None:
            raise ProviderUnavailable("hybrid search needs an embedding provider")
        mode = ProjectSearchMode.HYBRID
        # Verify before paying for the query embedding; nothing selected, no call.
        async with read_only_snapshot(self._sessions) as session:
            corpus = await self._corpus(session, course_id, revisions, mode, types)
        query_input = construction_query_input(query)
        if not corpus.selected:
            return self._result(course_id, mode, self._embeddings, revisions, corpus, (),
                                query_input.input_format, None)  # fmt: skip
        try:
            recorded = await call_embeddings_recorded(self._provider, self._sessions, [query_input])
        except RecordedCallError as failed:
            raise SearchProviderError(failed.error.category, failed.model_call_id) from failed
        except VectorStorageError as failed:
            raise QueryCallNotRecordedError(failed.model_call_id) from failed
        vector = recorded.result.vectors[0]
        async with read_only_snapshot(self._sessions) as session:
            corpus = await self._corpus(session, course_id, revisions, mode, types)
            space = await store.find_space(session, self._provider.space)
            scope = self._scope(course_id, corpus, types)
            if space is None or not corpus.selected:  # pragma: no cover - verified above
                hits: tuple[SearchHit, ...] = ()
            else:
                by_vector = await rank_vector(session, scope, space, vector, CANDIDATE_DEPTH)
                by_lexical = await rank_lexical(session, scope, query, CANDIDATE_DEPTH)
                fused = fuse_rrf(by_vector, by_lexical)[:k]
                hits = await assemble_hits(session, [fused_ranked(c) for c in fused])
            out = await self._decorate(session, corpus, hits)
        return self._result(course_id, mode, self._embeddings, revisions, corpus, out,
                            query_input.input_format, recorded.model_call_id)  # fmt: skip

    # --- corpus --------------------------------------------------------------------------

    async def _corpus(
        self,
        session: AsyncSession,
        course_id: uuid.UUID,
        revisions: RevisionScope,
        mode: ProjectSearchMode,
        types: frozenset[ResourceType] | None = None,
    ) -> _Corpus:
        if not await session.scalar(select(exists().where(Course.id == course_id))):
            raise ProjectNotFoundError(str(course_id))
        statuses = await revision_statuses(session, course_id)
        if types is not None:
            allowed = set(
                await session.scalars(
                    select(Resource.id).where(
                        Resource.course_id == course_id, Resource.type.in_(sorted(types))
                    )
                )
            )
            statuses = {v: s for v, s in statuses.items() if s.resource_id in allowed}
        wanted = [v for v, s in statuses.items() if revisions is RevisionScope.ALL or s.in_force]
        excluded = len(statuses) - len(wanted)
        space = (
            self._provider.space if mode is ProjectSearchMode.HYBRID and self._provider else None
        )
        reports = await inspect_versions_in_session(session, wanted, space, params=self._params)
        corrupt, not_ready, selected = [], 0, []
        for report in reports:
            if report.content is SourceContent.NO_VISIBLE_TEXT and report.chunks == 0:
                continue  # nothing to retrieve in it
            unusable = report.content is not SourceContent.CHUNKABLE
            if unusable or report.chunk_state is ChunkState.MISMATCH:
                corrupt.append(report.resource_version_id)
            elif report.chunk_state is ChunkState.NONE:
                not_ready += 1
            elif mode is ProjectSearchMode.HYBRID and report.link_state is LinkState.INCONSISTENT:
                corrupt.append(report.resource_version_id)
            elif mode is ProjectSearchMode.HYBRID and report.link_state is not LinkState.COMPLETE:
                not_ready += 1
            else:
                selected.append(report.resource_version_id)
        if corrupt:
            raise IndexStateError(course_id, corrupt, len(reports))
        if not_ready:
            raise IndexNotReady(mode, not_ready, len(reports))
        return _Corpus(statuses, tuple(selected), excluded)

    def _scope(
        self, course_id: uuid.UUID, corpus: _Corpus, types: frozenset[ResourceType] | None
    ) -> SearchScope:
        # version_ids already exclude other types; resource_types repeats the
        # bound in SQL (an empty selection matches nothing either way).
        return SearchScope(
            course_id=course_id,
            version_ids=corpus.selected,
            chunker_version=self._params.version,
            resource_types=types,
            require_current_version=False,  # selection is by supersession, not by recency
        )

    async def _decorate(
        self, session: AsyncSession, corpus: _Corpus, hits: Sequence[SearchHit]
    ) -> tuple[ProjectHit, ...]:
        if not hits:
            return ()
        names = dict(
            (
                await session.execute(
                    select(ResourceVersion.id, ResourceVersion.display_name).where(
                        ResourceVersion.id.in_({h.version.id for h in hits})
                    )
                )
            ).all()
        )
        out = []
        for hit in hits:
            status = corpus.statuses[hit.version.id]
            by = status.superseded_by
            out.append(
                ProjectHit(
                    hit,
                    RevisionInfo(
                        version_id=status.version_id,
                        version_number=status.version_number,
                        stored_label=revision_label(status.version_number),
                        stated_revision=status.stated_revision,
                        file_name=names[hit.version.id],
                        latest=status.latest,
                        in_force=status.in_force,
                        superseded_by_version_id=by.version_id if by else None,
                        superseded_by_revision=by.stated_revision if by else None,
                        supersession_quote=by.quote if by else None,
                        supersession_page=by.page_number if by else None,
                    ),
                )
            )
        return tuple(out)

    def _result(
        self,
        course_id: uuid.UUID,
        mode: ProjectSearchMode,
        embeddings: Embeddings,
        revisions: RevisionScope,
        corpus: _Corpus,
        hits: tuple[ProjectHit, ...],
        query_format: str | None,
        query_model_call_id: uuid.UUID | None,
    ) -> ProjectSearchResult:
        hybrid = mode is ProjectSearchMode.HYBRID
        return ProjectSearchResult(
            course_id=course_id,
            mode=mode,
            embeddings=embeddings,
            revisions=revisions,
            score_kind="rrf" if hybrid else "ts_rank_cd",
            chunker_version=self._params.version,
            lexical_version=LEXICAL_VERSION,
            fusion_version=FUSION_VERSION if hybrid else None,
            supersession_rules=SUPERSESSION_RULES_VERSION,
            query_format=query_format,
            query_model_call_id=query_model_call_id,
            revisions_searched=len(corpus.selected),
            revisions_excluded_as_superseded=corpus.excluded,
            hits=hits,
        )
