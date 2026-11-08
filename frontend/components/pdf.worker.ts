/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The PDF.js worker, bundled from the installed pdfjs-dist so its version
// always matches the library. Loaded in a Web Worker, it starts listening on
// its own message port.
import "pdfjs-dist/build/pdf.worker.min.mjs";
