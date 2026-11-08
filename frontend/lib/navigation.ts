/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IconName } from "@/components/Icon";

/** Top-level product areas. */
export const NAV_ITEMS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/projects", label: "Projects", icon: "library" },
  { href: "/changes", label: "Revisions", icon: "history" },
];

/** Whether a top-level item is the current area. Documents belong to projects. */
export function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/projects") return path.startsWith("/projects") || path.startsWith("/documents");
  return path.startsWith(href);
}
