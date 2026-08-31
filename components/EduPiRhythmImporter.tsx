"use client";

import { useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";

type Props = {
  onData: (data: EducationContract) => void;
};

type ImportMode = "calendar" | "timetable";

function parseJsonObject(value: string, field: string): Record<string, unknown>[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 数组`);
  return parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

const calendarExample = `[
  {"date":"2026-09-10","name":"教师节","type":"festival","source":"official_school_calendar","confidence":"confirmed"},
  {"date":"2026-11-16","name":"期中考试","type":"exam","source":"official_school_calendar","confidence":"confirmed"}
]`;

const timetableExample = `[
  {"day_of_week":1,"period":2,"subject":"数学","class_name":"七年级1班","kind":"class"},
  {"day_of_week":5,"period":1,"subject":"班会","kind":"routine"}
]`;

export function EduPiRhythmImporter({ onData }: Props) {
  const [mode, setMode] = useState<ImportMode>("calendar");
  const [value, setValue] = useState(calendarExample);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeMode(next: ImportMode) {
    setMode(next);
    setMessage(null);
    setValue(next === "calendar" ? calendarExample : timetableExample);
  }

  async function importData() {
    setBusy(true);
    setMessage(null);
    try {
      const body = mode === "calendar"
        ? { operation: "calendar_import", events: parseJsonObject(value, "events") }
        : { operation: "timetable_import", slots: parseJsonObject(value, "slots") };
      const response = await fetch("/api/edupi/education", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; added?: number; skipped?: number; data?: EducationContract };
      if (!response.ok) throw new Error(result.error || `导入失败（HTTP ${response.status}）`);
      if (result.data) onData(result.data);
      setMessage(`已写入 ${result.added ?? 0} 条，跳过重复 ${result.skipped ?? 0} 条。请在下方核对事实；未根据不完整日期做推断。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <section className="edupi-rhythm-importer" aria-label="导入校历与课程节奏"><div className="edupi-rhythm-importer__header"><div><span className="edupi-section-kicker">FACT INTAKE</span><h3>补充真实教育节奏</h3><p>校历和课程表先作为事实写入 EduPi memory；只有日期和来源清楚的记录才会进入后续内部准备。</p></div><div className="edupi-rhythm-importer__tabs"><button type="button" className={mode === "calendar" ? "is-active" : ""} onClick={() => changeMode("calendar")}>校历事件</button><button type="button" className={mode === "timetable" ? "is-active" : ""} onClick={() => changeMode("timetable")}>每周课程</button></div></div><label className="edupi-rhythm-importer__label">{mode === "calendar" ? "events JSON 数组" : "slots JSON 数组"}<textarea value={value} onChange={(event) => setValue(event.target.value)} rows={8} spellCheck={false} /></label><div className="edupi-rhythm-importer__actions"><button type="button" className="edupi-entry-secondary" onClick={() => setValue(mode === "calendar" ? calendarExample : timetableExample)}>恢复示例</button><button type="button" className="edupi-entry-primary" disabled={busy} onClick={() => void importData()}>{busy ? "正在写入…" : "写入并核对"}</button></div>{message ? <div className="edupi-entry-message" role="status">{message}</div> : null}</section>;
}
