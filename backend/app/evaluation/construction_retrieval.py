# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Construction retrieval evaluation: the labelled cases in
``evals/datasets/construction-retrieval/v1`` run through the real pipeline.

    COURSEFLOW_EVAL_DATABASE_URL=postgresql+asyncpg://...@db:5432/courseflow_eval \\
        python -m app.evaluation.construction_retrieval --mode lexical
    ... --mode replay --snapshot evals/snapshots/construction/<file>.jsonl
    ... --mode live --yes                       # paid embedding calls
    ... --record-snapshot <path> --price-usd-per-million <price> --yes

Every run recreates the disposable evaluation database (``courseflow_eval``;
the guards in ``eval_db`` refuse anything else), imports the demo documents
through the production connector and parser, loads Revision B through the
versioning path, chunks every revision, and searches each case through
``ProjectSearchService``. Modes are reported separately and never mixed:

- ``lexical``: lexical-only, offline. No embeddings, no model calls.
- ``replay``: hybrid with vectors from a recorded snapshot (documents and
  queries), validated against this dataset, the corpus and the configured
  embedding space. No provider calls. No construction snapshot is
  committed; ``--record-snapshot`` records one (paid, live).
- ``live``: hybrid with the configured live provider (paid calls).

A report is written only for a run that executed; it states the mode, the
dataset and corpus hashes, the versions of every rule, and the per-case
ranks. Nothing is reported for a mode that did not run.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import yaml
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.ai.embeddings import (
    EmbeddingInput,
    EmbeddingProvider,
    construction_query_input,
    document_input,
)
from app.evaluation.retrieval.snapshot import ExpectedInputs, SnapshotSubject, file_chunk_texts
from app.retrieval.chunking import SPAN_PACK_V1
from app.retrieval.project_search import ProjectSearchMode, ProjectSearchService, RevisionScope

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIR = REPO_ROOT / "evals" / "datasets" / "construction-retrieval" / "v1"
CASES_FILE = DATASET_DIR / "cases.yaml"
CORPUS_DIR = REPO_ROOT / "demo_data" / "construction"
REPORTS_DIR = REPO_ROOT / "evals" / "reports"
TOP_K = 10

Mode = Literal["lexical", "replay", "live"]
EXECUTION = {
    "lexical": "lexical-only (offline: PostgreSQL full-text, no embeddings, no model calls)",
    "replay": "hybrid with replayed embeddings (recorded snapshot; no provider calls)",
    "live": "hybrid with live embeddings (paid provider calls during this run)",
}


# --- the dataset ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Expected:
    file: str
    page: int
    passage: str


@dataclass(frozen=True, slots=True)
class Case:
    id: str
    query: str
    revisions: RevisionScope
    expected: tuple[Expected, ...]
    must_not_return: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Dataset:
    name: str
    version: str
    sha256: str  # cases file and corpus files together
    cases: tuple[Case, ...]
    corpus_files: tuple[Path, ...]


def _flat(text: str) -> str:
    return " ".join(text.split())


def load_dataset(path: Path = CASES_FILE, corpus: Path = CORPUS_DIR) -> Dataset:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    cases = tuple(
        Case(
            id=c["id"],
            query=c["query"],
            revisions=RevisionScope(c["revisions"]),
            expected=tuple(
                Expected(e["file"], int(e["page"]), e["passage"]) for e in c["expected"]
            ),
            must_not_return=tuple(c.get("must_not_return", ())),
        )
        for c in raw["cases"]
    )
    if len({c.id for c in cases}) != len(cases):
        raise ValueError("case ids must be unique")
    files = tuple(sorted([corpus / "manifest.yaml", *sorted((corpus / "documents").glob("*.pdf"))]))
    digest = hashlib.sha256()
    for item in (path, *files):
        digest.update(item.relative_to(REPO_ROOT).as_posix().encode() + b"\0")
        digest.update(hashlib.sha256(item.read_bytes()).hexdigest().encode() + b"\n")
    return Dataset(raw["dataset"], raw["version"], digest.hexdigest(), cases, files)


def subject(dataset: Dataset) -> SnapshotSubject:
    return SnapshotSubject(
        name=dataset.name,
        version=dataset.version,
        sha256=dataset.sha256,
        hash_scheme="construction-retrieval-files/v1",
        chunker=SPAN_PACK_V1.version,
    )


def expected_inputs(dataset: Dataset) -> ExpectedInputs:
    """Every provider input a hybrid run needs: each chunk of each revision
    (the production parser and chunker over the committed PDFs), then each
    distinct query as ``query/v2``."""
    documents: dict[tuple[str, str], EmbeddingInput] = {}
    for path in dataset.corpus_files:
        if path.suffix != ".pdf":
            continue
        for text in file_chunk_texts(path, SPAN_PACK_V1, path.name):
            item = document_input(text)
            documents.setdefault((item.input_format, item.input_hash), item)
    queries: dict[tuple[str, str], EmbeddingInput] = {}
    for case in dataset.cases:
        item = construction_query_input(case.query)
        queries.setdefault((item.input_format, item.input_hash), item)
    return ExpectedInputs(tuple(documents.values()), tuple(queries.values()))


# --- scoring -------------------------------------------------------------------------------


def score_case(case: Case, hits: Sequence[Any]) -> dict[str, Any]:
    """Rank (1-based) of the first hit matching an expected passage, or None;
    and the forbidden files that appeared."""
    rank = None
    for hit in hits:
        for want in case.expected:
            if (
                hit.revision.file_name == want.file
                and want.page in {s.page_number for s in hit.hit.spans}
                and _flat(want.passage) in _flat(hit.hit.text)
            ):
                rank = hit.hit.rank
                break
        if rank is not None:
            break
    returned = [h.revision.file_name for h in hits]
    return {
        "id": case.id,
        "revisions": case.revisions.value,
        "rank": rank,
        "returned": [
            f"{h.revision.file_name} p{','.join(str(s.page_number) for s in h.hit.spans)}"
            for h in hits
        ],
        "forbidden_returned": sorted(set(case.must_not_return) & set(returned)),
    }


def aggregate(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    ranks = [r["rank"] for r in rows]
    return {
        "cases": n,
        "hit_at_1": sum(1 for r in ranks if r == 1),
        "hit_at_3": sum(1 for r in ranks if r is not None and r <= 3),
        "hit_at_10": sum(1 for r in ranks if r is not None),
        "mrr_at_10": round(sum(1 / r for r in ranks if r is not None) / n, 4) if n else 0.0,
        "invariant_cases": sum(1 for r in rows if r["forbidden_returned"] is not None),
        "invariant_violations": sum(1 for r in rows if r["forbidden_returned"]),
    }


# --- running -------------------------------------------------------------------------------


async def _build(sessions: async_sessionmaker[AsyncSession], raw_dir: Path) -> Any:
    from app.demo.construction import ConstructionDemo
    from app.ingestion.storage import LocalRawObjectStore

    demo = ConstructionDemo(sessions, LocalRawObjectStore(raw_dir))
    courses, _ = await demo.ingest(reset=True)
    await demo.sync()  # Revision B through the versioning path
    (course_id,) = courses.values()
    return course_id


async def run(
    dataset: Dataset,
    mode: Mode,
    database_url: Any,
    provider: EmbeddingProvider | None = None,
) -> dict[str, Any]:
    from app.db.models import Chunk, ChunkEmbedding, ModelCall
    from app.retrieval.indexing import IndexingService

    engine = create_async_engine(database_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        with tempfile.TemporaryDirectory() as raw:
            course_id = await _build(sessions, Path(raw))
            index_summary = None
            if mode != "lexical":
                assert provider is not None
                indexed = await IndexingService(
                    sessions, provider, batch_max_items=provider.max_batch_items,
                    batch_max_estimated_tokens=32_000,
                ).index_course(course_id, all_versions=True)  # fmt: skip
                if indexed.status.value != "succeeded":
                    raise RuntimeError(f"embedding indexing failed: {indexed.summary.failures}")
                index_summary = indexed.summary.model_dump(mode="json")
            service = ProjectSearchService(
                sessions,
                provider=provider if mode != "lexical" else None,
                embeddings=None if mode == "lexical" else mode,  # type: ignore[arg-type]
            )
            search_mode = (
                ProjectSearchMode.LEXICAL if mode == "lexical" else ProjectSearchMode.HYBRID
            )
            rows = []
            for case in dataset.cases:
                result = await service.search(
                    course_id, case.query, mode=search_mode, revisions=case.revisions, k=TOP_K
                )
                row = score_case(case, result.hits)
                if not case.must_not_return:
                    row["forbidden_returned"] = None
                rows.append(row)
            async with sessions() as session:
                counts = {
                    "chunks": await session.scalar(select(func.count()).select_from(Chunk)),
                    "chunk_embedding_links": await session.scalar(
                        select(func.count()).select_from(ChunkEmbedding)
                    ),
                    "model_calls": await session.scalar(
                        select(func.count()).select_from(ModelCall)
                    ),
                }
    finally:
        await engine.dispose()
    from app.reasoning.revisions import SUPERSESSION_RULES_VERSION
    from app.retrieval.fusion import FUSION_VERSION
    from app.retrieval.rankers import LEXICAL_VERSION

    return {
        "dataset": {
            "name": dataset.name,
            "version": dataset.version,
            "sha256": dataset.sha256,
            "cases": len(dataset.cases),
        },
        "mode": mode,
        "execution": EXECUTION[mode],
        "embedding_space": None
        if provider is None
        else {
            "provider": provider.space.provider,
            "model": provider.space.model,
            "dimensions": provider.space.dimensions,
            "space_version": provider.space.space_version,
        },
        "versions": {
            "chunker": SPAN_PACK_V1.version,
            "lexical": LEXICAL_VERSION,
            "fusion": FUSION_VERSION if mode != "lexical" else None,
            "supersession_rules": SUPERSESSION_RULES_VERSION,
            "query_format": None if mode == "lexical" else "query/v2",
        },
        "top_k": TOP_K,
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "database_counts": counts,
        "index_summary": index_summary,
        "metrics": aggregate(rows),
        "cases": rows,
    }


def markdown(report: dict[str, Any]) -> str:
    m = report["metrics"]
    lines = [
        f"# Construction retrieval {report['dataset']['version']}: {report['mode']}",
        "",
        f"**Execution mode: {report['execution']}.**",
        "",
        (
            f"- Dataset: `{report['dataset']['name']}` {report['dataset']['version']}, "
            f"{report['dataset']['cases']} cases, sha256 `{report['dataset']['sha256']}`"
        ),
        f"- Ran: {report['ran_at']}; top {report['top_k']}",
        f"- Versions: {', '.join(f'{k} `{v}`' for k, v in report['versions'].items() if v)}",
        f"- Embedding space: {report['embedding_space'] or 'none (no embeddings used)'}",
        f"- Database after the run: {report['database_counts']}",
        "",
        "| Cases | Hit@1 | Hit@3 | Hit@10 | MRR@10 | Invariant violations |",
        "|---:|---:|---:|---:|---:|---:|",
        (
            f"| {m['cases']} | {m['hit_at_1']}/{m['cases']} | {m['hit_at_3']}/{m['cases']} | "
            f"{m['hit_at_10']}/{m['cases']} | {m['mrr_at_10']} | "
            f"{m['invariant_violations']}/{m['invariant_cases']} |"
        ),
        "",
        "| Case | Revisions | Rank | Returned (in order) | Forbidden returned |",
        "|---|---|---:|---|---|",
    ]
    for row in report["cases"]:
        forbidden = row["forbidden_returned"]
        lines.append(
            f"| {row['id']} | {row['revisions']} | {row['rank'] or 'miss'} | "
            f"{'; '.join(row['returned']) or 'none'} | "
            f"{'n/a' if forbidden is None else (', '.join(forbidden) or 'none')} |"
        )
    lines += [
        "",
        (
            "The corpus is four one-page synthetic PDFs (one chunk per revision), so these "
            "numbers check the pipeline's behaviour (revision filtering, citations, ranking "
            "plumbing); they are not evidence of retrieval quality on real project documents."
        ),
        "",
    ]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    from app.core.config import get_settings
    from app.evaluation.retrieval.eval_db import (
        EvalDatabaseRefused,
        prepare_eval_database,
        require_eval_database,
    )

    parser = argparse.ArgumentParser(prog="python -m app.evaluation.construction_retrieval")
    parser.add_argument("--mode", choices=("lexical", "replay", "live"))
    parser.add_argument("--snapshot", type=Path, help="recorded snapshot for --mode replay")
    parser.add_argument("--record-snapshot", type=Path, help="record a snapshot (live, paid)")
    parser.add_argument("--price-usd-per-million", type=Decimal)
    parser.add_argument("--yes", action="store_true", help="confirm paid live provider calls")
    parser.add_argument("--no-report", action="store_true", help="print only; write no files")
    args = parser.parse_args(argv)
    settings = get_settings()
    dataset = load_dataset()

    if args.record_snapshot:
        return _record(args, settings, dataset)
    if args.mode is None:
        parser.error("--mode is required")
    if args.mode == "live" and not args.yes:
        print("--mode live makes paid embedding calls; add --yes to confirm", file=sys.stderr)
        return 2
    try:
        database = require_eval_database(
            os.environ, application_database_url=settings.database_url.get_secret_value()
        )
    except EvalDatabaseRefused as refused:
        print(f"refused: {refused}", file=sys.stderr)
        return 3
    provider = _provider(args, settings, dataset)
    if isinstance(provider, int):
        return provider
    prepare_eval_database(database)

    async def go() -> dict[str, Any]:
        try:
            return await run(dataset, args.mode, database.url, provider)
        finally:
            if provider is not None:
                await provider.aclose()

    report = asyncio.run(go())
    text = json.dumps(report, indent=2, sort_keys=True)
    if not args.no_report:
        stem = REPORTS_DIR / f"construction-retrieval-{dataset.version}-{args.mode}"
        stem.with_suffix(".json").write_text(text + "\n", encoding="utf-8")
        stem.with_suffix(".md").write_text(markdown(report), encoding="utf-8")
    print(text)
    return 0 if report["metrics"]["invariant_violations"] == 0 else 1


def _provider(args: Any, settings: Any, dataset: Dataset) -> EmbeddingProvider | int | None:
    from app.ai.errors import AIConfigurationError
    from app.ai.nebius_embeddings import NebiusEmbeddingProvider, embedding_space_from_settings

    if args.mode == "lexical":
        return None
    if args.mode == "live":
        try:
            return NebiusEmbeddingProvider.from_settings(settings)
        except AIConfigurationError:
            print("live embeddings are not configured: set NEBIUS_API_KEY, NEBIUS_BASE_URL "
                  "and EMBEDDING_MODEL", file=sys.stderr)  # fmt: skip
            return 4
    from app.evaluation.retrieval.replay import load_replay_provider
    from app.evaluation.retrieval.snapshot import SnapshotError

    if args.snapshot is None or not args.snapshot.exists():
        print("replay needs --snapshot <recorded file>; no construction snapshot is committed "
              "(record one with --record-snapshot)", file=sys.stderr)  # fmt: skip
        return 4
    if settings.embedding_model is None:
        print("replay needs EMBEDDING_MODEL (the recorded space's identity)", file=sys.stderr)
        return 4
    try:
        return load_replay_provider(
            args.snapshot, dataset=subject(dataset),
            active_space=embedding_space_from_settings(settings),
            max_batch_items=settings.embedding_batch_max_items, inputs=expected_inputs(dataset),
        )  # fmt: skip
    except SnapshotError as error:
        print(f"snapshot refused: {list(error.problems)}", file=sys.stderr)
        return 4


def _record(args: Any, settings: Any, dataset: Dataset) -> int:
    from app.ai.errors import AIConfigurationError
    from app.ai.nebius_embeddings import NebiusEmbeddingProvider, embedding_space_from_settings
    from app.evaluation.retrieval.record import (
        RecordingFailed,
        RecordingRefused,
        plan_recording,
        record_snapshot,
    )

    missing = [name for name, value in (("--price-usd-per-million", args.price_usd_per_million),
                                        ("EMBEDDING_MODEL", settings.embedding_model)) if value is None]  # fmt: skip
    if missing:
        print(f"recording needs: {', '.join(missing)}", file=sys.stderr)
        return 2
    plan = plan_recording(
        subject(dataset), embedding_space_from_settings(settings),
        batch_max_items=settings.embedding_batch_max_items,
        batch_max_estimated_tokens=settings.embedding_batch_max_estimated_tokens,
        attempts_per_request=settings.ai_max_attempts,
        price_usd_per_million=args.price_usd_per_million, output=args.record_snapshot,
        inputs=expected_inputs(dataset),
    )  # fmt: skip
    if not args.yes:
        print(json.dumps({"status": "planned", "plan": plan.describe()}, indent=2, default=str))
        return 0
    try:
        provider = NebiusEmbeddingProvider.from_settings(settings)
    except AIConfigurationError:
        print("live embeddings are not configured", file=sys.stderr)
        return 4

    async def go() -> Any:
        try:
            return await record_snapshot(plan, provider)
        finally:
            await provider.aclose()

    try:
        result = asyncio.run(go())
    except (RecordingRefused, RecordingFailed) as error:
        print(f"recording stopped: {error}", file=sys.stderr)
        return 5
    print(json.dumps({"status": "recorded", "snapshot": result.snapshot.as_posix(),
                      "sha256": result.sha256}, indent=2))  # fmt: skip
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
