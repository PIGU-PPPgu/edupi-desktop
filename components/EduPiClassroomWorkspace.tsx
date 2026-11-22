"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { educationWriteHeaders } from "@/lib/edupi-education-client";
import type { ClassroomDomain, ClassroomInput, ClassroomRecord, ClassroomReply, ClassroomRequest, ClassroomResult, ClassroomStudent, ClassroomSummary, DutyAssignment, DutyInput, GradeInput, SeatingAssignment, SeatingInput } from "@/lib/edupi-classroom-types";

const labels = { grades: "成绩分析", seating: "排座与分组", duty: "值日排班" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const number = (value: number | null | undefined) => value == null ? "—" : Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, "") : "—";
const rate = (value: number | null) => value === null ? "—" : `${number(value * 100)}%`;
type Sheet = { name: string; rows: string[][] };
function studentLabel(student: { student_id: string; name: string }, students: Array<{ student_id: string; name: string }>): string {
  const matches = students.filter(row => row.name === student.name);
  if (matches.length < 2) return student.name;
  const suffix = student.student_id.slice(-8);
  return `${student.name} · ${matches.filter(row => row.student_id.endsWith(suffix)).length > 1 ? student.student_id : suffix}`;
}

async function call(request: ClassroomRequest): Promise<ClassroomReply> {
  const response = await fetch("/api/edupi/classroom", { method: "POST", headers: educationWriteHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(request) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "班级操作失败。");
  return body;
}

function initial(domain: ClassroomDomain, className: string, students: ClassroomStudent[]): ClassroomInput {
  const common = { title: labels[domain], class_name: className };
  const student_ids = students.filter(student => student.class_name === className).map(student => student.student_id);
  if (domain === "grades") return { ...common, date: today(), subjects: [], rows: [] };
  if (domain === "seating") return { ...common, mode: "seating", rows: Math.max(1, Math.ceil(student_ids.length / 6)), columns: 6, group_size: 4, student_ids, features: {}, constraints: { gender_strategy: "ignore", avoid_pairs: [], fixed_seats: [] } };
  return { ...common, start_date: today(), days: 7, weekdays: [1, 2, 3, 4, 5], student_ids, exempt_ids: [],
    posts: [{ id: "floor", name: "扫地", count: 2, weight: 1, gender: "any" }, { id: "board", name: "擦黑板", count: 1, weight: 1, gender: "any" }],
    max_per_day: 1, max_days_per_week: 5 };
}

function GradeImport({ onImport, className }: { onImport: (subjects: GradeInput["subjects"], rows: GradeInput["rows"], title: string) => void; className: string }) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [header, setHeader] = useState(0);
  const [nameColumn, setNameColumn] = useState(0);
  const [columns, setColumns] = useState<number[]>([]);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sheet = sheets[sheetIndex];
  const headers = sheet?.rows[header] || [];
  function choose(index: number) {
    setSheetIndex(index); setHeader(0); setNameColumn(0); setColumns([]);
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/edupi/classroom/import", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSheets(body.sheets); setSource(file.name); choose(0);
    } catch (error) { setError(error instanceof Error ? error.message : "文件读取失败。"); }
    finally { setBusy(false); }
  }
  function adopt() {
    try {
      if (!className) throw new Error("请先选择班级。");
      if (!columns.length || columns.includes(nameColumn)) throw new Error("请选择姓名列及互不重复的科目列。");
      const names = columns.map(column => headers[column]?.trim());
      if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("科目表头为空或重复，请修改文件。");
      const classColumns = headers.flatMap((name, index) => /^(班级|班级名称|行政班|教学班)$/u.test(name.trim()) ? [index] : []);
      if (classColumns.length > 1) throw new Error("发现多个班级列，请保留权威班级列后重新导入。");
      const rows = sheet.rows.slice(header + 1).filter(row => row.some(value => value.trim())).map((row, index) => {
        const name = row[nameColumn]?.trim();
        if (!name) throw new Error(`第 ${header + index + 2} 行缺少姓名。`);
        const scores = Object.fromEntries(columns.map((column, subjectIndex) => {
          const text = row[column]?.trim() || "";
          const value = ["", "缺考", "缺", "免考", "—", "-"].includes(text) ? null : Number(text);
          if (value !== null && (!Number.isFinite(value) || !/^\d+(?:\.\d+)?$/u.test(text))) throw new Error(`${name}的${names[subjectIndex]}成绩无效：${text}`);
          return [names[subjectIndex], value];
        }));
        return { row_id: `row-${index + 1}`, name, scores, ...(classColumns.length ? { class_name: row[classColumns[0]]?.trim() || "" } : {}) };
      });
      if (!rows.length) throw new Error("没有成绩记录。");
      const fullMarks: Record<string, number> = { 语文: 120, 数学: 100, 英语: 100, 科学: 100, 历史: 70, 物理: 70, 道法: 50, 政治: 50, 生物: 50, 地理: 50, 化学: 50 };
      onImport(names.map(name => ({ name, max_score: fullMarks[name] || 100 })), rows, source.replace(/\.[^.]+$/u, ""));
      setSheets([]); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "请核对文件。"); }
  }
  return <div className="edupi-classroom-import">
    <label className="edupi-classroom-file">{busy ? "读取中…" : "导入成绩文件"}<input aria-label="成绩文件" type="file" disabled={busy} accept=".csv,.tsv,.xlsx,.xls,.xlsm,.xlsb" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
    {error ? <p role="alert">{error}</p> : null}
    {sheet ? <section aria-label="成绩列对应">
      <div className="edupi-classroom-fields">
        <label>工作表<select value={sheetIndex} onChange={event => choose(Number(event.target.value))}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>
        <label>表头行<input type="number" min="1" max={sheet.rows.length} value={header + 1} onChange={event => { setHeader(Number(event.target.value) - 1); setColumns([]); }} /></label>
        <label>姓名列<select value={nameColumn} onChange={event => { const column = Number(event.target.value); setNameColumn(column); setColumns(columns.filter(item => item !== column)); }}>{headers.map((name, index) => <option key={index} value={index}>{name || `第${index + 1}列`}</option>)}</select></label>
      </div>
      <fieldset><legend>科目列</legend>{headers.map((name, index) => index === nameColumn ? null : <label key={index}><input type="checkbox" checked={columns.includes(index)} onChange={event => setColumns(event.target.checked ? [...columns, index] : columns.filter(item => item !== index))} />{name || `第${index + 1}列`}</label>)}</fieldset>
      <div className="edupi-classroom-table"><table><thead><tr>{headers.map((name, index) => <th key={index}>{name}</th>)}</tr></thead><tbody>{sheet.rows.slice(header + 1, header + 6).map((row, index) => <tr key={index}>{headers.map((_, column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table></div>
      <button type="button" onClick={adopt}>采用数据</button><button type="button" onClick={() => setSheets([])}>取消导入</button>
    </section> : null}
  </div>;
}

function Grades({ input, change, students, exams, result, unresolved }: {
  input: GradeInput; change: (next: GradeInput) => void; students: ClassroomStudent[]; exams: ClassroomSummary[]; result: ClassroomResult | null; unresolved: ClassroomReply["unresolved"];
}) {
  return <>
    <div className="edupi-classroom-fields">
      <label>考试日期<input type="date" value={input.date} onChange={event => change({ ...input, date: event.target.value })} /></label>
      <label>对比考试<select aria-label="对比考试" value={input.baseline_id || ""} onChange={event => change({ ...input, baseline_id: event.target.value || undefined })}><option value="">单次考试</option>{exams.map(exam => <option value={exam.id} key={exam.id}>{exam.title}</option>)}</select></label>
    </div>
    <GradeImport className={input.class_name} onImport={(subjects, rows, title) => change({ ...input, subjects, rows, title })} />
    {input.subjects.length ? <div className="edupi-classroom-fields">{input.subjects.map((subject, index) => <label key={subject.name}>{subject.name}满分<input aria-label={`${subject.name}满分`} type="number" min="1" value={subject.max_score} onChange={event => change({ ...input, subjects: input.subjects.map((item, i) => i === index ? { ...item, max_score: Number(event.target.value) } : item) })} /></label>)}</div> : null}
    {unresolved?.length ? <p role="alert">请为 {unresolved.length} 条成绩选择学生身份。</p> : null}
    {input.rows.length ? <div className="edupi-classroom-table"><table><thead><tr><th>文件姓名</th><th>学生身份</th>{input.subjects.map(subject => <th key={subject.name}>{subject.name}</th>)}</tr></thead><tbody>
      {input.rows.map((row, index) => <tr key={row.row_id}><td>{row.name}</td><td><select aria-label={`${row.name}身份${index + 1}`} value={row.student_id || ""} onChange={event => change({ ...input, rows: input.rows.map((item, i) => i === index ? { ...item, student_id: event.target.value || undefined } : item) })}>
        <option value="">按同班姓名匹配</option>{students.map(student => <option key={student.student_id} value={student.student_id}>{student.name} · {student.student_id.slice(-6)}</option>)}</select></td>
        {input.subjects.map(subject => <td key={subject.name}><input aria-label={`${row.name}${subject.name}${index + 1}`} type="number" min="0" max={subject.max_score} value={row.scores[subject.name] ?? ""} placeholder="缺考" onChange={event => change({ ...input, rows: input.rows.map((item, i) => i === index ? { ...item, scores: { ...item.scores, [subject.name]: event.target.value === "" ? null : Number(event.target.value) } } : item) })} /></td>)}</tr>)}
    </tbody></table></div> : null}
    {result?.subjects ? <div className="edupi-classroom-table"><table aria-label="考试统计"><thead><tr><th>科目</th><th>有效</th><th>缺考</th><th>均分</th><th>中位数</th><th>标准差</th><th>及格率</th><th>优秀率</th></tr></thead><tbody>{result.subjects.map(subject => <tr key={subject.name}><th>{subject.name}</th><td>{subject.count}</td><td>{subject.missing}</td><td>{number(subject.mean)}</td><td>{number(subject.median)}</td><td>{number(subject.stddev)}</td><td>{rate(subject.pass_rate)}</td><td>{rate(subject.excellent_rate)}</td></tr>)}</tbody></table></div> : null}
    {result?.students ? <details><summary>学生成绩与排名</summary><div className="edupi-classroom-table"><table><thead><tr><th>学生</th><th>总分</th><th>排名</th></tr></thead><tbody>{result.students.map(student => <tr key={student.student_id}><th>{studentLabel(student, students)}</th><td>{number(student.total)}</td><td>{student.rank ?? "—"}</td></tr>)}</tbody></table></div></details> : null}
    {result?.comparison ? <section aria-label="跨考试增值"><h2>两次考试对比</h2><p>标准分变化与增值以两次都有成绩的共同学生为参照。</p><div className="edupi-classroom-table"><table><thead><tr><th>学生</th><th>前次</th><th>本次</th><th>分差</th><th>名次进步</th><th>标准分变化</th><th>增值残差</th></tr></thead><tbody>{result.comparison.students.map(student => <tr key={student.student_id}><th>{studentLabel(student, students)}</th><td>{number(student.before)}</td><td>{number(student.after)}</td><td>{number(student.delta)}</td><td>{number(student.rank_delta)}</td><td>{number(student.z_delta)}</td><td>{number(student.value_added?.score_value_added_rate)}</td></tr>)}</tbody></table></div></section> : null}
  </>;
}

function Seating({ input, change, students, exams, result }: { input: SeatingInput; change: (next: SeatingInput) => void; students: ClassroomStudent[]; exams: ClassroomSummary[]; result: ClassroomResult | null }) {
  const [swap, setSwap] = useState("");
  const [avoidA, setAvoidA] = useState("");
  const [avoidB, setAvoidB] = useState("");
  const assignments = (input.assignments || result?.assignments || []) as SeatingAssignment[];
  const edit = (next: Partial<SeatingInput>) => change({ ...input, assignments: undefined, ...next });
  function seatClick(studentId: string) {
    if (!swap) { setSwap(studentId); return; }
    if (swap === studentId) { setSwap(""); return; }
    const a = assignments.find(row => row.student_id === swap), b = assignments.find(row => row.student_id === studentId);
    if (a && b) change({ ...input, assignments: assignments.map(row => row === a ? { ...row, row: b.row, column: b.column, group: b.group } : row === b ? { ...row, row: a.row, column: a.column, group: a.group } : row) });
    setSwap("");
  }
  return <>
    <div className="edupi-classroom-fields">
      <label>方案类型<select value={input.mode} onChange={event => edit({ mode: event.target.value as SeatingInput["mode"] })}><option value="seating">排座</option><option value="groups">分组</option></select></label>
      <label>行数<input type="number" min="1" max="30" value={input.rows} onChange={event => edit({ rows: Number(event.target.value) })} /></label>
      <label>列数<input type="number" min="1" max="20" value={input.columns} onChange={event => edit({ columns: Number(event.target.value) })} /></label>
      <label>每组人数<input type="number" min="2" max="6" value={input.group_size} onChange={event => edit({ group_size: Number(event.target.value) })} /></label>
      <label>参考成绩<select value={input.exam_id || ""} onChange={event => edit({ exam_id: event.target.value || undefined })}><option value="">不使用成绩</option>{exams.map(exam => <option value={exam.id} key={exam.id}>{exam.title}</option>)}</select></label>
      <label>同桌性别<select value={input.constraints.gender_strategy} onChange={event => edit({ constraints: { ...input.constraints, gender_strategy: event.target.value as SeatingInput["constraints"]["gender_strategy"] } })}><option value="ignore">不限制</option><option value="mixed">异性优先</option><option value="same">同性优先</option></select></label>
    </div>
    <details><summary>学生特征与约束</summary>
      <div className="edupi-classroom-table"><table><thead><tr><th>参与</th><th>学生</th><th>性别</th><th>身高</th><th>前排</th><th>活跃度</th><th>自管</th><th>情绪稳定</th><th>领导力</th><th>固定座位</th></tr></thead><tbody>{students.map(student => {
        const feature = input.features[student.student_id] || {};
        const fixed = input.constraints.fixed_seats.find(row => row.student_id === student.student_id);
        const setFeature = (value: Partial<typeof feature>) => edit({ features: { ...input.features, [student.student_id]: { ...feature, ...value } } });
        return <tr key={student.student_id}>
          <td><input type="checkbox" aria-label={`${studentLabel(student, students)}参与`} checked={input.student_ids.includes(student.student_id)} onChange={event => edit({ student_ids: event.target.checked ? [...input.student_ids, student.student_id] : input.student_ids.filter(id => id !== student.student_id) })} /></td><th>{studentLabel(student, students)}</th>
          <td><select aria-label={`${studentLabel(student, students)}性别`} value={feature.gender || ""} onChange={event => setFeature({ gender: event.target.value })}><option value="">未知</option><option value="male">男</option><option value="female">女</option></select></td>
          <td><input aria-label={`${studentLabel(student, students)}身高`} type="number" min="50" max="250" value={feature.height ?? ""} onChange={event => setFeature({ height: event.target.value ? Number(event.target.value) : undefined })} /></td>
          <td><input aria-label={`${studentLabel(student, students)}前排`} type="checkbox" checked={feature.front || false} onChange={event => setFeature({ front: event.target.checked })} /></td>
          {(["activity", "self_control", "emotion", "leadership"] as const).map(key => <td key={key}><input aria-label={`${studentLabel(student, students)}${key}`} type="number" min="1" max="5" value={feature[key] ?? 3} onChange={event => setFeature({ [key]: Number(event.target.value) })} /></td>)}
          <td><input aria-label={`${studentLabel(student, students)}固定行`} placeholder="行" type="number" min="1" max={input.rows} value={fixed ? fixed.row + 1 : ""} onChange={event => edit({ constraints: { ...input.constraints, fixed_seats: [...input.constraints.fixed_seats.filter(row => row.student_id !== student.student_id), ...(event.target.value ? [{ student_id: student.student_id, row: Number(event.target.value) - 1, column: fixed?.column || 0 }] : [])] } })} /><input aria-label={`${studentLabel(student, students)}固定列`} placeholder="列" type="number" min="1" max={input.columns} value={fixed ? fixed.column + 1 : ""} onChange={event => edit({ constraints: { ...input.constraints, fixed_seats: [...input.constraints.fixed_seats.filter(row => row.student_id !== student.student_id), ...(event.target.value ? [{ student_id: student.student_id, row: fixed?.row || 0, column: Number(event.target.value) - 1 }] : [])] } })} /></td>
        </tr>;
      })}</tbody></table></div>
      <div className="edupi-classroom-fields"><label>分离学生<select value={avoidA} onChange={event => setAvoidA(event.target.value)}><option value="">选择学生</option>{students.map(student => <option key={student.student_id} value={student.student_id}>{studentLabel(student, students)}</option>)}</select></label><label>另一位<select value={avoidB} onChange={event => setAvoidB(event.target.value)}><option value="">选择学生</option>{students.map(student => <option key={student.student_id} value={student.student_id}>{studentLabel(student, students)}</option>)}</select></label><button type="button" disabled={!avoidA || !avoidB || avoidA === avoidB} onClick={() => { edit({ constraints: { ...input.constraints, avoid_pairs: [...input.constraints.avoid_pairs, [avoidA, avoidB]] } }); setAvoidA(""); setAvoidB(""); }}>添加分离约束</button></div>
      {input.constraints.avoid_pairs.map((pair, index) => <button type="button" key={index} onClick={() => edit({ constraints: { ...input.constraints, avoid_pairs: input.constraints.avoid_pairs.filter((_, i) => i !== index) } })}>{pair.map(id => students.find(student => student.student_id === id)?.name || id).join(" · ")} ×</button>)}
    </details>
    {assignments.length ? <section aria-label="排座结果"><p>{swap ? "选择另一位学生交换位置" : "点选两名学生交换位置"}</p>
      {input.mode === "seating" ? <><div className="edupi-classroom-front">讲台</div><div className="edupi-classroom-seats" style={{ gridTemplateColumns: `repeat(${input.columns}, minmax(64px, 1fr))` }}>{Array.from({ length: input.rows * input.columns }, (_, index) => {
        const row = Math.floor(index / input.columns), column = index % input.columns, student = assignments.find(item => item.row === row && item.column === column);
        return student ? <button type="button" key={index} className={swap === student.student_id ? "is-selected" : ""} onClick={() => seatClick(student.student_id)} aria-label={`座位${row + 1}-${column + 1} ${students.find(item => item.student_id === student.student_id)?.name || ""}`}><strong>{studentLabel(students.find(item => item.student_id === student.student_id) || {student_id: student.student_id, name: student.student_id}, students)}</strong><small>第{student.group}组</small></button> : <button type="button" key={index} aria-label={`空座位${row + 1}-${column + 1}`} onClick={() => {
          const selected = assignments.find(item => item.student_id === swap);
          if (selected) change({ ...input, assignments: assignments.map(item => item === selected ? { ...item, row, column } : item) }); setSwap("");
        }}>空位</button>;
      })}</div></> : <div className="edupi-classroom-groups">{[...new Set(assignments.map(row => row.group))].sort((a, b) => a - b).map(group => <section key={group}><h3>第{group}组</h3>{assignments.filter(row => row.group === group).map(row => <button type="button" className={swap === row.student_id ? "is-selected" : ""} key={row.student_id} onClick={() => seatClick(row.student_id)}>{studentLabel(students.find(student => student.student_id === row.student_id) || {student_id: row.student_id, name: row.student_id}, students)}</button>)}</section>)}</div>}
    </section> : null}
  </>;
}

function Duty({ input, change, students, result }: { input: DutyInput; change: (next: DutyInput) => void; students: ClassroomStudent[]; result: ClassroomResult | null }) {
  const assignments = (input.assignments || result?.assignments || []) as DutyAssignment[];
  const edit = (value: Partial<DutyInput>) => change({ ...input, assignments: undefined, substitutions: undefined, ...value });
  return <>
    <div className="edupi-classroom-fields">
      <label>开始日期<input type="date" value={input.start_date} onChange={event => edit({ start_date: event.target.value })} /></label>
      <label>天数<input type="number" min="1" max="35" value={input.days} onChange={event => edit({ days: Number(event.target.value) })} /></label>
      <label>每天最多岗位<input type="number" min="1" max="12" value={input.max_per_day} onChange={event => edit({ max_per_day: Number(event.target.value) })} /></label>
      <label>每周最多天数<input type="number" min="1" max="7" value={input.max_days_per_week} onChange={event => edit({ max_days_per_week: Number(event.target.value) })} /></label>
    </div>
    <fieldset><legend>排班日</legend>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((name, index) => <label key={name}><input type="checkbox" checked={input.weekdays.includes(index + 1)} onChange={event => edit({ weekdays: event.target.checked ? [...input.weekdays, index + 1] : input.weekdays.filter(day => day !== index + 1) })} />{name}</label>)}</fieldset>
    <div className="edupi-classroom-table"><table aria-label="值日岗位"><thead><tr><th>岗位</th><th>人数</th><th>工作量权重</th><th>性别要求</th><th /></tr></thead><tbody>{input.posts.map((post, index) => <tr key={post.id}><td><input aria-label={`岗位${index + 1}`} value={post.name} onChange={event => edit({ posts: input.posts.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></td><td><input aria-label={`岗位人数${index + 1}`} type="number" min="1" max="10" value={post.count} onChange={event => edit({ posts: input.posts.map((item, i) => i === index ? { ...item, count: Number(event.target.value) } : item) })} /></td><td><input aria-label={`岗位权重${index + 1}`} type="number" min="1" max="3" value={post.weight} onChange={event => edit({ posts: input.posts.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item) })} /></td><td><select aria-label={`岗位性别${index + 1}`} value={post.gender} onChange={event => edit({ posts: input.posts.map((item, i) => i === index ? { ...item, gender: event.target.value as typeof post.gender } : item) })}><option value="any">不限</option><option value="male">男</option><option value="female">女</option></select></td><td><button type="button" onClick={() => edit({ posts: input.posts.filter((_, i) => i !== index) })}>移除</button></td></tr>)}</tbody></table></div>
    <button type="button" onClick={() => edit({ posts: [...input.posts, { id: `post-${crypto.randomUUID().slice(0, 8)}`, name: "", count: 1, weight: 1, gender: "any" }] })}>添加岗位</button>
    <details><summary>参与与免值日</summary><div className="edupi-classroom-table"><table><thead><tr><th>学生</th><th>参与</th><th>免值日</th><th>性别</th></tr></thead><tbody>{students.map(student => <tr key={student.student_id}><th>{studentLabel(student, students)}</th><td><input aria-label={`${studentLabel(student, students)}参与值日`} type="checkbox" checked={input.student_ids.includes(student.student_id)} onChange={event => edit({ student_ids: event.target.checked ? [...input.student_ids, student.student_id] : input.student_ids.filter(id => id !== student.student_id) })} /></td><td><input aria-label={`${studentLabel(student, students)}免值日`} type="checkbox" checked={input.exempt_ids.includes(student.student_id)} onChange={event => edit({ exempt_ids: event.target.checked ? [...input.exempt_ids, student.student_id] : input.exempt_ids.filter(id => id !== student.student_id) })} /></td><td><select aria-label={`${studentLabel(student, students)}值日性别`} value={input.features?.[student.student_id]?.gender || ""} onChange={event => edit({ features: { ...input.features, [student.student_id]: { gender: event.target.value } } })}><option value="">按档案</option><option value="male">男</option><option value="female">女</option></select></td></tr>)}</tbody></table></div></details>
    {assignments.length ? <div className="edupi-classroom-table"><table aria-label="值日结果"><thead><tr><th>日期</th><th>岗位</th><th>值日学生</th></tr></thead><tbody>{assignments.map((assignment, index) => <tr key={`${assignment.date}:${assignment.post_id}`}><td>{assignment.date}</td><th>{assignment.post_name || input.posts.find(post => post.id === assignment.post_id)?.name}</th><td>{assignment.student_ids.map((id, slot) => <select key={slot} aria-label={`${assignment.date}${assignment.post_id}第${slot + 1}人`} value={id} onChange={event => change({ ...input, substitutions: undefined, assignments: assignments.map((row, i) => i === index ? { ...row, student_ids: row.student_ids.map((studentId, j) => j === slot ? event.target.value : studentId) } : row) })}>{students.map(student => <option key={student.student_id} value={student.student_id}>{studentLabel(student, students)}{input.exempt_ids.includes(student.student_id) ? " · 免值日" : ""}</option>)}</select>)}</td></tr>)}</tbody></table></div> : null}
    {result?.workloads ? <details open><summary>工作量</summary><p>加权负担差：{number(result.fairness_gap)}</p><div className="edupi-classroom-workloads">{result.workloads.map(row => <span key={row.student_id}>{studentLabel(row, students)} · {number(row.weight)} 点 · {row.count} 次</span>)}</div></details> : null}
  </>;
}

function ClassroomEditor({ domain, openId, active }: { domain: ClassroomDomain; openId?: string; active: boolean }) {
  const [roster, setRoster] = useState<ClassroomStudent[]>([]);
  const [records, setRecords] = useState<ClassroomSummary[]>([]);
  const [exams, setExams] = useState<ClassroomSummary[]>([]);
  const [input, setInput] = useState<ClassroomInput>(() => initial(domain, "", []));
  const [saved, setSaved] = useState<ClassroomRecord | null>(null);
  const [draftId, setDraftId] = useState(() => `classroom-${crypto.randomUUID()}`);
  const [preview, setPreview] = useState<ClassroomReply | null>(null);
  const [dirty, setDirty] = useState(true);
  const [needsCompute, setNeedsCompute] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const requestVersion = useRef(0);
  const invalidateRequest = useCallback(() => { requestVersion.current++; }, []);
  useEffect(() => invalidateRequest, [invalidateRequest]);
  const adopt = useCallback((record: ClassroomRecord) => {
    setSaved(record); setDraftId(record.id); setInput(record.input);
    const row: ClassroomSummary = { id: record.id, domain: record.domain, title: record.input.title, class_name: record.input.class_name,
      revision: record.revision, updated_at: record.updated_at, date: "date" in record.input ? record.input.date : "start_date" in record.input ? record.input.start_date : null,
      mode: "mode" in record.input ? record.input.mode : null, task_id: record.task_id || null };
    setRecords(current => [...current.filter(item => item.id !== row.id), row]);
    setPreview({ ok: true, operation: "classroom", external_send: false, request_id: "", input: record.input, result: record.result, issues: record.issues });
    setDirty(false); setNeedsCompute(false);
  }, []);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    void Promise.all([call({ domain, action: "roster" }), call({ domain, action: "list" }), call({ domain: "grades", action: "list" })]).then(([students, plans, gradePlans]) => {
      if (!live) return;
      setRoster(students.students || []); setRecords(plans.records || []); setExams(gradePlans.records || []);
      const rows = students.students || [];
      setInput(previous => previous.class_name ? previous : initial(domain, rows.find(row => row.class_name)?.class_name || "", rows));
    }).catch(error => { if (live) setError(error instanceof Error ? error.message : "读取失败。"); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [domain, refresh, active]);
  useEffect(() => {
    if (!openId) { setBusy(false); return; }
    let live = true;
    const version = ++requestVersion.current;
    setBusy(true);
    void call({ domain, action: "read", id: openId }).then(result => { if (live && requestVersion.current === version && result.record) adopt(result.record); })
      .catch(error => { if (live && requestVersion.current === version) setError(error instanceof Error ? error.message : "读取方案失败。"); })
      .finally(() => { if (live && requestVersion.current === version) setBusy(false); });
    return () => { live = false; invalidateRequest(); };
  }, [domain, openId, adopt, invalidateRequest]);
  const students = roster.filter(student => student.class_name === input.class_name);
  const classNames = [...new Set(roster.map(student => student.class_name).filter(Boolean))];
  const change = (next: ClassroomInput) => { requestVersion.current++; setInput(next); setDirty(true); setNeedsCompute(true); setMessage(""); setError(""); };
  const result = preview?.result || null;
  const errors = preview?.issues?.some(issue => issue.severity === "error") || Boolean(preview?.unresolved?.length);
  async function operation(action: "preview" | "save" | "restore" | "publish", revision?: number) {
    const version = ++requestVersion.current;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await call({ domain, action, input, id: saved?.id || draftId, expected_revision: saved?.revision || 0, revision }) as ClassroomReply & { queued?: boolean };
      if (requestVersion.current !== version) return;
      if (response.queued) { setMessage("方案已保留，等待云端同步。"); return; }
      if (response.record) { adopt(response.record); setMessage(action === "publish" ? "已关联工作区任务" : action === "restore" ? "已恢复并保存" : "已保存"); setRefresh(value => value + 1); }
      else { setPreview(response); if (response.input) setInput(response.input); setNeedsCompute(false); }
    } catch (error) { if (requestVersion.current === version) setError(error instanceof Error ? error.message : "操作失败。"); }
    finally { if (requestVersion.current === version) setBusy(false); }
  }
  async function open(id: string) {
    if (!id || dirty && input.title !== labels[domain] && !window.confirm("放弃未保存的修改并打开方案？")) return;
    const version = ++requestVersion.current;
    setBusy(true); setError("");
    try { const result = await call({ domain, action: "read", id }); if (requestVersion.current === version && result.record) { adopt(result.record); setMessage(""); } }
    catch (error) { if (requestVersion.current === version) setError(error instanceof Error ? error.message : "读取失败。"); }
    finally { if (requestVersion.current === version) setBusy(false); }
  }
  function reset() {
    if (dirty && preview && !window.confirm("放弃未保存的修改？")) return;
    requestVersion.current++; setBusy(false);
    setSaved(null); setDraftId(`classroom-${crypto.randomUUID()}`); setPreview(null); setInput(initial(domain, input.class_name, roster)); setDirty(true); setNeedsCompute(true); setMessage(""); setError("");
  }
  return <section className="edupi-classroom-editor" aria-label={labels[domain]}>
    <header className="edupi-module-heading"><h1>{labels[domain]}</h1><div><select aria-label="打开已存方案" disabled={busy} value={saved?.id || ""} onChange={event => void open(event.target.value)}><option value="">已存方案</option>{records.map(row => <option key={row.id} value={row.id}>{row.class_name} · {row.title} · v{row.revision}</option>)}</select><button type="button" onClick={reset} disabled={busy}>新方案</button></div></header>
    {loading ? <p role="status">读取中…</p> : null}
    {error ? <p className="edupi-classroom-error" role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>重试读取</button></p> : null}
    {message ? <p role="status">{message}</p> : null}
    <fieldset disabled={busy || loading} className="edupi-classroom-form">
      <div className="edupi-classroom-fields"><label>班级<select aria-label="方案班级" value={input.class_name} onChange={event => { setSaved(null); setDraftId(`classroom-${crypto.randomUUID()}`); setPreview(null); change(initial(domain, event.target.value, roster)); }}><option value="">选择班级</option>{classNames.map(name => <option key={name}>{name}</option>)}</select></label><label>名称<input aria-label="方案名称" value={input.title} maxLength={160} onChange={event => change({ ...input, title: event.target.value })} /></label></div>
      {!classNames.length && !loading ? <p>请先在名单中导入带班级的学生。</p> : null}
      {domain === "grades" ? <Grades input={input as GradeInput} change={change} students={students} exams={exams.filter(row => row.class_name === input.class_name && row.id !== saved?.id)} result={result} unresolved={preview?.unresolved} /> : domain === "seating" ? <Seating input={input as SeatingInput} change={change} students={students} exams={exams.filter(row => row.class_name === input.class_name)} result={result} /> : <Duty input={input as DutyInput} change={change} students={students} result={result} />}
      {preview?.issues?.length ? <ul className="edupi-classroom-issues" aria-label="计算提示">{preview.issues.map((issue, index) => <li key={index} className={issue.severity === "error" ? "edupi-classroom-error" : ""}>{issue.message}</li>)}</ul> : null}
      <footer className="edupi-classroom-actions"><button type="button" className="is-primary native-button-primary" disabled={busy || !input.class_name || !dirty || !needsCompute && errors} onClick={() => void operation(needsCompute ? "preview" : "save")}>{busy ? "处理中…" : needsCompute ? domain === "grades" ? "计算分析" : "生成方案" : dirty ? "保存" : "已保存"}</button>
        {dirty && saved ? <button type="button" onClick={() => { adopt(saved); setMessage("已取消修改"); }}>取消调整</button> : null}
        {saved?.domain === "duty" && !dirty ? saved.task_id ? <a href={`/?module=tasks&view=workspace&taskDetail=${encodeURIComponent(saved.task_id)}`}>打开关联任务</a> : <button type="button" onClick={() => void operation("publish")}>关联工作区任务</button> : null}
        {saved ? <span>版本 {saved.revision}{dirty ? " · 未保存" : ""}</span> : null}
      </footer>
    </fieldset>
    {saved?.versions.length ? <details><summary>修改记录</summary>{[...saved.versions].reverse().map(version => <div key={version.revision} className="edupi-classroom-version"><span>版本 {version.revision} · {new Date(version.saved_at).toLocaleString("zh-CN")}</span><button type="button" disabled={busy || version.revision === saved.revision} onClick={() => void operation("restore", version.revision)}>恢复</button></div>)}</details> : null}
  </section>;
}

export function EduPiClassroomWorkspace({ rosterView }: { rosterView: ReactNode }) {
  const params = useSearchParams();
  const requested = params.get("classroom");
  const [tab, setTab] = useState<"roster" | ClassroomDomain>(requested === "grades" || requested === "seating" || requested === "duty" ? requested : "roster");
  const [visited, setVisited] = useState<Array<"roster" | ClassroomDomain>>([tab]);
  return <div className="edupi-classroom-workspace"><nav className="edupi-classroom-tabs" aria-label="班级功能">{(["roster", "grades", "seating", "duty"] as const).map(id => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setVisited(current => current.includes(id) ? current : [...current, id]); }}>{id === "roster" ? "名单" : labels[id]}</button>)}</nav>
    {visited.map(id => <div key={id} hidden={tab !== id} className="edupi-classroom-tab">{id === "roster" ? rosterView : <main className="edupi-module-workspace"><ClassroomEditor domain={id} active={tab === id} openId={requested === id ? params.get("classroomId") || undefined : undefined} /></main>}</div>)}
  </div>;
}
