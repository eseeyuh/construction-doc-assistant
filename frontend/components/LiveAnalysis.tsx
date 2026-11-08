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
export function LiveAnalysis({ documentId, currentLabel }: { documentId: string; currentLabel: string | null }) {
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
    <section aria-labelledby="live-analysis-heading" className="panel flex min-w-0 flex-[2_1_320px] flex-col gap-3 p-5" data-testid="live-analysis">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="live-analysis-heading" className="section-title">Analyse live</h2>
        <span className="badge badge-found"><Icon name="sparkles" size={12} />Live model</span>
      </div>
      <p className="text-[13px] leading-[18px] text-ink-soft">
        One real model call over {currentLabel ? `the current revision (${currentLabel})` : "the current revision"}. The answer
        is shown here only: it is not saved, not checked by the evidence gate, and the requirement register stays the
        authored offline replay.
      </p>
      <button type="button" className="btn btn-quiet self-start" data-testid="live-analysis-button"
        disabled={!available || state.kind === "running"} onClick={analyze}
        aria-describedby={!available ? "live-analysis-unavailable" : undefined}>
        {state.kind === "running" ? "Analysing…" : state.kind === "failed" ? "Retry live analysis" : state.kind === "done" ? "Run again" : "Analyse live"}
      </button>

      {!available && (capabilities.data !== undefined || capabilities.state === "error") && (
        <div id="live-analysis-unavailable" className="notice notice-neutral" data-testid="live-analysis-unavailable">
          <Icon name="info" />
          <span>
            <strong className="font-semibold text-ink">Unavailable.</strong> Live analysis is unavailable: {reason ?? "it is not enabled"}.
            The requirements on this page come from the offline replay of authored fixtures, not from a model.
          </span>
        </div>
      )}
      {state.kind === "running" && (
        <div role="status" className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-soft">Waiting for the model…</span>
          <span aria-hidden className="skeleton block h-1.5 w-full rounded-full" />
        </div>
      )}
      {state.kind === "failed" && (
        <div role="alert" className="notice notice-danger">
          <Icon name="alert" className="text-conflict" />
          <span><strong className="font-semibold text-conflict">Live analysis failed.</strong> {state.message} The register is unchanged.</span>
        </div>
      )}
      {state.kind === "done" && <LiveResult result={state.result} />}
    </section>
  );
}

function LiveResult({ result }: { result: LiveRequirements }) {
  const { prompt_tokens, completion_tokens } = result.usage;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] font-[550]">
        Live model output · {result.requirements.length} candidate requirement{result.requirements.length === 1 ? "" : "s"} · not verified
      </p>
      {result.requirements.length === 0 ? (
        <p className="text-[13px] text-muted">The model reported no requirements in this document.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {result.requirements.map((r, i) => (
            <li key={i} className="flex flex-col gap-1.5 rounded-lg border border-line px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="max-w-prose text-ink">{r.requirement}</p>
                <span className={`badge ${r.quote_found ? "badge-neutral" : "badge-review"}`}>
                  {r.quote_found ? "Quote found in document" : "Quote not found in document"}
                </span>
              </div>
              <p className="source-quote text-[13px] text-ink-soft">{r.quote}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[12px] leading-4 text-muted tabular-nums">
        {result.provider} · {result.model} · {(result.latency_ms / 1000).toFixed(1)} s
        {prompt_tokens !== null && completion_tokens !== null && ` · ${prompt_tokens} in / ${completion_tokens} out tokens`}
        {` · ${result.resource_title}, ${revisionLabel(result.version_number)}`}
      </p>
    </div>
  );
}
