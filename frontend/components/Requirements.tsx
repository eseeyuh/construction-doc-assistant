/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// The requirement register. Every value shown is stored: the statement is the
// source sentence, the role and notice period are copied verbatim from it,
// the due date is a calendar date it states. A value the source does not
// state is shown as "Not stated", never filled in.

import Link from "next/link";

import { EvidenceButton, fromEvidence } from "@/components/Evidence";
import { formatLocalDate, isFixture, locator, revisionLabel } from "@/lib/format";
import { statementEvidence, statementOf } from "@/lib/load";
import type { Evidence, Obligation } from "@/lib/types";

function NotStated() {
  return <span className="text-faint italic" data-testid="not-stated">Not stated</span>;
}

/** The evidence a requirement is shown with: the newest revision that states it. */
function newestSource(r: Obligation): Evidence | null {
  return [...statementEvidence(r)].sort((a, b) => b.version_number - a.version_number)[0] ?? null;
}

export function deadlineOf(r: Obligation): string | null {
  const parts = [r.notice_period, r.due ? `by ${formatLocalDate(r.due.due_date, r.due.due_time)}` : null].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

function RequirementRow({ r, linkDocument }: { r: Obligation; linkDocument: boolean }) {
  const source = newestSource(r);
  const deadline = deadlineOf(r);
  const fixture = r.evidence.some((e) => isFixture(e.model));
  return (
    <li className={`grid gap-x-6 gap-y-3 px-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] ${r.supported_by_current_version ? "" : "bg-canvas/50"}`}
      data-testid="requirement" data-current={r.supported_by_current_version ? "true" : "false"}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {r.supported_by_current_version
            ? <span className="badge badge-verified">Current</span>
            : <span className="badge badge-review" title="Stated only by a superseded revision; kept as history">Superseded</span>}
          {r.modality === "mandatory" && <span className="badge badge-neutral">Mandatory</span>}
          {r.modality === "recommended" && <span className="badge badge-neutral" title="The source uses permissive wording, such as “should”">Recommended</span>}
          {r.status === "needs_review" && <span className="badge badge-review">Needs review</span>}
          {fixture && <span className="badge badge-neutral" title="Answer authored for the demo and replayed offline; not model output">Authored fixture</span>}
        </div>
        <p className="source-quote mt-2.5 max-w-prose text-[15.5px] leading-relaxed text-ink" data-testid="requirement-statement">
          {statementOf(r)}
        </p>
        <dl className="mt-3 grid grid-cols-[9.5rem_1fr] gap-x-4 gap-y-1 text-[13.5px]">
          <dt className="text-faint">Responsible role</dt>
          <dd className="text-ink-soft" data-testid="requirement-role">{r.responsible_role ?? <NotStated />}</dd>
          <dt className="text-faint">Deadline or notice</dt>
          <dd className="text-ink-soft" data-testid="requirement-deadline">{deadline ?? <NotStated />}</dd>
        </dl>
      </div>
      <div className="flex flex-col items-start gap-2 text-[13px] md:items-end md:text-right">
        {source && (
          <p className="text-ink-soft" data-testid="requirement-source">
            {linkDocument
              ? <Link href={`/documents/${source.resource_id}`} className="font-medium text-link">{source.resource_title}</Link>
              : <span className="font-medium">{source.resource_title}</span>}
            <br />
            <span className="text-muted">{revisionLabel(source.version_number)} · {locator(source)}</span>
            {!source.current_version && <><br /><span className="text-review">Revision since superseded</span></>}
          </p>
        )}
        <EvidenceButton label="Source quote"
          request={{ kind: "Requirement evidence", claim: statementOf(r), items: r.evidence.map(fromEvidence) }} />
      </div>
    </li>
  );
}

/** Current requirements first, then (if asked) the superseded history. */
export function RequirementList({ requirements, linkDocument = true, empty }: {
  requirements: Obligation[];
  linkDocument?: boolean;
  empty: string;
}) {
  const visible = requirements.filter((r) => !r.hidden);
  if (visible.length === 0) {
    return <p className="panel border-dashed px-6 py-5 text-[14.5px] text-muted" data-testid="no-requirements">{empty}</p>;
  }
  return (
    <ul className="panel divide-y divide-line overflow-hidden" data-testid="requirement-list">
      {visible.map((r) => <RequirementRow key={r.id} r={r} linkDocument={linkDocument} />)}
    </ul>
  );
}

/** What the stored requirements are, said once per page. */
export function ProvenanceNote() {
  return (
    <p className="max-w-3xl text-[13px] text-muted" data-testid="provenance-note">
      Recorded output: these requirements were produced by replaying authored fixture answers offline through the real
      extraction and evidence gate. They are not live model output and are not an evaluation of a model. Each quote is
      checked against the document; a role, deadline or notice period is kept only if the quoted sentence states it,
      otherwise it shows as <em>Not stated</em>.
    </p>
  );
}
