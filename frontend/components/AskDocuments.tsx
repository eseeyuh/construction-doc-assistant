/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { type FormEvent, Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { useApi } from "@/components/DemoState";
import { type EvidenceView, useEvidence } from "@/components/Evidence";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/ProjectSearch";
import { api, ApiError } from "@/lib/api";
import type { AskResult, AskSource } from "@/lib/types";

type Turn = { question: string } & (
  | { kind: "running" }
  | { kind: "done"; result: AskResult }
  | { kind: "failed"; message: string }
);

// Example questions: they only fill in the question box. Asking is a paid
// live model call, so it always waits for Send.
const SUGGESTIONS = [
  "How much notice is needed before an inspection?",
  "What safety footwear is required?",
  "When is payment application 1 due?",
];

/** Ask project documents, shown as a chat: a live model answers from the
 * documents the signed-in identity may read, searching them through a tool the
 * backend scopes. Each question is sent on its own: earlier messages stay on
 * screen for this session but are never sent as context. Always a live model
 * response (never an authored fixture); without model credentials the panel is
 * disabled and says why. The page keys this panel by project, and the app is
 * keyed by identity, so switching either clears the messages. */
export function AskDocuments({ projectId }: { projectId: string }) {
  const capabilities = useApi(api.capabilities, "capabilities");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Focus from a click or tap gets no focus ring; keyboard focus gets a subtle one.
  const pointerFocus = useRef(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const available = capabilities.data?.ask_documents === true;
  const running = turns.some((t) => t.kind === "running");

  // Keep the newest message in view, scrolling only inside the panel.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(q: string) {
    if (!q || !available || running) return;
    setTurns((t) => [...t, { question: q, kind: "running" }]);
    const settle = (turn: Turn) => setTurns((t) => [...t.slice(0, -1), turn]);
    try {
      settle({ question: q, kind: "done", result: await api.ask(projectId, q) });
    } catch (error) {
      settle({ question: q, kind: "failed", message: error instanceof ApiError ? error.message : "The request failed." });
    }
  }
  function ask(event: FormEvent | KeyboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !available || running) return;
    setQuestion("");
    void send(q);
  }
  function suggest(text: string, byPointer: boolean) {
    setQuestion(text);
    pointerFocus.current = byPointer;
    input.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter (and Enter while composing text) adds a newline.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) ask(event);
  }

  return (
    <section aria-labelledby="ask-heading" className="panel flex w-full min-w-0 flex-col gap-4 p-5" data-testid="ask-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id="ask-heading" className="section-title">Ask project documents</h2>
          <InfoTip id="ask-independent-info" label="About questions"
            text="Each question is answered independently from the documents you can read. Earlier messages are not sent with it." />
        </div>
        <span className={`pill ${available ? "bg-accent-soft text-accent-ink" : ""}`} data-testid="ask-availability">
          <span className="dot" />
          {capabilities.data === undefined ? "Checking…" : available ? "Live model" : "Live model unavailable"}
        </span>
      </div>

      {!available && capabilities.data !== undefined && (
        <div id="ask-unavailable" className="well flex flex-col gap-1 p-4" data-testid="ask-unavailable">
          <span className="font-[550]">Live answers are unavailable</span>
          <span className="text-[13px] leading-[18px] text-ink-soft">
            {capabilities.data.ask_documents_reason ?? "Live chat is not enabled"}. To enable it locally, set
            NEBIUS_API_KEY, NEBIUS_BASE_URL, MODEL_FAST and MODEL_STRONG in the git-ignored <code>.env</code> at the
            repository root and restart the stack with <code>--env-file .env</code>.
          </span>
        </div>
      )}
      {capabilities.state === "error" && capabilities.data === undefined && (
        <p className="text-[13px] text-conflict" role="alert">Could not check whether live chat is configured.</p>
      )}

      <div ref={scroller} role="log" aria-label="Messages" aria-live="polite"
        className="flex max-h-[min(60vh,560px)] min-h-[160px] flex-col overflow-y-auto overscroll-contain rounded-xl border border-line bg-canvas/40 p-4">
        {turns.length === 0 ? (
          <p className="m-auto text-center text-[13px] leading-[18px] text-muted">
            {available ? "Ask a question about the documents you can read." : "No messages."}
          </p>
        ) : (
          <ol className="m-0 mx-auto flex w-full max-w-[760px] list-none flex-col gap-5 p-0" data-testid="ask-turns">
            {turns.map((turn, i) => (
              <li key={i} className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <p className="m-0 max-w-[min(80%,640px)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-on-accent"
                    data-testid="ask-user-message">
                    <span className="sr-only">You: </span>{turn.question}
                  </p>
                </div>
                {turn.kind === "running" && (
                  <div className="flex justify-start">
                    <div role="status" className="flex items-center gap-1.5 py-2">
                      <span className="sr-only">Searching the documents and answering with the live model…</span>
                      {[0, 1, 2].map((d) => (
                        <span key={d} aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted"
                          style={{ animationDelay: `${d * 160}ms` }} />
                      ))}
                    </div>
                  </div>
                )}
                {turn.kind === "failed" && (
                  <div className="flex justify-start">
                    <div role="alert" data-testid="ask-error"
                      className="flex max-w-[min(85%,720px)] flex-col gap-2 rounded-2xl rounded-bl-md border border-conflict-line bg-conflict-soft px-4 py-3">
                      <span className="font-[550] text-conflict">No answer was produced</span>
                      <span className="text-[13px] text-ink-soft">{turn.message}</span>
                      {i === turns.length - 1 && (
                        <button type="button" className="btn btn-quiet btn-sm self-start" disabled={!available || running}
                          onClick={() => { setTurns((t) => t.slice(0, -1)); void send(turn.question); }}>
                          Try again
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {turn.kind === "done" && <Answer result={turn.result} question={turn.question} />}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" disabled={!available} title={s}
            onClick={(e) => suggest(s, e.detail > 0)}>
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={ask}
        className={`ask-composer flex items-center gap-2 rounded-xl border bg-surface p-2 ${keyboardFocus ? "border-muted" : "border-line-strong"}`}>
        <textarea ref={input} id="ask-question" rows={2} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          onPointerDown={() => { pointerFocus.current = true; }}
          onFocus={() => { setKeyboardFocus(!pointerFocus.current); pointerFocus.current = false; }}
          onBlur={() => { setKeyboardFocus(false); pointerFocus.current = false; }} disabled={!available} data-testid="ask-question" aria-label="Question"
          aria-describedby={!available ? "ask-unavailable" : undefined}
          className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[14px] leading-[21px] text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
          placeholder={available ? "Ask about the documents you can read…" : "Live answers are unavailable"} />
        <button type="submit" className="btn btn-primary h-10 min-h-0 w-10 shrink-0 rounded-full p-0" data-testid="ask-button"
          disabled={!available || running || !question.trim()} aria-label={running ? "Answering…" : "Send question"}
          title={running ? "Answering…" : "Send (Enter)"}>
          <Icon name="send" size={16} />
        </button>
      </form>
    </section>
  );
}

/** Citation markers ("[S1]", "[S1, S2]") are for the backend's citation
 * check; the display drops them, the answer itself is kept as returned. */
function withoutCitationMarkers(text: string): string {
  return text.replace(/[ \t]*\[S\d+(?:\s*,\s*S\d+)*\]/g, "");
}

/** The API's verified citations, grouped by revision: each file once. */
function sourceGroups(citations: AskSource[]): AskSource[][] {
  const groups = new Map<string, AskSource[]>();
  for (const c of citations) groups.set(c.version_id, [...(groups.get(c.version_id) ?? []), c]);
  return [...groups.values()];
}

function pagesLabel(sources: AskSource[]): string {
  const pages = [...new Set(sources.flatMap((s) => s.pages))].sort((a, b) => a - b);
  return pages.length === 0 ? "" : ` · ${pages.length === 1 ? "p." : "pp."} ${pages.join(", ")}`;
}

/** A cited passage as the evidence drawer shows it; every field from the API. */
function evidenceOf(source: AskSource): EvidenceView {
  return {
    key: `${source.version_id}-${source.source_id}`,
    documentId: source.document_id,
    resourceTitle: source.document_title,
    resourceType: source.document_type,
    versionNumber: 0, // not sent for chat sources: the stored label is shown instead
    revision: source.stated_revision ? `Revision ${source.stated_revision} (stored as ${source.stored_label})` : source.stored_label,
    currentVersion: source.in_force,
    page_number: source.pages[0] ?? null,
    slide_number: null,
    section_path: null,
    quote: source.excerpt,
    status: null,
    origin: "Retrieved passage",
  };
}

function Answer({ result, question }: { result: AskResult; question: string }) {
  const open = useEvidence();
  const groups = sourceGroups(result.citations);
  return (
    <div className="flex w-full flex-col gap-2 text-left" data-testid="ask-answer">
      {!result.grounded && (
        <div className="flex flex-col gap-1 rounded-lg bg-review-soft p-3" data-testid="ask-ungrounded">
          <span className="font-[550] text-review">No retrieved passage is cited</span>
          <span className="text-[13px] text-ink">Treat this answer as unsupported by the documents you can read.</span>
        </div>
      )}
      <div className="flex flex-col gap-2 text-[14px] leading-[22px] text-ink break-words" data-testid="ask-answer-text">
        <RichText text={withoutCitationMarkers(result.answer)} />
      </div>
      {groups.length > 0 && (
        <p className="m-0 text-[12px] leading-4 text-muted" data-testid="ask-citations">
          {groups.length === 1 ? "Source: " : "Sources: "}
          {groups.map((sources, i) => (
            <Fragment key={sources[0].version_id}>
              {i > 0 && "; "}
              <button type="button" className="ask-source" data-testid="ask-citation"
                onClick={() => open({ kind: "Cited source", claim: question, items: sources.map(evidenceOf) })}>
                {sources[0].file_name}{pagesLabel(sources)}
              </button>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

// A deliberately small Markdown subset for model answers: paragraphs, line
// breaks, bullet and numbered lists, headings (shown bold), **bold**, *italic*,
// and `code`. Everything renders as React text nodes; no HTML
// from the answer is ever interpreted.
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let lines: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushLines = () => {
    if (!lines.length) return;
    const body = lines;
    blocks.push(
      <p key={blocks.length} className="m-0">
        {body.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<Inline text={l} /></Fragment>)}
      </p>,
    );
    lines = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const children = items.map((item, i) => <li key={i}><Inline text={item} /></li>);
    blocks.push(ordered
      ? <ol key={blocks.length} className="m-0 list-decimal space-y-1 pl-5">{children}</ol>
      : <ul key={blocks.length} className="m-0 list-disc space-y-1 pl-5">{children}</ul>);
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushLines(); flushList(); continue; }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushLines();
      const ordered = /^\s*\d/.test(line);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flushList();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    lines.push(heading ? `**${heading[1].replace(/\*\*/g, "")}**` : line);
  }
  flushLines();
  flushList();
  return <>{blocks}</>;
}

function Inline({ text }: { text: string }) {
  // split() with one capturing group puts the matched tokens at odd indexes.
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith("**") || part.startsWith("__")) {
          return <strong key={i} className="font-semibold text-ink"><Inline text={part.slice(2, -2)} /></strong>;
        }
        if (part.startsWith("`")) return <code key={i} className="mono">{part.slice(1, -1)}</code>;
        return <em key={i}><Inline text={part.slice(1, -1)} /></em>;
      })}
    </>
  );
}
