/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { useApi } from "@/components/DemoState";
import { NoProjects, ProjectCard } from "@/components/ProjectCard";
import { LoadState } from "@/components/ui";
import { loadOverview } from "@/lib/load";

export default function ProjectsPage() {
  const result = useApi(loadOverview, "projects");
  return (
    <div className="space-y-8">
      <header className="animate-fade-up">
        <h1 className="page-title">Projects</h1>
        <p className="page-lede">Each project&apos;s documents, and the requirements they state.</p>
      </header>
      <LoadState result={result}>
        {({ projects }) => projects.length === 0 ? <NoProjects /> : (
          <div className="grid gap-6 lg:grid-cols-2">
            {projects.map((b) => <ProjectCard key={b.project.id} bundle={b} />)}
          </div>
        )}
      </LoadState>
    </div>
  );
}
