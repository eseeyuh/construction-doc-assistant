# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""construction layer: document types; responsible role and notice period on obligations

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-07

Additive only. Three resource types (procedure, safety_rules, contract) join
the allowed list, and obligations gain two nullable text columns. Existing
rows are untouched: NULL means unknown. Downgrade drops the two columns and
restores the previous type list (it fails while a row uses a new type).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TYPES = "'lecture', 'lab', 'reading', 'workshop', 'handbook', 'brief', 'announcement', 'page'"
_NEW_TYPES = _OLD_TYPES + ", 'procedure', 'safety_rules', 'contract'"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_resources_resource_type"), "resources", type_="check")
    op.create_check_constraint(
        op.f("ck_resources_resource_type"), "resources", f"type IN ({_NEW_TYPES})"
    )
    op.add_column("obligations", sa.Column("responsible_role", sa.Text(), nullable=True))
    op.add_column("obligations", sa.Column("notice_period", sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f("ck_obligations_responsible_role_nonblank_bounded"),
        "obligations",
        "responsible_role IS NULL OR (length(btrim(responsible_role)) > 0"
        " AND length(responsible_role) <= 100)",
    )
    op.create_check_constraint(
        op.f("ck_obligations_notice_period_nonblank_bounded"),
        "obligations",
        "notice_period IS NULL OR (length(btrim(notice_period)) > 0"
        " AND length(notice_period) <= 100)",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_obligations_notice_period_nonblank_bounded"), "obligations", type_="check"
    )
    op.drop_constraint(
        op.f("ck_obligations_responsible_role_nonblank_bounded"), "obligations", type_="check"
    )
    op.drop_column("obligations", "notice_period")
    op.drop_column("obligations", "responsible_role")
    op.drop_constraint(op.f("ck_resources_resource_type"), "resources", type_="check")
    op.create_check_constraint(
        op.f("ck_resources_resource_type"), "resources", f"type IN ({_OLD_TYPES})"
    )
