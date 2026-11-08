/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ReplayLabel } from "@/components/DemoControls";
import { useApi } from "@/components/DemoState";
import { EvidenceButton } from "@/components/Evidence";
import { LiveAnalysis } from "@/components/LiveAnalysis";
import { ProvenanceNote, RequirementList } from "@/components/Requirements";
import { LoadState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatInstant, projectCode, RESOURCE_LABELS } from "@/lib/format";
import { currentRevision, isCurrent, requirementsOf } from "@/lib/load";
import type { ProjectDocument, Revision } from "@/lib/types";

async function loadDocumentPage(id: string) {
  const document = await api.document(id);
  const [projects, requirements] = await Promise.all([api.projects(), api.requirements(document.course_id)]);
  const project = projects.find((p) => p.id === document.course_id) ?? null;
  return { document, project, requirements: requirementsOf(document, requirements.filter((r) => !r.hidden)) };
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const result = useApi(() => loadDocumentPage(id), `document-${id}`);
  return (
    <LoadState result={result}>
      {({ document, project, requirements }) => {
        const current = requirements.filter(isCurrent);
        const superseded = requirements.filter((r) => !isCurrent(r));
        const now = currentRevision(document);
        return (
          <>
            <header className="flex flex-col gap-2 animate-fade-up">
              <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
                <Link href="/projects" className="hover:text-ink">Projects</Link>
                {project && <> / <Link href={`/projects/${project.id}`} className="hover:text-ink">{projectCode(project.title, project.external_id)}</Link></>}
                {" "}/ <span>{document.title}</span>
              </nav>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="page-title">{document.title}</h1>
                {now && <span className="mono rounded-md bg-paper px-2 py-0.5 text-ink-soft">{now.file_name}</span>}
              </div>
              <dl className="m-0 flex flex-wrap gap-x-7 gap-y-2 text-[13px] leading-[18px]">
                <div className="flex gap-1.5"><dt className="text-muted">Type</dt><dd className="m-0">{RESOURCE_LABELS[document.type] ?? document.type}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted">Current revision</dt><dd className="m-0">{now?.revision_label ?? "None"}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted">Current requirements</dt><dd className="m-0 tabular-nums">{current.length}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted">Superseded</dt><dd className="m-0 tabular-nums">{superseded.length}</dd></div>
                <div className="flex items-center gap-1.5"><dt className="sr-only">Requirement source</dt><dd className="m-0"><ReplayLabel /></dd></div>
              </dl>
            </header>

            <div className="flex flex-wrap items-start gap-6">
              <section aria-labelledby="revisions-heading" className="panel flex min-w-0 flex-[3_1_480px] flex-col gap-3 p-5">
                <h2 id="revisions-heading" className="section-title">Revisions</h2>
                <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="revision-list">
                  {[...document.revisions].reverse().map((r) => <RevisionRow key={r.id} doc={document} rev={r} />)}
                </ol>
                <p className="text-[12px] leading-4 text-muted">
                  Revision labels follow the order in which revisions were stored (the first is Rev A). A revision is
                  superseded only when a later one says so.
                </p>
              </section>
              <LiveAnalysis documentId={document.id} currentLabel={now?.revision_label ?? null} />
            </div>

            <section aria-labelledby="doc-requirements-heading" className="panel flex flex-col gap-4 p-5">
              <div className="space-y-0.5">
                <h2 id="doc-requirements-heading" className="section-title">Requirements</h2>
                <p className="text-[13px] leading-[18px] text-muted">
                  Current · {now?.revision_label ?? "current revision"} · from the authored offline register
                </p>
              </div>
              <RequirementList requirements={current}
                empty="No requirements are stored for the current revision of this document." />
              <div className="space-y-0.5 pt-2">
                <h3 className="text-[14px] leading-5 font-semibold">Superseded history</h3>
                <p className="text-[13px] leading-[18px] text-muted">
                  {superseded.length
                    ? "Earlier requirements kept for reference. A later revision explicitly supersedes them."
                    : "None. Requirements appear here when a later revision explicitly supersedes the one that states them."}
                </p>
              </div>
              {superseded.length > 0 && <RequirementList requirements={superseded} empty="" />}
            </section>
            <ProvenanceNote />
          </>
        );
      }}
    </LoadState>
  );
}

function RevisionRow({ doc, rev }: { doc: ProjectDocument; rev: Revision }) {
  const previous = doc.revisions.find((r) => r.id === rev.supersedes_version_id) ?? null;
  const next = doc.revisions.find((r) => r.id === rev.superseded_by_version_id) ?? null;
  const s = rev.supersession;
  return (
    <li className={`flex flex-col gap-2 rounded-lg border border-line px-3.5 py-3 ${rev.current ? "" : "bg-canvas/40"}`}
      data-testid="revision" data-current={rev.current ? "true" : "false"}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-[550]">{rev.revision_label}</span>
            {rev.current
              ? <span className="badge badge-verified">In force</span>
              : <span className="badge badge-neutral">Superseded{next ? ` by ${next.revision_label}` : ""}</span>}
          </span>
          <span className="text-[12px] leading-4 text-ink-soft">
            {previous
              ? `Supersedes ${previous.revision_label}${s?.page_number != null ? ` (stated on p. ${s.page_number})` : ""}`
              : rev.current ? "Initial import" : "Kept as history · initial import"}
            {` · imported ${formatInstant(rev.imported_at)}`}
          </span>
          <span className="mono text-[12px] text-muted">{rev.file_name} · {rev.pages} {rev.pages === 1 ? "page" : "pages"}</span>
        </span>
        {s && previous && (
          <EvidenceButton label="Source quote" request={{
            kind: "Supersession statement",
            claim: `${doc.title} ${rev.revision_label} supersedes ${previous.revision_label}`,
            items: [{
              key: s.source_span_id, documentId: doc.id, resourceTitle: doc.title, resourceType: doc.type,
              versionNumber: rev.version_number, currentVersion: rev.current, page_number: s.page_number,
              slide_number: null, section_path: null, quote: s.quote, status: null, origin: "Document text",
            }],
          }} />
        )}
      </div>
      {previous && (
        <div data-testid="revision-supersedes" className="text-[13px] text-ink-soft">
          {s ? (
            <blockquote className="m-0 rounded-md bg-paper px-3 py-2">
              <span className="source-quote">{s.quote}</span>
              <span className="text-muted"> — {rev.revision_label}{s.page_number !== null ? `, p. ${s.page_number}` : ""}</span>
              {!s.names_previous_revision && (
                <span className="block text-review">It names {s.names_revision}, not the previous stored revision.</span>
              )}
            </blockquote>
          ) : (
            <span className="text-muted">The document itself does not state what it supersedes.</span>
          )}
        </div>
      )}
    </li>
  );
}
