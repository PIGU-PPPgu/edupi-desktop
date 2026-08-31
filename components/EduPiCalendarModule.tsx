"use client";

import type { EducationContract } from "@/lib/edupi-education-contract";
import { isRecognizedTimetableNote } from "@/lib/edupi-recognition-markers";
import { EduPiRhythmImporter } from "./EduPiRhythmImporter";

type Props = {
  data: EducationContract;
  onData: (data: EducationContract) => void;
};

export function EduPiCalendarModule({ data, onData }: Props) {
  return <section className="edupi-module-view edupi-calendar-module"><span className="edupi-section-kicker">CALENDAR & RHYTHM</span><h2>课程与校历</h2><p>这里显示 EduPi 已读取的事实。导入只写入校历/课程记忆，不自动生成学生或家长内容。</p><EduPiRhythmImporter onData={onData} /><div className="edupi-calendar-grid">{data.calendar.map((event) => <article key={event.id || `${event.date}-${event.name}`}><time>{event.date || "日期待确认"}</time><strong>{event.name}</strong><span>{event.type || "校历"} · {event.confidence} · {event.preparationStatus === "hold" ? "暂缓准备" : "可进入内部准备"}</span><small>{event.source || "来源待补"}{event.notes ? ` · ${event.notes}` : ""}</small></article>)}</div>{data.timetable.length > 0 ? <div className="edupi-timetable-list"><h3>每周课程与固定事务</h3>{data.timetable.map((slot, index) => <div className="edupi-timetable-row" key={`${String(slot.day_of_week)}-${String(slot.period)}-${index}`}><b>周{String(slot.day_of_week)}</b><span>第 {String(slot.period)} 节</span><strong>{String(slot.subject || "未命名")}</strong><small>{String(slot.class_name || slot.kind || "")}{isRecognizedTimetableNote(slot.notes) ? " · 待确认" : ""}</small></div>)}</div> : null}</section>;
}
