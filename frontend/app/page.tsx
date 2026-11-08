/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { useApi } from "@/components/DemoState";
import { NoProjects, ProjectCard } from "@/components/ProjectCard";
import { ProvenanceNote } from "@/components/Requirements";
import { LoadState } from "@/components/ui";
import { loadOverview } from "@/lib/load";

export default function OverviewPage() {
  const result = useApi(loadOverview, "overview");
  return (
    <>
      <header className="space-y-2 animate-fade-up">
        <p className="overline">Overview</p>
        <h1 className="display-title [text-wrap:wrap]">Project documents, organised into requirements with sources</h1>
      </header>
      <LoadState result={result}>
        {({ projects, changes }) => projects.length === 0 ? <NoProjects /> : (
          <>
            {projects.map((b) => <ProjectCard key={b.project.id} bundle={b} changes={changes} overview />)}
            <DemoGuide revisionLoaded={changes.some((s) => s.changes.some((c) => c.old_version !== null))} />
            <ProvenanceNote />
          </>
        )}
      </LoadState>
    </>
  );
}

/** The demo instructions: what to look at, in order. */
function DemoGuide({ revisionLoaded }: { revisionLoaded: boolean }) {
  const steps = [
    "Open the project's requirement register: statement, responsible role, deadline or notice period, and source.",
    "Use Source quote on any requirement to see the exact sentence, document, revision and page.",
    "Search documents (lexical offline; hybrid when live embeddings are indexed) or ask a question with the live model, when it is configured.",
    revisionLoaded
      ? "Inspection Procedure Revision B is loaded. Open Revisions to see what it supersedes and which requirement changed."
      : "Press Load next revision (demo) to import Inspection Procedure Revision B, then open Revisions.",
    "Switch identity in the sidebar: the Site Engineer cannot read the Commercial Terms, and the API enforces it everywhere.",
    "Reset local demo deletes the demo's data and rebuilds it at Revision A, after you confirm. Opening a page never resets anything.",
  ];
  return (
    <section className="panel space-y-4 p-5" aria-labelledby="demo-guide-heading" data-testid="demo-guide">
      <h2 id="demo-guide-heading" className="section-title">How to use this demo</h2>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-ink-soft">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
