# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Construction document search: project isolation, current versus
historical revisions (supersession only when a revision states it), citation
metadata, missing live-embedding credentials and idempotent indexing.

Built on the real demo documents (parsed, chunked and searched by the
production code). Hybrid search runs here with ``FakeEmbeddingProvider``, a
labelled test double standing in for the live provider: it exercises the
pipeline, and says nothing about retrieval quality."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import Chunk, ChunkEmbedding, ModelCall
from app.demo import construction_content as content
from app.demo.construction import ConstructionDemo
from app.domain.enums import BlockKind
from app.ingestion.storage import LocalRawObjectStore
from app.reasoning.revisions import revision_statuses, stated_revision
from app.retrieval.chunk_index import ChunkIndexer
from app.retrieval.indexing import IndexingService
from app.retrieval.project_search import (
    IndexNotReady,
    ProjectSearchMode,
    ProjectSearchService,
    ProviderUnavailable,
    RevisionScope,
)
from tests.embedding_fakes import FakeEmbeddingProvider
from tests.retrieval_seed import seed_course, seed_version

pytestmark = pytest.mark.anyio

NOTICE_QUERY = "how much notice before an inspection"
HYBRID = ProjectSearchMode.HYBRID
ALL = RevisionScope.ALL


def _flat(text: str) -> str:
    return " ".join(text.split())


@pytest.fixture
async def demo(committed_session: AsyncSession, tmp_path: Path) -> Any:
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    raw = tmp_path / "raw"
    raw.mkdir()
    built = ConstructionDemo(sessions, LocalRawObjectStore(raw))
    courses, outcomes = await built.ingest(reset=True)
    (course_id,) = courses.values()
    built.course_id = course_id
    built.ingest_outcome = next(iter(outcomes.values()))
    return built


async def _count(sessions: Any, model: Any) -> int:
    async with sessions() as session:
        return int(await session.scalar(select(func.count()).select_from(model)) or 0)


def _search(sessions: Any, **kwargs: Any) -> ProjectSearchService:
    return ProjectSearchService(sessions, **kwargs)


def _files(result: Any) -> list[str]:
    return [h.revision.file_name for h in result.hits]


# --- idempotent indexing -----------------------------------------------------------------


async def test_offline_build_chunks_every_revision_once_and_embeds_nothing(demo: Any) -> None:
    sessions = demo.sessions
    first = demo.ingest_outcome.counts["retrieval_index"]["chunks_created"]
    chunks = await _count(sessions, Chunk)
    assert first == chunks > 0
    assert await _count(sessions, ChunkEmbedding) == 0
    assert await _count(sessions, ModelCall) == 0  # nothing was embedded, nothing invented

    again = await ChunkIndexer(sessions).index_course(demo.course_id)
    assert again.summary.chunks_created == 0
    assert again.summary.versions_already_chunked == again.summary.versions_considered == 3
    assert await _count(sessions, Chunk) == chunks

    await demo.sync()  # Revision B arrives and is chunked; Revision A's chunks are kept
    after_sync = await _count(sessions, Chunk)
    assert after_sync > chunks
    third = await ChunkIndexer(sessions).index_course(demo.course_id)
    assert (third.summary.chunks_created, third.summary.versions_already_chunked) == (0, 4)
    assert await _count(sessions, Chunk) == after_sync


async def test_live_style_indexing_of_all_revisions_is_idempotent(demo: Any) -> None:
    sessions = demo.sessions
    await demo.sync()
    provider = FakeEmbeddingProvider()
    service = IndexingService(
        sessions, provider, batch_max_items=64, batch_max_estimated_tokens=32_000
    )
    first = await service.index_course(demo.course_id, all_versions=True)
    assert first.summary.versions_considered == 4  # Revision A included, as history
    assert first.summary.chunks_created == 0  # the offline chunks are reused exactly
    assert first.summary.links_created == await _count(sessions, Chunk)
    calls = len(provider.calls)
    second = await service.index_course(demo.course_id, all_versions=True)
    assert second.summary.versions_already_indexed == 4
    assert (second.summary.links_created, second.summary.provider_calls) == (0, 0)
    assert len(provider.calls) == calls


# --- current versus historical revisions --------------------------------------------------


async def test_current_search_excludes_revision_a_only_once_revision_b_supersedes_it(
    demo: Any,
) -> None:
    search = _search(demo.sessions)
    before = await search.search(demo.course_id, NOTICE_QUERY)
    assert "IP-01_Inspection_Procedure_RevA.pdf" in _files(before)
    assert before.revisions_excluded_as_superseded == 0

    await demo.sync()
    current = await search.search(demo.course_id, NOTICE_QUERY)
    assert "IP-01_Inspection_Procedure_RevA.pdf" not in _files(current)
    assert _files(current)[0] == "IP-01_Inspection_Procedure_RevB.pdf"
    assert current.revisions_excluded_as_superseded == 1
    assert all(h.revision.in_force for h in current.hits)

    history = await search.search(demo.course_id, NOTICE_QUERY, revisions=ALL)
    by_file = {h.revision.file_name: h.revision for h in history.hits}
    rev_a = by_file["IP-01_Inspection_Procedure_RevA.pdf"]
    assert (rev_a.stated_revision, rev_a.in_force, rev_a.latest) == ("A", False, False)
    assert rev_a.superseded_by_revision == "B"
    assert rev_a.supersession_quote == "This revision supersedes Revision A"
    assert by_file["IP-01_Inspection_Procedure_RevB.pdf"].in_force


async def test_upload_order_alone_supersedes_nothing(committed_session: AsyncSession) -> None:
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    course = await seed_course(sessions, "Method statements (test)")
    page = BlockKind.PAGE

    async def revision(*lines: str) -> uuid.UUID:
        return await seed_version(sessions, course, [(page, "\n".join(lines), None)],
                                  source_uri="upload:ms-01.pdf", title="Method Statement MS-01")  # fmt: skip

    v1 = await revision("Method Statement MS-01, Revision 1", "Scaffold inspections are weekly.")
    v2 = await revision("Method Statement MS-01, Revision 2", "Scaffold inspections are daily.")
    await ChunkIndexer(sessions).index_course(course)
    async with sessions() as session:
        statuses = await revision_statuses(session, course)
    # Revision 2 is newer, but says nothing about Revision 1: both stay in force.
    assert statuses[v1].in_force and statuses[v2].in_force
    assert (statuses[v1].latest, statuses[v2].latest) == (False, True)
    current = await _search(sessions).search(course, "scaffold inspections")
    assert {h.revision.version_id for h in current.hits} == {v1, v2}

    v3 = await revision(
        "Method Statement MS-01, Revision 3", "This revision supersedes Revision 1.",
        "Scaffold inspections are made before each shift.",
    )  # fmt: skip
    await ChunkIndexer(sessions).index_course(course)
    async with sessions() as session:
        statuses = await revision_statuses(session, course)
    assert not statuses[v1].in_force and statuses[v1].superseded_by.version_id == v3  # type: ignore[union-attr]
    assert statuses[v2].in_force  # not named: still in force, though older than Revision 3
    current = await _search(sessions).search(course, "scaffold inspections")
    assert {h.revision.version_id for h in current.hits} == {v2, v3}


def test_a_revision_states_its_own_code_outside_the_supersedes_clause() -> None:
    assert stated_revision(["Procedure, Revision B", "This revision supersedes Revision A."]) == "B"
    assert stated_revision(["This revision supersedes Revision A."]) is None
    assert stated_revision(["Site Safety Rules SSR-01"]) is None


# --- citation metadata --------------------------------------------------------------------


async def test_hits_cite_file_page_revision_and_the_stored_quote(
    demo: Any, client: httpx.AsyncClient, app: FastAPI
) -> None:
    await demo.sync()
    response = await client.post(
        f"/api/v1/courses/{demo.course_id}/search",
        json={"query": "safety helmets and safety footwear"},
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["mode"], body["embeddings"], body["revisions"]) == ("lexical", "none", "current")
    assert body["query_model_call_id"] is None and body["query_format"] is None
    top = body["hits"][0]
    assert top["document_title"] == "Site Safety Rules SSR-01"
    assert top["revision"]["file_name"] == "SSR-01_Site_Safety_Rules.pdf"
    assert top["revision"]["stated_revision"] is None  # the document states no revision code
    assert top["pages"] == [1]
    (citation,) = top["citations"]
    assert citation["page_number"] == 1
    assert content.PPE in _flat(citation["quote"])
    assert citation["quote"] in top["excerpt"] or top["excerpt"] in citation["quote"]

    notice = (
        await client.post(f"/api/v1/courses/{demo.course_id}/search", json={"query": NOTICE_QUERY})
    ).json()["hits"][0]
    assert notice["revision"]["file_name"] == "IP-01_Inspection_Procedure_RevB.pdf"
    assert (notice["revision"]["stated_revision"], notice["revision"]["stored_label"]) == (
        "B",
        "Rev B",
    )
    assert content.NOTICE_REV_B in _flat(notice["excerpt"])


# --- project isolation --------------------------------------------------------------------


async def test_search_never_leaves_its_project(demo: Any, client: httpx.AsyncClient) -> None:
    sessions = demo.sessions
    other = await seed_course(sessions, "Another project (test)")
    await seed_version(
        sessions, other,
        [(BlockKind.PAGE, "Give 48 hours notice of each inspection. Safety helmets required.", None)],
        source_uri="upload:other.pdf", title="Other Project Procedure",
    )  # fmt: skip
    await ChunkIndexer(sessions).index_course(other)

    ours = await _search(sessions).search(
        demo.course_id, "inspection notice helmets", revisions=ALL
    )
    theirs = await _search(sessions).search(other, "inspection notice helmets", revisions=ALL)
    assert ours.hits and theirs.hits
    assert "Other Project Procedure" not in {h.hit.resource.title for h in ours.hits}
    assert {h.hit.resource.title for h in theirs.hits} == {"Other Project Procedure"}

    missing = await client.post(f"/api/v1/courses/{uuid.uuid4()}/search", json={"query": "x"})
    assert missing.status_code == 404


# --- missing provider credentials ---------------------------------------------------------


async def test_hybrid_search_without_credentials_is_refused_not_downgraded(
    demo: Any, client: httpx.AsyncClient
) -> None:
    response = await client.post(
        f"/api/v1/courses/{demo.course_id}/search", json={"query": NOTICE_QUERY, "mode": "hybrid"}
    )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]
    assert NOTICE_QUERY not in response.text
    assert await _count(demo.sessions, ModelCall) == 0  # no call, no fallback results

    status = (await client.get(f"/api/v1/courses/{demo.course_id}/search/status")).json()
    assert status["lexical"] == {"available": True, "reason": None}
    assert status["hybrid"]["available"] is False
    assert "not configured" in status["hybrid"]["reason"]
    assert status["embedding_space"] is None
    assert all(r["chunked"] and r["embedded"] is None for r in status["revisions"])

    with pytest.raises(ProviderUnavailable):
        await _search(demo.sessions).search(demo.course_id, NOTICE_QUERY, mode=HYBRID)


async def test_hybrid_search_needs_every_selected_revision_embedded(demo: Any) -> None:
    sessions = demo.sessions
    await demo.sync()
    provider = FakeEmbeddingProvider()
    search = _search(sessions, provider=provider, embeddings="live")
    with pytest.raises(IndexNotReady):  # chunked, but not embedded: refused, not partial
        await search.search(demo.course_id, NOTICE_QUERY, mode=HYBRID)
    assert provider.calls == []

    await IndexingService(
        sessions, provider, batch_max_items=64, batch_max_estimated_tokens=32_000
    ).index_course(demo.course_id, all_versions=True)
    result = await search.search(demo.course_id, NOTICE_QUERY, mode=HYBRID)
    assert result.embeddings == "live" and result.query_format == "query/v2"
    assert result.query_model_call_id is not None
    assert "IP-01_Inspection_Procedure_RevA.pdf" not in _files(result)
    history = await search.search(demo.course_id, NOTICE_QUERY, mode=HYBRID, revisions=ALL)
    assert "IP-01_Inspection_Procedure_RevA.pdf" in _files(history)
