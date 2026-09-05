"use client";

import { useEffect, useState } from "react";
import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "@/lib/app-prefs";
import { emergencyStopComputerUseNative } from "@/lib/desktop-computer-use";
import { isTauriDesktop } from "@/lib/desktop-updater";

export const COMPUTER_USE_CHANGED_EVENT = "edupi-computer-use-changed";
export const COMPUTER_USE_STOP_NOTICE_MS = 4_000;

export function announceComputerUseChanged(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(COMPUTER_USE_CHANGED_EVENT, { detail: enabled }));
}

export function EduPiComputerUseStop() {
  const [enabled, setEnabled] = useState(() => isTauriDesktop() && getPrefBool(APP_PREF_KEYS.computerUseEnabled, false));
  const [visible, setVisible] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const update = (event: Event) => { const next = (event as CustomEvent<boolean>).detail === true; setEnabled(next); setVisible(next); };
    window.addEventListener(COMPUTER_USE_CHANGED_EVENT, update);
    return () => window.removeEventListener(COMPUTER_USE_CHANGED_EVENT, update);
  }, []);
  useEffect(() => {
    if (!enabled || !visible || busy || error) return;
    const timer = window.setTimeout(() => setVisible(false), COMPUTER_USE_STOP_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, enabled, error, visible]);

  if (!enabled) return null;
  return <button type="button" className={`edupi-computer-stop${!visible && !busy && !error ? " is-compact" : ""}`} aria-label="停止桌面控制" disabled={busy} title={error ? "停止失败，点击重试" : "停止桌面控制"} onClick={() => {
    setBusy(true);
    setError(false);
    void emergencyStopComputerUseNative()
      .then(() => {
        setPrefBool(APP_PREF_KEYS.computerUseEnabled, false);
        setEnabled(false);
        announceComputerUseChanged(false);
      })
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }}><span aria-hidden="true" />{busy ? "正在停止…" : error ? "停止失败，重试" : visible ? "停止桌面控制" : null}</button>;
}
