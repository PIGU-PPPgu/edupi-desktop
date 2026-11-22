// Pure contract adapter for the privately ported dutySchedule smart algorithm.
// Original source and SHA-256 are retained in duty-engine.mjs.
import { object, issue, integer, ids, rosterFor, normalizeGender } from './student-gender.mjs';
import { buildDutySchedule, dateKey, scheduleDates } from './duty-engine.mjs';

export function computeDuty(raw, students = [], context = {}) {
  const issues = [];
  if (!object(raw)) issue(issues, 'invalid_input', '值日输入必须是对象');
  const source = object(raw) ? raw : {};
  const { roster, selected, className } = rosterFor(source, students, issues);
  const start_date = dateKey(source.start_date);
  if (!start_date) issue(issues, 'invalid_start_date', '开始日期必须是有效的年月日');
  const days = integer(source.days, 7, 1, 35, '排班天数', issues);
  const max_per_day = integer(source.max_per_day, 1, 1, 100, '每日岗位上限', issues);
  const max_days_per_week = integer(source.max_days_per_week, 1, 1, 7, '每周值日天数上限', issues);
  const weekdays = source.weekdays === undefined ? [1, 2, 3, 4, 5] : Array.isArray(source.weekdays) ? [...source.weekdays] : [];
  if (!weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7) || new Set(weekdays).size !== weekdays.length) issue(issues, 'invalid_weekdays', '排班星期必须是不重复的 1 至 7 整数列表');
  const exempt_ids = source.exempt_ids === undefined ? [] : ids(source.exempt_ids, '免值日学生', issues);
  for (const id of exempt_ids) if (!selected.includes(id)) issue(issues, 'exempt_student_missing', `免值日学生未参与：${id}`);
  const posts = [];
  if (!Array.isArray(source.posts) || !source.posts.length) issue(issues, 'posts_required', '请至少设置一个值日岗位');
  for (const rawPost of Array.isArray(source.posts) ? source.posts : []) {
    if (!object(rawPost)) { issue(issues, 'invalid_post', '值日岗位必须是对象'); continue; }
    const id = typeof rawPost.id === 'string' ? rawPost.id.trim() : '';
    const name = typeof rawPost.name === 'string' ? rawPost.name.trim() : '';
    if (!id || !name) issue(issues, 'invalid_post', '岗位编号和名称不能为空');
    if (posts.some(p => p.id === id)) issue(issues, 'duplicate_post', '岗位编号不能重复');
    const count = integer(rawPost.count, 1, 1, 500, '岗位人数', issues);
    const weight = rawPost.weight ?? 1;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 10000) issue(issues, 'invalid_weight', '岗位权重必须是大于 0 且不超过 10000 的数值');
    const suppliedGender = rawPost.gender ?? 'any';
    const gender = suppliedGender === 'any' ? 'any' : normalizeGender(suppliedGender);
    if (gender === 'unknown') issue(issues, 'invalid_post_gender', '岗位性别要求必须为不限、男生或女生');
    posts.push({ id, name, count, weight, gender });
  }
  const features = {};
  if (source.features !== undefined && !object(source.features)) issue(issues, 'invalid_features', '值日性别画像必须是对象');
  for (const [id, feature] of Object.entries(object(source.features) ? source.features : {})) {
    if (!selected.includes(id)) { issue(issues, 'feature_student_missing', `画像学生未参与值日：${id}`); continue; }
    if (!object(feature)) { issue(issues, 'invalid_feature', '值日性别画像无效'); continue; }
    if (feature.gender !== undefined) features[id] = { gender: normalizeGender(feature.gender) };
  }
  const input = { title: String(source.title ?? '').trim(), class_name: className, start_date, days, weekdays, student_ids: selected, exempt_ids, posts, max_per_day, max_days_per_week, features };
  const dates = start_date && !issues.some(i => i.code === 'invalid_weekdays') ? scheduleDates(input) : [];
  if (start_date && !dates.length) issue(issues, 'no_duty_dates', '所选日期范围没有排班日');
  if (source.assignments !== undefined) {
    if (!Array.isArray(source.assignments)) issue(issues, 'invalid_assignments', '人工值日排班必须是列表');
    input.assignments = (Array.isArray(source.assignments) ? source.assignments : []).map(a => {
      if (!object(a)) { issue(issues, 'invalid_assignment', '人工值日排班项无效'); a = {}; }
      if (!dates.includes(a.date)) issue(issues, 'assignment_date_out_of_range', '人工排班日期不在本次排班范围');
      if (!posts.some(p => p.id === a.post_id)) issue(issues, 'assignment_post_missing', '人工排班岗位不存在');
      const student_ids = ids(a.student_ids, '岗位学生', issues);
      for (const id of student_ids) {
        if (!selected.includes(id)) issue(issues, 'duty_student_missing', `值日学生未参与：${id}`);
        if (exempt_ids.includes(id)) issue(issues, 'exempt_student_assigned', '免值日学生不能参与人工排班');
      }
      return { date: a.date, post_id: a.post_id, student_ids };
    });
  }
  input.substitutions = [];
  if (source.substitutions !== undefined && !Array.isArray(source.substitutions)) issue(issues, 'invalid_substitutions', '替班记录必须是列表');
  for (const sub of Array.isArray(source.substitutions) ? source.substitutions : []) {
    if (!object(sub) || !dates.includes(sub.date) || !posts.some(p => p.id === sub.post_id) || !selected.includes(sub.from_id) || !selected.includes(sub.to_id) || sub.from_id === sub.to_id) { issue(issues, 'invalid_substitution', '替班日期、岗位或学生无效'); continue; }
    if (exempt_ids.includes(sub.to_id)) issue(issues, 'exempt_substitute', '免值日学生不能替班');
    input.substitutions.push({ date: sub.date, post_id: sub.post_id, from_id: sub.from_id, to_id: sub.to_id });
  }
  if (issues.some(i => i.severity === 'error')) return { input, result: { assignments: [], workloads: [], fairness_gap: 0, can_save: false }, issues };
  return { input, result: buildDutySchedule(input, roster.map(s => features[s.student_id]?.gender !== undefined ? { ...s, gender: features[s.student_id].gender } : s), issues), issues };
}
