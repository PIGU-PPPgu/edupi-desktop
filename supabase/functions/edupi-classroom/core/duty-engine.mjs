// 私有移植：Headteacher-helper/cloud/apiCore/dutySchedule.js
// 用户授权日期：2026-11-13；原文件 SHA-256：400b1b8688ec1eb53fd99b76bbb2c495ea70ff52943ebe2eab3fc53ce43ccf5f
// 原项目未提供开源许可；不授予再分发许可。
// 来源：buildSmartDutySchedule 的岗位逐槽分配、weeklyUsage 比较和 selectionCursor。
// 修订：统一性别；每日/周硬上限；实际替班链；调整后重算；不足人数为 error。
import { issue, studentGender } from './student-gender.mjs';
const DAY_MS = 86400000;
export function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : '';
}
export const addDays = (value, days) => new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export function startOfWeek(value) {
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay() || 7;
  return addDays(value, 1 - weekday);
}
export function scheduleDates(input) {
  return Array.from({ length: input.days }, (_, i) => addDays(input.start_date, i))
    .filter(date => input.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay() || 7));
}

// Sequential replacement changes the actual task roster, so A→B→C ends at C.
// The original implementation replaced only one map edge in taskAssignments.
function substitute(rows, substitutions, date, issues) {
  for (const sub of substitutions.filter(s => s.date === date)) {
    const row = rows.find(r => r.post_id === sub.post_id);
    if (!row || !row.student_ids.includes(sub.from_id)) {
      issue(issues, 'substitution_source_missing', `${date} 替班原学生不在该岗位`); continue;
    }
    if (row.student_ids.includes(sub.to_id)) {
      issue(issues, 'substitution_duplicate', `${date} 替班会使同一岗位出现重复学生`); continue;
    }
    row.student_ids[row.student_ids.indexOf(sub.from_id)] = sub.to_id;
  }
}

export function buildDutySchedule(input, students, issues = []) {
  const dates = scheduleDates(input);
  const exempt = new Set(input.exempt_ids);
  const eligible = students.filter(s => !exempt.has(s.student_id));
  const byId = new Map(students.map(s => [s.student_id, s]));
  const order = new Map(eligible.map((s, i) => [s.student_id, i]));
  const count = eligible.length;
  if (input.posts.some(p => p.gender !== 'any') && eligible.some(s => studentGender(s) === 'unknown')) issue(issues, 'unknown_student_gender', '部分学生性别未知，不参与性别限定岗位', 'warning');
  const requiredSlots = input.posts.reduce((n, post) => n + post.count, 0);
  const usageFor = () => new Map(eligible.map(s => [s.student_id, { days: new Set(), taskCount: 0, weightedLoad: 0 }]));
  let week = '', weeklyUsage = usageFor(), selectionCursor = 0;
  const assignments = [], weeklyWorkloads = [];
  function closeWeek() {
    if (week) weeklyWorkloads.push({ week_start: week, workloads: eligible.map(s => ({ student_id: s.student_id, count: weeklyUsage.get(s.student_id).taskCount, weight: weeklyUsage.get(s.student_id).weightedLoad, days: weeklyUsage.get(s.student_id).days.size })) });
  }
  for (const date of dates) {
    const nextWeek = startOfWeek(date);
    if (week !== nextWeek) {
      closeWeek(); week = nextWeek; weeklyUsage = usageFor();
      const weekIndex = Math.round((Date.parse(week) - Date.parse(startOfWeek(input.start_date))) / DAY_MS / 7);
      // Same cross-week offset as upstream; no invented historic compensation.
      selectionCursor = count ? weekIndex * Math.max(1, requiredSlots) % count : 0;
    }
    const dailyUsage = new Map(eligible.map(s => [s.student_id, 0]));
    const rows = input.posts.map(post => ({ date, post_id: post.id, post_name: post.name, student_ids: [] }));
    const beforeDay = new Map([...weeklyUsage].map(([id, u]) => [id, { days: new Set(u.days), taskCount: u.taskCount, weightedLoad: u.weightedLoad }]));
    if (input.assignments !== undefined) {
      for (const row of rows) {
        const supplied = input.assignments.filter(a => a.date === date && a.post_id === row.post_id);
        if (supplied.length > 1) issue(issues, 'duplicate_post_assignment', `${date} 同一岗位重复排班`);
        row.student_ids = supplied.flatMap(a => a.student_ids);
      }
    } else {
      const futureDays = dates.filter(d => d > date && startOfWeek(d) === week).length;
      // Necessary capacity bounds only: preserve the original ranking whenever
      // it leaves enough capacity, including one student per post per day.
      // Substitutions can change future usage, so leave their original path intact.
      function preservesCapacity(candidate, selectedPost) {
        if (!futureDays || input.substitutions.length) return true;
        const subsets = [input.posts, ...input.posts.map(p => [p]),
          ...['male', 'female'].map(g => input.posts.filter(p => p.gender === g))];
        for (const posts of subsets) {
          if (!posts.length) continue;
          const remaining = new Map(posts.map(p => [p.id, p.count - rows.find(r => r.post_id === p.id).student_ids.length - Number(p === selectedPost)]));
          const demand = [...remaining.values()].reduce((a, b) => a + b, 0)
            + futureDays * posts.reduce((sum, p) => sum + p.count, 0);
          let capacity = 0, futureDayCapacity = 0;
          for (const student of eligible) {
            const id = student.student_id, usage = weeklyUsage.get(id);
            const selected = id === candidate.student_id;
            const workedToday = usage.days.has(date) || selected;
            const daysLeft = input.max_days_per_week - usage.days.size - Number(selected && !usage.days.has(date));
            const matches = posts.filter(p => p.gender === 'any' || studentGender(student) === p.gender);
            if (matches.length) futureDayCapacity += Math.min(futureDays, daysLeft);
            const currentPosts = matches.filter(p => remaining.get(p.id) > 0
              && !rows.find(r => r.post_id === p.id).student_ids.includes(id)
              && !(selected && p === selectedPost)).length;
            if (workedToday || daysLeft > 0) capacity += Math.min(currentPosts, input.max_per_day - dailyUsage.get(id) - Number(selected));
            capacity += Math.min(futureDays, daysLeft) * Math.min(input.max_per_day, matches.length);
          }
          if (capacity < demand) return false;
          // Student-days are indivisible: e.g. three daily slots at a two-slot
          // daily limit need two people on every future date, not 1.5 people.
          const dailyWorkers = Math.max(...posts.map(p => p.count),
            Math.ceil(posts.reduce((sum, p) => sum + p.count, 0) / Math.min(input.max_per_day, posts.length)));
          if (futureDayCapacity < futureDays * dailyWorkers) return false;
        }
        return true;
      }
      // Allocate scarce gender-restricted positions first. Ranking within a post
      // retains upstream weekly weight/count/days, daily usage, then cursor.
      const orderedPosts = [...input.posts].sort((a, b) => {
        const supply = post => eligible.filter(s => post.gender === 'any' || studentGender(s) === post.gender).length / post.count;
        return supply(a) - supply(b) || input.posts.indexOf(a) - input.posts.indexOf(b);
      });
      for (const post of orderedPosts) {
        const row = rows.find(r => r.post_id === post.id);
        for (let slot = 0; slot < post.count; slot++) {
          const available = eligible.filter(student => {
            const id = student.student_id, usage = weeklyUsage.get(id);
            return !row.student_ids.includes(id)
              && (post.gender === 'any' || studentGender(student) === post.gender)
              && dailyUsage.get(id) < input.max_per_day
              && (usage.days.has(date) || usage.days.size < input.max_days_per_week);
          });
          available.sort((a, b) => {
            const au = weeklyUsage.get(a.student_id), bu = weeklyUsage.get(b.student_id);
            const rank = id => (order.get(id) - selectionCursor + count) % Math.max(1, count);
            return au.weightedLoad - bu.weightedLoad || au.taskCount - bu.taskCount || au.days.size - bu.days.size
              || dailyUsage.get(a.student_id) - dailyUsage.get(b.student_id) || rank(a.student_id) - rank(b.student_id);
          });
          // If every candidate fails a necessary bound, retain the original
          // partial schedule and its real validation errors; invent no error.
          const selected = available.find(s => preservesCapacity(s, post)) ?? available[0];
          if (!selected) break;
          const id = selected.student_id, usage = weeklyUsage.get(id);
          row.student_ids.push(id); dailyUsage.set(id, dailyUsage.get(id) + 1);
          usage.days.add(date); usage.taskCount++; usage.weightedLoad += post.weight;
          selectionCursor = (order.get(id) + 1) % Math.max(1, count);
        }
      }
    }
    substitute(rows, input.substitutions, date, issues);
    // Always discard predicted loads and commit the effective assignments,
    // including substitutions even when there was no manual override.
    weeklyUsage = beforeDay;
    for (const id of dailyUsage.keys()) dailyUsage.set(id, 0);
    for (const row of rows) {
      const post = input.posts.find(p => p.id === row.post_id);
      if (row.student_ids.length !== post.count) issue(issues, row.student_ids.length < post.count ? 'unfilled_post' : 'post_capacity', `${date} ${post.name}需要 ${post.count} 人，实际 ${row.student_ids.length} 人`);
      if (new Set(row.student_ids).size !== row.student_ids.length) issue(issues, 'duplicate_duty_student', `${date} ${post.name}有重复学生`);
      for (const id of row.student_ids) {
        const student = byId.get(id);
        if (!student) { issue(issues, 'duty_student_missing', `${date} 值日学生未参与：${id}`); continue; }
        if (exempt.has(id)) { issue(issues, 'exempt_student_assigned', `${date} 免值日学生不能排班：${student.name}`); continue; }
        if (post.gender !== 'any' && studentGender(student) !== post.gender) issue(issues, 'duty_gender_mismatch', `${date} ${post.name}不满足岗位性别要求`);
        dailyUsage.set(id, (dailyUsage.get(id) ?? 0) + 1);
        const usage = weeklyUsage.get(id);
        usage.days.add(date); usage.taskCount++; usage.weightedLoad += post.weight;
        if (dailyUsage.get(id) > input.max_per_day) issue(issues, 'daily_limit', `${date} ${student.name}超过每日岗位上限`);
        if (usage.days.size > input.max_days_per_week) issue(issues, 'weekly_limit', `${date} ${student.name}超过每周值日天数上限`);
      }
      row.student_names = row.student_ids.map(id => byId.get(id)?.name ?? '');
      assignments.push(row);
    }
  }
  closeWeek();
  const workloads = students.map(s => {
    const duties = assignments.filter(a => a.student_ids.includes(s.student_id));
    return { student_id: s.student_id, name: s.name,
      count: duties.reduce((n, a) => n + a.student_ids.filter(id => id === s.student_id).length, 0),
      weight: duties.reduce((n, a) => n + input.posts.find(p => p.id === a.post_id).weight * a.student_ids.filter(id => id === s.student_id).length, 0) };
  });
  const weights = workloads.filter(s => !exempt.has(s.student_id)).map(s => s.weight);
  return { assignments, workloads, fairness_gap: weights.length ? Math.max(...weights) - Math.min(...weights) : 0,
    weekly_workloads: weeklyWorkloads, dates, selection_cursor: selectionCursor,
    can_save: !issues.some(i => i.severity === 'error') };
}
