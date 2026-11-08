/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// A few stroke icons, drawn inline so the interface needs no icon package.
// Decorative only: every icon sits next to text that says the same thing.

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  grid: "M4.5 3h4A1.5 1.5 0 0 1 10 4.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5v-4A1.5 1.5 0 0 1 4.5 3zM15.5 3h4A1.5 1.5 0 0 1 21 4.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 8.5v-4A1.5 1.5 0 0 1 15.5 3zM4.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-4A1.5 1.5 0 0 1 4.5 14zM15.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  building: "M4 21V8l8-5 8 5v13M9 21v-5h6v5M9 11h.01M15 11h.01",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5.9-3.6 14.1-3.5-.9",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
  switch: "M7 7h12l-3-3M17 17H5l3 3",
  sparkles: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  check: "M4 12.5l5 5L20 6.5",
  checkCircle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l3 3 5-6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  chevronRight: "M9 5l7 7-7 7",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 3v5h5M4 13a8 8 0 0 0 14.3 4.9L20 16M20 21v-5h-5",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14l2 2 4-4",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  panel: "M4 5h16v14H4zM9.5 5v14",
  quote: "M6 8h4v4c0 2-1 3.5-3 4.5M14 8h4v4c0 2-1 3.5-3 4.5",
  x: "M6 6l12 12M18 6 6 18",
  send: "M12 19V5M5.5 11.5 12 5l6.5 6.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "", strokeWidth = 1.8 }: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The mark (an accent tile with a checked document) and, unless ``compact``,
 * the wordmark. */
export function Logo({ compact = false, size = 32 }: { compact?: boolean; size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <span className="rail-logo" style={{ width: size, height: size, borderRadius: size > 32 ? 10 : 8 }}>
        <Icon name="doc" size={Math.round(size * 0.56)} strokeWidth={1.8} />
      </span>
      {!compact && <span className="section-title">Construction Document Assistant</span>}
    </span>
  );
}
