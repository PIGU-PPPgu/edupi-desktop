"use client";

import { useEffect } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { announceEduPiCloudStatus, EDUPI_CLOUD_STATUS_CHANGED, type EduPiCloudStatus } from "@/lib/edupi-cloud-events";

export function EduPiCloudSync() {
  useEffect(() => {
    let stopped = false;
    let status: EduPiCloudStatus | null = null;
    let revision = 0;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (!stopped && status?.mode === "cloud" && document.visibilityState !== "hidden") {
        timer = setTimeout(() => { void run(true); }, 15_000);
      }
    };
    const run = async (sync: boolean) => {
      if (stopped || request || document.visibilityState === "hidden") return;
      clear();
      const controller = new AbortController();
      const captured = revision;
      request = controller;
      const current = () => !stopped && request === controller && revision === captured;
      const deadline = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetchDesktopApi("/api/edupi/cloud", {
          cache: "no-store",
          signal: controller.signal,
          ...(sync ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync" }),
          } : {}),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "同步状态暂不可用。");
        if (!current() || controller.signal.aborted) return;
        announceEduPiCloudStatus(result as EduPiCloudStatus);
        if (sync && result.flushed > 0) window.dispatchEvent(new Event("edupi-education-refresh"));
      } catch (error) {
        if (current() && status) {
          announceEduPiCloudStatus({
            ...status,
            error: {
              code: "sync_unavailable",
              message: controller.signal.aborted ? "同步请求超时，待同步记录已保留。"
                : error instanceof TypeError ? "无法连接云端，待同步记录已保留。"
                  : error instanceof Error ? error.message : "同步状态暂不可用。",
            },
          });
        }
      } finally {
        clearTimeout(deadline);
        if (request === controller) request = null;
        schedule();
      }
    };
    const changed = (event: Event) => {
      status = (event as CustomEvent<EduPiCloudStatus>).detail;
      revision++;
      schedule();
    };
    const resume = () => {
      clear();
      if (status?.mode === "cloud") void run(true);
      else if (!status) void run(false);
    };
    window.addEventListener(EDUPI_CLOUD_STATUS_CHANGED, changed);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    void run(false);
    return () => {
      stopped = true;
      clear();
      request?.abort();
      window.removeEventListener(EDUPI_CLOUD_STATUS_CHANGED, changed);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return null;
}
