"use client";

import { cloneElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";

type Props = {
  active: boolean;
  narrow: boolean;
  scope: string;
  sidebar: ReactNode;
  onFocusChat: () => void;
  children: ReactElement<{ inert?: boolean }>;
};

function invalidateOwnedMenus(panel: HTMLElement | null) {
  if (!panel) return;
  for (const control of panel.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]')) {
    const popup = document.getElementById(control.getAttribute("aria-controls") ?? "");
    if (!popup?.matches(".session-item-menu[role=menu]")) continue;
    // Make the body portal noninteractive in this layout commit, then let its
    // persistent owner clear menuOpen before the next paint.
    popup.hidden = true;
    popup.inert = true;
  }
  panel.dispatchEvent(new window.Event("edupi-chat-sidebar-invalidated"));
}

/** Keep the list and composer in fixed slots while the narrow list is hidden. */
export function EduPiChatSidebarFrame({ active, narrow, scope, sidebar, onFocusChat, children }: Props) {
  const context = useMemo(() => ({ active, narrow, scope }), [active, narrow, scope]);
  const [revealed, setRevealed] = useState<typeof context | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previousContext = useRef(context);
  const preserveListFocus = active && narrow && previousContext.current.active && !previousContext.current.narrow
    && previousContext.current.scope === scope
    && typeof document !== "undefined" && Boolean(sidebarRef.current?.contains(document.activeElement));
  const foreground = active && narrow && (revealed === context || preserveListFocus);
  const visible = active && (!narrow || foreground);
  const focusRequest = useRef<{ context: typeof context; target: "trigger" | "chat"; from: Element | null } | null>(null);
  const focusFrame = useRef(0);
  const live = useRef({ context, foreground, onFocusChat });
  live.current = { context, foreground, onFocusChat };

  const dismiss = useCallback((target?: "trigger" | "chat") => {
    const current = live.current;
    invalidateOwnedMenus(sidebarRef.current);
    cancelAnimationFrame(focusFrame.current);
    focusRequest.current = target && current.foreground
      ? { context: current.context, target, from: document.activeElement } : null;
    setRevealed(null);
  }, []);
  useModalDismiss<HTMLElement>(() => dismiss("trigger"), foreground, sidebarRef, false, ".session-item-menu[role=menu]");

  useLayoutEffect(() => {
    if (previousContext.current !== context || !visible) invalidateOwnedMenus(sidebarRef.current);
    previousContext.current = context;
    if (preserveListFocus) setRevealed(context);
  }, [context, preserveListFocus, visible]);

  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request || foreground) return;
    focusRequest.current = null;
    if (request.context !== context || !active || !narrow) return;
    const from = request.from;
    const eligible = () => {
      const current = live.current;
      const focused = document.activeElement;
      return current.context === request.context && !current.foreground && !document.hidden
        && (focused === from || focused === document.body || focused === document.documentElement)
        && (request.target === "trigger" || !document.querySelector('[aria-modal="true"]'));
    };
    if (request.target === "trigger") {
      if (eligible()) triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    const cancelMovedFocus = (event: FocusEvent) => {
      if (event.target !== from && event.target !== document.body && event.target !== document.documentElement) {
        cancelAnimationFrame(focusFrame.current);
        document.removeEventListener("focusin", cancelMovedFocus);
      }
    };
    document.addEventListener("focusin", cancelMovedFocus);
    focusFrame.current = requestAnimationFrame(() => {
      document.removeEventListener("focusin", cancelMovedFocus);
      if (!eligible()) return;
      live.current.onFocusChat();
    });
    return () => {
      cancelAnimationFrame(focusFrame.current);
      document.removeEventListener("focusin", cancelMovedFocus);
    };
  }, [active, context, foreground, narrow]);

  useEffect(() => {
    const selected = () => dismiss("chat");
    const action = () => dismiss("trigger");
    window.addEventListener("edupi-session-navigated", selected);
    window.addEventListener("edupi-chat-sidebar-action", action);
    return () => {
      window.removeEventListener("edupi-session-navigated", selected);
      window.removeEventListener("edupi-chat-sidebar-action", action);
      cancelAnimationFrame(focusFrame.current);
    };
  }, [dismiss]);

  return <>
    <aside ref={sidebarRef} id="edupi-chat-sidebar" data-session-popup-owner className={`edupi-chat-session-sidebar${foreground ? " is-foreground" : ""}`} hidden={!visible} inert={!visible}
      role={foreground ? "dialog" : undefined} aria-modal={foreground ? "true" : undefined} aria-label="对话与文件">
      <header className="edupi-chat-sidebar-header"><strong>对话与文件</strong><button type="button" data-autofocus onClick={() => dismiss("trigger")} aria-label="收起对话与文件" title="收起对话与文件">×</button></header>
      <div className="edupi-chat-session-sidebar__content">{sidebar}</div>
    </aside>
    {foreground ? <button type="button" className="edupi-chat-sidebar-backdrop" tabIndex={-1} aria-label="关闭对话与文件" onClick={() => dismiss("trigger")} /> : null}
    <button ref={triggerRef} type="button" className="edupi-chat-sidebar-trigger" hidden={!active || !narrow || foreground} inert={!active || !narrow || foreground}
      aria-label="显示对话与文件" title="显示对话与文件" aria-controls="edupi-chat-sidebar" aria-expanded={foreground} onClick={() => { focusRequest.current = null; setRevealed(context); }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg><span>对话与文件</span>
    </button>
    {cloneElement(children, { inert: children.props.inert || foreground })}
  </>;
}
