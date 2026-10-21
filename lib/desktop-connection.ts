"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readPackagedServerIdentity, type DesktopConnectionProbeRecord, type DesktopProbeOutcome } from "@/lib/desktop-connection-probe";
import { relaunchAppNative } from "@/lib/desktop-native";

export type DesktopConnectionState = "online" | "offline" | "checking";

const PING_INTERVAL_MS = 8_000;
const OFFLINE_THRESHOLD = 2;
const MAX_PROBE_RECORDS = 8;
type ProbeSettlement = { reachable: boolean; sequence: number };

/** Surface a reconnect banner when the shell-verified local server is unreachable. */
export function useDesktopConnection(enabled = true): {
  state: DesktopConnectionState;
  retry: () => void;
  diagnostics: readonly DesktopConnectionProbeRecord[];
  failureIncident: readonly DesktopConnectionProbeRecord[];
} {
  const [state, setState] = useState<DesktopConnectionState>(enabled ? "checking" : "online");
  const [diagnostics, setDiagnostics] = useState<DesktopConnectionProbeRecord[]>([]);
  const [failureIncident, setFailureIncident] = useState<DesktopConnectionProbeRecord[]>([]);
  const diagnosticsRef = useRef<DesktopConnectionProbeRecord[]>([]);
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeControllerRef = useRef<AbortController | null>(null);
  const instanceIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(true);
  const probeSequenceRef = useRef(0);

  const probe = useCallback(async (): Promise<ProbeSettlement | null> => {
    if (!enabled || stoppedRef.current) return null;

    // Wake/online/timer events can arrive together after sleep. Only the most
    // recent probe may change connection state; otherwise a stale timeout can
    // overwrite a newer successful response and leave the banner stuck.
    probeControllerRef.current?.abort();
    const controller = new AbortController();
    probeControllerRef.current = controller;
    const sequence = ++probeSequenceRef.current;
    const startedAt = Date.now();
    const started = performance.now();
    const visibility = document.visibilityState;
    let timedOut = false;
    let outcome: DesktopProbeOutcome = "network";
    let httpStatus: number | null = null;
    let instance: DesktopConnectionProbeRecord["instance"] = "unavailable";
    const record = (captureIncident = false) => {
      const entry: DesktopConnectionProbeRecord = {
        sequence, startedAt, documentStartedAt: performance.timeOrigin,
        durationMs: Math.max(0, Math.round((performance.now() - started) * 10) / 10),
        visibility, settledVisibility: document.visibilityState, outcome, httpStatus, instance,
      };
      const recent = [...diagnosticsRef.current, entry].slice(-MAX_PROBE_RECORDS);
      diagnosticsRef.current = recent;
      setDiagnostics(recent);
      // Freeze the probes that actually crossed the offline threshold. Later
      // failures and healthy polling must not erase that incident's evidence.
      if (captureIncident) setFailureIncident(recent);
    };
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 4_000);
    try {
      const instanceId = await readPackagedServerIdentity(fetch, controller.signal, response => {
        outcome = response.outcome;
        httpStatus = response.httpStatus;
      });
      if (stoppedRef.current || probeControllerRef.current !== controller) return null;
      if (timedOut) throw new Error("Desktop probe deadline exceeded");
      if (!instanceId) throw new Error("Desktop server identity unavailable");
      if (instanceIdRef.current && instanceIdRef.current !== instanceId) {
        outcome = "identity_mismatch";
        instance = "changed";
        throw new Error("Desktop server identity unavailable");
      }
      instance = instanceIdRef.current ? "same" : "pinned";
      instanceIdRef.current = instanceId;
      failuresRef.current = 0;
      record();
      setState("online");
      return { reachable: true, sequence };
    } catch {
      if (stoppedRef.current || probeControllerRef.current !== controller) return null;
      if (timedOut) outcome = "timeout";
      failuresRef.current += 1;
      record(failuresRef.current === OFFLINE_THRESHOLD);
      if (failuresRef.current >= OFFLINE_THRESHOLD) {
        setState("offline");
      } else {
        setState((prev) => (prev === "offline" ? "offline" : "checking"));
      }
      return { reachable: false, sequence };
    } finally {
      window.clearTimeout(timeout);
      if (probeControllerRef.current === controller) {
        probeControllerRef.current = null;
      }
    }
  }, [enabled]);

  // A probe that is still in flight at unmount resolves after cleanup ran, so
  // it would queue a timer nobody owns and keep pinging forever.
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!enabled || stoppedRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void probe().then(result => {
        if (result && result.sequence === probeSequenceRef.current) schedule();
      });
    }, PING_INTERVAL_MS);
  }, [enabled, probe]);

  const retry = useCallback(() => {
    if (!enabled || stoppedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setState("checking");
    failuresRef.current = 0;
    void probe().then(async (result) => {
      if (stoppedRef.current || result === null || result.sequence !== probeSequenceRef.current) return;
      if (result.reachable) {
        // Recreate every HTTP/SSE connection, not only the health probe.
        window.location.reload();
        return;
      }

      try {
        // Tauri IPC remains available even when the localhost server is not.
        // Relaunching recreates both the WebView and packaged Node server.
        await relaunchAppNative();
      } catch {
        if (!stoppedRef.current && result.sequence === probeSequenceRef.current) {
          setState("offline");
          schedule();
        }
      }
    });
  }, [enabled, probe, schedule]);

  const checkNow = useCallback(() => {
    if (!enabled || stoppedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    void probe().then(result => {
      if (result && result.sequence === probeSequenceRef.current) schedule();
    });
  }, [enabled, probe, schedule]);

  useEffect(() => {
    if (!enabled) {
      stoppedRef.current = true;
      probeSequenceRef.current += 1;
      instanceIdRef.current = null;
      failuresRef.current = 0;
      diagnosticsRef.current = [];
      setDiagnostics([]);
      setFailureIncident([]);
      setState("online");
      return;
    }
    stoppedRef.current = false;
    checkNow();

    const onVisible = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    const onOnline = () => checkNow();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stoppedRef.current = true;
      probeControllerRef.current?.abort();
      probeControllerRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [checkNow, enabled]);

  return { state: enabled ? state : "online", retry, diagnostics: enabled ? diagnostics : [], failureIncident: enabled ? failureIncident : [] };
}
