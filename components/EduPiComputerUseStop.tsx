"use client";

import { useEffect, useState } from "react";
import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "@/lib/app-prefs";
import { emergencyStopComputerUseNative } from "@/lib/desktop-computer-use";
import { isTauriDesktop } from "@/lib/desktop-updater";

export const COMPUTER_USE_CHANGED_EVENT = "edupi-computer-use-changed";

export function announceComputerUseChanged(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(COMPUTER_USE_CHANGED_EVENT, { detail: enabled }));
}

export function EduPiComputerUseStop() {
  const [enabled, setEnabled] = useState(() => isTauriDesktop() && getPrefBool(APP_PREF_KEYS.computerUseEnabled, false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const update = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail === true);
    window.addEventListener(COMPUTER_USE_CHANGED_EVENT, update);
    return () => window.removeEventListener(COMPUTER_USE_CHANGED_EVENT, update);
  }, []);

  if (!enabled) return null;
  return <button type="button" className="edupi-computer-stop" disabled={busy} title={error ? "原生急停失败，请重试" : undefined} onClick={() => {
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
  }}><span aria-hidden="true" />{busy ? "正在停止…" : error ? "停止失败，重试" : "停止桌面控制"}</button>;
}
