/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// The two local demo controls. Both call the real offline backend paths:
// reset rebuilds the fictional project at Revision A, and "load next
// revision" brings in Inspection Procedure Revision B through the ordinary
// change-detection path. Neither talks to an external system, and neither
// runs unless someone presses it. There is no sign-in yet: anyone who can
// reach this local demo can press them. Every copy of the controls shares one
// running action (DemoState), so nothing runs twice.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useApi, useDemoState } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { CompactNav } from "@/components/Nav";
import { api } from "@/lib/api";
import { formatInstant } from "@/lib/format";

// Display label only: the demo organisation, as the manifest names it.
const ORGANISATION_LABEL = "Demo Contractor Ltd (fictional)";

// What each action does on the backend, in order. A description, not a
// progress report: the API answers once the whole action has finished.
const WORKING = {
  sync: {
    title: "Loading the next document revision",
    steps: ["Import Inspection Procedure Rev B", "Record what changed from Rev A", "Replay the recorded requirement extraction"],
    duration: "This takes a few seconds.",
  },
  reset: {
    title: "Resetting the local demo",
    steps: ["Delete the demo project's stored data", "Import every document at its first revision", "Replay the recorded requirement extraction"],
    duration: "This takes a few seconds.",
  },
};

function Buttons({ small = false }: { small?: boolean }) {
  const { busy, run } = useDemoState();
  const [confirming, setConfirming] = useState(false);
  const size = small ? "btn-sm" : "";
  if (confirming) {
    return (
      <span role="group" aria-label="Confirm local demo reset" className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] text-ink-soft">Delete this demo&apos;s data and rebuild it at Rev A?</span>
        <button type="button" className={`btn btn-ghost ${size}`} data-testid="confirm-reset"
          onClick={() => { setConfirming(false); void run("reset"); }}>
          Reset
        </button>
        <button type="button" className={`btn btn-quiet ${size}`} onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <>
      <button type="button" className={`btn btn-ghost ${size}`} disabled={busy !== null} onClick={() => setConfirming(true)}
        data-testid="reset-demo" title="Local demo operation: deletes and rebuilds the fictional project's data">
        {busy === "reset" ? "Resetting…" : "Reset local demo"}
      </button>
      <button type="button" className={`btn btn-quiet ${size}`} disabled={busy !== null} onClick={() => run("sync")}
        data-testid="simulate-sync" title="Local demo operation: imports Inspection Procedure Rev B">
        <Icon name="refresh" size={14} className={`text-link ${busy === "sync" ? "motion-safe:animate-spin" : ""}`} />
        {busy === "sync" ? "Loading…" : "Load next revision (demo)"}
      </button>
    </>
  );
}

/** The status of the last demo action, kept short. */
function Status() {
  const { busy, message } = useDemoState();
  return (
    <span role="status" aria-live="polite" data-testid="demo-status" className="flex items-center gap-1.5 text-[12.5px]">
      {busy && <span aria-hidden className="spinner h-3 w-3" />}
      {busy === "sync" && <span className="text-muted">Loading the next revision…</span>}
      {busy === "reset" && <span className="text-muted">Resetting the local demo…</span>}
      {!busy && message && (
        <>
          <Icon name={message.tone === "error" ? "alert" : "checkCircle"} size={13}
            className={message.tone === "error" ? "text-conflict" : "text-verified"} />
          <span className={message.tone === "error" ? "text-conflict" : "text-ink-soft"}>{message.text}</span>
        </>
      )}
    </span>
  );
}

/** When a document revision was last loaded, from the stored changes. */
function LastRevision() {
  const changes = useApi(api.changes, "topbar-changes");
  const latest = changes.data?.at(-1);
  if (changes.data === undefined) return <span className="skeleton inline-block h-2 w-40 align-middle" aria-hidden />;
  if (!latest) return <>No revisions loaded since import</>;
  return <>Last revision loaded {formatInstant(latest.observed_at)}</>;
}

/** The plain label every page carries: what the stored results are. */
export function ReplayLabel() {
  return (
    <span className="badge badge-neutral" data-testid="replay-label"
      title="Requirements were produced by replaying authored fixture answers through the real extraction gate. They are not live model output and not an evaluation.">
      Offline replay · authored fixtures, not live AI
    </span>
  );
}

/** The workspace top bar: context on the left, the demo actions on the
 * right. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 px-8 py-2.5 xl:px-12">
        <div className="mr-auto min-w-0">
          <p className="font-display text-[24px] leading-[1.1] tracking-tight text-ink sm:whitespace-nowrap xl:text-[28px]">{ORGANISATION_LABEL}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-tight text-muted">
            <ReplayLabel />
            <LastRevision />
          </p>
        </div>
        <CompactNav />
        <div role="group" aria-label="Local demo controls" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Status />
          <span className="flex flex-wrap gap-1.5"><Buttons small /></span>
        </div>
      </div>
    </header>
  );
}

/** The controls in a page body (the Revisions page). */
export function DemoControls() {
  return (
    <div className="flex flex-wrap items-center gap-2"><Buttons /></div>
  );
}

/** In the page while a demo action runs, then its outcome. The page under
 * it stays as it was until the fresh data arrives. */
export function DemoProgress() {
  const { busy, message, dismiss } = useDemoState();
  const path = usePathname();
  if (busy) {
    const { title, steps, duration } = WORKING[busy];
    return (
      <div className="panel mb-9 overflow-hidden shadow-lift animate-fade-up" data-testid="demo-progress">
        <div className="h-0.5 skeleton rounded-none" aria-hidden />
        <div className="flex items-start gap-4 px-6 py-5">
          <span aria-hidden className="spinner mt-1 h-4 w-4" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tracking-tight">{title}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted">
              {steps.map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold text-faint ring-1 ring-line">{i + 1}</span>
                  {step}
                  {i < steps.length - 1 && <Icon name="arrowRight" size={13} className="text-line-strong" />}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] text-faint">{duration}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!message) return null;
  const error = message.tone === "error";
  return (
    <div className={`panel mb-9 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-[13.5px] animate-fade-up ${
      error ? "border-conflict-line bg-conflict-soft" : "border-verified-line/70"}`}
      data-testid="demo-outcome">
      <Icon name={error ? "alert" : "checkCircle"} size={17} className={error ? "text-conflict" : "text-verified"} />
      <p className="min-w-0 flex-1">
        <span className={`font-medium ${error ? "text-conflict" : "text-ink"}`}>{message.text}</span>
        <span className="text-muted">
          {!error && message.action === "sync" && " The requirement register now reflects the current revisions; Rev A stays as history."}
          {!error && message.action === "reset" && " Every document is back at its first revision, with no changes yet."}
        </span>
        {message.ref && <span className="text-[12px] text-faint">{message.ref}</span>}
      </p>
      <span className="flex items-center gap-4">
        {!error && message.action === "sync" && path !== "/changes" && <Link href="/changes" className="text-link">See what changed</Link>}
        <button type="button" onClick={dismiss} className="text-muted hover:text-ink">Dismiss</button>
      </span>
    </div>
  );
}
