"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { observeTeacherUsage, type UsageObservation, type UsageObservationTarget } from "@/lib/edupi-usage-observation";

export const EduPiArtifactUsageContext = createContext<{ target: UsageObservationTarget; filePath: string } | null>(null);
export function useArtifactUsageTarget(filePath: string) {
  const binding = useContext(EduPiArtifactUsageContext);
  return binding?.filePath.replaceAll("\\", "/") === filePath.replaceAll("\\", "/") ? binding.target : null;
}

export function useUsageVisibility<T extends HTMLElement = HTMLDivElement>(input: UsageObservation) {
  const ref = useRef<T | null>(null);
  const target = input.target;
  const kind = target?.kind, targetId = target?.targetId, revision = target?.expectedRevision, fingerprint = target?.expectedFingerprint;
  const { action, surface } = input;
  useEffect(() => {
    const element = ref.current;
    if (!element || !kind || !targetId || !isTauriDesktop() || typeof IntersectionObserver === "undefined") return;
    let intersecting = false, counted = false, observing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const count = () => {
      if (!intersecting || counted || observing || document.visibilityState !== "visible") return;
      observing = true;
      void observeTeacherUsage({ target: { kind, targetId, expectedRevision: revision, expectedFingerprint: fingerprint }, action, surface, once: true })
        .then(result => { counted = result === "recorded"; }).finally(() => { observing = false; });
    };
    const schedule = () => { clearTimeout(timer); if (intersecting && document.visibilityState === "visible") timer = setTimeout(count, 250); };
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio > 0);
      schedule();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("edupi-teacher-usage-updated", schedule);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); window.removeEventListener("edupi-teacher-usage-updated", schedule); };
  }, [kind, targetId, revision, fingerprint, action, surface]);
  return ref;
}

export function EduPiUsageVisibility({ target, action, surface, className, children }: UsageObservation & { className?: string; children: ReactNode }) {
  const ref = useUsageVisibility({ target, action, surface });
  return <div ref={ref} className={className}>{children}</div>;
}

export function EduPiUsageArticle({ target, action, surface, className, children }: UsageObservation & { className?: string; children: ReactNode }) {
  const ref = useUsageVisibility<HTMLElement>({ target, action, surface });
  return <article ref={ref} className={className}>{children}</article>;
}
