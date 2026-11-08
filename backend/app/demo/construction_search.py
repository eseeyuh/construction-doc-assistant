# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Index the construction demo project for search, from the command line.

    python -m app.demo.construction_search status
    python -m app.demo.construction_search chunk          # offline, free
    python -m app.demo.construction_search index-live --yes

``chunk`` writes the deterministic chunks of every revision (lexical search
needs nothing else; the demo build already does it). ``index-live`` embeds
every revision's chunks with the configured provider (NEBIUS_API_KEY,
NEBIUS_BASE_URL, EMBEDDING_MODEL; a paid call, so it needs ``--yes``) and
links them, after which hybrid search can run. Already embedded chunks are
reused from the embedding cache; nothing is ever embedded by anything but
the configured live provider. Output is counts and IDs only: never a key,
never document text.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from app.ai.errors import AIConfigurationError
from app.core.config import get_settings
from app.db.models import Course, Institution
from app.db.session import create_db_engine, create_session_factory
from app.demo.construction import ConstructionDemo


async def _project_id(sessions: Any) -> uuid.UUID | None:
    async with sessions() as session:
        return await session.scalar(  # type: ignore[no-any-return]
            select(Course.id)
            .join(Institution, Institution.id == Course.institution_id)
            .where(Institution.name == ConstructionDemo.organisation())
        )


async def _run(command: str) -> dict[str, Any]:
    settings = get_settings()
    engine = create_db_engine(settings)
    sessions = create_session_factory(engine)
    try:
        course_id = await _project_id(sessions)
        if course_id is None:
            return {"ok": False, "error": "the construction demo project is not loaded"}
        if command == "chunk":
            from app.retrieval.chunk_index import ChunkIndexer

            result = await ChunkIndexer(sessions).index_course(course_id)
            return {"ok": result.status.value == "succeeded", "run_id": str(result.run_id),
                    "summary": result.summary.model_dump(mode="json")}  # fmt: skip
        if command == "index-live":
            from app.ai.nebius_embeddings import NebiusEmbeddingProvider
            from app.retrieval.indexing import IndexingService

            try:
                provider = NebiusEmbeddingProvider.from_settings(settings)
            except AIConfigurationError:
                return {"ok": False, "error": "live embeddings are not configured: set "
                        "NEBIUS_API_KEY, NEBIUS_BASE_URL and EMBEDDING_MODEL"}  # fmt: skip
            try:
                service = IndexingService(
                    sessions, provider,
                    batch_max_items=settings.embedding_batch_max_items,
                    batch_max_estimated_tokens=settings.embedding_batch_max_estimated_tokens,
                )  # fmt: skip
                indexed = await service.index_course(course_id, all_versions=True)
            finally:
                await provider.aclose()
            return {"ok": indexed.status.value == "succeeded", "run_id": str(indexed.run_id),
                    "embeddings": "live",
                    "summary": indexed.summary.model_dump(mode="json")}  # fmt: skip
        # status
        from app.ai.nebius_embeddings import embedding_space_from_settings
        from app.reasoning.revisions import revision_statuses
        from app.retrieval.indexing import inspect_versions_in_session
        from app.retrieval.store import ChunkState, LinkState

        space = embedding_space_from_settings(settings) if settings.embedding_model else None
        async with sessions() as session:
            statuses = await revision_statuses(session, course_id)
            reports = await inspect_versions_in_session(session, list(statuses), space)
        return {
            "ok": True,
            "embedding_space": None if space is None else {
                "provider": space.provider, "model": space.model,
                "dimensions": space.dimensions, "space_version": space.space_version},
            "revisions": [
                {"version_id": str(r.resource_version_id),
                 "stated_revision": statuses[r.resource_version_id].stated_revision,
                 "in_force": statuses[r.resource_version_id].in_force,
                 "chunked": r.chunk_state is ChunkState.EXACT,
                 "embedded": None if space is None else r.link_state is LinkState.COMPLETE}
                for r in reports
            ],
        }  # fmt: skip
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.demo.construction_search")
    parser.add_argument("command", choices=("status", "chunk", "index-live"))
    parser.add_argument("--yes", action="store_true", help="confirm paid live embedding calls")
    args = parser.parse_args(argv)
    if args.command == "index-live" and not args.yes:
        print("index-live makes paid embedding calls; rerun with --yes to confirm", file=sys.stderr)
        return 2
    result = asyncio.run(_run(args.command))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
