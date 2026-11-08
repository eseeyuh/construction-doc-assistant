# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

from fastapi import APIRouter

from app.api.demo_auth import ViewerDep
from app.api.deps import SessionDep
from app.db.changes import SyncRead, syncs

router = APIRouter(tags=["changes"])


@router.get("/changes")
async def get_changes(session: SessionDep, viewer: ViewerDep) -> list[SyncRead]:
    """Each sync: the versions it brought in (real version state), what they
    deterministically affected, and the study plan before vs after by task key.
    Only changes to document types the viewer may read; the (inherited) study
    plan diff only with full access."""
    out = []
    for sync in await syncs(session):
        changes = [c for c in sync.changes if viewer.can_read(c.resource_type)]
        if sync.changes and not changes:
            continue
        out.append(
            sync.model_copy(
                update={
                    "changes": changes,
                    "plan_diff": sync.plan_diff if viewer.full_access else None,
                }
            )
        )
    return out
