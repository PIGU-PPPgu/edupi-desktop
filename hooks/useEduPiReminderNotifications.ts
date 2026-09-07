"use client";
import { useEffect } from "react";
import { desktopNotificationsEnabled, notifyDesktop } from "@/lib/desktop-notify";
import { isTauriDesktop } from "@/lib/desktop-updater";

export function useEduPiReminderNotifications() {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const notify = isTauriDesktop() && desktopNotificationsEnabled() && !document.hasFocus();
        const response = await fetch("/api/edupi/reminders", {
          signal: controller.signal,
          ...(notify ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "*", type: "claim_notifications" }) } : {}),
        });
        if (!response.ok) return;
        const result = await response.json();
        if (controller.signal.aborted) return;
        const items = result.notifications || [];
        if (items.length) await notifyDesktop({ title: "EduPi 提醒", body: items.length === 1 ? `${items[0].title}，请查看提醒` : `${items.length} 项待处理，请查看提醒` });
      } catch { /* Persistent inbox remains available after network or notification failure. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 30000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
}
