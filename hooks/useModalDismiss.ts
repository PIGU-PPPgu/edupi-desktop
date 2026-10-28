"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function isHiddenByClosedDetails(element: Element): boolean {
  // WebKit can retain offsetParent for content hidden by a closed details.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName !== "DETAILS" || parent.hasAttribute("open")) continue;
    const summary = Array.from(parent.children).find((child) => child.tagName === "SUMMARY");
    if (!summary?.contains(element)) return true;
  }
  return false;
}

// Stack of mounted modals — only the topmost one reacts to Escape/Tab so
// nested dialogs (e.g. provider picker above the models settings) close
// one layer at a time.
const modalStack: symbol[] = [];

/**
 * Dialog dismissal + focus management shared by all modals:
 * - Escape calls `onDismiss` (topmost modal only)
 * - Tab is trapped inside the returned container
 * - focus moves into the dialog on mount and back to the opener on unmount
 *   unless the caller owns return focus with `restoreFocus = false`
 * - opt-in owned portals join the Tab cycle and handle their own Escape;
 *   an expanded control inside the panel must explicitly reference their id
 * - portal owners may synchronously query the registered topmost modal before
 *   consuming a key, even when focus has escaped that modal
 *
 * Attach the returned ref to the dialog panel element (not the backdrop).
 */
export function useModalDismiss<T extends HTMLElement = HTMLDivElement>(
  onDismiss: () => void,
  enabled = true,
  externalContainerRef?: RefObject<T | null>,
  restoreFocus = true,
  ownedPopupSelector?: string,
) {
  const internalContainerRef = useRef<T | null>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("modal");
    modalStack.push(id);

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (container && !container.contains(document.activeElement)) {
      const target = container.querySelector<HTMLElement>("[data-autofocus]")
        ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? container;
      if (target === container) container.tabIndex = -1;
      target.focus({ preventScroll: true });
    }

    const isTopmost = () => modalStack[modalStack.length - 1] === id;
    const handleKeyboardOwner = (event: Event) => {
      const owner = (event as CustomEvent<HTMLElement | null>).detail;
      if (!owner || !isTopmost()) return;
      if (!containerRef.current?.contains(owner)) event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost() || event.defaultPrevented) return;
      if (event.key !== "Escape" && event.key !== "Tab") return;
      const panel = containerRef.current;
      const ownedPopups: HTMLElement[] = [];
      if (panel && ownedPopupSelector) {
        for (const control of panel.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]')) {
          for (const popupId of control.getAttribute("aria-controls")?.split(/\s+/) ?? []) {
            const popup = document.getElementById(popupId);
            if (popup?.matches(ownedPopupSelector) && !popup.hidden && !panel.contains(popup) && !ownedPopups.includes(popup)) ownedPopups.push(popup);
          }
        }
      }

      if (event.key === "Escape") {
        if (ownedPopups.length > 0) return;
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
        return;
      }

      if (!panel) return;
      const scopes = [panel, ...ownedPopups].map((root) => ({ root,
        controls: Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .filter((el) => !isHiddenByClosedDetails(el) && (el.offsetParent !== null || el === document.activeElement)),
      })).filter((scope) => scope.controls.length > 0);
      if (scopes.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const index = scopes.findIndex((scope) => active !== null && scope.root.contains(active));
      const scope = scopes[index];
      const boundary = scope && (event.shiftKey ? scope.controls[0] : scope.controls[scope.controls.length - 1]);
      if (!scope || active === boundary) {
        event.preventDefault();
        const nextIndex = index === -1 ? (event.shiftKey ? scopes.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + scopes.length) % scopes.length;
        const controls = scopes[nextIndex].controls;
        (event.shiftKey ? controls[controls.length - 1] : controls[0]).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("edupi-modal-keyboard-owner", handleKeyboardOwner);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("edupi-modal-keyboard-owner", handleKeyboardOwner);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (restoreFocus) previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [enabled, containerRef, restoreFocus, ownedPopupSelector]);

  return containerRef;
}
