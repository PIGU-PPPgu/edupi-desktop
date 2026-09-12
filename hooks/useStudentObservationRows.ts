"use client";
import { useEffect, useRef, useState } from "react";
import type { StudentEvent } from "@/lib/edupi-student-events";
import { EDUPI_STUDENT_RECORDS_UPDATED_EVENT } from "@/lib/edupi-ui-events";

type Prefix = { records: StudentEvent[]; total: number | null };
export const STUDENT_OBSERVATION_PAGE_SIZE = 8;
export function studentObservationNeed(page: number, extraRows = 0): number {
  return (Math.max(0, page) + 1) * STUDENT_OBSERVATION_PAGE_SIZE + Math.max(0, extraRows);
}
export async function readStudentObservationPrefix(kind: string, query: string, needed: number, previous: Prefix, signal: AbortSignal): Promise<Prefix> {
  const records = [...previous.records];
  let total = previous.total;
  while (total === null || records.length < Math.min(needed, total)) {
    const params = new URLSearchParams({ kind, query, offset: String(records.length) });
    const response = await fetch(`/api/edupi/student-events?${params}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("学生观察读取失败");
    const result = await response.json();
    signal.throwIfAborted();
    if (!result.ok || !Array.isArray(result.records) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error("学生观察读取失败");
    total = result.total;
    if (!result.records.length && records.length < Number(total)) throw new Error("学生记录已变化，请刷新");
    records.push(...result.records);
  }
  return { records, total };
}

export function useStudentObservationRows(category: string, status: string, query: string, page: number, extraRows = 0) {
  const kind = category === "learning" ? "learning" : category === "class" ? "interaction" : null;
  const enabled = kind !== null && ["all", "observation"].includes(status);
  const key = `${kind}:${status}:${query}`;
  const cache = useRef<{ key: string; value: Prefix }>({ key: "", value: { records: [], total: null } });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const reload = () => { cache.current.key = ""; setRefresh(value => value + 1); };
    window.addEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, reload);
  }, []);
  const [state, setState] = useState({ key: "", records: [] as StudentEvent[], total: 0, loading: false, error: "" });
  useEffect(() => {
    if (!enabled || !kind) { cache.current.key = ""; return; }
    const controller = new AbortController();
    const previous = cache.current.key === key ? cache.current.value : { records: [], total: null };
    setState({ key, records: previous.records, total: previous.total || 0, loading: true, error: "" });
    void readStudentObservationPrefix(kind, query, studentObservationNeed(page, extraRows), previous, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      cache.current = { key, value };
      setState({ key, records: value.records, total: value.total || 0, loading: false, error: "" });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, records: previous.records, total: previous.total || 0, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [enabled, extraRows, key, kind, page, query, refresh]);
  return enabled && state.key === key ? { ...state, connected: !state.loading && !state.error } : { records: [], total: 0, loading: enabled, error: "", connected: false };
}
