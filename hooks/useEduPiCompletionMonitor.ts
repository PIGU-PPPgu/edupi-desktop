"use client";

import { useEffect } from "react";
import { readEduPiEducation } from "@/lib/edupi-education-client";
import {
  completionSnapshot,
  completionSnapshotSignature,
  diffTaskCompletionTransitions,
  type EduPiCompletionSnapshot,
} from "@/lib/edupi-completion-monitor";
import { notifyDesktop } from "@/lib/desktop-notify";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

function notificationCopy(changes: ReturnType<typeof diffTaskCompletionTransitions>): { title: string; body: string } {
  const ready = changes.filter((item) => item.completion === "ready");
  const failed = changes.filter((item) => item.completion === "failed");
  if (changes.length === 1) {
    const item = changes[0];
    return item.completion === "failed"
      ? { title: "EduPi 需要处理", body: `${item.title} 准备失败` }
      : { title: "EduPi 已完成", body: `${item.title} 已准备好，等待你确认` };
  }
  return {
    title: failed.length > 0 ? "EduPi 有新进展" : "EduPi 已完成",
    body: [`${ready.length} 项已准备`, failed.length > 0 ? `${failed.length} 项需要处理` : ""].filter(Boolean).join(" · "),
  };
}

export function useEduPiCompletionMonitor({
  onRefresh,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  onRefresh: () => void;
  intervalMs?: number;
}): void {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let sequence = 0;
    let baseline: EduPiCompletionSnapshot | null = null;

    const schedule = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void poll(); }, intervalMs);
    };

    const poll = async () => {
      const requestSequence = ++sequence;
      controller?.abort();
      controller = new AbortController();
      try {
        const education = await readEduPiEducation({ signal: controller.signal });
        if (!education || !Array.isArray(education.tasks) || typeof education.workspace !== "string") throw new Error("Invalid education projection");
        if (disposed || requestSequence !== sequence) return;
        const next = completionSnapshot(education.tasks, education.workspace);
        if (baseline === null) {
          baseline = next;
          return;
        }
        const previous = baseline;
        baseline = next;
        if (completionSnapshotSignature(previous) === completionSnapshotSignature(next)) return;
        const changes = diffTaskCompletionTransitions(previous, next);
        onRefresh();
        if (changes.length > 0) void notifyDesktop(notificationCopy(changes));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        if (!disposed && requestSequence === sequence) schedule();
      }
    };

    const refreshNow = () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      void poll();
    };

    void poll();
    window.addEventListener("visibilitychange", refreshNow);
    window.addEventListener("online", refreshNow);
    return () => {
      disposed = true;
      sequence += 1;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("visibilitychange", refreshNow);
      window.removeEventListener("online", refreshNow);
    };
  }, [intervalMs, onRefresh]);
}
