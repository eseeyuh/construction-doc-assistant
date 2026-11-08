# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import asyncio
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.api.demo_auth import get_viewer
from app.api.deps import SessionDep, SettingsDep
from app.db.models import Course, WorkflowRun
from app.demo.intelligence import DemoReplay
from app.domain.enums import ModelRole, WorkflowRunStatus
from app.orchestration.workflow import (
    SYNC_STEPS,
    WORKFLOW_VERSION,
    CourseIntelligenceWorkflow,
    UnknownStepError,
)

router = APIRouter(tags=["workflows"])

# One demo workflow at a time: a second request is refused, never queued.
_DEMO_LOCK = asyncio.Lock()


class WorkflowRunRead(BaseModel):
    """A run and its trace (``summary``: per-step status, child runs, counts,
    the failed step and its error category; IDs and counts only)."""

    id: uuid.UUID
    course_id: uuid.UUID
    workflow_version: str
    status: WorkflowRunStatus
    started_at: datetime | None
    finished_at: datetime | None
    summary: dict[str, Any] | None


class DemoWorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reset: bool = False
    steps: list[str] | None = None  # allowlisted names; None: every step


class DemoWorkflowStarted(BaseModel):
    succeeded: bool
    runs: list[WorkflowRunRead]


def get_demo_replay(request: Request, settings: SettingsDep) -> DemoReplay:
    """The offline demo implementation (the construction project, authored
    fixtures): refused in production, and without a raw store."""
    from app.demo.construction import ConstructionDemo
    from app.ingestion.storage import LocalRawObjectStore, RawStoreError

    if settings.app_env == "production":
        raise HTTPException(status_code=404, detail="not found")
    try:
        store = LocalRawObjectStore.from_settings(settings)
    except RawStoreError:
        raise HTTPException(status_code=503, detail="raw storage is not configured") from None
    return ConstructionDemo(request.app.state.session_factory, store)


DemoReplayDep = Annotated[DemoReplay, Depends(get_demo_replay)]


class DemoStatus(BaseModel):
    """Whether the construction demo project is loaded, and whether another
    demo's data (an older demo in a reused volume) is present. Read only."""

    project_loaded: bool
    other_demo_data: bool
    mode: str


@router.get("/demo/status")
async def demo_status(replay: DemoReplayDep) -> DemoStatus:
    from app.demo.construction import ConstructionDemo

    if not isinstance(replay, ConstructionDemo):
        raise HTTPException(status_code=404, detail="not found")
    return DemoStatus(**await replay.status(), mode=replay.mode)


class Capabilities(BaseModel):
    """What this deployment can do. ``live_analysis``: whether model
    credentials are configured (never what they are)."""

    live_analysis: bool
    live_analysis_reason: str | None
    # "Ask project documents" (live tool-calling chat): same credentials.
    ask_documents: bool = False
    ask_documents_reason: str | None = None


@router.get("/capabilities")
async def capabilities(settings: SettingsDep) -> Capabilities:
    from app.ai.errors import AIConfigurationError
    from app.ai.nebius import NebiusTokenFactoryProvider
    from app.extraction.live_preview import LIVE_MODEL

    if settings.app_env == "production":
        return Capabilities(
            live_analysis=False, live_analysis_reason="not offered in production",
            ask_documents=False, ask_documents_reason="not offered in production",
        )  # fmt: skip
    try:
        provider = NebiusTokenFactoryProvider.from_settings(
            settings, models={ModelRole.FAST: LIVE_MODEL}
        )
    except AIConfigurationError:
        reason = "no model credentials are configured for this deployment"
        return Capabilities(
            live_analysis=False, live_analysis_reason=reason,
            ask_documents=False, ask_documents_reason=reason,
        )  # fmt: skip
    await provider.aclose()
    return Capabilities(
        live_analysis=True, live_analysis_reason=None, ask_documents=True, ask_documents_reason=None
    )


def _read(run: WorkflowRun) -> WorkflowRunRead:
    return WorkflowRunRead(
        id=run.id,
        course_id=run.course_id,
        workflow_version=run.workflow_version,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        summary=run.summary,
    )


# The production refusal (get_demo_replay) comes before the sign-in check.
@router.post("/demo/workflow-runs", dependencies=[Depends(get_demo_replay), Depends(get_viewer)])
async def start_demo_workflow(
    session: SessionDep, replay: DemoReplayDep, body: DemoWorkflowRequest | None = None
) -> DemoWorkflowStarted:
    """Run the offline course-intelligence workflow over the demo courses
    (replayed recordings: no network, no spend) and return each course's run."""
    body = body or DemoWorkflowRequest()
    if _DEMO_LOCK.locked():
        raise HTTPException(status_code=409, detail="a demo workflow is already running")
    async with _DEMO_LOCK:
        try:
            result = await CourseIntelligenceWorkflow(replay.sessions, replay).run(
                reset=body.reset, steps=body.steps
            )
        except UnknownStepError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    runs = (
        await session.scalars(select(WorkflowRun).where(WorkflowRun.id.in_(result.runs.values())))
    ).all()
    return DemoWorkflowStarted(
        succeeded=result.succeeded,
        runs=sorted((_read(r) for r in runs), key=lambda r: str(r.course_id)),
    )


class SyncedVersion(BaseModel):
    change_event_id: uuid.UUID
    course_id: uuid.UUID
    resource_id: uuid.UUID
    resource_title: str
    old_version: int | None
    new_version: int


class DemoSyncResult(BaseModel):
    """What the sync brought in and the runs that propagated it. A sync
    that brings nothing new returns no changes and starts no run."""

    succeeded: bool
    observed_at: datetime
    changes: list[SyncedVersion]
    affected_course_ids: list[uuid.UUID]
    runs: list[WorkflowRunRead]


@router.post("/demo/sync", dependencies=[Depends(get_demo_replay), Depends(get_viewer)])
async def sync_demo(session: SessionDep, replay: DemoReplayDep) -> DemoSyncResult:
    """Move the demo courses to the connector's final state through the real
    versioning path, then reprocess what changed (replayed recordings: no
    network, no spend)."""
    from app.db.models import ChangeEvent, Resource, ResourceVersion

    if _DEMO_LOCK.locked():
        raise HTTPException(status_code=409, detail="a demo workflow is already running")
    async with _DEMO_LOCK:
        result = await CourseIntelligenceWorkflow(replay.sessions, replay).run(steps=SYNC_STEPS)
    versions = [v for vs in result.changed.values() for v in vs]
    rows = (
        await session.execute(
            select(ChangeEvent, Resource.title)
            .join(Resource, Resource.id == ChangeEvent.resource_id)
            .where(ChangeEvent.new_version_id.in_(versions))
            .order_by(Resource.source_uri)
        )
    ).all()
    numbers = dict(
        (
            await session.execute(
                select(ResourceVersion.id, ResourceVersion.version_number).where(
                    ResourceVersion.id.in_(
                        [e.new_version_id for e, _ in rows]
                        + [e.old_version_id for e, _ in rows if e.old_version_id]
                    )
                )
            )
        ).all()
    )
    runs = (
        await session.scalars(select(WorkflowRun).where(WorkflowRun.id.in_(result.runs.values())))
    ).all()
    return DemoSyncResult(
        succeeded=result.succeeded,
        observed_at=replay.final_sync_at(),
        changes=[
            SyncedVersion(
                change_event_id=e.id,
                course_id=e.course_id,
                resource_id=e.resource_id,
                resource_title=title,
                old_version=numbers.get(e.old_version_id) if e.old_version_id else None,
                new_version=numbers[e.new_version_id],
            )
            for e, title in rows
        ],
        affected_course_ids=sorted(result.courses.values(), key=str),
        runs=sorted((_read(r) for r in runs), key=lambda r: str(r.course_id)),
    )


@router.get("/workflow-runs/{run_id}", dependencies=[Depends(get_viewer)])
async def get_workflow_run(session: SessionDep, run_id: uuid.UUID) -> WorkflowRunRead:
    run = await session.get(WorkflowRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="workflow run not found")
    return _read(run)


@router.get("/courses/{course_id}/workflow-runs", dependencies=[Depends(get_viewer)])
async def get_course_workflow_runs(
    session: SessionDep, course_id: uuid.UUID, limit: int = 10
) -> list[WorkflowRunRead]:
    """A course's course-intelligence runs, newest first."""
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="course not found")
    runs = (
        await session.scalars(
            select(WorkflowRun)
            .where(
                WorkflowRun.course_id == course_id,
                WorkflowRun.workflow_version == WORKFLOW_VERSION,
            )
            .order_by(WorkflowRun.started_at.desc(), WorkflowRun.id)
            .limit(max(1, min(limit, 50)))
        )
    ).all()
    return [_read(r) for r in runs]
