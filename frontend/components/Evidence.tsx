/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// The evidence viewer: stored provenance only. Every field shown comes from
// the API (document title, revision, page/section, the exact excerpt,
// verification status); nothing is composed into a citation here.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { isFixture, locator, RESOURCE_LABELS, revisionLabel } from "@/lib/format";
import type { Evidence, SourceQuote, Verification } from "@/lib/types";

export type EvidenceView = {
  key: string;
  /** The document's ID, when known: links to its page. */
  documentId?: string;
  resourceTitle: string;
  resourceType?: string;
  versionNumber: number;
  /** The revision as the API labels it, shown instead of one derived from versionNumber. */
  revision?: string;
  currentVersion?: boolean;
  page_number: number | null;
  slide_number: number | null;
  section_path: string | null;
  quote: string;
  status?: Verification | null;
  /** Shown instead of a verification status (e.g. a verifier-selected mapping). */
  origin?: string;
  note?: string;
};

export type EvidenceRequest = { claim: string; kind: string; items: EvidenceView[] };

export function fromEvidence(e: Evidence): EvidenceView {
  return {
    key: e.id,
    documentId: e.resource_id,
    resourceTitle: e.resource_title,
    resourceType: e.resource_type,
    versionNumber: e.version_number,
    currentVersion: e.current_version,
    page_number: e.page_number,
    slide_number: e.slide_number,
    section_path: e.section_path,
    quote: e.quote,
    status: e.verification_status,
    note: !e.model
      ? undefined
      : isFixture(e.model)
        ? "From an authored fixture answer replayed offline (not live model output); the quote was checked against the document by the evidence gate."
        : `Extracted by ${e.model} (${e.prompt_version ?? "recorded prompt"}); checked against the document by the evidence gate.`,
  };
}

export function fromSource(s: SourceQuote): EvidenceView {
  return {
    key: `${s.source_span_id}:${s.quote}`,
    resourceTitle: s.resource_title,
    versionNumber: s.version_number,
    page_number: s.page_number,
    slide_number: s.slide_number,
    section_path: s.section_path,
    quote: s.quote,
    status: null,
    origin: "Source text",
  };
}

const Context = createContext<(request: EvidenceRequest) => void>(() => {});

export function useEvidence(): (request: EvidenceRequest) => void {
  return useContext(Context);
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EvidenceRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!request) return;
    // Focus the drawer, and give focus back to what opened it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [request, close]);
  const documents = request ? [...new Map(request.items.filter((i) => i.documentId).map((i) => [i.documentId, i])).values()] : [];
  return (
    <Context.Provider value={setRequest}>
      {children}
      {request && (
        <div className="scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <aside role="dialog" aria-modal="true" aria-label="Evidence" className="drawer" data-testid="evidence-drawer">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="overline">{request.kind}</p>
                <h2 className="section-title" data-testid="evidence-claim">{request.claim}</h2>
              </div>
              <button ref={closeButton} type="button" onClick={close} className="icon-btn" aria-label="Close">
                <Icon name="x" size={16} />
              </button>
            </div>
            <p className="overline -mb-2">
              {request.items.length === 1 ? "Exact source excerpt" : `Exact source excerpts (${request.items.length})`}
            </p>
            <ol className="m-0 flex list-none flex-col gap-5 p-0">
              {request.items.map((item) => (
                <li key={item.key} data-testid="evidence-item" className="flex flex-col gap-4">
                  <blockquote className="quote-block source-quote m-0" data-testid="evidence-quote">{item.quote}</blockquote>
                  <dl className="meta">
                    <dt>Document</dt>
                    <dd className="text-ink">{item.resourceTitle}</dd>
                    {item.resourceType && (<><dt>Type</dt><dd>{RESOURCE_LABELS[item.resourceType] ?? item.resourceType}</dd></>)}
                    <dt>Location</dt>
                    <dd className="font-medium text-ink" data-testid="evidence-locator">{locator(item)}</dd>
                    {item.section_path && item.slide_number === null && item.page_number !== null && (
                      <><dt>Section</dt><dd>{item.section_path}</dd></>
                    )}
                    <dt>Revision</dt>
                    <dd>
                      {item.revision ?? revisionLabel(item.versionNumber)}
                      {item.currentVersion === false && <span className="text-review"> (superseded by a later revision)</span>}
                      {item.currentVersion === true && <span className="text-muted"> (current)</span>}
                    </dd>
                    <dt>Status</dt>
                    <dd>
                      {item.status ? <StatusBadge status={item.status} /> : <span className="badge badge-neutral">{item.origin ?? "Source text"}</span>}
                    </dd>
                  </dl>
                  {item.note && (
                    <div className="notice notice-neutral"><Icon name="info" /><span>{item.note}</span></div>
                  )}
                </li>
              ))}
            </ol>
            {documents.map((item) => (
              <Link key={item.documentId} href={`/documents/${item.documentId}`} onClick={close} className="btn btn-quiet self-start">
                <Icon name="file" size={15} />Open {item.resourceTitle}
              </Link>
            ))}
          </aside>
        </div>
      )}
    </Context.Provider>
  );
}

export function StatusBadge({ status }: { status: Verification }) {
  return status === "verified" ? (
    <span className="badge badge-verified"><Icon name="check" size={11} strokeWidth={2.6} />Verified</span>
  ) : (
    <span className="badge badge-review">Needs review</span>
  );
}

/** A button that opens the evidence viewer. */
export function EvidenceButton({ request, label = "View evidence", primary = false }: {
  request: EvidenceRequest;
  label?: string;
  primary?: boolean;
}) {
  const open = useEvidence();
  if (request.items.length === 0) return null;
  return (
    <button type="button" onClick={() => open(request)} className={primary ? "btn btn-primary" : "evidence-button"}>
      <Icon name="quote" size={14} />
      {label}
    </button>
  );
}
