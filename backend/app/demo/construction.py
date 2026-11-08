# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""The construction demo: one fictional project, run offline.

``ConstructionDemo`` is the demo the API serves (``/demo/workflow-runs``,
``/demo/sync``). It reuses the course-intelligence workflow and its
production services with the inherited names (``institution`` is the
fictional organisation, a ``course`` the project, a ``resource`` a
document, a ``version`` a revision). What it does per step:

- ingest: imports the project through ``DemoConnector`` over
  ``demo_data/construction``, then chunks every revision for offline
  lexical search (``ChunkIndexer``, ``chunk/v1``). Nothing is embedded:
  vectors are never invented. Live embeddings are a separate, explicit step
  (``python -m app.demo.construction_search index-live``);
- assessments, mapping: skipped (a construction project has no
  assessments or teaching material);
- claims: requirement extraction as obligations (``obligation-extraction/v3``,
  the construction prompt) through the production evidence gate, answered
  by ``FixtureProvider``: authored answers, recorded under the model name
  ``fixture:authored-construction/v1``, never as a model's output;
- sync: the real versioning path brings in Inspection Procedure Revision B
  as version 2 of the same document (a ChangeEvent), chunks it, and its
  requirements are extracted from that revision only. Revision A's requirements and
  evidence stay stored as history.

Reset removes this organisation and, if an older volume still holds it, the
inherited university demo institution; nothing else.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.provider import ChatMessage, ModelInfo, StructuredResult, TokenUsage
from app.db.models import Course, Institution
from app.demo.construction_content import REQUIREMENTS, AuthoredRequirement
from app.demo.intelligence import DemoReplay, StepOutcome
from app.domain.enums import LmsType, ModelRole, WorkflowRunStatus
from app.extraction.obligations import ObligationExtraction
from app.ingestion.storage import RawObjectStore

CONSTRUCTION_ROOT = Path(__file__).resolve().parents[3] / "demo_data" / "construction"
FIXTURE_MODEL = "fixture:authored-construction/v1"
OBLIGATION_PROMPT = "obligation-extraction/v3"
DEMO_USER = "demo-user"
# A date without a stated timezone uses this one (fictional UK project).
PROJECT_TIMEZONE = "Europe/London"
# The inherited university demo, removed by a reset if a reused volume holds it.
LEGACY_DEMO_INSTITUTIONS = ("Northbridge University",)

_SPAN = re.compile(r"(?m)^\[(S[1-9][0-9]*)\] [^\n]*\n")


def _norm(text: str) -> str:
    return " ".join(text.split())


def _material(user: str) -> str:
    start = user.index(">>>\n", user.index("<<<PROJECT_DOCUMENT ")) + 4
    return user[start : user.index("\n<<<END_PROJECT_DOCUMENT ")]


def _spans(material: str) -> list[tuple[str, str]]:
    found = list(_SPAN.finditer(material))
    ends = [m.start() for m in found[1:]] + [len(material)]
    return [(m.group(1), material[m.end() : end]) for m, end in zip(found, ends, strict=True)]


class FixtureProvider:
    """Answers requirement extraction for the construction documents from
    ``REQUIREMENTS``, quoting only the material each call shows: a sentence
    that is not in that material is not claimed. Role, notice period and due
    date are passed on exactly as authored (None where the sentence states
    none); the gate still checks each one against the source. No network,
    no tokens."""

    name = "fixture"

    def __init__(self, requirements: Sequence[AuthoredRequirement] = REQUIREMENTS) -> None:
        self._requirements = tuple(requirements)

    def model_for(self, role: ModelRole) -> str:
        return FIXTURE_MODEL

    async def list_models(self) -> list[ModelInfo]:
        return []

    async def chat_structured[T: BaseModel](
        self,
        messages: Sequence[ChatMessage],
        schema: type[T],
        *,
        role: ModelRole,
        temperature: float | None = None,
        thinking: bool | None = None,
    ) -> StructuredResult[T]:
        if schema is not ObligationExtraction:
            raise TypeError(f"no authored answers for {schema.__name__}")
        spans = _spans(_material(messages[-1].content))
        return StructuredResult(
            output=schema.model_validate({"obligations": self._answer(spans)}),
            model=FIXTURE_MODEL,
            usage=TokenUsage(prompt_tokens=0, completion_tokens=0, reasoning_tokens=0),
            attempts=1,
        )

    def _answer(self, spans: list[tuple[str, str]]) -> list[dict[str, Any]]:
        out = []
        for requirement in self._requirements:
            quote = requirement.statement
            span = next((sid for sid, text in spans if quote in _norm(text)), None)
            if span is None:
                continue
            evidence = {"span": span, "quote": quote}
            out.append({
                "action": requirement.action,
                "category": "other",
                "assessment": None,
                "evidence": [evidence],
                "due": (
                    {"status": "stated", "due_date": requirement.due_date, "due_time": None,
                     "evidence": evidence}
                    if requirement.due_date else
                    {"status": "not_stated", "due_date": None, "due_time": None, "evidence": None}
                ),
                "responsible_role": requirement.responsible_role,
                "notice_period": requirement.notice_period,
            })  # fmt: skip
        return out


class ConstructionDemo(DemoReplay):
    """The construction demo's implementation of the workflow steps."""

    mode = "replay:authored-fixture"

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        store: RawObjectStore,
        space: Any = None,
        *,
        provider: Any = None,
    ) -> None:
        # Not DemoReplay.__init__: no university recordings or snapshots are loaded.
        self.sessions, self._store, self._space = sessions, store, space
        self._supplement = False
        self._fixture = provider or FixtureProvider()
        self._search = None
        self.mapping_results = []

    @staticmethod
    def _connector() -> Any:
        from app.connectors.demo import DemoConnector

        return DemoConnector(CONSTRUCTION_ROOT)

    def _institution(self) -> Any:
        return self._connector()

    def _indexer(self) -> Any:
        # Chunks only, for lexical search; no embeddings (none are recorded).
        from app.retrieval.chunk_index import ChunkIndexer

        return ChunkIndexer(self.sessions)

    @classmethod
    def organisation(cls) -> str:
        return cls._connector().manifest.institution.name  # type: ignore[no-any-return]

    async def status(self) -> dict[str, bool]:
        """Whether the project is loaded, and whether any other demo
        institution's data (an older demo in a reused volume) is present."""
        async with self.sessions() as session:
            names = set(
                (
                    await session.scalars(
                        select(Institution.name)
                        .join(Course, Course.institution_id == Institution.id)
                        .where(Institution.lms_type == LmsType.DEMO)
                    )
                ).all()
            )
        own = self.organisation()
        return {"project_loaded": own in names, "other_demo_data": bool(names - {own})}

    async def ingest(self, *, reset: bool) -> tuple[dict[str, uuid.UUID], dict[str, StepOutcome]]:
        from app.connectors.sync import import_course
        from app.demo.reset import reset_demo_institution
        from app.evaluation.retrieval.resolve import production_limits

        connector = self._connector()
        own = connector.manifest.institution.name
        if reset:
            for name in (own, *LEGACY_DEMO_INSTITUTIONS):
                await reset_demo_institution(self.sessions, name, LmsType.DEMO)
        courses, outcomes = {}, {}
        for stub in await connector.list_courses(DEMO_USER):
            imported = await import_course(
                self.sessions, self._store, connector, stub, institution_name=own,
                lms_type=LmsType.DEMO, limits=production_limits(),
                institution_timezone=PROJECT_TIMEZONE,
            )  # fmt: skip
            courses[stub.course_ref] = imported.course_id
            chunked = await self._indexer().index_course(imported.course_id)
            outcomes[stub.course_ref] = StepOutcome(
                chunked.status,
                (chunked.run_id,),
                {"versions_created": imported.versions_created,
                 "documents": len(imported.documents),
                 "retrieval_index": {"chunks": "chunk/v1 (lexical search)",
                                     "embeddings": "none (live indexing is a separate step)",
                                     "chunks_created": chunked.summary.chunks_created}},
            )  # fmt: skip
        return courses, outcomes

    async def assessments(
        self, course_id: uuid.UUID, version_ids: Sequence[uuid.UUID] | None = None
    ) -> StepOutcome:
        return StepOutcome(WorkflowRunStatus.SUCCEEDED, (), {"skipped": "no assessments"})

    async def claims(
        self, course_id: uuid.UUID, version_ids: Sequence[uuid.UUID] | None = None
    ) -> StepOutcome:
        from app.extraction.claims_service import ClaimExtractionService

        service = ClaimExtractionService(
            self.sessions, self._fixture, "obligations", thinking=False,
            prompt_version=OBLIGATION_PROMPT,
        )  # fmt: skip
        result = await service.extract_course(course_id, version_ids)
        s = result.summary
        return StepOutcome(result.status, (result.run_id,),
                           {"requirements": {"versions": s.versions, "created": s.created,
                                             "merged": s.merged, "units_failed": s.units_failed,
                                             "rejected": s.rejected}})  # fmt: skip

    async def mapping(self, course_id: uuid.UUID, courses: dict[str, uuid.UUID]) -> StepOutcome:
        return StepOutcome(WorkflowRunStatus.SUCCEEDED, (), {"skipped": "no teaching material"})
