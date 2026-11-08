/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import type { ReactNode } from "react";

import type { Loaded } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { formatInstant } from "@/lib/format";
import type { Course, WorkflowRun } from "@/lib/types";

export type CourseTone = { dot: string; bar: string; text: string; edge: string };

// Full class names, so Tailwind sees every one of them.
const TONES: CourseTone[] = [
  { dot: "bg-course-1", bar: "bg-course-1/80", text: "text-course-1", edge: "border-l-course-1/70" },
  { dot: "bg-course-2", bar: "bg-course-2/80", text: "text-course-2", edge: "border-l-course-2/70" },
  { dot: "bg-course-3", bar: "bg-course-3/80", text: "text-course-3", edge: "border-l-course-3/70" },
  { dot: "bg-course-4", bar: "bg-course-4/80", text: "text-course-4", edge: "border-l-course-4/70" },
  { dot: "bg-course-5", bar: "bg-course-5/80", text: "text-course-5", edge: "border-l-course-5/70" },
];
// Presentation only: a fixed colour for the demo project's code. Any other
// project gets one from its title.
const BY_CODE: Record<string, number> = { KYD001: 0 };

/** A project's identity colour. Keyed on its title (whose code prefix names
 * the project), not its row ID, so a demo reset keeps the colour. */
export function courseTone(course: Pick<Course, "title">): CourseTone {
  const fixed = BY_CODE[course.title.split(" ")[0]];
  if (fixed !== undefined) return TONES[fixed];
  let hash = 0;
  for (const ch of course.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function CourseDot({ course, size = "h-2 w-2" }: { course: Pick<Course, "title">; size?: string }) {
  return <span aria-hidden className={`${size} shrink-0 rounded-[3px] ${courseTone(course).dot}`} />;
}

/** Whether the project's latest run is worth showing: only when it did not
 * succeed (not processed, queued, running or failed). */
export function runNeedsNotice(run: WorkflowRun | null): boolean {
  return run?.status !== "succeeded";
}

/** The project's latest document-processing run, as its trace records it. */
export function RunStatus({ run, testId = "run-status" }: { run: WorkflowRun | null; testId?: string }) {
  if (!run) return <span className="text-muted">Not processed yet</span>;
  const when = run.finished_at ?? run.started_at;
  const label = { succeeded: "Processed", failed: "Processing failed", running: "Processing", pending: "Queued" }[run.status];
  const dot = { succeeded: "bg-verified", failed: "bg-conflict", running: "bg-link", pending: "bg-faint" }[run.status];
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${run.status === "failed" ? "text-conflict" : ""}`} data-testid={testId}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}{when ? ` ${formatInstant(when)}` : ""}
    </span>
  );
}

/** A quiet placeholder in the shape of a page: title, then cards. */
function PageSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="space-y-3">
        <span className="skeleton block h-9 w-80 max-w-full" />
        <span className="skeleton block h-3 w-56" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="panel space-y-3 p-5 lg:col-span-2">
          <span className="skeleton block h-3 w-28" />
          <span className="skeleton block h-5 w-72 max-w-full" />
          <span className="skeleton block h-3 w-96 max-w-full" />
        </div>
        <div className="panel space-y-3 p-6">
          <span className="skeleton block h-3 w-24" />
          <span className="skeleton block h-3 w-40" />
        </div>
      </div>
      <div className="panel space-y-3 p-6">
        <span className="skeleton block h-3 w-full" />
        <span className="skeleton block h-3 w-4/5" />
      </div>
    </div>
  );
}

/** Renders loaded data, a loading placeholder, or an error with what to do. */
export function LoadState<T>({ result, children }: { result: Loaded<T>; children: (data: T) => ReactNode }) {
  if (result.data !== undefined) {
    return (
      <>
        {result.state === "error" && <ErrorNote message={result.message} />}
        {children(result.data)}
      </>
    );
  }
  if (result.state === "error") return <ErrorNote message={result.message} />;
  return (
    <div role="status" className="space-y-5">
      <p className="flex items-center gap-2.5 text-[14px] text-muted">
        <span aria-hidden className="spinner h-3.5 w-3.5" />
        Loading from the demo API…
      </p>
      <PageSkeleton />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="notice notice-danger max-w-2xl border border-conflict-line text-[14px] leading-5" data-testid="load-error">
      <Icon name="alert" size={18} className="text-conflict" />
      <div>
        <p className="font-semibold text-conflict">This page could not be loaded.</p>
        <p className="mt-1 text-ink">{message}</p>
        <p className="mt-2 text-ink-soft">
          Check that the demo API is running (docker compose -f infra/demo/compose.yml ps), then reload the page.
        </p>
      </div>
    </div>
  );
}
