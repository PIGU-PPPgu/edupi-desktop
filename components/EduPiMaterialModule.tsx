"use client";

import { useMemo, useState } from "react";
import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";

type Props = {
  data: EducationContract;
  onRequestMaterialUpload: () => void;
  onOpenTasks: () => void;
};

type MaterialKind = "作业 / 错题" | "课堂记录" | "校历通知";

const materials: Array<{ kind: MaterialKind; title: string; description: string }> = [
  { kind: "作业 / 错题", title: "作业与错题", description: "归类重复错因，保留题目或批注证据。" },
  { kind: "课堂记录", title: "课堂记录", description: "整理课堂观察，形成教师内部跟进候选。" },
  { kind: "校历通知", title: "校历通知", description: "日期和来源先核对，再进入课程节奏。" },
];

function materialTasks(tasks: TeacherTask[]): TeacherTask[] {
  return tasks.filter((task) => task.trigger === "teaching_adjustment_candidate");
}

export function EduPiMaterialModule({ data, onRequestMaterialUpload, onOpenTasks }: Props) {
  const [selectedKind, setSelectedKind] = useState<MaterialKind>("作业 / 错题");
  const pending = useMemo(() => materialTasks(data.tasks).filter((task) => task.status === "planned").length, [data.tasks]);
  return <section className="edupi-module-view edupi-material-module"><span className="edupi-section-kicker">MATERIALS & EVIDENCE</span><h2>材料与证据</h2><p>原始文件先进入教师材料收件箱；EduPi 只生成 candidate_only 中间结果，教师核对后才进入内部任务。</p><div className="edupi-material-kind-grid">{materials.map((item) => <button key={item.kind} type="button" className={selectedKind === item.kind ? "is-selected" : ""} onClick={() => setSelectedKind(item.kind)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div><div className="edupi-material-actions"><button type="button" className="edupi-entry-primary" onClick={onRequestMaterialUpload}>上传{selectedKind}</button><button type="button" className="edupi-entry-secondary" onClick={onOpenTasks}>查看材料候选（{pending}）</button></div><div className="edupi-material-boundary"><strong>处理边界</strong><span>事实来源：教师主动上传 · 推断状态：candidate_only · 外发：关闭 · 教师审核：必须</span></div></section>;
}
