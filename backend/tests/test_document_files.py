# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""The revision file endpoint: the exact stored bytes of a revision the
signed-in identity may read, and nothing else."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.documents import get_raw_store, safe_filename
from app.api.v1.workflows import get_demo_replay
from app.demo.construction import ConstructionDemo
from app.ingestion.storage import LocalRawObjectStore

pytestmark = pytest.mark.anyio


@pytest.fixture
async def demo(
    app: FastAPI, client: httpx.AsyncClient, committed_session: AsyncSession, tmp_path: Path
) -> dict[str, Any]:
    """The demo built through the API (offline fixtures) with Revision B
    loaded, served from a temporary raw store. ``client`` is the Commercial
    Manager. Returns the raw store root and the documents by type."""
    sessions = async_sessionmaker(committed_session.bind, expire_on_commit=False)
    raw = tmp_path / "raw"
    raw.mkdir()
    store = LocalRawObjectStore(raw)
    app.dependency_overrides[get_demo_replay] = lambda: ConstructionDemo(sessions, store)
    app.dependency_overrides[get_raw_store] = lambda: store
    assert (await client.post("/api/v1/demo/workflow-runs", json={"reset": True})).json()[
        "succeeded"
    ]
    assert (await client.post("/api/v1/demo/sync")).json()["succeeded"]
    (project,) = (await client.get("/api/v1/courses")).json()
    documents = (await client.get(f"/api/v1/courses/{project['id']}/documents")).json()
    return {"raw": raw, "docs": {d["type"]: d for d in documents}}


def _file_url(document: dict[str, Any], revision: dict[str, Any]) -> str:
    return f"/api/v1/documents/{document['id']}/revisions/{revision['id']}/file"


async def _sign_in(client: httpx.AsyncClient, identity: str) -> None:
    response = await client.post("/api/v1/auth/demo-sign-in", json={"identity": identity})
    client.headers["Authorization"] = f"Bearer {response.json()['token']}"


async def test_returns_the_exact_bytes_of_each_requested_revision(
    demo: dict[str, Any], client: httpx.AsyncClient
) -> None:
    procedure = demo["docs"]["procedure"]
    assert len(procedure["revisions"]) == 2  # Rev A (superseded) and Rev B
    for revision in procedure["revisions"]:
        response = await client.get(_file_url(procedure, revision))
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
        assert hashlib.sha256(response.content).hexdigest() in revision["content_hash"]
        disposition = response.headers["content-disposition"]
        assert disposition == f'attachment; filename="{revision["file_name"]}"'
        assert str(demo["raw"]) not in str(response.headers)
        assert response.headers["cache-control"] == "private, no-store"


async def test_enforces_document_permissions_before_reading_the_file(
    demo: dict[str, Any], client: httpx.AsyncClient
) -> None:
    contract = demo["docs"]["contract"]
    url = _file_url(contract, contract["revisions"][0])
    await _sign_in(client, "site-engineer")
    forbidden = await client.get(url)
    assert forbidden.status_code == 403
    assert not forbidden.content.startswith(b"%PDF")
    client.headers.pop("Authorization")
    assert (await client.get(url)).status_code == 401
    await _sign_in(client, "commercial-manager")
    assert (await client.get(url)).status_code == 200


async def test_refuses_a_revision_of_another_document_or_an_unknown_one(
    demo: dict[str, Any], client: httpx.AsyncClient
) -> None:
    procedure, safety = demo["docs"]["procedure"], demo["docs"]["safety_rules"]
    mismatched = await client.get(_file_url(procedure, safety["revisions"][0]))
    assert mismatched.status_code == 404
    assert mismatched.json()["detail"] == "revision not found"
    unknown = await client.get(_file_url(procedure, {"id": str(uuid.uuid4())}))
    assert unknown.status_code == 404
    # A forbidden document stays forbidden even when paired with a readable revision.
    await _sign_in(client, "site-engineer")
    crossed = await client.get(_file_url(demo["docs"]["contract"], procedure["revisions"][0]))
    assert crossed.status_code == 403


async def test_reports_a_missing_stored_file(
    demo: dict[str, Any], client: httpx.AsyncClient
) -> None:
    safety = demo["docs"]["safety_rules"]
    revision = safety["revisions"][0]
    digest = hashlib.sha256((await client.get(_file_url(safety, revision))).content).hexdigest()
    (demo["raw"] / "sha256" / digest[:2] / digest[2:4] / digest).unlink()
    response = await client.get(_file_url(safety, revision))
    assert response.status_code == 404
    assert response.json()["detail"] == "the stored file for this revision is missing"
    assert str(demo["raw"]) not in response.text


async def test_download_names_are_restricted_to_safe_characters() -> None:
    assert safe_filename("IP-01_Inspection_Procedure_RevB.pdf", "application/pdf") == (
        "IP-01_Inspection_Procedure_RevB.pdf"
    )
    assert safe_filename('../../etc/pa"ss\r\nwd', "application/pdf") == "pa_ss_wd.pdf"
    assert safe_filename("..", "application/pdf") == "document.pdf"
