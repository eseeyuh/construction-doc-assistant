/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { useState } from "react";

import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { api, ApiError } from "@/lib/api";
import { revisionLabel } from "@/lib/format";
import type { LiveRequirements } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: LiveRequirements }
  | { kind: "failed"; message: string };

/** One real model call over the document's current revision, on request.
 * Shown beside the stored requirements, never mixed into them: the answer is
 * not saved, and a failure is shown as one, never replaced. Without model
 * credentials the button is disabled and says why; nothing is simulated. */
export function LiveAnalysis({ documentId }: { documentId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const capabilities = useApi(api.capabilities, "capabilities");
  const available = capabilities.data?.live_analysis === true;
  const reason = capabilities.state === "error"
    ? "could not check whether model credentials are configured"
    : capabilities.data?.live_analysis_reason ?? null;

  async function analyze() {
    setState({ kind: "running" });
    try {
      setState({ kind: "done", result: await api.liveDocumentRequirements(documentId) });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof ApiError ? error.message : "The live analysis failed." });
    }
  }

  return (
    <section aria-labelledby="live-analysis-heading" className="panel space-y-4 px-6 py-5" data-testid="live-analysis">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 id="live-analysis-heading" className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-tight">
            <span className="badge badge-found"><Icon name="sparkles" size={11} />Live analysis</span>
            Ask the configured model
          </h2>
          <p className="mt-1 text-[13.5px] text-muted">
            One real model call over this document&apos;s current revision. The answer is shown here only, is not saved,
            and is not checked by the evidence gate.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" data-testid="live-analysis-button"
          disabled={!available || state.kind === "running"} onClick={analyze}
          aria-describedby={!available ? "live-analysis-unavailable" : undefined}>
          {state.kind === "running" ? "Analysing…" : "Analyse live"}
        </button>
      </div>

      {!available && capabilities.data !== undefined && (
        <p id="live-analysis-unavailable" className="flex items-start gap-2 text-[13.5px] text-ink-soft" data-testid="live-analysis-unavailable">
          <Icon name="lock" size={14} className="mt-0.5 text-faint" />
          <span>
            Live analysis is unavailable: {reason ?? "it is not enabled"}. The requirements on this page come from the
            offline replay of authored fixtures, not from a model.
          </span>
        </p>
      )}
      {!available && capabilities.state === "error" && capabilities.data === undefined && (
        <p id="live-analysis-unavailable" className="text-[13.5px] text-ink-soft">
          Live analysis is unavailable: {reason}.
        </p>
      )}
      {state.kind === "running" && <p className="text-[14px] text-muted" role="status">Waiting for the model…</p>}
      {state.kind === "failed" && (
        <p className="flex items-center gap-2 text-[14px] text-conflict" role="alert">
          <Icon name="alert" size={14} />Live analysis failed: {state.message}
        </p>
      )}
      {state.kind === "done" && <LiveResult result={state.result} />}
    </section>
  );
}

function LiveResult({ result }: { result: LiveRequirements }) {
  const { prompt_tokens, completion_tokens } = result.usage;
  return (
    <div className="space-y-3">
      {result.requirements.length === 0 ? (
        <p className="text-[14px] text-muted">The model reported no requirements in this document.</p>
      ) : (
        <ol className="space-y-2.5">
          {result.requirements.map((r, i) => (
            <li key={i} className="rounded-xl border border-line bg-canvas/50 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="max-w-prose text-[15px] text-ink">{r.requirement}</p>
                <span className={`badge ${r.quote_found ? "badge-neutral" : "badge-review"}`}>
                  {r.quote_found ? "Quote found in document" : "Quote not found in document"}
                </span>
              </div>
              <p className="source-quote mt-1.5 text-[13.5px] text-muted">{r.quote}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[12.5px] text-faint tabular-nums">
        Live model output · {result.provider} · {result.model} · {(result.latency_ms / 1000).toFixed(1)} s
        {prompt_tokens !== null && completion_tokens !== null && ` · ${prompt_tokens} in / ${completion_tokens} out tokens`}
        {` · ${result.resource_title}, ${revisionLabel(result.version_number)}`}
      </p>
    </div>
  );
}
