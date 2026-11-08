/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { AskDocuments } from "@/components/AskDocuments";
import { DownloadButton } from "@/components/DownloadButton";
import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { ProjectSearch } from "@/components/ProjectSearch";
import { RequirementRegister } from "@/components/Requirements";
import { LoadState } from "@/components/ui";
import { projectCode, projectName, RESOURCE_LABELS } from "@/lib/format";
import { currentRevision, isCurrent, loadProjectById, requirementsOf } from "@/lib/load";
import type { Obligation, ProjectDocument } from "@/lib/types";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const result = useApi(() => loadProjectById(id), `project-${id}`);
  return (
    <LoadState result={result}>
      {({ project, documents, requirements }) => {
        const visible = requirements.filter((r) => !r.hidden);
        const code = projectCode(project.title, project.external_id);
        return (
          <>
            <header className="flex flex-col gap-2 animate-fade-up">
              <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
                <Link href="/projects" className="hover:text-ink">Projects</Link> / <span>{code}</span>
              </nav>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="mono text-muted">{code}</span>
                <h1 className="page-title">{projectName(project.title)}</h1>
              </div>
            </header>

            <DocumentTable documents={documents} requirements={visible} />

            <div className="flex flex-col gap-6">
              <AskDocuments key={project.id} projectId={project.id} />
              <ProjectSearch projectId={project.id} />
            </div>

            <RequirementRegister requirements={visible} />
          </>
        );
      }}
    </LoadState>
  );
}

function DocumentTable({ documents, requirements }: { documents: ProjectDocument[]; requirements: Obligation[] }) {
  const router = useRouter();
  return (
    <section className="panel overflow-hidden" aria-labelledby="documents-heading">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="documents-heading" className="section-title">Documents</h2>
        <span className="text-[13px] text-muted">
          {documents.length} {documents.length === 1 ? "document" : "documents"} you can read
        </span>
      </div>
      {documents.length === 0 ? (
        <p className="px-5 py-6 text-ink-soft">No documents you can read are stored for this project.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[720px]" data-testid="document-table">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Type</th>
                <th scope="col">Available revisions</th>
                <th scope="col" className="text-right">Current requirements</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => {
                const count = requirementsOf(d, requirements).filter(isCurrent).length;
                const rev = currentRevision(d);
                return (
                  <tr key={d.id} data-testid="document-row" className="clickable" onClick={() => router.push(`/documents/${d.id}`)}>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <Link href={`/documents/${d.id}`} onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-2 font-[550] text-link hover:underline">
                          <Icon name="file" size={15} className="text-muted" />{d.title}
                        </Link>
                        {rev && (
                          <DownloadButton documentId={d.id} revisionId={rev.id} fileName={rev.file_name} testId="document-download" />
                        )}
                      </span>
                    </td>
                    <td>{RESOURCE_LABELS[d.type] ?? d.type}</td>
                    <td className="tabular-nums">{d.revisions.map((r) => r.revision_label).join(", ")}</td>
                    <td className="text-right text-ink tabular-nums">{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
