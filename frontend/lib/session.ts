/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DemoSession } from "@/lib/types";

// DEMO sign-in only: the token names one of two fixed identities chosen by
// the backend. It is kept in this browser so a reload stays signed in; the
// API decides on every request what the identity may read.
const KEY = "cda-demo-session";
const EVENT = "cda-demo-session-change";

export function readSession(): DemoSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as DemoSession;
    return session.expires_at * 1000 > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(session: DemoSession | null): void {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
  memory = session;
  window.dispatchEvent(new Event(EVENT));
}

let memory: DemoSession | null = null;

/** The current session: storage first, then the in-memory fallback. */
export function currentSession(): DemoSession | null {
  if (typeof window === "undefined") return null;
  return readSession() ?? (memory && memory.expires_at * 1000 > Date.now() ? memory : null);
}

export function onSessionChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** A stable snapshot for useSyncExternalStore: the session as JSON, or "". */
export function sessionSnapshot(): string {
  const session = currentSession();
  return session ? JSON.stringify(session) : "";
}

/** During server rendering and hydration the browser session is unknown. */
export const PENDING = "pending";
