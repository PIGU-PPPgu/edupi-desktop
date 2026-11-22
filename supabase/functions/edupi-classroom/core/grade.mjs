/**
 * 独立成绩入口；不访问文件、网络、Taro、CloudBase 或 aiProxy。
 * 返回同步对象。error 或 unresolved 存在时 result=null，禁止保存成有效分析。
 * 来源、算法口径、输出字段见 ./grade-engine/SOURCE.md。
 */
import { summarizeExam, compareExams } from "./grade-engine/analysisService.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" ? v.trim() : "";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const own = (v, key) => Object.prototype.hasOwnProperty.call(v, key);

function normalize(raw, roster, issue, unresolved, historical = false) {
  const source = object(raw) ? raw : {};
  if (!object(raw)) issue("INVALID_INPUT", "成绩输入必须是对象。");
  const normalized = {
    title: text(source.title), class_name: text(source.class_name), date: text(source.date),
    subjects: [], rows: [],
  };
  if (!normalized.title) issue("TITLE_REQUIRED", "请填写考试名称。");
  if (!normalized.class_name) issue("CLASS_REQUIRED", "请填写班级。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)
    || !Number.isFinite(Date.parse(normalized.date))
    || new Date(normalized.date).toISOString().slice(0, 10) !== normalized.date) {
    issue("INVALID_DATE", "考试日期必须是有效的 YYYY-MM-DD 日期。");
  }
  if (!Array.isArray(source.subjects) || !source.subjects.length) issue("SUBJECTS_REQUIRED", "请至少填写一个学科。");
  const names = new Set();
  for (const s of Array.isArray(source.subjects) ? source.subjects : []) {
    const name = text(s?.name);
    if (!name) issue("SUBJECT_NAME_REQUIRED", "学科名称不能为空。");
    if (names.has(name)) issue("DUPLICATE_SUBJECT", `学科“${name}”重复。`);
    names.add(name);
    if (!finite(s?.max_score) || s.max_score <= 0) issue("INVALID_MAX_SCORE", `${name || "学科"}满分必须是正的有限数字。`);
    normalized.subjects.push({ name, max_score: finite(s?.max_score) ? s.max_score : null });
  }
  if (!Array.isArray(source.rows) || !source.rows.length) issue("ROWS_REQUIRED", "请至少填写一行成绩。");
  const rowIds = new Set();
  const studentIds = new Set();
  const classmates = roster.filter((s) => s.class_name === normalized.class_name);
  for (const [index, r] of (Array.isArray(source.rows) ? source.rows : []).entries()) {
    const row = { row_id: text(r?.row_id) || `row-${index + 1}`, name: text(r?.name), scores: {} };
    if (r?.class_name !== undefined) {
      row.class_name = text(r.class_name);
      if (row.class_name && row.class_name !== normalized.class_name) issue("ROW_CLASS_MISMATCH", `第 ${index + 1} 行“${row.name}”来自${row.class_name}，与所选班级不符，请核对或按班级拆分文件。`);
    }
    if (rowIds.has(row.row_id)) issue("DUPLICATE_ROW_ID", `成绩行标识“${row.row_id}”重复。`);
    rowIds.add(row.row_id);
    if (!row.name) issue("STUDENT_NAME_REQUIRED", `第 ${index + 1} 行学生姓名不能为空。`);
    const explicit = text(r?.student_id);
    if (r?.student_id != null && !explicit) issue("INVALID_STUDENT_ID", `第 ${index + 1} 行学生标识必须是非空字符串。`);
    if (historical && !explicit) issue("BASELINE_ID_REQUIRED", "基线成绩必须包含已确认的学生标识。");
    const candidates = classmates.filter((s) => s.name === row.name);
    const matches = explicit ? classmates.filter((s) => s.student_id === explicit) : candidates;
    if (historical && explicit) {
      row.student_id = explicit;
    } else if (matches.length === 1) {
      row.student_id = matches[0].student_id;
      row.name = matches[0].name;
    } else {
      const reason = explicit ? "所选学生不在当前班级或标识不唯一，请重新选择。" :
        candidates.length > 1 ? "同班同名学生不唯一，请选择学生。" : "未找到同班同名学生，请选择学生。";
      unresolved.push({
        row_id: row.row_id, name: row.name, reason,
        candidates: (candidates.length ? candidates : classmates).map(({ student_id, name, class_name }) => ({ student_id, name, class_name })),
      });
      issue(explicit ? "STUDENT_ID_NOT_IN_CLASS" : candidates.length > 1 ? "AMBIGUOUS_STUDENT" : "UNKNOWN_STUDENT", `${row.name || row.row_id}：${reason}`, "warning");
      if (historical) issue("BASELINE_ID_REQUIRED", "基线成绩必须包含已确认的学生标识。");
    }
    if (row.student_id) {
      if (studentIds.has(row.student_id)) issue("DUPLICATE_STUDENT_ID", `学生“${row.name}”的标识重复，每次考试只能有一行。`);
      studentIds.add(row.student_id);
    }
    const scores = object(r?.scores) ? r.scores : {};
    if (!object(r?.scores)) issue("INVALID_SCORES", `${row.name || row.row_id}的成绩必须是学科到分数的对象。`);
    for (const key of Object.keys(scores)) {
      if (!names.has(key)) issue("UNKNOWN_SUBJECT", `${row.name || row.row_id}含未声明学科“${key}”。`);
    }
    row.scores = Object.fromEntries(normalized.subjects.map((s) => {
      const value = own(scores, s.name) ? scores[s.name] : null;
      if (value !== null && (!finite(value) || value < 0 || value > s.max_score)) {
        issue("INVALID_SCORE", `${row.name || row.row_id}的${s.name}成绩必须为 0 至 ${s.max_score} 的有限数字，缺考请填 null。`);
        return [s.name, null];
      }
      return [s.name, value];
    }));
    normalized.rows.push(row);
  }
  const maximumTotal = normalized.subjects.reduce((sum, s) => sum + s.max_score, 0);
  if (!Number.isFinite(maximumTotal)) issue("INVALID_TOTAL_MAX_SCORE", "各科满分合计超出可计算范围。");
  if (source.baseline_id != null) {
    normalized.baseline_id = text(source.baseline_id);
    if (!normalized.baseline_id) issue("INVALID_BASELINE_ID", "基线考试标识必须是非空字符串。");
  }
  return normalized;
}

export function computeGrades(raw, students, context = {}) {
  const issues = [];
  const unresolved = [];
  const issue = (code, message, severity = "error") => issues.push({ code, message, severity });
  const roster = [];
  const seen = new Set();
  if (!Array.isArray(students)) issue("INVALID_ROSTER", "学生名册必须是数组。");
  for (const s of Array.isArray(students) ? students : []) {
    const entry = { student_id: text(s?.student_id), name: text(s?.name), class_name: text(s?.class_name) };
    if (!entry.student_id || !entry.name || seen.has(entry.student_id)) {
      issue("INVALID_ROSTER", "学生名册存在缺失字段或重复学生标识。");
    } else {
      roster.push(entry);
      seen.add(entry.student_id);
    }
  }
  const input = normalize(raw, roster, issue, unresolved);
  let baseline = null;
  if (input.baseline_id) {
    const record = object(context) ? context.baseline : null;
    if (!object(record) || record.id !== input.baseline_id) {
      issue("BASELINE_NOT_FOUND", "未找到所选基线考试。");
    } else if (!Number.isInteger(record.revision) || record.revision < 1) {
      issue("INVALID_BASELINE_REVISION", "基线考试缺少有效修订号。");
    } else {
      const baselineUnresolved = [];
      const normalized = normalize(record.input, roster,
        (code, message, severity) => issue(`BASELINE_${code}`, `基线考试：${message}`, severity), baselineUnresolved, true);
      if (normalized.class_name !== input.class_name) issue("BASELINE_CLASS_MISMATCH", "只能选择同班考试作为基线。");
      baseline = { id: record.id, revision: record.revision, input: normalized };
    }
  }
  if (issues.some((i) => i.severity === "error") || unresolved.length) {
    return { input, result: null, issues, unresolved };
  }
  const result = summarizeExam(input);
  if (input.rows.some((r) => input.subjects.some((s) => r.scores[s.name] === null))) {
    issue("MISSING_SCORES", "缺考不记零分；成绩不完整的学生不参与总分排名。", "warning");
  }
  if (baseline) result.comparison = compareExams(input, baseline, issue);
  const hasInvalidNumber = (value) => typeof value === "number" ? !Number.isFinite(value)
    : value !== null && typeof value === "object" && Object.values(value).some(hasInvalidNumber);
  if (hasInvalidNumber(result)) {
    issue("NUMERIC_RANGE_EXCEEDED", "成绩数值超出统计计算范围，请检查分数与满分。");
    return { input, result: null, issues, unresolved };
  }
  return { input, result, issues, unresolved };
}
