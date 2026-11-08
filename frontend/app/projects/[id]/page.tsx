/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { AskDocuments } from "@/components/AskDocuments";
import { ReplayLabel } from "@/components/DemoControls";
import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { ProjectSearch } from "@/components/ProjectSearch";
import { ProvenanceNote, RequirementList } from "@/components/Requirements";
import { CourseDot, LoadState, RunStatus } from "@/components/ui";
import { formatInstant, projectCode, projectName, RESOURCE_LABELS } from "@/lib/format";
import { currentRevision, isCurrent, loadProjectById, requirementsOf } from "@/lib/load";
import type { Obligation, ProjectDocument } from "@/lib/types";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const result = useApi(() => loadProjectById(id), `project-${id}`);
  return (
    <LoadState result={result}>
      {({ project, documents, requirements, latestRun }) => {
        const visible = requirements.filter((r) => !r.hidden);
        const current = visible.filter(isCurrent);
        const superseded = visible.filter((r) => !isCurrent(r));
        return (
          <div className="space-y-10">
            <header className="animate-fade-up">
              <p className="label flex items-center gap-2">
                <CourseDot course={project} />
                Project {projectCode(project.title, project.external_id)}
              </p>
              <h1 className="page-title mt-2">{projectName(project.title)}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
                <RunStatus run={latestRun} />
                <ReplayLabel />
              </p>
            </header>

            <section aria-labelledby="documents-heading">
              <h2 id="documents-heading" className="section-title mb-3">Documents</h2>
              <DocumentTable documents={documents} requirements={visible} />
            </section>

            <ProjectSearch projectId={project.id} />

            <AskDocuments projectId={project.id} />

            <section aria-labelledby="register-heading" className="space-y-3">
              <div>
                <h2 id="register-heading" className="section-title">Current requirements</h2>
                <p className="mt-1 text-[14px] text-muted">Stated by the current revision of each document.</p>
              </div>
              <RequirementList requirements={current}
                empty="No requirements are stored for this project yet. Reset the local demo to replay the recorded extraction." />
              <ProvenanceNote />
            </section>

            <section aria-labelledby="history-heading" className="space-y-3">
              <div>
                <h2 id="history-heading" className="section-title">Superseded requirements (history)</h2>
                <p className="mt-1 text-[14px] text-muted">
                  Stated only by a revision that has since been superseded. Kept, with their original evidence, so the
                  history stays traceable; they no longer apply.{" "}
                  {superseded.length > 0 && <Link href="/changes" className="text-link">See what changed</Link>}
                </p>
              </div>
              <RequirementList requirements={superseded}
                empty="None: no document in this project has been reissued yet." />
            </section>
          </div>
        );
      }}
    </LoadState>
  );
}

function DocumentTable({ documents, requirements }: { documents: ProjectDocument[]; requirements: Obligation[] }) {
  if (documents.length === 0) {
    return <p className="panel border-dashed px-6 py-5 text-[14.5px] text-muted">No documents are stored for this project.</p>;
  }
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[14px]" data-testid="document-table">
        <thead className="border-b border-line text-[12px] text-faint">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">Document</th>
            <th scope="col" className="px-5 py-2.5 font-medium">Type</th>
            <th scope="col" className="px-5 py-2.5 font-medium">Current revision</th>
            <th scope="col" className="px-5 py-2.5 font-medium">Revisions</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Current requirements</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {documents.map((d) => {
            const rev = currentRevision(d);
            const count = requirementsOf(d, requirements).filter(isCurrent).length;
            return (
              <tr key={d.id} data-testid="document-row">
                <td className="px-5 py-3">
                  <Link href={`/documents/${d.id}`} className="inline-flex items-center gap-2 font-medium text-ink hover:text-link">
                    <Icon name="file" size={15} className="text-faint" />{d.title}
                  </Link>
                </td>
                <td className="px-5 py-3 text-ink-soft">{RESOURCE_LABELS[d.type] ?? d.type}</td>
                <td className="px-5 py-3 text-ink-soft">
                  {rev ? <>{rev.revision_label} <span className="text-faint">· imported {formatInstant(rev.imported_at)}</span></> : "None"}
                </td>
                <td className="px-5 py-3 text-ink-soft tabular-nums">
                  {d.revisions.map((r) => r.revision_label).join(", ")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
