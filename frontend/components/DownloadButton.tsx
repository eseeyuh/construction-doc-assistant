/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import { type MouseEvent, useState } from "react";

import { Icon } from "@/components/Icon";
import { api, ApiError } from "@/lib/api";

/** Hands a file to the browser as a download. The temporary object URL is
 * released once the browser has taken the file. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Downloads one stored revision through the authenticated file endpoint.
 * `file` may supply bytes already fetched for that same revision. */
export function DownloadButton({ documentId, revisionId, fileName, file, testId }: {
  documentId: string;
  revisionId: string;
  fileName: string;
  file?: Blob | null;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(event: MouseEvent) {
    event.stopPropagation(); // inside clickable table rows
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      saveFile(file ?? await api.revisionFile(documentId, revisionId), fileName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className="icon-btn has-tip" onClick={download} disabled={busy} data-testid={testId}
        aria-label={`Download document ${fileName}`} data-tip={error ? "Download failed" : "Download document"}>
        <Icon name={busy ? "refresh" : "download"} size={16} className={busy ? "spinner" : undefined} />
      </button>
      {error && <span role="alert" className="text-[12px] leading-4 text-conflict">Download failed: {error}</span>}
    </span>
  );
}
