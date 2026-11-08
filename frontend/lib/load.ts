/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { api, ApiError } from "@/lib/api";
import type { Course, Evidence, Obligation, ProjectDocument, Sync, WorkflowRun } from "@/lib/types";

export type ProjectBundle = {
  project: Course;
  documents: ProjectDocument[];
  requirements: Obligation[];
  /** The project's latest processing run (null if none). */
  latestRun: WorkflowRun | null;
};

export async function loadProject(project: Course): Promise<ProjectBundle> {
  const [documents, requirements, runs] = await Promise.all([
    api.documents(project.id),
    api.requirements(project.id),
    api.workflowRuns(project.id),
  ]);
  return { project, documents, requirements, latestRun: runs[0] ?? null };
}

export async function loadProjectById(id: string): Promise<ProjectBundle> {
  const project = (await api.projects()).find((p) => p.id === id);
  if (!project) throw new ApiError(404, "This project is not in the demo data. Reset the local demo to reload it.");
  return loadProject(project);
}

export type Overview = { projects: ProjectBundle[]; changes: Sync[] };

export async function loadOverview(): Promise<Overview> {
  const [projects, changes] = await Promise.all([api.projects(), api.changes()]);
  return { projects: await Promise.all(projects.map(loadProject)), changes };
}

/** The evidence that states the requirement itself (not its due date). */
export function statementEvidence(r: Obligation): Evidence[] {
  return r.evidence.filter((e) => e.field === "obligation");
}

/** The requirement's statement: its source sentence, verbatim, from the
 * newest revision that states it. */
export function statementOf(r: Obligation): string {
  const evidence = [...statementEvidence(r)].sort((a, b) => b.version_number - a.version_number);
  return evidence[0]?.quote.replace(/\s+/g, " ") ?? r.canonical_action;
}

/** Current: stated by a current revision. Superseded: only by older ones. */
export function isCurrent(r: Obligation): boolean {
  return r.supported_by_current_version;
}

/** Requirements whose statement evidence is in this document. */
export function requirementsOf(doc: ProjectDocument, requirements: Obligation[]): Obligation[] {
  return requirements.filter((r) => statementEvidence(r).some((e) => e.resource_id === doc.id));
}

export function currentRevision(doc: ProjectDocument) {
  return doc.revisions.find((r) => r.current) ?? doc.revisions.at(-1) ?? null;
}
