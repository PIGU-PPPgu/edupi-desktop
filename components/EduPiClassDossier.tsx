"use client";


import type { EducationContract } from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { buildClassDossier, dossierDateLabel, UNASSIGNED_CLASS_FILTER } from "@/lib/edupi-class-dossier";
import { DossierCoverageCard, DossierTrendCard, DossierMiniActivity } from "./EduPiDossierCharts";
import { EduPiDossierRecordTable, type DossierRecordRow } from "./EduPiDossierRecordTable";

type Props = {
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  classFilter: string;
  onClass: (name: string) => void;
  onStudent: (student: Record<string, unknown>) => void;
  onAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onShowStudents: () => void;
  onShowRecords: () => void;
};

export function EduPiClassDossier({ data, context, classFilter, onClass, onStudent, onAgent, onShowStudents, onShowRecords }: Props) {
  const dossier = buildClassDossier(data.students, classFilter, context?.classes ?? []);
  const title = classFilter === UNASSIGNED_CLASS_FILTER ? "未分班" : classFilter || "全部班级";
  const particulars = [
    { label: "教师", value: context?.name }, { label: "学校", value: context?.school },
    { label: "年级", value: context?.grade }, { label: "学科", value: context?.subject },
  ].filter((item): item is { label: string; value: string } => typeof item.value === "string" && Boolean(item.value.trim()));
  const entries = dossier.growth.map(entry => ({ date: entry.date, label: entry.title }));
  const rows: DossierRecordRow[] = [
    ...dossier.growth.map(entry => ({ id: entry.key, title: entry.title, date: entry.date, note: entry.note, kind: "growth" as const, student: entry.student, studentName: entry.studentName })),
    ...dossier.resolved.map(entry => ({ id: entry.key, title: entry.title, date: entry.date, note: entry.note, kind: "resolved" as const, student: entry.student, studentName: entry.studentName })),
    ...dossier.concerns.map(entry => ({ id: entry.key, title: entry.title, date: entry.date, note: entry.note, kind: "attention" as const, student: entry.student, studentName: entry.studentName })),
  ];
  return <div className="edupi-class-dossier">
    <header className="edupi-class-dossier__heading"><div><h2>{title}</h2><p>{dossier.students.length} 名学生</p></div><label><span className="sr-only">选择班级档案</span><select aria-label="选择班级档案" value={classFilter} onChange={event => onClass(event.target.value)}><option value="">全部班级</option>{dossier.classes.map(name => <option key={name} value={name}>{name}</option>)}{dossier.unassignedCount ? <option value={UNASSIGNED_CLASS_FILTER}>未分班</option> : null}</select></label></header>
    <div className="edupi-class-dossier__layout">
      <div className="edupi-class-dossier__main">
        <div className="edupi-dossier-chart-pair"><DossierCoverageCard title="学生档案覆盖" numerator={dossier.recordedStudents} denominator={dossier.students.length} numeratorLabel="已有记录" remainderLabel="仅名单" /><DossierTrendCard title="班级成长记录" entries={entries} /></div>
        <EduPiDossierRecordTable title="学生记录" rows={rows} onStudent={onStudent} />
        <div className="edupi-class-dossier__links"><button type="button" onClick={onShowStudents}>查看学生名册</button><button type="button" onClick={onShowRecords}>全部学习与互动记录</button></div>
        {dossier.traits.length ? <details className="edupi-class-dossier__traits"><summary>学生特征</summary><ul>{dossier.traits.map(trait => <li key={trait.text}><span>{trait.text}</span><small>{trait.count} 人</small></li>)}</ul></details> : null}
      </div>
      <aside className="edupi-class-dossier__aside" aria-label="班级档案">
        <section className="edupi-class-dossier__identity"><h3>班级档案</h3><div className="edupi-dossier-portrait"><picture><source srcSet="/dossier/default-classroom.webp" type="image/webp" /><img src="/dossier/default-classroom.png" width="280" height="220" alt="" /></picture></div><div className="edupi-dossier-identity__status"><span>{dossier.students.length} 名学生</span><button type="button" onClick={() => onAgent(`请协助整理${title}现有学生档案，先核对来源，缺失情况向我询问。`, "replace")}>补充记录</button></div><dl>{particulars.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}<div><dt>档案更新</dt><dd>{dossierDateLabel(dossier.updatedAt)}</dd></div></dl>{!classFilter && dossier.unassignedCount ? <button type="button" className="edupi-class-dossier__unassigned" onClick={() => onClass(UNASSIGNED_CLASS_FILTER)}>未分班 <span>{dossier.unassignedCount} 人</span></button> : null}</section>
        <DossierMiniActivity entries={entries} />
      </aside>
    </div>
  </div>;
}
