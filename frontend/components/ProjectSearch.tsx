/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { type FormEvent, useState } from "react";

import { useApi, useDemoState } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { api, ApiError } from "@/lib/api";
import type { RevisionScope, SearchHit, SearchMode, SearchResult } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: SearchResult; version: number }
  | { kind: "failed"; message: string };

/** Search the project's documents: source excerpts with file, page and
 * revision. No answer is generated. Lexical search runs offline; hybrid
 * search needs live embeddings and is disabled, with the reason, when they are
 * not configured or the documents are not embedded. A refused hybrid search
 * is shown as refused, never replaced by a lexical one. */
export function ProjectSearch({ projectId }: { projectId: string }) {
  const { version } = useDemoState();
  const status = useApi(() => api.searchStatus(projectId), `search-status-${projectId}`);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("lexical");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  const hybrid = status.data?.hybrid;
  const lexical = status.data?.lexical;
  const modeStatus = mode === "hybrid" ? hybrid : lexical;
  const canSearch = query.trim().length > 0 && modeStatus?.available === true && state.kind !== "running";
  // Results from before a reset or a new revision are stale: drop them.
  const shown = state.kind === "done" && state.version !== version ? { kind: "idle" as const } : state;

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!canSearch) return;
    const revisions: RevisionScope = includeSuperseded ? "all" : "current";
    setState({ kind: "running" });
    try {
      const result = await api.search(projectId, { query: query.trim(), mode, revisions });
      setState({ kind: "done", result, version });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof ApiError ? error.message : "The search failed." });
    }
  }

  return (
    <section aria-labelledby="search-heading" className="panel space-y-4 px-6 py-5" data-testid="project-search">
      <div>
        <h2 id="search-heading" className="section-title flex items-center gap-2">
          <Icon name="search" size={16} className="text-faint" />Search documents
        </h2>
        <p className="mt-1 text-[13.5px] text-muted">
          Returns source passages with file, page and revision. No answer is generated. By default only revisions in
          force are searched; a revision is superseded only when a later document says so.
        </p>
      </div>

      <form onSubmit={search} className="space-y-3" role="search">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="search-query" className="sr-only">Search query</label>
          <input id="search-query" type="search" value={query} maxLength={2000} data-testid="search-query"
            onChange={(e) => setQuery(e.target.value)} placeholder="e.g. How much notice before an inspection?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3.5 py-2 text-[14.5px] text-ink placeholder:text-faint focus:border-accent-line focus:outline-none" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!canSearch} data-testid="search-button">
            {state.kind === "running" ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-ink-soft">
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="sr-only">Search mode</legend>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name="search-mode" value="lexical" checked={mode === "lexical"}
                onChange={() => setMode("lexical")} data-testid="search-mode-lexical" />
              Lexical (offline, no embeddings)
            </label>
            <label className={`inline-flex items-center gap-1.5 ${hybrid?.available ? "" : "text-faint"}`}>
              <input type="radio" name="search-mode" value="hybrid" checked={mode === "hybrid"}
                disabled={!hybrid?.available} onChange={() => setMode("hybrid")} data-testid="search-mode-hybrid"
                aria-describedby={hybrid && !hybrid.available ? "hybrid-unavailable" : undefined} />
              Hybrid (live embeddings)
            </label>
          </fieldset>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={includeSuperseded} data-testid="search-include-superseded"
              onChange={(e) => setIncludeSuperseded(e.target.checked)} />
            Include superseded revisions (history)
          </label>
        </div>
        {hybrid && !hybrid.available && (
          <p id="hybrid-unavailable" className="flex items-start gap-2 text-[13px] text-muted" data-testid="hybrid-unavailable">
            <Icon name="lock" size={13} className="mt-0.5 text-faint" />
            <span>Hybrid search is unavailable: {hybrid.reason ?? "it is not enabled"}.</span>
          </p>
        )}
        {lexical && !lexical.available && (
          <p className="text-[13px] text-review" role="status">Search is not ready: {lexical.reason}.</p>
        )}
        {status.state === "error" && (
          <p className="text-[13px] text-conflict" role="alert">Could not read the search index status: {status.message}</p>
        )}
      </form>

      {shown.kind === "running" && <p className="text-[14px] text-muted" role="status">Searching…</p>}
      {shown.kind === "failed" && (
        <p className="flex items-center gap-2 text-[14px] text-conflict" role="alert" data-testid="search-error">
          <Icon name="alert" size={14} />Search failed: {shown.message}
        </p>
      )}
      {shown.kind === "done" && <Results result={shown.result} />}
    </section>
  );
}

function modeLabel(result: SearchResult): string {
  if (result.mode === "lexical") return "Offline lexical search · no embeddings";
  if (result.embeddings === "live") return "Hybrid search · live query embedding";
  return `Hybrid search · ${result.embeddings} embeddings`;
}

function Results({ result }: { result: SearchResult }) {
  return (
    <div className="space-y-3" data-testid="search-results">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-faint tabular-nums" data-testid="search-summary">
        <span className={`badge ${result.mode === "lexical" ? "badge-neutral" : "badge-found"}`} data-testid="search-mode-label">
          {modeLabel(result)}
        </span>
        <span>{result.hits.length} passage{result.hits.length === 1 ? "" : "s"}</span>
        <span>
          {result.revisions_searched} revision{result.revisions_searched === 1 ? "" : "s"} searched
          {result.revisions === "current" ? " (in force only)" : " (history included)"}
        </span>
        {result.revisions_excluded_as_superseded > 0 && (
          <span data-testid="search-excluded">{result.revisions_excluded_as_superseded} superseded excluded</span>
        )}
      </p>
      {result.hits.length === 0 ? (
        <p className="text-[14px] text-muted">No passage matches this query.</p>
      ) : (
        <ol className="space-y-2.5">
          {result.hits.map((hit) => <Hit key={`${hit.revision.version_id}-${hit.rank}`} hit={hit} />)}
        </ol>
      )}
      <p className="text-[12px] text-faint">
        Ranked by {result.score_kind} (a ranking score, not a confidence) · {result.chunker_version} ·{" "}
        {result.lexical_version}
        {result.fusion_version && ` · ${result.fusion_version}`} · {result.supersession_rules}
      </p>
    </div>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  const rev = hit.revision;
  const pages = hit.pages.length === 0 ? "page unknown" : `${hit.pages.length === 1 ? "p." : "pp."} ${hit.pages.join(", ")}`;
  return (
    <li className="rounded-xl border border-line bg-canvas/50 px-4 py-3" data-testid="search-hit">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">
            <span className="mr-2 text-faint tabular-nums">{hit.rank}.</span>{hit.document_title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted" data-testid="search-hit-source">
            <Icon name="file" size={13} className="text-faint" />
            <span data-testid="search-hit-file">{rev.file_name}</span>
            <span aria-hidden>·</span>
            <span data-testid="search-hit-pages">{pages}</span>
            <span aria-hidden>·</span>
            <span data-testid="search-hit-revision">
              {rev.stated_revision ? `Revision ${rev.stated_revision}` : "no revision stated"}
              <span className="text-faint"> (stored as {rev.stored_label})</span>
            </span>
          </p>
        </div>
        <span className={`badge ${rev.in_force ? "badge-verified" : "badge-review"}`} data-testid="search-hit-status">
          {rev.in_force ? "In force" : `Superseded${rev.superseded_by_revision ? ` by Revision ${rev.superseded_by_revision}` : ""}`}
        </span>
      </div>
      {!rev.in_force && rev.supersession_quote && (
        <p className="mt-1.5 text-[12.5px] text-muted">
          Superseded because the later revision states
          {rev.supersession_page !== null && ` on p. ${rev.supersession_page}`}: &ldquo;{rev.supersession_quote}&rdquo;
        </p>
      )}
      <p className="source-quote mt-2 max-h-48 overflow-y-auto text-[13.5px] text-ink-soft" data-testid="search-hit-excerpt">
        {hit.excerpt}
      </p>
      <p className="mt-1.5 text-[12px] text-faint tabular-nums">
        Score {hit.score.toFixed(4)}
        {hit.lexical_rank !== null && ` · lexical rank ${hit.lexical_rank}`}
        {hit.vector_rank !== null && ` · vector rank ${hit.vector_rank}`}
        {` · ${hit.citations.length} cited span${hit.citations.length === 1 ? "" : "s"}`}
      </p>
    </li>
  );
}
