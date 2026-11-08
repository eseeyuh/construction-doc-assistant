/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DemoControls, ReplayLabel } from "@/components/DemoControls";
import { useApi } from "@/components/DemoState";
import { EvidenceButton, fromSource } from "@/components/Evidence";
import { Icon, type IconName } from "@/components/Icon";
import { LoadState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatInstant, formatLocalDate, projectName, RESOURCE_LABELS } from "@/lib/format";
import type { Affected, Change, RequirementValue } from "@/lib/types";

export default function RevisionsPage() {
  const result = useApi(api.changes, "changes");
  return (
    <div className="space-y-10">
      <header className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="animate-fade-up">
          <h1 className="page-title">Revisions</h1>
          <p className="page-lede">
            When a document is reissued, the assistant records which revision supersedes which, keeps the earlier
            revision&apos;s requirements as history, and shows what changed.
          </p>
          <p className="mt-3"><ReplayLabel /></p>
        </div>
        <div className="panel p-5">
          <h2 className="section-title">Local demo: next revision</h2>
          <p className="mt-1 text-[14px] text-muted">
            The demo project starts with Inspection Procedure Revision A. Loading the next revision imports Revision B
            (fictional, issued 20 October 2026) through the ordinary change-detection path. Resetting the local demo
            deletes the demo&apos;s data and rebuilds it at Revision A.
          </p>
          <div className="mt-4"><DemoControls /></div>
        </div>
      </header>
      <LoadState result={result}>
        {(syncs) =>
          syncs.length === 0 ? (
            <div className="panel flex max-w-2xl gap-3.5 border-dashed px-5 py-4 text-[15px] text-muted" data-testid="no-changes">
              <Icon name="history" size={18} className="mt-0.5 text-faint" />
              <p>
                No revisions loaded yet: every document is at the revision first imported. Use <em>Load next revision
                (demo)</em> to bring in Inspection Procedure Revision B.
              </p>
            </div>
          ) : (
            <div className="space-y-14">
              {syncs.map((sync) => (
                <section key={sync.observed_at} data-testid="sync">
                  <h2 className="label mb-5">Revisions loaded {formatInstant(sync.observed_at)} (demo clock)</h2>
                  <ol className="relative space-y-6 border-l border-line pl-8">
                    {sync.changes.map((change) => (
                      <TimelineStep key={change.id} icon="file">
                        <ChangeCard change={change} />
                      </TimelineStep>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )
        }
      </LoadState>
    </div>
  );
}

/** Word-level difference of two stored texts (longest common subsequence):
 * marks the words that differ. Display only; both texts are the sources'. */
function wordDiff(before: string, after: string): { before: [string, boolean][]; after: [string, boolean][] } {
  const a = before.split(" ");
  const b = after.split(" ");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const outA: [string, boolean][] = [];
  const outB: [string, boolean][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      outA.push([a[i++], false]);
      outB.push([b[j++], false]);
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      outB.push([b[j++], true]);
    } else {
      outA.push([a[i++], true]);
    }
  }
  return { before: outA, after: outB };
}

function Words({ words, mark }: { words: [string, boolean][]; mark: string }) {
  return (
    <>
      {words.map(([w, changed], k) => (
        <span key={k}>{k > 0 && " "}{changed ? <span className={mark}>{w}</span> : w}</span>
      ))}
    </>
  );
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const LABELS: Record<Affected["kind"], string> = {
  requirement_changed: "Requirement changed",
  requirement_withdrawn: "Requirement withdrawn",
  requirement_added: "New requirement",
  obligation_wording_changed: "Requirement reworded",
  // Inherited kinds; the construction demo does not produce them.
  deadline_added: "New deadline",
  deadline_superseded: "Deadline replaced",
  conflict_changed: "Conflict changed",
};

function Field({ label, before, after }: { label: string; before: string | null; after: string | null }) {
  if (before === after) return null;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd data-testid={`changed-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        <span className="text-muted line-through decoration-conflict/60">{before ?? "Not stated"}</span>
        <Icon name="arrowRight" size={12} className="mx-1.5 inline text-faint" />
        <span className="font-semibold text-ink">{after ?? "Not stated"}</span>
      </dd>
    </>
  );
}

function AffectedBody({ item, change }: { item: Affected; change: Change }) {
  const oldLabel = change.old_version?.revision_label ?? "Earlier revision";
  const newLabel = change.new_version.revision_label;
  switch (item.kind) {
    case "requirement_changed": {
      const before = item.old_value as unknown as RequirementValue;
      const after = item.new_value as unknown as RequirementValue;
      const diff = wordDiff(flat(before.statement), flat(after.statement));
      return (
        <div className="space-y-3">
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">{oldLabel} (superseded, kept as history)</dt>
              <dd className="source-quote mt-1 text-muted" data-testid="requirement-before">
                <Words words={diff.before} mark="rounded-sm bg-conflict-soft px-0.5 text-conflict line-through" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{newLabel} (current)</dt>
              <dd className="source-quote mt-1" data-testid="requirement-after">
                <Words words={diff.after} mark="mark font-semibold" />
              </dd>
            </div>
          </dl>
          <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1 text-[13.5px]">
            <Field label="Notice period" before={before.notice_period} after={after.notice_period} />
            <Field label="Responsible role" before={before.responsible_role} after={after.responsible_role} />
            <Field label="Due date" before={before.due_date && formatLocalDate(before.due_date)}
              after={after.due_date && formatLocalDate(after.due_date)} />
          </dl>
        </div>
      );
    }
    case "requirement_withdrawn": {
      const before = item.old_value as unknown as RequirementValue;
      return (
        <p>
          <span className="source-quote text-muted">{flat(before.statement)}</span>
          <span className="block text-[13px] text-faint">Stated by {oldLabel}, not by {newLabel}. Kept as history.</span>
        </p>
      );
    }
    case "requirement_added": {
      const after = item.new_value as unknown as RequirementValue;
      return (
        <p>
          <span className="source-quote">{flat(after.statement)}</span>
          <span className="block text-[13px] text-faint">First stated by {newLabel}.</span>
        </p>
      );
    }
    case "obligation_wording_changed":
      return <p>The revision rewords a requirement it still states.</p>;
    default:
      return <p>{LABELS[item.kind]}</p>;
  }
}

/** One step on the timeline: a node on the rail, then its card. */
function TimelineStep({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="relative">
      <span aria-hidden className="absolute top-4 -left-[45px] grid h-[26px] w-[26px] place-items-center rounded-full bg-paper text-muted ring-4 ring-canvas">
        <Icon name={icon} size={13} />
      </span>
      {children}
    </li>
  );
}

function AffectedRow({ item, change }: { item: Affected; change: Change }) {
  const label = LABELS[item.kind];
  return (
    <li className="grid gap-x-4 gap-y-2 py-4 text-[14.5px] sm:grid-cols-[10.5rem_1fr_auto]" data-testid={`affected-${item.kind}`}>
      <span><span className={`badge ${item.kind === "requirement_changed" ? "badge-review" : "badge-neutral"}`}>{label}</span></span>
      <div className="min-w-0 text-ink-soft"><AffectedBody item={item} change={change} /></div>
      <span>
        <EvidenceButton label="Source quotes"
          request={{ kind: label, claim: `${label} in ${change.resource_title}`, items: item.sources.map(fromSource) }} />
      </span>
    </li>
  );
}

/** The new revision's own statement of what it supersedes, with its source. */
function SupersessionNote({ change }: { change: Change }) {
  const s = change.supersession;
  const oldLabel = change.old_version?.revision_label;
  if (!s) {
    return change.old_version ? (
      <p className="text-[13.5px] text-muted" data-testid="supersession-missing">
        {change.new_version.revision_label} replaces {oldLabel} as the current stored revision. The document itself does
        not state what it supersedes.
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="supersession">
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-ink">
          {change.new_version.revision_label} supersedes {oldLabel ?? "an earlier revision"}
        </p>
        <blockquote className="source-quote mt-1 border-l-[3px] border-mark-strong bg-mark/40 px-3 py-1.5 text-[14px]">{flat(s.quote)}</blockquote>
        <p className="mt-1 text-[12.5px] text-faint">
          {change.new_version.revision_label}, {s.page_number !== null ? `page ${s.page_number}` : "location not stated"}.
          {s.names_previous_revision
            ? ` It names ${s.names_revision}, the previous stored revision.`
            : ` It names ${s.names_revision}, which is not the previous stored revision: check the document register.`}
        </p>
      </div>
      <EvidenceButton label="Source quote"
        request={{
          kind: "Supersession statement",
          claim: `${change.resource_title} ${change.new_version.revision_label} supersedes ${oldLabel ?? "an earlier revision"}`,
          items: [{
            key: s.source_span_id,
            resourceTitle: change.resource_title,
            resourceType: change.resource_type,
            versionNumber: change.new_version.version_number,
            currentVersion: true,
            page_number: s.page_number,
            slide_number: null,
            section_path: null,
            quote: s.quote,
            status: null,
            origin: "Document text",
          }],
        }} />
    </div>
  );
}

function ChangeCard({ change }: { change: Change }) {
  return (
    <article className="panel overflow-hidden" data-testid="change">
      <header className="space-y-3 px-6 pt-4 pb-4">
        <div>
          <p className="label">{change.old_version ? "Document reissued" : "Document added"}</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/documents/${change.resource_id}`} className="text-[17.5px] font-semibold tracking-tight hover:text-link">
              {change.resource_title}
            </Link>
            <span className="text-[14px] text-muted">
              {RESOURCE_LABELS[change.resource_type] ?? change.resource_type} in {projectName(change.course_title)}
            </span>
            <span className="ml-auto rounded-md bg-paper px-2 py-0.5 text-[12.5px] text-ink-soft ring-1 ring-line" data-testid="change-versions">
              {change.old_version
                ? `${change.old_version.revision_label} → ${change.new_version.revision_label}`
                : `new, ${change.new_version.revision_label}`}
            </span>
          </div>
        </div>
        <SupersessionNote change={change} />
      </header>
      <div className="border-t border-line bg-canvas/40 px-6 pt-3.5">
        <p className="eyebrow text-[12.5px] text-link"><Icon name="arrowRight" size={13} />What changed in the requirements</p>
        <ul className="divide-y divide-line">
          {change.affected.map((item, i) => <AffectedRow key={`${item.kind}-${i}`} item={item} change={change} />)}
          {change.affected.length === 0 && <li className="py-3 text-[14.5px] text-muted">No stored requirement was affected.</li>}
        </ul>
      </div>
    </article>
  );
}
