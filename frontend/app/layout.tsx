/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Metadata } from "next";

import { DemoAuthGate } from "@/components/DemoAuth";
import { DemoProgress, ResetConfirmProvider, TopBar } from "@/components/DemoControls";
import { DemoStateProvider } from "@/components/DemoState";
import { EvidenceProvider } from "@/components/Evidence";
import { Sidebar } from "@/components/Nav";
import { Waves } from "@/components/Waves";

import "./globals.css";

export const metadata: Metadata = {
  title: "Construction Document Assistant",
  description: "Source-grounded requirements from construction project documents (local prototype).",
};

// Geist and Geist Mono (SIL Open Font Licence) load from Google Fonts at view
// time; the build never needs the network, and an offline viewer gets the
// system fallbacks named in globals.css.
const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&display=swap";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body className="min-h-full">
        <Waves />
        <DemoStateProvider>
          <DemoAuthGate>
            <EvidenceProvider>
              <ResetConfirmProvider>
                <div className="app-shell">
                  <Sidebar />
                  <div className="app-main">
                    <main className="content">
                      <DemoProgress />
                      {children}
                    </main>
                  </div>
                  <TopBar />
                </div>
              </ResetConfirmProvider>
            </EvidenceProvider>
          </DemoAuthGate>
        </DemoStateProvider>
      </body>
    </html>
  );
}
