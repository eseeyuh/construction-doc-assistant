/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// The two local demo controls. Both call the real offline backend paths:
// reset rebuilds the fictional project at Revision A, and "load next
// revision" brings in Inspection Procedure Revision B through the ordinary
// change-detection path. Neither talks to an external system, and neither
// runs unless someone presses it; a reset is always confirmed first. Every
// copy of the controls shares one running action (DemoState), so nothing
// runs twice.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useDemoState } from "@/components/DemoState";
import { Icon } from "@/components/Icon";

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

// --- confirmation before a reset --------------------------------------------------------------

const ConfirmContext = createContext<() => void>(() => {});

/** Holds the reset confirmation dialog, so every Reset button asks first. */
export function ResetConfirmProvider({ children }: { children: ReactNode }) {
  const { run } = useDemoState();
  const [open, setOpen] = useState(false);
  const ask = useCallback(() => setOpen(true), []);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && <ConfirmReset onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); void run("reset"); }} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmReset({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onCancel]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-heading" aria-describedby="reset-body">
        <h2 id="reset-heading" className="section-title">Reset local demo?</h2>
        <p id="reset-body" className="text-ink-soft">
          This deletes the demo project&apos;s stored data and rebuilds it at Revision A by replaying the authored
          fixtures. Any revision loaded since then is removed, and live embeddings must be indexed again for hybrid
          search.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancel} type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} data-testid="confirm-reset">Reset to Revision A</button>
        </div>
      </div>
    </div>
  );
}

// --- the controls -------------------------------------------------------------------------------

function ResetButton({ className }: { className: string }) {
  const { busy } = useDemoState();
  const confirm = useContext(ConfirmContext);
  return (
    <button type="button" className={className} disabled={busy !== null} onClick={confirm}
      data-testid="reset-demo" title="Local demo operation: deletes and rebuilds the fictional project's data">
      {busy === "reset" ? "Resetting…" : "Reset local demo"}
    </button>
  );
}

function LoadButton({ className }: { className: string }) {
  const { busy, run } = useDemoState();
  return (
    <button type="button" className={className} disabled={busy !== null} onClick={() => run("sync")}
      data-testid="simulate-sync" title="Local demo operation: imports Inspection Procedure Rev B">
      <Icon name="refresh" size={14} className={busy === "sync" ? "motion-safe:animate-spin" : ""} />
      {busy === "sync" ? "Loading…" : "Load next revision (demo)"}
    </button>
  );
}

/** The status of the last demo action, kept short. */
function Status() {
  const { busy, message } = useDemoState();
  const visible = busy !== null || message !== null;
  return (
    <span role="status" aria-live="polite" data-testid="demo-status"
      className={`items-center gap-1.5 px-1.5 text-[12.5px] ${visible ? "flex" : "sr-only"}`}>
      {busy && <span aria-hidden className="spinner h-3 w-3" />}
      {busy === "sync" && <span className="text-muted">Loading the next revision…</span>}
      {busy === "reset" && <span className="text-muted">Resetting the local demo…</span>}
      {!busy && message && (
        <>
          <Icon name={message.tone === "error" ? "alert" : "checkCircle"} size={13}
            className={message.tone === "error" ? "text-conflict" : "text-verified"} />
          <span className={`max-w-[18rem] truncate ${message.tone === "error" ? "text-conflict" : "text-ink-soft"}`} title={message.text}>
            {message.text}
          </span>
        </>
      )}
    </span>
  );
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

/** The floating demo actions, top right of every signed-in screen. */
export function TopBar() {
  return (
    <header className="floating" aria-label="Local demo actions">
      <Status />
      <ResetButton className="btn btn-ghost btn-sm" />
      <LoadButton className="btn btn-quiet btn-sm font-[550]" />
    </header>
  );
}

/** The controls in a page body (the Revisions page's empty state). */
export function DemoControls() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <LoadButton className="btn btn-primary" />
      <ResetButton className="btn btn-quiet" />
    </div>
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
      <div className="panel overflow-hidden animate-fade-up" data-testid="demo-progress">
        <div className="skeleton h-0.5 rounded-none" aria-hidden />
        <div className="flex items-start gap-4 px-5 py-4">
          <span aria-hidden className="spinner mt-1 h-4 w-4" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{title}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-ink-soft">
              {steps.map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink">{i + 1}</span>
                  {step}
                  {i < steps.length - 1 && <Icon name="arrowRight" size={13} className="text-faint" />}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] text-muted">{duration}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!message) return null;
  const error = message.tone === "error";
  return (
    <div role={error ? "alert" : undefined} data-testid="demo-outcome"
      className={`notice items-center animate-fade-up ${error ? "notice-danger" : "notice-neutral border border-line"}`}>
      <Icon name={error ? "alert" : "checkCircle"} size={16} className={error ? "text-conflict" : "text-verified"} />
      <p className="min-w-0 flex-1">
        <strong className={`font-semibold ${error ? "text-conflict" : "text-ink"}`}>{message.text}</strong>
        <span className="text-ink-soft">
          {!error && message.action === "sync" && " The requirement register now reflects the current revisions; Rev A stays as history."}
          {!error && message.action === "reset" && " Every document is back at its first revision, with no changes yet."}
        </span>
        {message.ref && <span className="text-[12px] text-muted">{message.ref}</span>}
      </p>
      <span className="flex items-center gap-3">
        {!error && message.action === "sync" && path !== "/changes" && <Link href="/changes" className="text-link font-medium">See what changed</Link>}
        <button type="button" onClick={dismiss} className="icon-btn h-7 w-7 bg-transparent" aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </span>
    </div>
  );
}
