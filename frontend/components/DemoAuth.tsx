/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useApi } from "@/components/DemoState";
import { Icon, Logo } from "@/components/Icon";
import { api, ApiError } from "@/lib/api";
import { onSessionChange, PENDING, sessionSnapshot, writeSession } from "@/lib/session";
import type { DemoSession } from "@/lib/types";

const SessionContext = createContext<DemoSession | null>(null);

export function useDemoSession(): DemoSession | null {
  return useContext(SessionContext);
}

export function signOut(): void {
  writeSession(null);
}

// Whether this tab has passed the landing screen: a per-tab convenience only.
const LANDING_KEY = "cda-landing-seen";

function landingSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(LANDING_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberLanding(seen: boolean): void {
  try {
    if (seen) window.sessionStorage.setItem(LANDING_KEY, "1");
    else window.sessionStorage.removeItem(LANDING_KEY);
  } catch {
    // Storage unavailable: the landing shows again after a reload.
  }
}

/** "Site Engineer" -> "SE": the avatar on the identity row. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
}

/** Shows the app only to a signed-in demo identity. Signed out, a first visit
 * sees the landing screen, then the demo sign-in; switching identity goes
 * straight to the sign-in. Hiding the app is convenience only: the API itself
 * refuses unsigned requests and filters every response by the identity. */
export function DemoAuthGate({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(onSessionChange, sessionSnapshot, () => PENDING);
  const session = useMemo<DemoSession | null>(
    () => (snapshot && snapshot !== PENDING ? (JSON.parse(snapshot) as DemoSession) : null),
    [snapshot],
  );
  const [started, setStarted] = useState(false);
  // Signed in once in this tab: switching identity later goes to the sign-in.
  useEffect(() => { if (session) rememberLanding(true); }, [session]);
  if (snapshot === PENDING) return null;
  if (session === null) {
    return started || landingSeen()
      ? <SignIn onBack={() => { rememberLanding(false); setStarted(false); }} />
      : <Landing onStart={() => { rememberLanding(true); setStarted(true); }} />;
  }
  // Keyed by identity: switching identity remounts the app, so nothing
  // loaded for the previous identity stays on screen.
  return (
    <SessionContext.Provider value={session} key={session.identity.id}>
      {children}
    </SessionContext.Provider>
  );
}

function Centred({ children }: { children: ReactNode }) {
  return (
    <main className="relative z-[1] flex min-h-dvh w-full items-center justify-center px-4 py-12">
      {children}
    </main>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <Centred>
      <section className="flex w-full max-w-[560px] flex-col items-center gap-6 text-center animate-fade-up" data-testid="landing">
        <Logo size={40} />
        <h1 className="display-title">Find what each project document requires, and where it says so.</h1>
        <p className="text-ink-soft">
          A local prototype for construction project documents. Each requirement shows what is required, who is
          responsible and by when, linked to its exact source quotation, page and revision. Superseded revisions stay
          available as history.
        </p>
        <p className="text-[13px] leading-[18px] text-ink-soft">One fictional demo project · all documents are synthetic</p>
        <button type="button" className="btn btn-primary min-h-11 px-6" onClick={onStart} data-testid="get-started">
          Get started <Icon name="arrowRight" size={16} />
        </button>
      </section>
    </Centred>
  );
}

function SignIn({ onBack }: { onBack: () => void }) {
  const identities = useApi(api.identities, "demo-identities");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = identities.data ?? [];
  const chosen = options.find((i) => i.id === picked) ?? options[0] ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      writeSession(await api.signIn(chosen.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <Centred>
      <form onSubmit={submit} data-testid="sign-in"
        className="flex w-full max-w-[480px] flex-col gap-5 rounded-2xl border border-line bg-surface p-7 shadow-lift animate-fade-up">
        <div className="space-y-1">
          <h2 className="section-title">Demo sign-in</h2>
          <p className="text-[13px] leading-[18px] text-muted">Choose one of the demo identities the API offers.</p>
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="overline mb-2 p-0">Demo identity</legend>
          <div className="space-y-2" role="radiogroup">
            {identities.state === "loading" && options.length === 0 && (
              <div aria-hidden className="space-y-2">
                <span className="skeleton block h-[66px]" />
                <span className="skeleton block h-[66px]" />
              </div>
            )}
            {options.map((identity) => {
              const on = chosen?.id === identity.id;
              return (
                <label key={identity.id} data-testid={`identity-option-${identity.id}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
                    on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-hover"}`}>
                  <input type="radio" name="identity" value={identity.id} checked={on} onChange={() => setPicked(identity.id)}
                    className="mt-[3px] h-4 w-4 accent-[var(--color-accent)]" />
                  <span className="min-w-0">
                    <span className="block font-[550] text-ink">{identity.name}</span>
                    <span className="block text-[13px] leading-[18px] text-ink-soft">Can read: {identity.access}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {identities.state === "error" && (
          <p className="text-[13px] text-conflict" role="alert">Could not load the demo identities: {identities.message}</p>
        )}
        {error && <p className="text-[13px] text-conflict" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary min-h-11" disabled={!chosen || busy} data-testid="sign-in-submit">
          {busy ? "Signing in…" : chosen ? `Sign in as ${chosen.name}` : "Sign in"}
        </button>
        <div className="notice notice-neutral" data-testid="demo-auth-notice">
          <Icon name="info" />
          <span>
            <strong className="font-semibold text-ink">Demo authentication only, not production sign-in.</strong> There
            are no passwords: anyone who can reach this local demo can choose either identity. Each identity&apos;s
            document access is enforced by the API on every request, not only hidden in the interface.
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm self-start" onClick={onBack}>
          <Icon name="arrowRight" size={14} className="rotate-180" />Back
        </button>
      </form>
    </Centred>
  );
}
