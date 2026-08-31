"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when ⌘N (macOS) / Ctrl+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** Open EduPi quick entry from anywhere in the app. */
  onQuickEntry?: () => void;
}

export function isQuickEntryShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">): boolean {
  return !event.isComposing
    && event.key.toLocaleLowerCase() === "k"
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc              – stop the running agent (via module-level abort handler)
 *   ⌘N / Ctrl+N      – create a new session in the active project directory
 *                      (Ctrl+Alt+N still works for backwards familiarity)
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, onQuickEntry } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (isQuickEntryShortcut(e) && onQuickEntry) {
        e.preventDefault();
        onQuickEntry();
        return;
      }
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
        return;
      }

      // ---- ⌘N / Ctrl+N: new session ----
      // Note: regular browsers reserve ⌘N/Ctrl+N for "new window"; this works
      // in the desktop (Tauri) build where the page receives the event.
      if (e.key.toLowerCase() === "n" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession, onQuickEntry]);
}
