# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import uuid

from fastapi import APIRouter, HTTPException

from app.api.demo_auth import FullAccessDep, ViewerDep
from app.api.deps import SessionDep
from app.api.schemas.claims import ObligationRead, RequirementRead
from app.db.claims import course_obligations, course_requirements
from app.db.models import Course

router = APIRouter(tags=["requirements", "obligations"])


@router.get("/courses/{course_id}/requirements")
async def get_course_requirements(
    session: SessionDep, viewer: FullAccessDep, course_id: uuid.UUID
) -> list[RequirementRead]:
    """Every assessment requirement of a course, with status, reasons and evidence."""
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="course not found")
    return await course_requirements(session, course_id)


@router.get("/courses/{course_id}/obligations")
async def get_course_obligations(
    session: SessionDep, viewer: ViewerDep, course_id: uuid.UUID
) -> list[ObligationRead]:
    """The obligations of a course the viewer may read, with modality, status,
    reasons and evidence. An obligation is returned only when every piece of
    its evidence comes from a document type the viewer may read."""
    if await session.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="course not found")
    return [
        o
        for o in await course_obligations(session, course_id)
        if viewer.can_read_all(e.resource_type for e in o.evidence)
    ]
