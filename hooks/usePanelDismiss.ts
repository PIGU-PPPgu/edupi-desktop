"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useModalDismiss } from "./useModalDismiss";

/** Visual docking and foreground focus ownership are independent. */
export function usePanelDismiss<T extends HTMLElement>(onClose: () => void, docked: boolean, enabled = true, focusSuspended = false) {
  const openedRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  if (enabled && !openedRef.current) {
    openerRef.current = typeof document === "undefined" ? null : document.activeElement as HTMLElement | null;
  }
  openedRef.current = enabled;
  // Once another surface takes the foreground, layout changes must preserve
  // the user's current focus until these details are closed and opened again.
  const autoFocusRef = useRef(true);
  if (!enabled) autoFocusRef.current = true;
  else if (focusSuspended) autoFocusRef.current = false;
  const panelRef: RefObject<T | null> = useModalDismiss<T>(onClose, enabled && !docked && !focusSuspended, undefined, false, undefined, {
    autoFocus: autoFocusRef.current,
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    const opener = openerRef.current;
    // One opener belongs to the entire open cycle. Layout and preview changes
    // cannot replace it with an editor inside the details that later unmounts.
    return () => {
      if (opener?.isConnected && !panel?.contains(opener)
        && (panel?.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [enabled, panelRef]);
  useEffect(() => {
    if (!enabled || (!docked && !focusSuspended)) return;
    const panel = panelRef.current;
    if (autoFocusRef.current) panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (!panel?.contains(document.activeElement)) return;
      if (document.activeElement?.closest('[aria-modal="true"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [docked, enabled, focusSuspended, panelRef]);
  return panelRef;
}
