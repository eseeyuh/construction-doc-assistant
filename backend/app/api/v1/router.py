# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

from fastapi import APIRouter

from app.api import demo_auth
from app.api.v1 import (
    ask,
    assessments,
    changes,
    claims,
    courses,
    documents,
    health,
    planning,
    reasoning,
    search,
    workflows,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(demo_auth.router)
api_router.include_router(courses.router)
api_router.include_router(assessments.router)
api_router.include_router(documents.router)
api_router.include_router(claims.router)
api_router.include_router(reasoning.router)
api_router.include_router(workflows.router)
api_router.include_router(planning.router)
api_router.include_router(changes.router)
api_router.include_router(search.router)
api_router.include_router(ask.router)
