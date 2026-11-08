/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { createContext, type ReactNode, useContext, useMemo, useState, useSyncExternalStore } from "react";

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

/** Shows the app only to a signed-in demo identity, otherwise the demo
 * sign-in. Hiding the app is convenience only: the API itself refuses
 * unsigned requests and filters every response by the identity. */
export function DemoAuthGate({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(onSessionChange, sessionSnapshot, () => PENDING);
  const session = useMemo<DemoSession | null>(
    () => (snapshot && snapshot !== PENDING ? (JSON.parse(snapshot) as DemoSession) : null),
    [snapshot],
  );
  if (snapshot === PENDING) return null;
  if (session === null) return <SignIn />;
  // Keyed by identity: switching identity remounts the app, so nothing
  // loaded for the previous identity stays on screen.
  return (
    <SessionContext.Provider value={session} key={session.identity.id}>
      {children}
    </SessionContext.Provider>
  );
}

function SignIn() {
  const identities = useApi(api.identities, "demo-identities");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: string) {
    setBusy(id);
    setError(null);
    try {
      writeSession(await api.signIn(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-6 py-16">
      <Logo />
      <h1 className="page-title mt-8 text-[2.3rem]">Sign in to the demo</h1>
      <p className="mt-3 flex items-start gap-2 text-[14px] text-muted" data-testid="demo-auth-notice">
        <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-faint" />
        <span>
          <strong className="font-medium text-ink-soft">Demo authentication only.</strong> Two fixed identities, no
          passwords: anyone who can reach this local demo can choose either. It shows that document permissions are
          enforced by the server, not that the app is secure.
        </span>
      </p>
      <div className="mt-6 space-y-2.5">
        {identities.state === "error" && <p className="text-[14px] text-conflict" role="alert">{identities.message}</p>}
        {identities.data?.map((identity) => (
          <button key={identity.id} type="button" onClick={() => choose(identity.id)} disabled={busy !== null}
            data-testid={`sign-in-${identity.id}`}
            className="panel panel-link flex w-full items-center justify-between gap-4 px-5 py-4 text-left disabled:opacity-60">
            <span className="min-w-0">
              <span className="block text-[15.5px] font-medium text-ink">{identity.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted">Can read: {identity.access}</span>
            </span>
            <span className="text-[13px] text-link">{busy === identity.id ? "Signing in…" : "Sign in"}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-[14px] text-conflict" role="alert">{error}</p>}
    </main>
  );
}

/** The signed-in identity, for the sidebar footer. */
export function IdentityBadge({ collapsed }: { collapsed: boolean }) {
  const session = useDemoSession();
  if (!session) return null;
  const { identity } = session;
  return (
    <div className={`flex items-center gap-2.5 border-t border-line py-4 ${collapsed ? "justify-center px-0" : "px-5"}`}
      title={collapsed ? `${identity.name} (demo sign-in)` : undefined} data-testid="identity-badge">
      <Icon name="lock" size={17} className="shrink-0 text-faint" />
      <div className={collapsed ? "sr-only" : "min-w-0 flex-1"}>
        <p className="truncate text-[12.5px] leading-tight font-medium text-ink-soft" data-testid="identity-name">
          {identity.name}
        </p>
        <p className="text-[11.5px] leading-tight text-faint">Demo sign-in · not real authentication</p>
      </div>
      {!collapsed && (
        <button type="button" onClick={signOut} className="btn btn-ghost btn-sm text-[12px]" data-testid="sign-out">
          Switch
        </button>
      )}
    </div>
  );
}
