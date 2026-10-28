"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { EduPiSidebarIcon } from "./EduPiSidebarIcon";

export function objectNavigationLayout({ collapsed, narrow, revealedView, view }: {
  collapsed: boolean; narrow: boolean; revealedView: string | null; view: string;
}) {
  const revealed = revealedView === view;
  return {
    collapsed: narrow ? !revealed : collapsed,
    foreground: narrow && revealed,
  };
}

export function findObjectNavigationHeader(root: HTMLElement, narrow: boolean): HTMLElement | null {
  const selectors = narrow
    ? [".edupi-student-drawer > header", ".edupi-calendar-detail > header", "[role='dialog'] > header", ".edupi-module-heading, .edupi-task-workspace__header, .edupi-c1-review__heading, .edupi-c1-review-task-bridge__heading", "main > header"]
    : [".edupi-module-heading, .edupi-task-workspace__header, .edupi-c1-review__heading, .edupi-c1-review-task-bridge__heading", "main > header"];
  for (const selector of selectors) {
    for (const header of root.querySelectorAll<HTMLElement>(selector)) {
      if (!header.closest("[hidden], [aria-hidden='true']") && header.getClientRects().length > 0) return header;
    }
  }
  return null;
}

export function canRestoreObjectNavigationFocus(from: Element | null, document: Pick<Document, "activeElement" | "body">): boolean {
  return document.activeElement === from || document.activeElement === document.body;
}

export type ObjectNavigationFocusRequest = { target: "restore" | "list"; from: Element | null };

export function restoreObjectNavigationFocus(request: ObjectNavigationFocusRequest | null, {
  document, collapsed, restoreButton, collapseButton, scroll, scrollTop,
}: {
  document: Pick<Document, "activeElement" | "body">;
  collapsed: boolean;
  restoreButton: HTMLButtonElement | null;
  collapseButton: HTMLButtonElement | null;
  scroll: HTMLElement | null;
  scrollTop: number;
}): ObjectNavigationFocusRequest | null {
  if (!request || !canRestoreObjectNavigationFocus(request.from, document)) return null;
  const target = request.target === "restore" ? restoreButton : collapseButton;
  if (!target || (request.target === "list" && collapsed)) return request;
  if (request.target === "list" && scroll) scroll.scrollTop = scrollTop;
  target.focus({ preventScroll: true });
  // Keep the fallback usable while an asynchronously loaded heading arrives.
  if (request.target === "restore" && !target.closest("[data-object-navigation-toolbar]")) return { ...request, from: target };
  return null;
}

export function EduPiObjectNavigationRestore({ rootRef, buttonRef, view, onExpand, onReady }: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  view: string;
  onExpand: () => void;
  onReady: () => void;
}) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const media = window.matchMedia("(max-width: 820px)");
    let current: HTMLElement | null | undefined;
    const locate = () => {
      const next = findObjectNavigationHeader(root, media.matches);
      if (next === current) return;
      current?.removeAttribute("data-object-navigation-toolbar");
      current = next;
      current?.setAttribute("data-object-navigation-toolbar", "");
      setHeader(next);
    };
    const observer = new MutationObserver(locate);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden"] });
    media.addEventListener("change", locate);
    locate();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", locate);
      current?.removeAttribute("data-object-navigation-toolbar");
    };
  }, [rootRef, view]);

  useEffect(() => { onReady(); }, [header, onReady]);

  const button = <button ref={buttonRef} type="button" className="edupi-object-navigation-restore" onClick={onExpand} aria-label="展开列表" title="展开列表" aria-controls="edupi-object-navigation" aria-expanded={false}><EduPiSidebarIcon expanded={false} />{header ? null : <span>查看列表</span>}</button>;
  return header ? createPortal(button, header) : <div className="edupi-object-navigation-fallback">{button}</div>;
}
