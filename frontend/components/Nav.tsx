/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import { initials, signOut, useDemoSession } from "@/components/DemoAuth";
import { useApi } from "@/components/DemoState";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { projectCode, projectName } from "@/lib/format";
import { isActive, NAV_ITEMS } from "@/lib/navigation";

type Tip = { text: string; y: number } | null;

/** The workspace rail: product areas, the projects the API holds for this
 * identity, and the signed-in demo identity. A 64px icon rail at every width;
 * it expands over the content on mouse hover (after a short delay), while a
 * keyboard user moves through it, or when the brand button pins it open (the
 * way to open it on touch screens). Labels stay in the accessibility tree
 * when collapsed; mouse users get a tooltip instead. */
export function Sidebar() {
  const path = usePathname();
  const session = useDemoSession();
  const projects = useApi(api.projects, "nav-projects");
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement>(null);
  const open = hovered || pinned || keyboard;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!pinned) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pinned]);

  const onEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setHovered(true); setTip(null); }, 260);
  };
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    setHovered(false);
    setTip(null);
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) setKeyboard(true);
  };
  const onBlur = (event: FocusEvent) => {
    if (!ref.current?.contains(event.relatedTarget as Node | null)) setKeyboard(false);
  };
  const tipFor = (text: string) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (open || event.pointerType !== "mouse") return;
      const r = event.currentTarget.getBoundingClientRect();
      setTip({ text, y: r.top + r.height / 2 });
    },
    onPointerLeave: () => setTip(null),
  });
  const navigated = () => { setPinned(false); setTip(null); };

  return (
    <>
      <aside ref={ref} aria-label="Workspace" className={`rail${open ? " expanded" : ""}`} data-testid="sidebar"
        onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onFocus} onBlur={onBlur}>
        <button type="button" className="rail-item rail-brand" aria-expanded={open}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"} data-testid="sidebar-toggle"
          onClick={() => { setPinned(!open); if (open) { setHovered(false); setKeyboard(false); } }}
          {...tipFor("Construction Document Assistant")}>
          <span className="rail-logo"><Icon name="doc" size={18} /></span>
          <span className="lbl">Construction Document Assistant</span>
        </button>

        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="rail-item" onClick={navigated}
              aria-current={isActive(item.href, path) ? "page" : undefined} {...tipFor(item.label)}>
              <Icon name={item.icon} size={20} strokeWidth={1.6} />
              <span className="lbl">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex min-h-0 flex-col gap-2">
          <span className="overline lbl px-2.5">{projects.data && projects.data.length === 1 ? "Project" : "Projects"}</span>
          <div className="scrollbar-thin flex min-h-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
            {projects.data?.map((p) => {
              const code = projectCode(p.title, p.external_id);
              const name = projectName(p.title);
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="rail-item rail-project" onClick={navigated}
                  aria-current={path === `/projects/${p.id}` ? "page" : undefined} aria-label={`Project ${code} · ${name}`}
                  {...tipFor(`${code} · ${name}`)}>
                  <Icon name="building" size={20} strokeWidth={1.6} />
                  <span className="lbl flex flex-col gap-0.5">
                    <span className="mono text-[12px] leading-4 text-muted">{code}</span>
                    <span className="truncate text-[13px] leading-[18px] font-medium text-ink">{name}</span>
                  </span>
                </Link>
              );
            })}
            {projects.data === undefined && projects.state === "loading" && (
              <span aria-hidden className="skeleton mx-1.5 block h-8 w-8" />
            )}
            {projects.data?.length === 0 && <span className="lbl px-2.5 text-[12px] text-faint">No projects loaded</span>}
            {projects.state === "error" && <span className="lbl px-2.5 text-[12px] text-conflict">Projects could not be loaded</span>}
          </div>
        </div>

        {session && (
          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4" data-testid="identity-badge">
            <div className="flex items-center gap-2.5 pl-1" {...tipFor(`${session.identity.name} · demo identity`)}>
              <span className="rail-avatar" aria-hidden>{initials(session.identity.name)}</span>
              <span className="lbl flex flex-col">
                <span className="text-[13px] leading-[18px] font-[550] text-ink" data-testid="identity-name">{session.identity.name}</span>
                <span className="text-[12px] leading-4 text-muted">Demo identity · not real authentication</span>
              </span>
            </div>
            <button type="button" className="rail-item" onClick={() => { setPinned(false); signOut(); }}
              data-testid="sign-out" aria-label="Switch identity" {...tipFor("Switch identity")}>
              <Icon name="switch" size={20} strokeWidth={1.6} />
              <span className="lbl">Switch identity</span>
            </button>
          </div>
        )}
      </aside>
      {tip && !open && <div className="rail-tip" role="tooltip" style={{ top: tip.y }}>{tip.text}</div>}
    </>
  );
}
