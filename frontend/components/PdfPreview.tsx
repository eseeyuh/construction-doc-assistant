/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/** PDF.js, loaded on first use, with one shared worker bundled from the
 * installed package (so library and worker versions always match). */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist")
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
      return pdfjs;
    })
    .catch((error: unknown) => {
      pdfjsPromise = null;
      throw error;
    });
  return pdfjsPromise;
}

/** Whole words that start with one of the query terms ("inspection" also
 * marks "inspections"). Null when there is nothing to look for. */
function termPattern(terms: string): RegExp | null {
  const words = terms.split(" ").filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})[\\p{L}\\p{N}]*`, "giu") : null;
}

/** Wraps the literal query-word matches in the rendered text layer. Only text
 * that is actually on the page is marked; nothing is added. */
function highlight(divs: HTMLElement[], pattern: RegExp | null): HTMLElement[] {
  const marks: HTMLElement[] = [];
  if (!pattern) return marks;
  for (const div of divs) {
    const text = div.textContent ?? "";
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    const parts: Node[] = [];
    let last = 0;
    for (const match of matches) {
      if (match.index > last) parts.push(document.createTextNode(text.slice(last, match.index)));
      const mark = document.createElement("span");
      mark.className = "pdf-hl";
      mark.dataset.testid = "pdf-highlight";
      mark.textContent = match[0];
      parts.push(mark);
      marks.push(mark);
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
    div.replaceChildren(...parts);
  }
  return marks;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** The actual stored PDF of one revision, rendered with PDF.js at the given
 * page, with the query's words highlighted in its text layer. The file is
 * fetched with the signed-in identity's authorisation; `onFile` receives the
 * same bytes so a download saves exactly the revision on screen. Mount one
 * per revision and page (use a key). */
export function PdfPreview({ documentId, revisionId, page, terms, title, onFile }: {
  documentId: string;
  revisionId: string;
  page: number;
  /** Lower-case query words, space separated. */
  terms: string;
  title: string;
  onFile: (file: Blob) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState<{ page: number; pages: number; marks: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Follow the available width (in steps, so small changes do not re-render).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.floor(entry.contentRect.width / 24) * 24));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch the file and open it.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const file = await api.revisionFile(documentId, revisionId);
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const opened = await task.promise;
        if (cancelled) return;
        setPdf(opened);
        onFile(file);
      } catch (e) {
        if (!cancelled) setError(message(e, "The PDF could not be opened."));
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy(); // also releases the opened document
    };
  }, [documentId, revisionId, onFile]);

  // Render the page, its text layer and the highlights.
  useEffect(() => {
    if (!pdf || width === 0) return;
    let cancelled = false;
    let render: RenderTask | null = null;
    let text: TextLayer | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const number = Math.min(Math.max(1, page), pdf.numPages);
        const pdfPage = await pdf.getPage(number);
        const box = frame.current, paper = canvas.current, layer = textLayer.current, view = scroller.current;
        if (cancelled || !box || !paper || !layer || !view) return;
        const scale = Math.min(width / pdfPage.getViewport({ scale: 1 }).width, 1.75);
        const viewport = pdfPage.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        paper.width = Math.floor(viewport.width * ratio);
        paper.height = Math.floor(viewport.height * ratio);
        box.style.width = `${Math.floor(viewport.width)}px`;
        box.style.height = `${Math.floor(viewport.height)}px`;
        box.style.setProperty("--total-scale-factor", String(scale));
        layer.replaceChildren();
        render = pdfPage.render({ canvas: paper, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
        text = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: layer, viewport });
        await Promise.all([render.promise, text.render()]);
        if (cancelled) return;
        const marks = highlight(text.textDivs, termPattern(terms));
        setShown({ page: number, pages: pdf.numPages, marks: marks.length });
        if (marks[0]) {
          const offset = marks[0].getBoundingClientRect().top - view.getBoundingClientRect().top;
          view.scrollTop += offset - view.clientHeight / 3;
        }
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          setError(message(e, "The page could not be rendered."));
        }
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, width, terms]);

  return (
    <div className="relative" data-testid="pdf-preview">
      <div ref={scroller} className="pdf-scroller" aria-busy={shown === null && error === null}>
        <div ref={frame} className="pdf-page" role="group" aria-label={`${title}, page ${shown?.page ?? page}`}>
          <canvas ref={canvas} data-testid="pdf-canvas" />
          <div ref={textLayer} className="textLayer" />
        </div>
      </div>
      {shown === null && error === null && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-paper" role="status" data-testid="pdf-loading">
          <span className="text-[13px] text-muted">Opening the PDF…</span>
        </div>
      )}
      {error !== null && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-paper p-6" role="alert" data-testid="pdf-error">
          <span className="text-center text-[13px] text-conflict">{error}</span>
        </div>
      )}
      {shown && (
        <p className="sr-only" role="status" data-testid="pdf-status">
          Page {shown.page} of {shown.pages}
          {shown.marks ? `, ${shown.marks} query word match${shown.marks === 1 ? "" : "es"} highlighted` : ", no query words on this page"}
        </p>
      )}
    </div>
  );
}
