/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { type FormEvent, Fragment, useState } from "react";

import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { api, ApiError } from "@/lib/api";
import type { AskResult, AskSource } from "@/lib/types";

type Turn = { question: string } & (
  | { kind: "running" }
  | { kind: "done"; result: AskResult }
  | { kind: "failed"; message: string }
);

/** Ask project documents: a live model answers from the documents the
 * signed-in identity may read, searching them through a tool the backend
 * scopes. Each question is answered on its own. Always a live model response
 * (never an authored fixture); without model credentials the panel is
 * disabled and says why. */
export function AskDocuments({ projectId }: { projectId: string }) {
  const capabilities = useApi(api.capabilities, "capabilities");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const available = capabilities.data?.ask_documents === true;
  const running = turns.some((t) => t.kind === "running");

  async function ask(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !available || running) return;
    setQuestion("");
    setTurns((t) => [...t, { question: q, kind: "running" }]);
    const settle = (turn: Turn) => setTurns((t) => [...t.slice(0, -1), turn]);
    try {
      settle({ question: q, kind: "done", result: await api.ask(projectId, q) });
    } catch (error) {
      settle({ question: q, kind: "failed", message: error instanceof ApiError ? error.message : "The request failed." });
    }
  }

  return (
    <section aria-labelledby="ask-heading" className="panel space-y-4 px-6 py-5" data-testid="ask-documents">
      <div>
        <h2 id="ask-heading" className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-tight">
          <span className="badge badge-found"><Icon name="sparkles" size={11} />Live model</span>
          Ask project documents
        </h2>
        <p className="mt-1 text-[13.5px] text-muted">
          A live model searches the documents you may read (it cannot widen that) and answers with document, page and
          revision references. It cites only passages it retrieved, and says so when the evidence is insufficient. Each
          question is answered on its own; nothing is saved but the model call records.
        </p>
      </div>

      {turns.length > 0 && (
        <ol className="space-y-4" data-testid="ask-turns">
          {turns.map((turn, i) => (
            <li key={i} className="space-y-2">
              <p className="text-[14px] text-ink"><span className="label mr-2">You</span>{turn.question}</p>
              {turn.kind === "running" && <p className="text-[14px] text-muted" role="status">Searching and answering…</p>}
              {turn.kind === "failed" && (
                <p className="flex items-center gap-2 text-[14px] text-conflict" role="alert" data-testid="ask-error">
                  <Icon name="alert" size={14} />{turn.message}
                </p>
              )}
              {turn.kind === "done" && <Answer result={turn.result} />}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={ask} className="flex flex-wrap gap-2">
        <label htmlFor="ask-question" className="sr-only">Question</label>
        <input id="ask-question" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)}
          disabled={!available} data-testid="ask-question"
          placeholder={available ? "e.g. How much notice is needed before an inspection?" : "Unavailable: see below"}
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3.5 py-2 text-[14.5px] text-ink placeholder:text-faint focus:border-accent-line focus:outline-none disabled:opacity-60" />
        <button type="submit" className="btn btn-primary btn-sm" data-testid="ask-button"
          disabled={!available || running || !question.trim()}
          aria-describedby={!available ? "ask-unavailable" : undefined}>
          {running ? "Answering…" : "Ask"}
        </button>
      </form>
      {!available && capabilities.data !== undefined && (
        <p id="ask-unavailable" className="flex items-start gap-2 text-[13px] text-muted" data-testid="ask-unavailable">
          <Icon name="lock" size={13} className="mt-0.5 shrink-0 text-faint" />
          <span>
            Unavailable: {capabilities.data.ask_documents_reason ?? "it is not enabled"}. To enable it locally, set
            NEBIUS_API_KEY, NEBIUS_BASE_URL, MODEL_FAST and MODEL_STRONG in the git-ignored <code>.env</code> at the
            repository root and restart the stack with <code>--env-file .env</code>. Nothing is simulated meanwhile.
          </span>
        </p>
      )}
      {capabilities.state === "error" && capabilities.data === undefined && (
        <p className="text-[13px] text-conflict" role="alert">Could not check whether live chat is configured.</p>
      )}
    </section>
  );
}

function Answer({ result }: { result: AskResult }) {
  const { prompt_tokens, completion_tokens } = result.usage;
  return (
    <div className="space-y-3 rounded-xl border border-line bg-canvas/50 px-4 py-3" data-testid="ask-answer">
      <p className="text-[15px] leading-relaxed text-ink whitespace-pre-line" data-testid="ask-answer-text">
        <CitedText text={result.answer} />
      </p>
      {!result.grounded && (
        <p className="flex items-center gap-2 text-[13px] text-review" data-testid="ask-ungrounded">
          <Icon name="alert" size={13} />No retrieved passage is cited: treat this answer as unsupported.
        </p>
      )}
      {result.removed_citations.length > 0 && (
        <p className="text-[13px] text-review">
          Removed {result.removed_citations.length} citation(s) to sources that were never retrieved
          ({result.removed_citations.join(", ")}).
        </p>
      )}
      {result.citations.length > 0 && (
        <ol className="space-y-1.5" data-testid="ask-citations">
          {result.citations.map((s) => <Source key={s.source_id} source={s} />)}
        </ol>
      )}
      <details className="text-[12.5px] text-faint">
        <summary className="cursor-pointer select-none">
          {result.tool_calls.length} search{result.tool_calls.length === 1 ? "" : "es"} (max {result.max_tool_calls}) ·{" "}
          {result.retrieval_mode === "hybrid" ? "hybrid retrieval, live embeddings" : "lexical retrieval, no embeddings"} ·
          scope: {result.identity.name}
        </summary>
        <ul className="mt-1.5 space-y-1 pl-4" data-testid="ask-tool-calls">
          {result.tool_calls.map((t, i) => (
            <li key={i} className="list-disc">
              {t.name}({t.query ? `“${t.query}”` : ""}{t.include_superseded ? ", history included" : ""}) →{" "}
              {t.error ? `error: ${t.error}` : `${t.source_ids.length} passage(s)${t.source_ids.length ? ` ${t.source_ids.join(", ")}` : ""}`}
              {t.ignored_arguments.length > 0 && ` · ignored arguments: ${t.ignored_arguments.join(", ")}`}
            </li>
          ))}
        </ul>
        {result.tool_call_limit_reached && <p className="mt-1">Search limit reached; the model was asked to answer.</p>}
      </details>
      <p className="text-[12px] text-faint tabular-nums" data-testid="ask-provenance">
        Live model response · {result.provider} · {result.model} · {(result.latency_ms / 1000).toFixed(1)} s ·{" "}
        {result.turns} model turn{result.turns === 1 ? "" : "s"}
        {prompt_tokens !== null && completion_tokens !== null && ` · ${prompt_tokens} in / ${completion_tokens} out tokens`}
      </p>
    </div>
  );
}

function CitedText({ text }: { text: string }) {
  const parts = text.split(/(\[S\d+(?:\s*,\s*S\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[S\d+/.test(part)
          ? <span key={i} className="mx-0.5 rounded bg-accent-soft px-1 text-[12px] font-medium text-link">{part.slice(1, -1)}</span>
          : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

function Source({ source }: { source: AskSource }) {
  const pages = source.pages.length ? `${source.pages.length === 1 ? "p." : "pp."} ${source.pages.join(", ")}` : "page unknown";
  const revision = source.stated_revision ? `Revision ${source.stated_revision}` : `stored as ${source.stored_label}`;
  return (
    <li className="text-[13px] text-ink-soft" data-testid="ask-citation">
      <details>
        <summary className="cursor-pointer select-none">
          <span className="mr-1.5 rounded bg-accent-soft px-1 text-[12px] font-medium text-link">{source.source_id}</span>
          <span className="font-medium text-ink">{source.document_title}</span> · {source.file_name} · {pages} · {revision} ·{" "}
          <span className={source.in_force ? "text-verified" : "text-review"}>
            {source.in_force ? "in force" : `superseded${source.superseded_by_revision ? ` by Revision ${source.superseded_by_revision}` : ""}`}
          </span>
        </summary>
        <p className="source-quote mt-1.5 max-h-40 overflow-y-auto pl-2 text-[13px] text-muted">{source.excerpt}</p>
      </details>
    </li>
  );
}
