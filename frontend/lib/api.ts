/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { apiBaseUrl } from "@/lib/config";
import { currentSession, writeSession } from "@/lib/session";
import type {
  AskResult,
  Capabilities,
  DemoIdentity,
  DemoSession,
  Course,
  DemoSyncResult,
  DemoWorkflowStarted,
  LiveRequirements,
  Obligation,
  ProjectDocument,
  SearchRequest,
  SearchResult,
  SearchStatus,
  Sync,
  WorkflowRun,
} from "@/lib/types";

// --- the Construction Document Assistant API ----------------------------------------------
// Inherited route names: a "course" is a project, a "resource" a document.

/** A failed API request: an HTTP status (0 when nothing answered) and the
 * server's detail when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const READ_TIMEOUT_MS = 20_000;
// The local demo operations run the offline pipeline: a few seconds.
const DEMO_TIMEOUT_MS = 180_000;
// One live model call, with the backend's own bounded retries behind it.
const LIVE_TIMEOUT_MS = 180_000;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = READ_TIMEOUT_MS): Promise<T> {
  if (apiBaseUrl === null) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE_URL is missing or invalid (see frontend/.env.example).");
  }
  const token = currentSession()?.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        // Demo sign-in token; the API enforces what this identity may read.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, controller.signal.aborted
      ? `The API did not answer within ${timeoutMs / 1000} s.`
      : "The API is unreachable. Is it running?");
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 && token) writeSession(null); // expired or API restarted: sign in again
  if (!response.ok) {
    const detail = typeof body === "object" && body !== null && "detail" in body ? (body as { detail: unknown }).detail : null;
    throw new ApiError(response.status, typeof detail === "string" ? detail : `HTTP ${response.status}`);
  }
  return body as T;
}

// A source file: a few hundred kilobytes over the local network.
const FILE_TIMEOUT_MS = 60_000;

/** A stored file, fetched with the demo sign-in in the Authorization header
 * (never in the URL); the API checks the identity's document access first. */
async function requestFile(path: string, timeoutMs = FILE_TIMEOUT_MS): Promise<Blob> {
  if (apiBaseUrl === null) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE_URL is missing or invalid (see frontend/.env.example).");
  }
  const token = currentSession()?.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/pdf, application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch {
      throw new ApiError(0, controller.signal.aborted
        ? `The API did not answer within ${timeoutMs / 1000} s.`
        : "The API is unreachable. Is it running?");
    }
    if (response.status === 401 && token) writeSession(null);
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = typeof body === "object" && body !== null && "detail" in body ? (body as { detail: unknown }).detail : null;
      throw new ApiError(response.status, typeof detail === "string" ? detail : `HTTP ${response.status}`);
    }
    return await response.blob();
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  identities: () => request<DemoIdentity[]>("/auth/identities"),
  signIn: (identity: string) =>
    request<DemoSession>("/auth/demo-sign-in", { method: "POST", body: JSON.stringify({ identity }) }),
  /** Live model with tool calling over the project's documents. */
  ask: (projectId: string, question: string) =>
    request<AskResult>(`/courses/${projectId}/ask`, { method: "POST", body: JSON.stringify({ question }) },
      LIVE_TIMEOUT_MS),
  projects: () => request<Course[]>("/courses"),
  requirements: (projectId: string) => request<Obligation[]>(`/courses/${projectId}/obligations`),
  documents: (projectId: string) => request<ProjectDocument[]>(`/courses/${projectId}/documents`),
  document: (id: string) => request<ProjectDocument>(`/documents/${id}`),
  workflowRuns: (projectId: string, limit = 1) =>
    request<WorkflowRun[]>(`/courses/${projectId}/workflow-runs?limit=${limit}`),
  changes: () => request<Sync[]>("/changes"),
  capabilities: () => request<Capabilities>("/capabilities"),
  /** Local demo operation: deletes and rebuilds the demo project's data. */
  resetDemo: () =>
    request<DemoWorkflowStarted>("/demo/workflow-runs", { method: "POST", body: JSON.stringify({ reset: true }) },
      DEMO_TIMEOUT_MS),
  /** Local demo operation: brings in the next document revision (Rev B). */
  syncDemo: () => request<DemoSyncResult>("/demo/sync", { method: "POST" }, DEMO_TIMEOUT_MS),
  searchStatus: (projectId: string) => request<SearchStatus>(`/courses/${projectId}/search/status`),
  /** The query travels in the body, never in the URL. Hybrid mode makes one
   * live embedding call; lexical mode runs offline. */
  search: (projectId: string, body: SearchRequest) =>
    request<SearchResult>(`/courses/${projectId}/search`, { method: "POST", body: JSON.stringify(body) },
      LIVE_TIMEOUT_MS),
  /** The exact stored file of one revision of a document the identity may read. */
  revisionFile: (documentId: string, revisionId: string) =>
    requestFile(`/documents/${documentId}/revisions/${revisionId}/file`),
  liveDocumentRequirements: (documentId: string) =>
    request<LiveRequirements>(`/documents/${documentId}/live-requirements`, { method: "POST" }, LIVE_TIMEOUT_MS),
};
