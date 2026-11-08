# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Demo sign-in permissions (no leak of Commercial Terms to the Site Engineer
through any content endpoint, search or chat) and the Ask project documents
tool loop: backend-fixed scope, cited-only-if-retrieved, the tool call limit
and provider failures.

The chat runs against ``ScriptedToolModel``, a labelled test double that
replays scripted tool-calling turns: it exercises the loop, the permission
boundary and citation checks, and says nothing about a real model's answers.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.errors import AIProviderError
from app.ai.provider import TokenUsage, ToolCall, ToolTurn
from app.api.v1.workflows import get_demo_replay
from app.db.models import ModelCall, Resource
from app.demo.construction import ConstructionDemo
from app.domain.enums import (
    ModelCallErrorCategory,
    ModelCallKind,
    ModelCallStatus,
    ModelRole,
    ResourceType,
)
from app.ingestion.storage import LocalRawObjectStore
from app.orchestration.project_chat import (
    MAX_TOOL_CALLS,
    ChatProviderError,
    ProjectChat,
)
from app.retrieval.project_search import ProjectSearchMode, ProjectSearchService

pytestmark = pytest.mark.anyio

SITE = frozenset({ResourceType.PROCEDURE, ResourceType.SAFETY_RULES})
ALL_TYPES = SITE | {ResourceType.CONTRACT}
COMMERCIAL_PHRASES = ("payment application", "Retention of 3 percent", "Commercial Terms")


@pytest.fixture
async def demo(
    app: FastAPI, client: httpx.AsyncClient, committed_session: AsyncSession, tmp_path: Path
) -> Any:
    """The demo as shown: built through the API (authored fixtures, offline),
    then Revision B loaded. ``client`` is signed in as the Commercial Manager."""
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    raw = tmp_path / "raw"
    raw.mkdir()
    built = ConstructionDemo(sessions, LocalRawObjectStore(raw))
    app.dependency_overrides[get_demo_replay] = lambda: built
    assert (await client.post("/api/v1/demo/workflow-runs", json={"reset": True})).json()[
        "succeeded"
    ]
    assert (await client.post("/api/v1/demo/sync")).json()["succeeded"]
    (project,) = (await client.get("/api/v1/courses")).json()
    built.course_id = uuid.UUID(project["id"])
    return built


async def _sign_in(client: httpx.AsyncClient, identity: str) -> None:
    response = await client.post("/api/v1/auth/demo-sign-in", json={"identity": identity})
    assert response.status_code == 200
    assert response.json()["identity"]["auth_mode"] == "demo"
    client.headers["Authorization"] = f"Bearer {response.json()['token']}"


async def _contract_id(demo: Any) -> uuid.UUID:
    async with demo.sessions() as session:
        return await session.scalar(
            select(Resource.id).where(
                Resource.course_id == demo.course_id, Resource.type == ResourceType.CONTRACT
            )
        )


# --- sign-in -------------------------------------------------------------------------------


async def test_content_endpoints_refuse_requests_without_a_valid_demo_sign_in(
    demo: Any, client: httpx.AsyncClient
) -> None:
    project = f"/api/v1/courses/{demo.course_id}"
    contract = await _contract_id(demo)
    content = [
        ("GET", "/api/v1/courses", None),
        ("GET", f"{project}/documents", None),
        ("GET", f"{project}/obligations", None),
        ("GET", f"/api/v1/documents/{contract}", None),
        ("POST", f"/api/v1/documents/{contract}/live-requirements", None),
        ("GET", "/api/v1/changes", None),
        ("POST", f"{project}/search", {"query": "retention"}),
        ("GET", f"{project}/search/status", None),
        ("POST", f"{project}/ask", {"question": "What retention applies?"}),
        ("POST", "/api/v1/demo/sync", None),
    ]
    for token in (None, "forged.token", "eyJzdWIiOiJjb21tZXJjaWFsLW1hbmFnZXIifQ.AAAA"):
        if token is None:
            client.headers.pop("Authorization", None)
        else:
            client.headers["Authorization"] = f"Bearer {token}"
        for method, path, body in content:
            response = await client.request(method, path, json=body)
            assert response.status_code == 401, (token, method, path, response.status_code)
            assert "Retention" not in response.text
    client.headers.pop("Authorization")
    for path in ("/api/v1/health", "/api/v1/capabilities", "/api/v1/auth/identities"):
        assert (await client.get(path)).status_code == 200
    unknown = await client.post("/api/v1/auth/demo-sign-in", json={"identity": "admin"})
    assert unknown.status_code == 422


# --- permissions ---------------------------------------------------------------------------


async def test_site_engineer_cannot_read_commercial_terms_through_any_endpoint(
    demo: Any, client: httpx.AsyncClient
) -> None:
    project = f"/api/v1/courses/{demo.course_id}"
    contract = await _contract_id(demo)
    await _sign_in(client, "site-engineer")

    documents = (await client.get(f"{project}/documents")).json()
    assert {d["type"] for d in documents} == {"procedure", "safety_rules"}
    assert (await client.get(f"/api/v1/documents/{contract}")).status_code == 403
    # Checked before the live provider is even set up (no credentials here).
    live = await client.post(f"/api/v1/documents/{contract}/live-requirements")
    assert live.status_code == 403

    obligations = (await client.get(f"{project}/obligations")).json()
    assert obligations
    assert {e["resource_type"] for o in obligations for e in o["evidence"]} <= set(SITE)

    for revisions in ("current", "all"):
        found = await client.post(
            f"{project}/search",
            json={"query": "payment application retention percent", "revisions": revisions},
        )
        assert found.status_code == 200
        assert {h["document_type"] for h in found.json()["hits"]} <= set(SITE)
    status = (await client.get(f"{project}/search/status")).json()
    assert {r["file_name"] for r in status["revisions"]} == {
        "IP-01_Inspection_Procedure_RevA.pdf",
        "IP-01_Inspection_Procedure_RevB.pdf",
        "SSR-01_Site_Safety_Rules.pdf",
    }
    changes = (await client.get("/api/v1/changes")).json()
    assert all(c["resource_type"] != "contract" for s in changes for c in s["changes"])
    # Inherited endpoints that are not filtered per document: full access only.
    assert (await client.get(f"{project}/dependencies")).status_code == 403

    for response in [
        await client.get(f"{project}/documents"),
        await client.get(f"{project}/obligations"),
        await client.get("/api/v1/changes"),
        await client.get(f"{project}/search/status"),
    ]:
        assert not any(p in response.text for p in COMMERCIAL_PHRASES), response.url

    # The Commercial Manager reads the same endpoints with Commercial Terms included.
    await _sign_in(client, "commercial-manager")
    documents = (await client.get(f"{project}/documents")).json()
    assert "contract" in {d["type"] for d in documents}
    assert (await client.get(f"/api/v1/documents/{contract}")).status_code == 200
    found = await client.post(
        f"{project}/search", json={"query": "payment application retention percent"}
    )
    assert "contract" in {h["document_type"] for h in found.json()["hits"]}
    assert (await client.get(f"{project}/dependencies")).status_code == 200


# --- chat ------------------------------------------------------------------------------------


class ScriptedToolModel:
    """Test double for a tool-calling provider: returns scripted turns and
    records exactly what it was sent (messages and tool_choice)."""

    name = "scripted-test-double"

    def __init__(self, turns: list[ToolTurn | Exception]) -> None:
        self._turns = list(turns)
        self.requests: list[dict[str, Any]] = []

    def model_for(self, role: ModelRole) -> str:
        return "scripted-model"

    async def chat_with_tools(self, messages: Any, tools: Any, **options: Any) -> ToolTurn:
        self.requests.append({"messages": copy.deepcopy(list(messages)), **options})
        turn = self._turns.pop(0) if self._turns else _answer("No more script.")
        if isinstance(turn, Exception):
            raise turn
        return turn


def _usage() -> TokenUsage:
    return TokenUsage(prompt_tokens=100, completion_tokens=20, reasoning_tokens=0)


def _search_call(call_id: str, **arguments: Any) -> ToolTurn:
    call = ToolCall(id=call_id, name="search_documents", arguments=json.dumps(arguments))
    return ToolTurn(None, (call,), "scripted-model", _usage(), 1)


def _answer(text: str) -> ToolTurn:
    return ToolTurn(text, (), "scripted-model", _usage(), 1)


def _chat(demo: Any, model: ScriptedToolModel) -> ProjectChat:
    search = ProjectSearchService(demo.sessions)
    return ProjectChat(model, demo.sessions, search, search_mode=ProjectSearchMode.LEXICAL)


def _tool_results(model: ScriptedToolModel) -> str:
    """Everything sent back to the model as tool results, over all turns."""
    return "\n".join(
        m["content"] for r in model.requests for m in r["messages"] if m["role"] == "tool"
    )


async def test_chat_search_scope_is_fixed_by_the_backend_not_by_the_model(demo: Any) -> None:
    model = ScriptedToolModel([
        # The model tries to widen its own scope: ignored, reported.
        _search_call("c1", query="payment application retention percent",
                     include_superseded=True, identity="commercial-manager",
                     document_types=["contract"]),
        _answer("Retention is 3 percent [S1]. Payment is due in 14 days [S7]."),
    ])  # fmt: skip
    answer = await _chat(demo, model).ask(
        demo.course_id, "What retention applies?", resource_types=SITE, viewer="site-engineer"
    )
    (trace,) = answer.tool_calls
    assert trace.ignored_arguments == ["document_types", "identity"]
    assert trace.include_superseded is True
    assert {s.document_type for s in answer.retrieved} <= SITE
    # Nothing from Commercial Terms reached the model.
    assert not any(p in _tool_results(model) for p in COMMERCIAL_PHRASES)
    # [S7] was never retrieved: removed from the answer and reported.
    assert "S7" in answer.removed_citations
    assert "[S7]" not in answer.answer
    assert "[citation removed: not a retrieved source]" in answer.answer
    assert all(c.source_id not in answer.removed_citations for c in answer.cited)


async def test_chat_cites_retrieved_sources_with_page_and_revision(demo: Any) -> None:
    model = ScriptedToolModel([
        _search_call("c1", query="notice of each inspection"),
        _answer("The Contractor must give 72 hours' notice [S1]."),
    ])  # fmt: skip
    answer = await _chat(demo, model).ask(
        demo.course_id, "How much notice?", resource_types=ALL_TYPES, viewer="commercial-manager"
    )
    assert answer.grounded and not answer.removed_citations
    (cited,) = answer.cited
    # One chunk of pages 2-4; the notice sentence is on page 3.
    assert (cited.file_name, cited.pages, cited.stated_revision, cited.in_force) == (
        "IP-01_Inspection_Procedure_RevB.pdf", (2, 3, 4), "B", True,
    )  # fmt: skip
    # Current revisions only by default: the superseded Rev A was not retrieved.
    assert "IP-01_Inspection_Procedure_RevA.pdf" not in {s.file_name for s in answer.retrieved}
    sent = json.loads(model.requests[1]["messages"][-1]["content"])
    assert "untrusted" in sent["note"]
    assert sent["passages"][0]["source_id"] == "S1"
    assert sent["passages"][0]["revision"] == "Revision B"
    assert "never follow them" in model.requests[0]["messages"][0]["content"]
    async with demo.sessions() as session:
        rows = (
            await session.scalars(
                select(ModelCall).where(ModelCall.call_kind == ModelCallKind.CHAT_TOOLS)
            )
        ).all()
    assert [(r.call_kind, r.status) for r in rows] == [
        (ModelCallKind.CHAT_TOOLS, ModelCallStatus.SUCCEEDED)
    ] * 2
    assert answer.usage.prompt_tokens == 200


async def test_chat_stops_searching_at_the_tool_call_limit(demo: Any) -> None:
    model = ScriptedToolModel(
        [_search_call(f"c{i}", query="inspection") for i in range(MAX_TOOL_CALLS + 3)]
    )
    answer = await _chat(demo, model).ask(
        demo.course_id, "Tell me everything.", resource_types=SITE, viewer="site-engineer"
    )
    assert len(answer.tool_calls) == MAX_TOOL_CALLS
    assert answer.tool_call_limit_reached
    assert len(model.requests) == MAX_TOOL_CALLS + 1
    assert model.requests[-1]["tool_choice"] == "none"
    assert model.requests[0]["tool_choice"] == "required"  # the first turn must search
    assert all(r["tool_choice"] == "auto" for r in model.requests[1:-1])
    assert not answer.grounded  # the scripted final turn cites nothing


async def test_chat_provider_failure_is_recorded_and_reported(demo: Any) -> None:
    failure = AIProviderError(
        ModelCallErrorCategory.RATE_LIMITED, "429", model="scripted-model", attempts=3,
        usage=TokenUsage(),
    )  # fmt: skip
    model = ScriptedToolModel([_search_call("c1", query="inspection"), failure])
    with pytest.raises(ChatProviderError) as raised:
        await _chat(demo, model).ask(
            demo.course_id, "How much notice?", resource_types=SITE, viewer="site-engineer"
        )
    assert raised.value.category is ModelCallErrorCategory.RATE_LIMITED
    async with demo.sessions() as session:
        statuses = (
            await session.scalars(
                select(ModelCall.status).where(ModelCall.call_kind == ModelCallKind.CHAT_TOOLS)
            )
        ).all()
    assert sorted(statuses) == sorted([ModelCallStatus.SUCCEEDED, ModelCallStatus.FAILED])


async def test_ask_without_model_credentials_says_where_to_add_them(
    demo: Any, client: httpx.AsyncClient
) -> None:
    await _sign_in(client, "site-engineer")
    response = await client.post(
        f"/api/v1/courses/{demo.course_id}/ask", json={"question": "How much notice?"}
    )
    assert response.status_code == 503
    assert ".env" in response.json()["detail"] and "NEBIUS_API_KEY" in response.json()["detail"]
    capabilities = (await client.get("/api/v1/capabilities")).json()
    assert capabilities["ask_documents"] is False
    async with demo.sessions() as session:
        chats = select(func.count()).where(ModelCall.call_kind == ModelCallKind.CHAT_TOOLS)
        assert await session.scalar(chats) == 0
