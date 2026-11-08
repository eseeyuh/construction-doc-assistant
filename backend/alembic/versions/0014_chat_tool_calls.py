# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""model calls: record tool-calling chat turns (call_kind 'chat_tools')

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-08

Additive only: the allowed call kinds gain 'chat_tools' (one turn of the
"Ask project documents" conversation). Existing rows are untouched.
Downgrade restores the previous list (it fails while a 'chat_tools' row
exists).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = "'chat_structured', 'embedding'"
_NEW = _OLD + ", 'chat_tools'"


def _set(kinds: str) -> None:
    op.drop_constraint(op.f("ck_model_calls_model_call_kind"), "model_calls", type_="check")
    op.create_check_constraint(
        op.f("ck_model_calls_model_call_kind"), "model_calls", f"call_kind IN ({kinds})"
    )


def upgrade() -> None:
    _set(_NEW)


def downgrade() -> None:
    _set(_OLD)
