/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useApi, useDemoState } from "@/components/DemoState";
import { DownloadButton } from "@/components/DownloadButton";
import { Icon } from "@/components/Icon";
import { PdfPreview } from "@/components/PdfPreview";
import { api, ApiError } from "@/lib/api";
import type { RevisionScope, SearchHit, SearchMode, SearchResult } from "@/lib/types";

type Request = { query: string; mode: SearchMode; revisions: RevisionScope };
type State =
  | { kind: "idle" }
  | { kind: "running"; request: Request }
  | { kind: "done"; request: Request; result: SearchResult; version: number; seq: number }
  | { kind: "failed"; request: Request; message: string };

// Example queries: they only fill in the search box and run it, as if typed.
const SUGGESTIONS = ["inspection notice", "safety footwear", "hard hats and boots", "payment application"];

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
  const runs = useRef(0); // each finished search gets a fresh results view

  const hybrid = status.data?.hybrid;
  const lexical = status.data?.lexical;
  const modeStatus = mode === "hybrid" ? hybrid : lexical;
  const ready = modeStatus?.available === true && state.kind !== "running";
  // Results from before a reset or a new revision are stale: drop them.
  const stale = state.kind === "done" && state.version !== version;
  const shown: State = stale ? { kind: "idle" } : state;

  async function run(request: Request) {
    setState({ kind: "running", request });
    try {
      const result = await api.search(projectId, request);
      setState({ kind: "done", request, result, version, seq: ++runs.current });
    } catch (error) {
      setState({ kind: "failed", request, message: error instanceof ApiError ? error.message : "The search failed." });
    }
  }
  const searchFor = (text: string) => {
    const q = text.trim();
    if (!q || !ready) return;
    void run({ query: q, mode, revisions: includeSuperseded ? "all" : "current" });
  };
  const submit = (event: FormEvent) => { event.preventDefault(); searchFor(query); };

  return (
    <section aria-labelledby="search-heading" className="panel flex w-full min-w-0 flex-col gap-4 p-5" data-testid="project-search">
      <div className="space-y-1">
        <h2 id="search-heading" className="section-title">Search documents</h2>
        <p className="text-[13px] leading-[18px] text-muted">
          Opens the best-matching source PDF at the matched page. It does not write an answer.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" role="search">
        <div className="flex gap-2">
          <label htmlFor="search-query" className="sr-only">Search query</label>
          <input id="search-query" type="search" value={query} maxLength={2000} data-testid="search-query" className="input"
            onChange={(e) => setQuery(e.target.value)} placeholder="e.g. How much notice before an inspection?" />
          <button type="submit" className="btn btn-primary" disabled={!ready || !query.trim()} data-testid="search-button">
            <Icon name="search" size={16} />{state.kind === "running" ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" disabled={!ready} onClick={() => { setQuery(s); searchFor(s); }}>{s}</button>
          ))}
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="overline mb-2 p-0">Search mode</legend>
          <div className="seg">
            <div className={`seg-option ${mode === "lexical" ? "on" : ""}`}>
              <label>
                <input type="radio" name="search-mode" value="lexical" checked={mode === "lexical"}
                  onChange={() => setMode("lexical")} data-testid="search-mode-lexical" />
                <span className="font-[550]">Lexical</span>
              </label>
              <InfoTip id="search-mode-lexical-info" label="About Lexical search"
                text="Keyword search using PostgreSQL full-text ranking. Runs offline without embeddings." />
            </div>
            <div className={`seg-option ${mode === "hybrid" ? "on" : ""} ${hybrid?.available ? "" : "off"}`}>
              <label>
                <input type="radio" name="search-mode" value="hybrid" checked={mode === "hybrid"}
                  disabled={!hybrid?.available} onChange={() => setMode("hybrid")} data-testid="search-mode-hybrid"
                  aria-describedby={hybrid && !hybrid.available ? "hybrid-unavailable" : undefined} />
                <span className="font-[550]">Hybrid</span>
              </label>
              <InfoTip id="search-mode-hybrid-info" label="About Hybrid search"
                text="Combines keyword and vector search. Uses a live query embedding for each search." />
            </div>
          </div>
          {status.state === "loading" && status.data === undefined && (
            <p className="mt-2 text-[12px] leading-4 text-muted" role="status">Checking which search modes are available…</p>
          )}
          {hybrid && !hybrid.available && (
            <p id="hybrid-unavailable" className="mt-2 flex items-start gap-2 text-[12px] leading-4 text-review" data-testid="hybrid-unavailable">
              <Icon name="alert" size={14} />
              <span>Hybrid search is unavailable: {hybrid.reason ?? "it is not enabled"}.</span>
            </p>
          )}
          {lexical && !lexical.available && (
            <p className="mt-2 text-[12px] leading-4 text-review" role="status">Search is not ready: {lexical.reason}.</p>
          )}
          {status.state === "error" && (
            <p className="mt-2 text-[12px] leading-4 text-conflict" role="alert">Could not read the search index status: {status.message}</p>
          )}
        </fieldset>
        <label className="checkbox">
          <input type="checkbox" checked={includeSuperseded} data-testid="search-include-superseded"
            onChange={(e) => setIncludeSuperseded(e.target.checked)} />
          Include superseded revisions (history)
        </label>
      </form>

      <div className="flex flex-col gap-3 border-t border-line pt-4" aria-live="polite">
        {shown.kind === "idle" && (
          <p className="text-[13px] leading-[18px] text-muted">
            {stale
              ? "The revision state changed since the last search. Run the search again."
              : "By default only revisions in force are searched; a revision is superseded only when a later document says so."}
          </p>
        )}
        {shown.kind === "running" && (
          <div role="status" className="flex flex-col gap-2.5">
            <span className="text-[13px] text-ink-soft">
              Searching {shown.request.revisions === "all" ? "all loaded revisions" : "revisions in force"} ({shown.request.mode})…
            </span>
            <span aria-hidden className="skeleton block h-16" />
            <span aria-hidden className="skeleton block h-16" />
          </div>
        )}
        {shown.kind === "failed" && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-conflict-soft p-4" data-testid="search-error">
            <span className="font-[550] text-conflict">Search failed</span>
            <span className="text-[13px] text-ink-soft">{shown.message} Your query is kept.</span>
            <button type="button" className="btn btn-quiet btn-sm self-start" onClick={() => run(shown.request)}>Retry search</button>
          </div>
        )}
        {shown.kind === "done" && <Results key={shown.seq} result={shown.result} query={shown.request.query} />}
      </div>
    </section>
  );
}

// Common words a full-text search ignores: never highlighted.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "has", "have", "how", "in", "is",
  "it", "its", "much", "many", "must", "of", "on", "or", "should", "that", "the", "their", "there", "this", "to", "was",
  "what", "when", "where", "which", "who", "why", "will", "with", "before", "after", "any", "all", "each",
]);

/** The query's own words, lower-case, for highlighting in the source PDF. */
function queryTerms(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w) && (w.length > 1 || /\d/.test(w))))].join(" ");
}

/** How well a quote matches the query: distinct query words found, then
 * occurrences (whole words starting with a query word, as highlighted). */
function matchScore(quote: string, words: string[]): [number, number] {
  let distinct = 0, total = 0;
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = quote.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, "giu"))?.length ?? 0;
    if (found) distinct++;
    total += found;
  }
  return [distinct, total];
}

/** The page to open: that of the cited quote that best matches the query
 * (the first such quote on a tie). A chunk can span several pages; only when
 * no citation carries a page does this fall back to the chunk's first page. */
function pageOf(hit: SearchHit, terms: string): number {
  const words = terms.split(" ").filter(Boolean);
  let best: { page: number; score: [number, number] } | null = null;
  for (const c of hit.citations) {
    if (c.page_number === null) continue;
    const score = matchScore(c.quote, words);
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
      best = { page: c.page_number, score };
    }
  }
  return best?.page ?? hit.pages[0] ?? 1;
}

/** The results as a preview of the source PDF: one entry per matching
 * revision, best-ranked first, each opened at its matched page. */
function Results({ result, query }: { result: SearchResult; query: string }) {
  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<Blob | null>(null);
  const terms = useMemo(() => queryTerms(query), [query]);
  const entries = useMemo(() => {
    const seen = new Set<string>();
    return result.hits.filter((hit) => !seen.has(hit.revision.version_id) && !!seen.add(hit.revision.version_id));
  }, [result]);

  if (entries.length === 0) {
    return (
      <div className="well flex flex-col gap-1 p-5" data-testid="search-empty">
        <span className="font-[550]">No matching passages</span>
        <span className="text-[13px] text-ink-soft">
          Nothing you can read matched “{query}”. Try other words{result.revisions === "current" ? ", or include superseded revisions" : ""}.
        </span>
      </div>
    );
  }
  const current = Math.min(index, entries.length - 1);
  const hit = entries[current];
  const page = pageOf(hit, terms);
  const go =(step: number) => { setFile(null); setIndex((current + step + entries.length) % entries.length); };
  return (
    <div className="flex flex-col gap-2" data-testid="search-results">
      {entries.length > 1 && (
        <div className="flex items-center justify-end gap-1" data-testid="search-result-nav">
          <button type="button" className="icon-btn" aria-label="Previous matching document" onClick={() => go(-1)}
            data-testid="search-result-prev">
            <Icon name="chevronRight" size={16} className="rotate-180" />
          </button>
          <span className="min-w-[44px] text-center text-[12px] text-muted tabular-nums" data-testid="search-result-position">
            {current + 1} / {entries.length}
          </span>
          <button type="button" className="icon-btn" aria-label="Next matching document" onClick={() => go(1)}
            data-testid="search-result-next">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}
      <PdfPreview key={`${hit.revision.version_id}-${page}`} documentId={hit.document_id}
        revisionId={hit.revision.version_id} page={page} terms={terms} title={hit.document_title} onFile={setFile} />
      <div className="flex min-w-0 items-center gap-2" data-testid="search-hit">
        <Icon name="file" size={16} className="shrink-0 text-conflict" />
        <span className="mono min-w-0 flex-1 truncate text-ink" title={hit.revision.file_name} data-testid="search-hit-file">
          {hit.revision.file_name}
        </span>
        <DownloadButton documentId={hit.document_id} revisionId={hit.revision.version_id} fileName={hit.revision.file_name}
          file={file} testId="search-download" />
      </div>
    </div>
  );
}

/** A small info button: the explanation shows on mouse hover, keyboard focus or
 * tap. It stays operable when its option is disabled. */
export function InfoTip({ id, label, text }: { id: string; label: string; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pointer = useRef(false); // focus from a tap or click is not keyboard focus
  const open = hover || focus || pinned;

  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setPinned(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);

  function close() { setHover(false); setFocus(false); setPinned(false); }

  return (
    <span ref={ref} className="info-tip"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(true); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(false); }}>
      <button type="button" className="info-tip-btn" aria-label={label} aria-describedby={id} aria-expanded={open}
        onPointerDown={() => { pointer.current = true; }}
        onFocus={() => { if (!pointer.current) setFocus(true); pointer.current = false; }} onBlur={() => { setFocus(false); setPinned(false); }}
        onClick={() => { pointer.current = false; if (open) close(); else setPinned(true); }}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
        <Icon name="info" size={14} />
      </button>
      <span role="tooltip" id={id} className="info-tip-text" hidden={!open}>{text}</span>
    </span>
  );
}
