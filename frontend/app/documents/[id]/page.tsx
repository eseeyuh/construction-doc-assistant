/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ReplayLabel } from "@/components/DemoControls";
import { useApi } from "@/components/DemoState";
import { EvidenceButton } from "@/components/Evidence";
import { Icon } from "@/components/Icon";
import { LiveAnalysis } from "@/components/LiveAnalysis";
import { ProvenanceNote, RequirementList } from "@/components/Requirements";
import { LoadState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatInstant, projectName, RESOURCE_LABELS } from "@/lib/format";
import { isCurrent, requirementsOf } from "@/lib/load";
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
        return (
          <div className="space-y-10">
            <header className="animate-fade-up">
              {project && (
                <Link href={`/projects/${project.id}`} className="label inline-flex items-center gap-1.5 hover:text-link">
                  <Icon name="arrowRight" size={12} className="rotate-180" />{projectName(project.title)}
                </Link>
              )}
              <h1 className="page-title mt-2">{document.title}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
                <span>{RESOURCE_LABELS[document.type] ?? document.type}</span>
                <ReplayLabel />
              </p>
            </header>

            <section aria-labelledby="revisions-heading">
              <h2 id="revisions-heading" className="section-title mb-3">Revisions</h2>
              <ol className="space-y-3" data-testid="revision-list">
                {[...document.revisions].reverse().map((r) => <RevisionRow key={r.id} doc={document} rev={r} />)}
              </ol>
              <p className="mt-2 text-[12.5px] text-faint">
                Revision labels follow the order in which revisions were stored (the first is Rev A).
              </p>
            </section>

            <section aria-labelledby="doc-requirements-heading" className="space-y-3">
              <h2 id="doc-requirements-heading" className="section-title">Requirements in the current revision</h2>
              <RequirementList requirements={current} linkDocument={false}
                empty="No requirements are stored for the current revision of this document." />
              {superseded.length > 0 && (
                <>
                  <h3 className="pt-4 text-[15px] font-semibold tracking-tight">Superseded (history)</h3>
                  <RequirementList requirements={superseded} linkDocument={false} empty="" />
                </>
              )}
              <ProvenanceNote />
            </section>

            <LiveAnalysis documentId={document.id} />
          </div>
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
    <li className={`panel px-5 py-4 ${rev.current ? "" : "bg-canvas/50"}`} data-testid="revision" data-current={rev.current ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[16px] font-semibold tracking-tight">{rev.revision_label}</span>
        {rev.current
          ? <span className="badge badge-verified">Current</span>
          : <span className="badge badge-review">Superseded{next ? ` by ${next.revision_label}` : ""}</span>}
        <span className="text-[13px] text-muted">{rev.file_name} · {rev.pages} {rev.pages === 1 ? "page" : "pages"}</span>
        <span className="ml-auto text-[12.5px] text-faint">Imported {formatInstant(rev.imported_at)}</span>
      </div>
      {previous && (
        <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="revision-supersedes">
          <p className="min-w-0 flex-1 text-[14px] text-ink-soft">
            Supersedes {previous.revision_label}.{" "}
            {s ? (
              <>
                The document says: <span className="source-quote">{s.quote}</span>
                {!s.names_previous_revision && (
                  <span className="text-review"> It names {s.names_revision}, not the previous stored revision.</span>
                )}
              </>
            ) : (
              <span className="text-muted">The document itself does not state what it supersedes.</span>
            )}
          </p>
          {s && (
            <EvidenceButton label="Source quote" request={{
              kind: "Supersession statement",
              claim: `${doc.title} ${rev.revision_label} supersedes ${previous.revision_label}`,
              items: [{
                key: s.source_span_id, resourceTitle: doc.title, resourceType: doc.type, versionNumber: rev.version_number,
                currentVersion: rev.current, page_number: s.page_number, slide_number: null, section_path: null,
                quote: s.quote, status: null, origin: "Document text",
              }],
            }} />
          )}
        </div>
      )}
    </li>
  );
}
