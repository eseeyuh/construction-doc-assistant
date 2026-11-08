# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Document revisions (``document-revisions/v1``): labels and explicit
supersession statements, read from stored state only.

- A revision label is derived from the version order: version 1 is "Rev A",
  2 "Rev B", ... The source's own revision code is not parsed; the demo
  documents are numbered the same way and state their revision on page 1.
- A supersession statement is the source's own sentence saying which
  revision it supersedes ("This revision supersedes Revision A"), found
  deterministically in the version's spans. It is reported with its exact
  location and whether it names the previous stored version. Without such a
  sentence a newer version still replaces the older one as the current
  version (the document's identity), but no statement is claimed.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SourceSpan

RULES_VERSION = "document-revisions/v1"
SUPERSEDES = re.compile(
    r"\b(?:this\s+(?:revision|version|issue)\s+)?supersedes\s+(?:revision|rev\.?)\s*"
    r"([A-Z0-9]{1,3})\b",
    re.IGNORECASE,
)


def revision_label(version_number: int) -> str:
    """The label of a version: "Rev A" for 1, ... "Rev Z" for 26, then the number."""
    if 1 <= version_number <= 26:
        return f"Rev {chr(64 + version_number)}"
    return f"Rev {version_number}"


@dataclass(frozen=True, slots=True)
class Supersession:
    span_id: uuid.UUID
    quote_start: int
    quote_end: int
    quote: str
    page_number: int | None
    section_path: str | None
    names: str  # the revision code the statement names, e.g. "A"


async def supersession_statement(
    session: AsyncSession, version_id: uuid.UUID
) -> Supersession | None:
    """The first sentence of this version saying what it supersedes, if any."""
    spans = (
        await session.scalars(
            select(SourceSpan)
            .where(SourceSpan.resource_version_id == version_id)
            .order_by(SourceSpan.ordinal)
        )
    ).all()
    for span in spans:
        found = SUPERSEDES.search(span.excerpt)
        if found:
            return Supersession(
                span.id,
                found.start(),
                found.end(),
                found.group(0),
                span.page_number,
                span.section_path,
                found.group(1).upper(),
            )
    return None


def names_previous(statement: Supersession, previous_version_number: int) -> bool:
    """Whether the statement names the stored previous version's label."""
    return f"Rev {statement.names}" == revision_label(previous_version_number)


# --- which revisions are in force (``revision-supersession/v1``) ---------------------------
#
# Search uses this, not the version order. A revision is SUPERSEDED only when
# another stored revision of the same document states, in its own text, that
# it supersedes the revision code this revision states for itself ("This
# revision supersedes Revision A" in a revision that itself says "Revision B";
# the superseded one says "Revision A"). Everything else stays IN FORCE,
# including an older revision whose successor states nothing, or one that
# states no revision code: upload or version order alone never supersedes.

SUPERSESSION_RULES_VERSION = "revision-supersession/v1"
# A revision's own code: "Revision B", "Rev B" or "Rev. B", capitalised, outside
# any supersedes clause. The first one in document order counts.
OWN_REVISION = re.compile(r"\b(?:Revision|Rev\.?)\s+([A-Z0-9]{1,3})\b")


def stated_revision(texts: list[str]) -> str | None:
    """The revision code a revision states for itself, or None."""
    for text in texts:
        clauses = [m.span() for m in SUPERSEDES.finditer(text)]
        for found in OWN_REVISION.finditer(text):
            if not any(start <= found.start() < end for start, end in clauses):
                return found.group(1)
    return None


@dataclass(frozen=True, slots=True)
class SupersededBy:
    version_id: uuid.UUID
    stated_revision: str | None
    span_id: uuid.UUID
    page_number: int | None
    quote: str  # the exact supersedes clause, as stored


@dataclass(frozen=True, slots=True)
class RevisionStatus:
    version_id: uuid.UUID
    resource_id: uuid.UUID
    version_number: int
    stated_revision: str | None  # the code the revision states for itself
    latest: bool  # the document's newest stored version (Resource.current_version_id)
    superseded_by: SupersededBy | None

    @property
    def in_force(self) -> bool:
        return self.superseded_by is None


async def revision_statuses(
    session: AsyncSession, course_id: uuid.UUID
) -> dict[uuid.UUID, RevisionStatus]:
    """Every stored revision of the project's documents, with whether another
    revision explicitly supersedes it. Reads only, in the caller's snapshot."""
    from app.db.models import Resource, ResourceVersion

    rows = (
        await session.execute(
            select(
                ResourceVersion.id,
                ResourceVersion.resource_id,
                ResourceVersion.version_number,
                Resource.current_version_id,
            )
            .join(Resource, Resource.id == ResourceVersion.resource_id)
            .where(Resource.course_id == course_id)
            .order_by(Resource.id, ResourceVersion.version_number)
        )
    ).all()
    spans: dict[uuid.UUID, list[SourceSpan]] = {row.id: [] for row in rows}
    if spans:
        for span in (
            await session.scalars(
                select(SourceSpan)
                .where(SourceSpan.resource_version_id.in_(list(spans)))
                .order_by(SourceSpan.resource_version_id, SourceSpan.ordinal)
            )
        ).all():
            spans[span.resource_version_id].append(span)
    codes = {v: stated_revision([s.excerpt for s in spans[v]]) for v in spans}

    superseded: dict[uuid.UUID, SupersededBy] = {}
    by_resource: dict[uuid.UUID, list[uuid.UUID]] = {}
    for row in rows:
        by_resource.setdefault(row.resource_id, []).append(row.id)
    for row in rows:
        for span in spans[row.id]:
            for found in SUPERSEDES.finditer(span.excerpt):
                named = found.group(1).upper()
                targets = [
                    other
                    for other in by_resource[row.resource_id]
                    if other != row.id and codes[other] == named
                ]
                # Exactly one revision of this document states the named code:
                # otherwise the statement cannot be attributed, and nothing is
                # excluded on its strength.
                if len(targets) == 1 and targets[0] not in superseded:
                    superseded[targets[0]] = SupersededBy(
                        row.id, codes[row.id], span.id, span.page_number, found.group(0)
                    )
    return {
        row.id: RevisionStatus(
            version_id=row.id,
            resource_id=row.resource_id,
            version_number=row.version_number,
            stated_revision=codes[row.id],
            latest=row.current_version_id == row.id,
            superseded_by=superseded.get(row.id),
        )
        for row in rows
    }
