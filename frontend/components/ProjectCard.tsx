/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";

import { ReplayLabel } from "@/components/DemoControls";
import { Icon } from "@/components/Icon";
import { RunStatus } from "@/components/ui";
import { formatInstant, projectCode, projectName } from "@/lib/format";
import { isCurrent, type ProjectBundle } from "@/lib/load";
import type { Sync } from "@/lib/types";

/** The latest reissue of one of this project's documents, from the stored changes. */
function revisionStatus(projectId: string, changes: Sync[]): string {
  for (const sync of [...changes].reverse()) {
    const change = sync.changes.find((c) => c.course_id === projectId && c.old_version !== null);
    if (change) {
      return `${change.resource_title} at ${change.new_version.revision_label} (loaded ${formatInstant(sync.observed_at)}); `
        + `${change.old_version?.revision_label} kept as history`;
    }
  }
  return "No document reissued since the initial import";
}

/** A project at a glance: what the signed-in identity may read, and the
 * requirement counts, all as the API returns them. `overview` is the Overview
 * page's simpler card: a larger name, without the processing and revision
 * details or the extraction badge (shown on the project page). */
export function ProjectCard({ bundle, changes, overview = false }: { bundle: ProjectBundle; changes: Sync[]; overview?: boolean }) {
  const { project, documents, requirements, latestRun } = bundle;
  const visible = requirements.filter((r) => !r.hidden);
  const current = visible.filter(isCurrent).length;
  const metrics: [string, number, string][] = [
    ["Accessible documents", documents.length, "metric-documents"],
    ["Current requirements", current, "metric-current"],
    ["Superseded requirements", visible.length - current, "metric-superseded"],
  ];
  return (
    <Link href={`/projects/${project.id}`} className="panel panel-link flex flex-col gap-5 p-5 text-ink" data-testid="project-card"
      aria-label={`Open project ${projectCode(project.title, project.external_id)} requirement register`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="mono text-muted">{projectCode(project.title, project.external_id)}</p>
          <h2 className={overview ? "text-[27px] leading-[34px] font-bold tracking-[-0.02em] text-ink" : "section-title"}>
            {projectName(project.title)}
          </h2>
        </div>
        {!overview && <ReplayLabel />}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {metrics.map(([label, value, testId]) => (
          <div key={label} className="well grid min-h-[120px] grid-rows-[auto_1fr] border border-line px-3 py-4 text-center sm:min-h-[148px]">
            <span className="text-[13px] leading-[18px] text-ink-soft">{label}</span>
            <span className="metric-xl self-center" data-testid={testId}>{value}</span>
          </div>
        ))}
      </div>
      {!overview && (
        <dl className="grid gap-x-4 gap-y-3 text-[13px] leading-[18px] sm:grid-cols-2">
          <div className="space-y-0.5"><dt className="text-muted">Processed</dt><dd className="text-ink"><RunStatus run={latestRun} /></dd></div>
          <div className="space-y-0.5"><dt className="text-muted">Revision status</dt><dd className="text-ink">{revisionStatus(project.id, changes)}</dd></div>
        </dl>
      )}
      <span className="btn btn-primary self-start">
        Open requirement register <Icon name="arrowRight" size={16} />
      </span>
    </Link>
  );
}

/** Shown when the API holds no project. */
export function NoProjects() {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="no-projects">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-paper text-muted"><Icon name="folder" size={22} /></span>
      <h2 className="section-title">No project is loaded</h2>
      <p className="max-w-[520px] text-ink-soft">
        Use <em>Reset local demo</em> at the top right to load the fictional demo project and its synthetic documents.
      </p>
    </div>
  );
}
