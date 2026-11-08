/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The background: slow, low-contrast flowing ribbons behind every screen.
// Decorative only (aria-hidden, no pointer events) and still when the viewer
// prefers reduced motion. Periods divide 1440 so the 200%-wide drawing loops
// without a seam.

function ribbon(base: number, amp: number, period: number, phase: number, thick: number, amp2: number, phase2: number): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let x = 0; x <= 2880; x += 24) {
    const t = (2 * Math.PI * x) / period;
    top.push(`${x},${(base + amp * Math.sin(t + phase)).toFixed(1)}`);
    bottom.push(`${x},${(base + thick + amp2 * Math.sin(t + phase2)).toFixed(1)}`);
  }
  return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
}

function line(base: number, amp: number, period: number, phase: number): string {
  const points: string[] = [];
  for (let x = 0; x <= 2880; x += 24) {
    points.push(`${x},${(base + amp * Math.sin((2 * Math.PI * x) / period + phase)).toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
}

const BAND_A = ribbon(430, 90, 1440, 0, 170, 60, 0.9);
const BAND_B = ribbon(470, 55, 720, 1.7, 160, 60, 2.6);
const LINES = [0, 0.35, 0.7, 1.05, 1.4].map((phase, i) => line(440 + i * 14, 70 - i * 6, 1440, phase));

export function Waves() {
  return (
    <div className="waves" aria-hidden="true">
      <div className="wave-layer">
        <svg viewBox="0 0 2880 900" preserveAspectRatio="none"><path d={BAND_A} fill="var(--wave-band)" /></svg>
      </div>
      <div className="wave-layer">
        <svg viewBox="0 0 2880 900" preserveAspectRatio="none"><path d={BAND_B} fill="var(--wave-band-2)" /></svg>
      </div>
      <div className="wave-layer">
        <svg viewBox="0 0 2880 900" preserveAspectRatio="none">
          {LINES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--wave-line)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
    </div>
  );
}
