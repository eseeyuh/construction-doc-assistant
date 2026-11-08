/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// The requirement register. Every value shown is stored: the statement is the
// source sentence, the role and notice period are copied verbatim from it,
// the due date is a calendar date it states. A value the source does not
// state is shown as "Not stated", never filled in.

import Link from "next/link";
import { useId, useState } from "react";

import { EvidenceButton, fromEvidence } from "@/components/Evidence";
import { Icon } from "@/components/Icon";
import { formatLocalDate, isFixture, locator, revisionLabel } from "@/lib/format";
import { isCurrent, statementEvidence, statementOf } from "@/lib/load";
import type { Evidence, Obligation } from "@/lib/types";

function NotStated() {
  return <span className="text-muted italic" data-testid="not-stated">Not stated</span>;
}

/** The evidence a requirement is shown with: the newest revision that states it. */
function newestSource(r: Obligation): Evidence | null {
  return [...statementEvidence(r)].sort((a, b) => b.version_number - a.version_number)[0] ?? null;
}

export function deadlineOf(r: Obligation): string | null {
  const parts = [r.notice_period, r.due ? `by ${formatLocalDate(r.due.due_date, r.due.due_time)}` : null].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

function Badges({ r }: { r: Obligation }) {
  const fixture = r.evidence.some((e) => isFixture(e.model));
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {r.supported_by_current_version
        ? <span className="badge badge-verified">Current</span>
        : <span className="badge badge-neutral" title="Stated only by a superseded revision; kept as history">Superseded</span>}
      {r.modality === "mandatory" && <span className="badge badge-neutral">Mandatory</span>}
      {r.modality === "recommended" && <span className="badge badge-neutral" title="The source uses permissive wording, such as “should”">Recommended</span>}
      {r.status === "needs_review" && <span className="badge badge-review">Needs review</span>}
      {fixture && <span className="badge badge-neutral" title="Answer authored for the demo and replayed offline; not model output">Authored fixture</span>}
    </span>
  );
}

function evidenceRequest(r: Obligation) {
  return { kind: "Requirement evidence", claim: statementOf(r), items: r.evidence.map(fromEvidence) };
}

function SourceCell({ source, linkDocument }: { source: Evidence; linkDocument: boolean }) {
  return (
    <span className="flex flex-col gap-0.5" data-testid="requirement-source">
      {linkDocument
        ? <Link href={`/documents/${source.resource_id}`} className="text-link font-medium">{source.resource_title}</Link>
        : <span className="font-medium text-ink">{source.resource_title}</span>}
      <span className="text-[12px] leading-4">{revisionLabel(source.version_number)} · {locator(source)}</span>
      {!source.current_version && <span className="text-[12px] leading-4 text-review">Revision since superseded</span>}
    </span>
  );
}

/** The project's register: current requirements and the superseded history,
 * as two tabs of one table. Both are rendered; the inactive one is hidden. */
export function RequirementRegister({ requirements }: { requirements: Obligation[] }) {
  const visible = requirements.filter((r) => !r.hidden);
  const current = visible.filter(isCurrent);
  const superseded = visible.filter((r) => !isCurrent(r));
  const [tab, setTab] = useState<"current" | "superseded">("current");
  const id = useId();
  const tabs = [
    { key: "current" as const, label: "Current", rows: current },
    { key: "superseded" as const, label: "Superseded history", rows: superseded },
  ];
  return (
    <section className="panel overflow-hidden" aria-labelledby={`${id}-heading`} data-testid="requirement-register">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="space-y-0.5">
          <h2 id={`${id}-heading`} className="section-title">Requirement register</h2>
          <p className="text-[13px] leading-[18px] text-muted">
            Authored offline fixtures, replayed through the evidence gate. Not live model output.
          </p>
        </div>
        <div className="tabs" role="tablist" aria-label="Requirement status">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" id={`${id}-${t.key}-tab`} aria-controls={`${id}-${t.key}`}
              aria-selected={tab === t.key} onClick={() => setTab(t.key)} data-testid={`register-tab-${t.key}`}>
              {t.label} <span className="tabular-nums">{t.rows.length}</span>
            </button>
          ))}
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.key} id={`${id}-${t.key}`} role="tabpanel" aria-labelledby={`${id}-${t.key}-tab`} hidden={tab !== t.key}>
          {t.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-5 py-8 text-center" data-testid="no-requirements">
              <span className="font-[550]">{t.key === "current" ? "No current requirements" : "No superseded requirements"}</span>
              <span className="text-[13px] leading-[18px] text-ink-soft">
                {t.key === "current"
                  ? "No requirements are stored for this project yet. Reset the local demo to replay the recorded extraction."
                  : "Requirements move here when a later revision explicitly supersedes the revision that states them."}
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[880px]" data-testid="requirement-list">
                <thead>
                  <tr>
                    <th scope="col">Requirement</th>
                    <th scope="col">Responsible</th>
                    <th scope="col">Deadline / notice</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="text-right">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r) => {
                    const source = newestSource(r);
                    const deadline = deadlineOf(r);
                    return (
                      <tr key={r.id} data-testid="requirement" data-current={r.supported_by_current_version ? "true" : "false"}
                        className={r.supported_by_current_version ? "" : "history"}>
                        <td className="max-w-[380px]">
                          <span className="flex flex-col gap-1.5">
                            <span className="font-[550] text-ink" data-testid="requirement-statement">{statementOf(r)}</span>
                            <Badges r={r} />
                          </span>
                        </td>
                        <td data-testid="requirement-role">{r.responsible_role ?? <NotStated />}</td>
                        <td data-testid="requirement-deadline">{deadline ?? <NotStated />}</td>
                        <td>{source ? <SourceCell source={source} linkDocument /> : <NotStated />}</td>
                        <td className="text-right"><EvidenceButton label="Source quote" request={evidenceRequest(r)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/** A document's requirements as rows (the document page). */
export function RequirementList({ requirements, empty }: { requirements: Obligation[]; empty: string }) {
  const visible = requirements.filter((r) => !r.hidden);
  if (visible.length === 0) {
    return <p className="text-[13px] leading-[18px] text-muted" data-testid="no-requirements">{empty}</p>;
  }
  return (
    <ul className="m-0 list-none p-0" data-testid="requirement-list">
      {visible.map((r) => {
        const source = newestSource(r);
        const deadline = deadlineOf(r);
        const current = r.supported_by_current_version;
        return (
          <li key={r.id} data-testid="requirement" data-current={current ? "true" : "false"}
            className={`flex flex-wrap items-start gap-x-5 gap-y-2 border-t border-line py-3.5 ${current ? "text-ink" : "text-ink-soft"}`}>
            <span className="flex min-w-0 flex-[3_1_320px] flex-col gap-1.5">
              <span className={current ? "font-[550]" : ""} data-testid="requirement-statement">{statementOf(r)}</span>
              <Badges r={r} />
            </span>
            <span className="flex flex-[1_1_140px] flex-col gap-0.5 text-[13px] leading-[18px]">
              <span className="text-muted">Responsible</span>
              <span data-testid="requirement-role">{r.responsible_role ?? <NotStated />}</span>
            </span>
            <span className="flex flex-[1_1_160px] flex-col gap-0.5 text-[13px] leading-[18px]">
              <span className="text-muted">Deadline / notice</span>
              <span data-testid="requirement-deadline">{deadline ?? <NotStated />}</span>
            </span>
            <span className="flex flex-col items-start gap-1.5 text-[13px] leading-[18px]">
              {source && (
                <span className="text-ink-soft" data-testid="requirement-source">
                  {revisionLabel(source.version_number)} · {locator(source)}
                </span>
              )}
              <EvidenceButton label="Source quote" request={evidenceRequest(r)} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What the stored requirements are, said once per page. */
export function ProvenanceNote() {
  return (
    <div className="notice notice-neutral border border-line" data-testid="provenance-note">
      <Icon name="info" />
      <span>
        <strong className="font-semibold text-ink">About the requirement register.</strong> It is recorded output:
        authored fixture answers replayed offline through the real extraction and evidence gate. It is not live model
        output and not an evaluation of a model. Each quote is checked against the document; a role, deadline or notice
        period is kept only if the quoted sentence states it, otherwise it shows as <em>Not stated</em>.
      </span>
    </div>
  );
}
