# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""The construction demo: the gate keeps a responsible role or notice period
only when the statement states it (unknown otherwise), the committed
documents match their source, and the offline workflow extracts the
requirements with role, notice period or due date, quote, page and revision,
then brings in Inspection Procedure Revision B through the versioning path:
the superseding relationship is explicit, Revision A's requirement and
evidence stay stored as history, and the changed requirement is reported."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.nebius import NebiusTokenFactoryProvider
from app.api.v1.workflows import get_demo_replay
from app.db.models import ModelCall, Obligation, ResourceVersion
from app.demo import construction_content as content
from app.demo.construction import FIXTURE_MODEL, OBLIGATION_PROMPT, ConstructionDemo
from app.demo.generate import CONSTRUCTION_ROOT, build_construction, differences
from app.domain.enums import BlockKind, ResourceType
from app.extraction.claim_units import ClaimUnit
from app.extraction.obligations import ObligationExtraction, gate_obligations
from app.extraction.units import ExtractionUnit, UnitSpan
from app.ingestion.storage import LocalRawObjectStore
from tests.retrieval_seed import seed_course, seed_version

# --- the gate: role and notice period are kept only when the statement states them --------

PAGE = (
    "2. Inspection requests\n"
    f"{content.NOTICE_REV_A}\n"
    "Requests are made on the site inspection form.\n"
    f"{content.PPE}\n"
)


def _unit() -> ClaimUnit:
    span = UnitSpan("S1", uuid.uuid4(), PAGE, "page 1")
    unit = ExtractionUnit(
        uuid.uuid4(), uuid.uuid4(), "Inspection Procedure", "procedure", 0, (span,)
    )
    return ClaimUnit(unit, ())


def _proposal(quote: str, role: str | None, notice: str | None) -> dict[str, Any]:
    return {
        "action": "x",
        "category": "other",
        "assessment": None,
        "evidence": [{"span": "S1", "quote": quote}],
        "due": {"status": "not_stated", "due_date": None, "due_time": None, "evidence": None},
        "responsible_role": role,
        "notice_period": notice,
    }


def _gate(*proposals: dict[str, Any]) -> Any:
    extraction = ObligationExtraction.model_validate({"obligations": list(proposals)})
    return gate_obligations(_unit(), extraction, "Europe/London")


def test_gate_keeps_role_and_notice_stated_in_the_statement() -> None:
    result = _gate(_proposal(content.NOTICE_REV_A, "Contractor", "48 hours' notice"))
    (gated,) = result.obligations
    assert (gated.responsible_role, gated.notice_period) == ("Contractor", "48 hours' notice")
    assert gated.status.value == "verified"
    assert not result.rejected


def test_gate_drops_values_the_statement_does_not_state() -> None:
    result = _gate(
        # A role named elsewhere on the page, and a different notice period.
        _proposal(content.PPE, "Contractor", "72 hours' notice"),
        # Not a duration at all.
        _proposal(content.NOTICE_REV_A, "Site Manager", "Site Manager"),
    )
    ppe, notice = result.obligations
    assert (ppe.responsible_role, ppe.notice_period) == (None, None)
    # "Site Manager" is in the notice sentence (as recipient): the gate checks
    # presence, not grammar, so the role is kept; the "period" is not a period.
    assert (notice.responsible_role, notice.notice_period) == ("Site Manager", None)
    assert result.rejected == {
        "responsible_role:value_not_in_statement": 1,
        "notice_period:value_not_in_statement": 1,
        "notice_period:not_a_period": 1,
    }
    # Dropped values never block the requirement itself.
    assert [o.status.value for o in result.obligations] == ["verified", "verified"]


def test_gate_leaves_unstated_values_unknown() -> None:
    (gated,) = _gate(_proposal(content.PPE, None, None)).obligations
    assert (gated.responsible_role, gated.notice_period) == (None, None)
    assert gated.modality is not None and gated.modality.value == "mandatory"


def test_committed_documents_match_their_source() -> None:
    assert differences(CONSTRUCTION_ROOT, build_construction(), "documents") == []


def test_every_document_says_it_is_synthetic() -> None:
    for doc in content.CONSTRUCTION_DOCUMENTS.values():
        assert doc.pages[0][0].text == content.SYNTHETIC


# --- the offline workflow -------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_live_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    async def refuse(*_: Any, **__: Any) -> Any:
        raise AssertionError("a live provider call was attempted")

    monkeypatch.setattr(NebiusTokenFactoryProvider, "chat_structured", refuse)


def _norm(text: str) -> str:
    return " ".join(text.split())


def _by_statement(obligations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for o in obligations:
        statement = next(_norm(e["quote"]) for e in o["evidence"] if e["field"] == "obligation")
        out[statement] = o
    return out


@pytest.mark.anyio
async def test_construction_demo_extracts_then_brings_in_revision_b(
    app: FastAPI, client: httpx.AsyncClient, committed_session: AsyncSession, tmp_path: Path
) -> None:
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    raw = tmp_path / "raw"
    raw.mkdir()
    app.dependency_overrides[get_demo_replay] = lambda: ConstructionDemo(
        sessions, LocalRawObjectStore(raw)
    )

    status = (await client.get("/api/v1/demo/status")).json()
    assert status == {"project_loaded": False, "other_demo_data": False,
                      "mode": "replay:authored-fixture"}  # fmt: skip

    started = (await client.post("/api/v1/demo/workflow-runs", json={"reset": True})).json()
    assert started["succeeded"] is True
    assert (await client.get("/api/v1/demo/status")).json()["project_loaded"] is True
    (project,) = (await client.get("/api/v1/courses")).json()
    assert project["title"] == "KYD001 Kestrel Yard Depot Extension (fictional)"
    pid = project["id"]

    # INITIAL: Revision A only. Every authored requirement but Revision B's.
    reqs = _by_statement((await client.get(f"/api/v1/courses/{pid}/obligations")).json())
    assert len(reqs) == len(content.REQUIREMENTS) - 1
    assert content.NOTICE_REV_B not in reqs
    notice_a = reqs[content.NOTICE_REV_A]
    assert notice_a["status"] == "verified"
    assert (notice_a["responsible_role"], notice_a["notice_period"], notice_a["due"]) == (
        "Contractor", "48 hours' notice", None)  # fmt: skip
    (evidence,) = notice_a["evidence"]
    assert (evidence["page_number"], evidence["version_number"], evidence["current_version"]) == (
        3, 1, True)  # fmt: skip
    assert evidence["resource_title"] == "Inspection Procedure IP-01"
    assert (evidence["model"], evidence["prompt_version"]) == (FIXTURE_MODEL, OBLIGATION_PROMPT)
    # Unknown stays unknown.
    assert (reqs[content.COVER_UP]["responsible_role"], reqs[content.COVER_UP]["notice_period"]) == (
        None, None)  # fmt: skip
    ppe = reqs[content.PPE]
    assert (ppe["modality"], ppe["responsible_role"], ppe["notice_period"]) == (
        "mandatory", None, None)  # fmt: skip
    assert reqs[content.HI_VIS]["modality"] == "recommended"
    application = reqs[content.APPLICATION_1]
    assert application["due"]["due_date"] == "2026-11-27"
    assert application["responsible_role"] == "Contractor"
    pay = reqs[content.PAY_PERIOD]
    assert (pay["responsible_role"], pay["notice_period"], pay["due"]) == (
        "Employer", "within 14 days", None)  # fmt: skip
    assert all(r["status"] == "verified" for r in reqs.values())

    docs = {d["title"]: d for d in (await client.get(f"/api/v1/courses/{pid}/documents")).json()}
    assert sorted(docs) == ["Commercial Terms CT-01", "Inspection Procedure IP-01",
                            "Site Safety Rules SSR-01"]  # fmt: skip
    assert [(r["revision_label"], r["current"]) for r in
            docs["Inspection Procedure IP-01"]["revisions"]] == [("Rev A", True)]  # fmt: skip
    assert (await client.get("/api/v1/changes")).json() == []

    # Reading pages never changes the demo state.
    async with sessions() as session:
        rows_before = await session.scalar(select(func.count()).select_from(Obligation))
    for path in ("/demo/status", "/courses", f"/courses/{pid}/obligations", "/changes"):
        assert (await client.get(f"/api/v1{path}")).status_code == 200
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Obligation)) == rows_before

    # SYNC: Revision B, as version 2 of the same document.
    synced = (await client.post("/api/v1/demo/sync")).json()
    assert synced["succeeded"] is True
    assert [(c["resource_title"], c["old_version"], c["new_version"])
            for c in synced["changes"]] == [("Inspection Procedure IP-01", 1, 2)]  # fmt: skip

    reqs = _by_statement((await client.get(f"/api/v1/courses/{pid}/obligations")).json())
    assert len(reqs) == len(content.REQUIREMENTS)
    old, new = reqs[content.NOTICE_REV_A], reqs[content.NOTICE_REV_B]
    # History: Revision A's requirement and its evidence are kept, marked superseded.
    assert old["supported_by_current_version"] is False
    assert [(e["version_number"], e["current_version"]) for e in old["evidence"]] == [(1, False)]
    assert new["supported_by_current_version"] is True
    assert (new["responsible_role"], new["notice_period"]) == ("Contractor", "72 hours' notice")
    assert [e["version_number"] for e in new["evidence"]] == [2]
    # Unchanged wording: one requirement, evidence in both revisions.
    records = reqs[content.RECORDS]
    assert records["supported_by_current_version"] is True
    assert sorted(e["version_number"] for e in records["evidence"]) == [1, 2]

    (sync,) = (await client.get("/api/v1/changes")).json()
    (change,) = sync["changes"]
    assert (change["old_version"]["revision_label"], change["new_version"]["revision_label"]) == (
        "Rev A", "Rev B")  # fmt: skip
    assert change["supersession"]["quote"] == "This revision supersedes Revision A"
    assert change["supersession"]["names_previous_revision"] is True
    assert change["supersession"]["page_number"] == 1
    kinds = [a["kind"] for a in change["affected"]]
    assert kinds == ["requirement_changed"]
    (changed,) = change["affected"]
    assert changed["old_value"]["notice_period"] == "48 hours' notice"
    assert changed["new_value"]["notice_period"] == "72 hours' notice"
    assert [(_norm(s["quote"]), s["version_number"]) for s in changed["sources"]] == [
        (content.NOTICE_REV_A, 1), (content.NOTICE_REV_B, 2)]  # fmt: skip

    revisions = {d["title"]: d for d in (await client.get(f"/api/v1/courses/{pid}/documents")).json()}[
        "Inspection Procedure IP-01"]["revisions"]  # fmt: skip
    assert [(r["revision_label"], r["current"]) for r in revisions] == [("Rev A", False),
                                                                        ("Rev B", True)]  # fmt: skip
    assert revisions[0]["superseded_by_version_id"] == revisions[1]["id"]
    assert revisions[1]["supersedes_version_id"] == revisions[0]["id"]
    assert revisions[1]["supersession"]["names_revision"] == "Rev A"

    # SYNC AGAIN: nothing new, nothing recreated.
    again = (await client.post("/api/v1/demo/sync")).json()
    assert again == {**again, "succeeded": True, "changes": []}

    # Every model call was the authored fixture, never a live model.
    async with sessions() as session:
        models = set((await session.scalars(select(ModelCall.model))).all())
    assert models == {FIXTURE_MODEL}


@pytest.mark.anyio
async def test_live_analysis_is_unavailable_without_credentials(
    client: httpx.AsyncClient, committed_session: AsyncSession
) -> None:
    capabilities = (await client.get("/api/v1/capabilities")).json()
    assert capabilities["live_analysis"] is False
    assert "credentials" in capabilities["live_analysis_reason"]
    # A readable document (existence and permission are checked first).
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    project = await seed_course(sessions, "Project (test)")
    document = await seed_version(
        sessions, project, [(BlockKind.PAGE, "The Contractor must give notice.", None)],
        resource_type=ResourceType.PROCEDURE, title="Procedure (test)",
    )  # fmt: skip
    async with sessions() as session:
        resource_id = (await session.get(ResourceVersion, document)).resource_id
    response = await client.post(f"/api/v1/documents/{resource_id}/live-requirements")
    assert response.status_code == 503
