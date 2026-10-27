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
 *
 * Attach the returned ref to the dialog panel element (not the backdrop).
 */
export function useModalDismiss<T extends HTMLElement = HTMLDivElement>(
  onDismiss: () => void,
  enabled = true,
  externalContainerRef?: RefObject<T | null>,
  restoreFocus = true,
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost() || event.defaultPrevented) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = containerRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !isHiddenByClosedDetails(el) && (el.offsetParent !== null || el === document.activeElement));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const activeInside = active !== null && panel.contains(active);
      if (event.shiftKey) {
        if (!activeInside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!activeInside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (restoreFocus) previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [enabled, containerRef, restoreFocus]);

  return containerRef;
}
