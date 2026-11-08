/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";

import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { NoProjects, ProjectCard } from "@/components/ProjectCard";
import { ProvenanceNote } from "@/components/Requirements";
import { LoadState } from "@/components/ui";
import { loadOverview } from "@/lib/load";
import type { Sync } from "@/lib/types";

export default function OverviewPage() {
  const result = useApi(loadOverview, "overview");
  return (
    <LoadState result={result}>
      {({ projects, changes }) => (
        <div className="space-y-12">
          <section className="animate-fade-up">
            <h1 className="display-title">Project documents, <em className="text-link">as requirements with sources</em></h1>
            <p className="page-lede">
              The assistant turns project documents into a register of requirements: what is required, who is
              responsible and by when, each with the exact quotation, page and revision it comes from. A value a document
              does not state is shown as <em>Not stated</em>.
            </p>
          </section>

          {projects.length === 0 ? <NoProjects /> : (
            <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
              <div className="min-w-0 space-y-6 lg:col-span-7">
                {projects.map((b) => <ProjectCard key={b.project.id} bundle={b} />)}
                <LatestRevision changes={changes} />
              </div>
              <aside className="min-w-0 space-y-6 lg:col-span-5">
                <DemoGuide revisionLoaded={changes.length > 0} />
                <ProvenanceNote />
              </aside>
            </div>
          )}
        </div>
      )}
    </LoadState>
  );
}

function LatestRevision({ changes }: { changes: Sync[] }) {
  const change = changes.at(-1)?.changes.find((c) => c.old_version !== null);
  if (!change) return null;
  const changed = change.affected.filter((a) => a.kind === "requirement_changed").length;
  return (
    <Link href="/changes" className="panel panel-link flex items-start gap-4 px-6 py-5" data-testid="latest-revision">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-review-soft text-review ring-1 ring-review-line">
        <Icon name="history" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="label">Latest revision</span>
        <span className="mt-1 block text-[16.5px] font-semibold tracking-tight">
          {change.resource_title}: {change.new_version.revision_label} supersedes {change.old_version?.revision_label}
        </span>
        <span className="mt-0.5 block text-[14px] text-muted">
          {changed === 0 ? "No stored requirement changed." : `${changed} ${changed === 1 ? "requirement" : "requirements"} changed.`}{" "}
          The earlier revision&apos;s requirements are kept as history.
        </span>
      </span>
      <Icon name="arrowRight" size={15} className="mt-1 text-link" />
    </Link>
  );
}

/** The demo instructions: what to look at, in order. */
function DemoGuide({ revisionLoaded }: { revisionLoaded: boolean }) {
  const steps = [
    "Open the project to see its requirement register: statement, responsible role, deadline or notice period, and source.",
    "Use Source quote on any requirement to see the exact sentence, document, revision and page.",
    revisionLoaded
      ? "Inspection Procedure Revision B is loaded. Open Revisions to see what it supersedes and which requirement changed."
      : "Press Load next revision (demo) to import Inspection Procedure Revision B, then open Revisions.",
    "Reset local demo deletes the demo's data and rebuilds it at Revision A. Nothing resets when a page is opened.",
  ];
  return (
    <section className="panel px-6 py-5" aria-labelledby="demo-guide-heading" data-testid="demo-guide">
      <h2 id="demo-guide-heading" className="section-title">How to use this demo</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        One fictional project with three clearly labelled synthetic documents; the inspection procedure has two revisions.
        Sign-in is a demo with two fixed identities: the Site Engineer can read the inspection and safety documents, the
        Commercial Manager also the Commercial Terms. The server enforces this in every list, document, search and answer.
      </p>
      <ol className="mt-4 space-y-2.5 text-[14px] text-ink-soft">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-faint ring-1 ring-line">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
