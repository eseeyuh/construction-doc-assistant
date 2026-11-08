/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";

import { Icon } from "@/components/Icon";
import { courseTone, RunStatus } from "@/components/ui";
import { projectCode, projectName } from "@/lib/format";
import { isCurrent, type ProjectBundle } from "@/lib/load";

/** A project at a glance: its documents and requirement counts, as stored. */
export function ProjectCard({ bundle }: { bundle: ProjectBundle }) {
  const { project, documents, requirements, latestRun } = bundle;
  const visible = requirements.filter((r) => !r.hidden);
  const current = visible.filter(isCurrent).length;
  const superseded = visible.length - current;
  const reissued = documents.filter((d) => d.revisions.length > 1).length;
  return (
    <Link href={`/projects/${project.id}`} className="panel panel-link block overflow-hidden" data-testid="project-card">
      <div aria-hidden className={`h-1 ${courseTone(project).bar}`} />
      <div className="p-6">
        <p className={`label ${courseTone(project).text}`}>{projectCode(project.title, project.external_id)}</p>
        <h2 className="mt-1 text-[21px] font-semibold tracking-tight">{projectName(project.title)}</h2>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
          <div><dt className="text-faint">Documents</dt><dd className="text-[20px] font-semibold tabular-nums">{documents.length}</dd></div>
          <div><dt className="text-faint">Current requirements</dt><dd className="text-[20px] font-semibold tabular-nums">{current}</dd></div>
          <div><dt className="text-faint">Superseded</dt><dd className="text-[20px] font-semibold tabular-nums">{superseded}</dd></div>
        </dl>
        <p className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
          <RunStatus run={latestRun} />
          <span>{reissued === 0 ? "No document reissued yet" : `${reissued} ${reissued === 1 ? "document" : "documents"} reissued`}</span>
        </p>
        <p className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-link">
          Open requirement register <Icon name="arrowRight" size={13} />
        </p>
      </div>
    </Link>
  );
}

/** Shown when the API holds no project. */
export function NoProjects() {
  return (
    <div className="panel max-w-2xl border-dashed px-6 py-5 text-[15px] text-muted" data-testid="no-projects">
      <p className="font-medium text-ink">No project is loaded.</p>
      <p className="mt-1">
        Use <em>Reset local demo</em> at the top of the page to load the fictional demo project and its synthetic
        documents.
      </p>
    </div>
  );
}
