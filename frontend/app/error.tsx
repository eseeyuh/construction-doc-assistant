/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

// A page that fails to render shows this instead of a blank screen; the
// navigation and demo controls stay usable. The raw error stays in the
// browser console, never on the page.

import { useEffect } from "react";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <section role="alert" className="panel flex max-w-xl flex-col gap-2 border-conflict-line p-6">
      <p className="overline text-conflict">Something went wrong</p>
      <h1 className="page-title">This page could not be shown</h1>
      <p className="text-ink-soft">
        Something in the project data could not be displayed. Try again; if it persists, use Reset local demo
        to rebuild the demo project.
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference {error.digest}</p>}
      <button type="button" className="btn btn-quiet mt-2 self-start" onClick={reset}>Try again</button>
    </section>
  );
}
