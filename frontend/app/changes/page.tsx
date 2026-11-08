/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";

import { DemoControls, ReplayLabel } from "@/components/DemoControls";
import { useApi } from "@/components/DemoState";
import { EvidenceButton, fromSource } from "@/components/Evidence";
import { Icon } from "@/components/Icon";
import { LoadState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatInstant, formatLocalDate, projectName, RESOURCE_LABELS } from "@/lib/format";
import type { Affected, Change, RequirementValue } from "@/lib/types";

export default function RevisionsPage() {
  const result = useApi(api.changes, "changes");
  return (
    <>
      <header className="max-w-[760px] space-y-2 animate-fade-up">
        <p className="overline">Revisions</p>
        <h1 className="page-title">What changed when a document was reissued</h1>
        <p className="page-lede">
          A revision replaces an earlier one only when the new document says so explicitly, not because it was loaded
          later. Replaced requirements stay available as superseded history. Showing revisions of the documents you can
          read.
        </p>
        <p className="pt-1"><ReplayLabel /></p>
      </header>
      <LoadState result={result}>
        {(syncs) =>
          syncs.length === 0 ? (
            <section className="panel flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="no-changes">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-paper text-muted"><Icon name="history" size={22} /></span>
              <h2 className="section-title">No revisions loaded since the initial import</h2>
              <p className="max-w-[520px] text-ink-soft">
                Every document is at the revision first imported. This local demo includes one predefined reissue:
                Inspection Procedure Revision B (fictional). Loading it updates the current requirements and the default
                search scope; resetting the local demo restores Revision A.
              </p>
              <DemoControls />
            </section>
          ) : (
            syncs.map((sync) => (
              <section key={sync.observed_at} className="flex flex-col gap-6" data-testid="sync">
                <h2 className="overline">Revisions loaded {formatInstant(sync.observed_at)} (demo clock)</h2>
                {sync.changes.map((change) => <ChangeCard key={change.id} change={change} observedAt={sync.observed_at} />)}
              </section>
            ))
          )
        }
      </LoadState>
    </>
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

/** "72 hours' notice" -> "72 hours": the figure shown large. Display only. */
const figure = (period: string) => period.replace(/[’']\s*notice$/i, "").replace(/\s+notice$/i, "");

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
      <dd className="m-0" data-testid={`changed-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        <span className="text-muted line-through decoration-conflict/60">{before ?? "Not stated"}</span>
        <Icon name="arrowRight" size={12} className="mx-1.5 inline text-faint" />
        <span className="font-semibold text-ink">{after ?? "Not stated"}</span>
      </dd>
    </>
  );
}

/** A changed requirement: the superseded and the current statement side by
 * side, each with its notice period large when it states one. */
function ChangedRequirement({ item, change }: { item: Affected; change: Change }) {
  const before = item.old_value as unknown as RequirementValue;
  const after = item.new_value as unknown as RequirementValue;
  const oldLabel = change.old_version?.revision_label ?? "Earlier revision";
  const newLabel = change.new_version.revision_label;
  const diff = wordDiff(flat(before.statement), flat(after.statement));
  const oldSources = item.sources.filter((s) => s.version_number === change.old_version?.version_number);
  const newSources = item.sources.filter((s) => s.version_number === change.new_version.version_number);
  const where = (sources: typeof item.sources) => {
    const s = sources[0];
    return s ? `${s.resource_title} · ${s.page_number !== null ? `p. ${s.page_number}` : "location not stated"}` : change.resource_title;
  };
  return (
    <div className="flex flex-col gap-3" data-testid={`affected-${item.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="overline">{LABELS[item.kind]}</p>
        <EvidenceButton label="Source quotes"
          request={{ kind: LABELS[item.kind], claim: `${LABELS[item.kind]} in ${change.resource_title}`, items: item.sources.map(fromSource) }} />
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <div className="well flex flex-col gap-2.5 border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-[550] text-ink-soft">Old · {oldLabel}</span>
            <span className="badge bg-surface text-ink-soft">Superseded</span>
          </div>
          {before.notice_period && (
            <span className="metric text-ink-soft line-through decoration-2">{figure(before.notice_period)}</span>
          )}
          <p className="source-quote text-[13px] text-ink-soft" data-testid="requirement-before">
            <Words words={diff.before} mark="rounded-sm bg-conflict-soft px-0.5 text-conflict line-through" />
          </p>
          <span className="text-[12px] leading-4 text-muted">{where(oldSources)}, {oldLabel}</span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-lg border border-accent bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-[550]">New · {newLabel}</span>
            <span className="badge badge-verified">Current</span>
          </div>
          {after.notice_period && <span className="metric">{figure(after.notice_period)}</span>}
          <p className="source-quote text-[13px]" data-testid="requirement-after">
            <Words words={diff.after} mark="mark font-semibold" />
          </p>
          <span className="text-[12px] leading-4 text-ink-soft">{where(newSources)}, {newLabel}</span>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
        <Field label="Notice period" before={before.notice_period} after={after.notice_period} />
        <Field label="Responsible role" before={before.responsible_role} after={after.responsible_role} />
        <Field label="Due date" before={before.due_date && formatLocalDate(before.due_date)}
          after={after.due_date && formatLocalDate(after.due_date)} />
      </dl>
    </div>
  );
}

function OtherChange({ item, change }: { item: Affected; change: Change }) {
  const label = LABELS[item.kind];
  const oldLabel = change.old_version?.revision_label ?? "the earlier revision";
  const newLabel = change.new_version.revision_label;
  let body;
  switch (item.kind) {
    case "requirement_withdrawn": {
      const before = item.old_value as unknown as RequirementValue;
      body = (
        <>
          <span className="source-quote text-ink-soft">{flat(before.statement)}</span>
          <span className="block text-[12px] text-muted">Stated by {oldLabel}, not by {newLabel}. Kept as history.</span>
        </>
      );
      break;
    }
    case "requirement_added": {
      const after = item.new_value as unknown as RequirementValue;
      body = (
        <>
          <span className="source-quote text-ink">{flat(after.statement)}</span>
          <span className="block text-[12px] text-muted">First stated by {newLabel}.</span>
        </>
      );
      break;
    }
    case "obligation_wording_changed":
      body = <>The revision rewords a requirement it still states.</>;
      break;
    default:
      body = <>{label}</>;
  }
  return (
    <li className="flex flex-wrap items-start gap-x-5 gap-y-2 border-t border-line py-3 first:border-t-0" data-testid={`affected-${item.kind}`}>
      <span className={`badge ${item.kind === "requirement_withdrawn" ? "badge-neutral" : "badge-found"}`}>{label}</span>
      <p className="min-w-0 flex-[3_1_320px]">{body}</p>
      <EvidenceButton label="Source quotes"
        request={{ kind: label, claim: `${label} in ${change.resource_title}`, items: item.sources.map(fromSource) }} />
    </li>
  );
}

/** The new revision's own statement of what it supersedes, with its source. */
function SupersessionNote({ change }: { change: Change }) {
  const s = change.supersession;
  const oldLabel = change.old_version?.revision_label;
  if (!s) {
    return change.old_version ? (
      <p className="notice notice-warn" data-testid="supersession-missing">
        {change.new_version.revision_label} replaces {oldLabel} as the current stored revision. The document itself does
        not state what it supersedes.
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="supersession">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="overline">Supersession statement</p>
        <EvidenceButton label="Source quote"
          request={{
            kind: "Supersession statement",
            claim: `${change.resource_title} ${change.new_version.revision_label} supersedes ${oldLabel ?? "an earlier revision"}`,
            items: [{
              key: s.source_span_id,
              documentId: change.resource_id,
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
      <blockquote className="m-0 rounded-lg bg-accent-soft px-4 py-3.5 text-[15px] leading-[23px] text-ink">
        <span className="sr-only">{change.new_version.revision_label} supersedes {oldLabel ?? "an earlier revision"}: </span>
        <span className="source-quote">{flat(s.quote)}</span>
        <span className="mt-1 block text-[12px] leading-4 text-accent-ink">
          {change.resource_title} {change.new_version.revision_label} ·{" "}
          {s.page_number !== null ? `p. ${s.page_number}` : "location not stated"} ·{" "}
          {s.names_previous_revision
            ? `names ${s.names_revision}, the previous stored revision`
            : `names ${s.names_revision}, which is not the previous stored revision: check the document register`}
        </span>
      </blockquote>
    </div>
  );
}

function ChangeCard({ change, observedAt }: { change: Change; observedAt: string }) {
  const changed = change.affected.filter((a) => a.kind === "requirement_changed");
  const others = change.affected.filter((a) => a.kind !== "requirement_changed");
  return (
    <article className="panel flex flex-col gap-5 p-5" data-testid="change">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="overline">{change.old_version ? "Document reissued" : "Document added"}</p>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Link href={`/documents/${change.resource_id}`} className="section-title hover:text-link">{change.resource_title}</Link>
            <span className="text-[13px] text-muted">
              {RESOURCE_LABELS[change.resource_type] ?? change.resource_type} in {projectName(change.course_title)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {change.old_version && (
              <>
                <span className="badge badge-neutral min-h-6 text-[14px]">{change.old_version.revision_label}</span>
                <span className="flex text-muted" role="img" aria-label="replaced by"><Icon name="arrowRight" size={16} /></span>
              </>
            )}
            <span className="badge badge-verified min-h-6 text-[14px]">{change.new_version.revision_label} · in force</span>
            <span className="sr-only" data-testid="change-versions">
              {change.old_version
                ? `${change.old_version.revision_label} → ${change.new_version.revision_label}`
                : `new, ${change.new_version.revision_label}`}
            </span>
          </div>
        </div>
        <span className="text-[13px] text-muted">
          Loaded {formatInstant(observedAt)} · {changed.length} changed, {others.length} other
        </span>
      </div>

      <SupersessionNote change={change} />

      {changed.map((item, i) => <ChangedRequirement key={`changed-${i}`} item={item} change={change} />)}

      {others.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="overline">Other requirement changes</p>
          <ul className="m-0 list-none p-0">
            {others.map((item, i) => <OtherChange key={`${item.kind}-${i}`} item={item} change={change} />)}
          </ul>
        </div>
      )}
      {change.affected.length === 0 && <p className="text-ink-soft">No stored requirement was affected.</p>}

      {change.old_version && change.supersession?.names_previous_revision && (
        <div className="notice notice-neutral">
          <span>
            <strong className="font-semibold text-ink">Effect:</strong> the current requirements and the default search now
            use {change.new_version.revision_label}. {change.old_version.revision_label}&apos;s requirements are kept as
            superseded history, and its passages stay searchable with &ldquo;Include superseded revisions (history)&rdquo;.
          </span>
        </div>
      )}
    </article>
  );
}
