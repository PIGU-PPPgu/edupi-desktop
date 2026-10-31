"use client";

import type { EducationContract } from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { buildClassDossier, dossierDateLabel, UNASSIGNED_CLASS_FILTER } from "@/lib/edupi-class-dossier";

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
  const count = dossier.students.length;
  const unrecorded = count - dossier.recordedStudents;
  const recordedPercent = count ? dossier.recordedStudents / count * 100 : 0;
  const particulars = [
    { label: "教师", value: context?.name },
    { label: "学校", value: context?.school },
    { label: "年级", value: context?.grade },
    { label: "学科", value: context?.subject },
  ].filter((item): item is { label: string; value: string } => typeof item.value === "string" && Boolean(item.value.trim()));
  const mark = classFilter && classFilter !== UNASSIGNED_CLASS_FILTER ? classFilter.replace(/班$/u, "").slice(0, 6) : "π";

  return <div className="edupi-class-dossier">
    <header className="edupi-class-dossier__heading">
      <div><h2>{title}</h2><p>{count} 名学生{classFilter ? "" : ` · ${dossier.classes.length} 个已命名班级`}</p></div>
      <div className="edupi-class-dossier__scope">
        <label><span className="sr-only">选择班级档案</span><select aria-label="选择班级档案" value={classFilter} onChange={(event) => onClass(event.target.value)}>
          <option value="">全部班级</option>
          {dossier.classes.map((name) => <option key={name} value={name}>{name}</option>)}
          {dossier.unassignedCount > 0 ? <option value={UNASSIGNED_CLASS_FILTER}>未分班 · {dossier.unassignedCount} 人</option> : null}
        </select></label>
        <button type="button" onClick={onShowStudents}>查看学生 <span aria-hidden="true">↗</span></button>
      </div>
    </header>

    <div className="edupi-class-dossier__layout">
      <div className="edupi-class-dossier__main">
        <section className="edupi-class-dossier__activity" aria-label="近期成长">
          <header><h3>近期成长</h3><span>{dossier.growth.length} 条档案记录</span></header>
          {dossier.growth.length ? <ol className="edupi-class-dossier__timeline">{dossier.growth.slice(0, 3).map((entry) => <li key={entry.key}>
            <time>{dossierDateLabel(entry.date)}</time>
            <button type="button" onClick={() => onStudent(entry.student)} aria-label={`打开${entry.studentName}的成长档案`}>
              <span className="edupi-class-dossier__event-person">{entry.studentName}{!classFilter ? <small>{entry.className || "未分班"}</small> : null}</span>
              <strong>{entry.title}</strong>
              {entry.note ? <span className="edupi-class-dossier__note">{entry.note}</span> : null}
              {entry.source !== "学生档案" ? <small className="edupi-class-dossier__source">{entry.source}</small> : null}
            </button>
          </li>)}</ol> : <p className="edupi-class-dossier__empty">暂无成长记录</p>}
          <footer><button type="button" onClick={onShowRecords}>查看全部学生记录 <span aria-hidden="true">→</span></button></footer>
        </section>

        <section className="edupi-class-dossier__concerns" aria-label="学习关注">
          <header><h3>学习关注</h3>{dossier.concerns.length ? <span>{dossier.concerns.length} 条档案记录</span> : null}</header>
          {dossier.concerns.length ? <ul>{dossier.concerns.slice(0, 4).map((entry) => <li key={entry.key}>
            <button type="button" onClick={() => onStudent(entry.student)}>
              <span className="edupi-class-dossier__concern-mark" aria-hidden="true">{entry.studentName.slice(0, 1)}</span>
              <span><strong>{entry.studentName}{!classFilter ? <small>{entry.className || "未分班"}</small> : null}</strong><span>{entry.title}</span></span>
              <span className="edupi-class-dossier__arrow" aria-hidden="true">↗</span>
            </button>
          </li>)}</ul> : <p className="edupi-class-dossier__empty">暂无待关注的学习记录</p>}
        </section>
      </div>

      <aside className="edupi-class-dossier__aside" aria-label="班级档案">
        <section className="edupi-class-dossier__identity">
          <div className="edupi-class-dossier__cover" aria-hidden="true"><span>{mark}</span></div>
          <div className="edupi-class-dossier__identity-body"><h3>班级档案</h3>
            {particulars.length ? <dl>{particulars.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className="edupi-class-dossier__empty">尚未填写教学资料</p>}
            {dossier.updatedAt ? <p className="edupi-class-dossier__updated">档案更新于 {dossierDateLabel(dossier.updatedAt)}</p> : null}
            {!classFilter && dossier.unassignedCount > 0 ? <button type="button" className="edupi-class-dossier__unassigned" onClick={() => onClass(UNASSIGNED_CLASS_FILTER)}>未分班学生 <span>{dossier.unassignedCount} 人 →</span></button> : null}
          </div>
        </section>

        <section className="edupi-class-dossier__coverage" aria-label="档案积累">
          <header><h3>档案积累</h3></header>
          <div className="edupi-class-dossier__coverage-number"><strong>{dossier.recordedStudents}<span> / {count}</span></strong><span>已有档案内容的学生</span></div>
          <div className="edupi-class-dossier__coverage-bar" role="img" aria-label={`${dossier.recordedStudents} 名学生已有档案内容，${unrecorded} 名仅有名单信息`}><span style={{ width: `${recordedPercent}%` }} /></div>
          <div className="edupi-class-dossier__legend"><span>已有内容 <strong>{dossier.recordedStudents}</strong></span><span>仅名单 <strong>{unrecorded}</strong></span></div>
          <button type="button" onClick={() => onAgent(`请协助整理${title}现有学生档案，先核对记录来源，缺失的情况向我询问。`, "replace")}>补充班级记录 <span aria-hidden="true">↗</span></button>
        </section>

        {dossier.traits.length ? <section className="edupi-class-dossier__traits" aria-label="已记录的学生特征">
          <header><h3>学生特征</h3></header><ul>{dossier.traits.slice(0, 5).map((trait) => <li key={trait.text}><span>{trait.text}</span><small>{trait.count} 人</small></li>)}</ul>
        </section> : null}
      </aside>
    </div>
  </div>;
}
