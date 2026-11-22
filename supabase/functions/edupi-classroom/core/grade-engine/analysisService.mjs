// 私有语义移植：Headteacher-helper/src/grade-analysis/analysisService.ts
// 2026-11-13 用户授权；来源与差异见 SOURCE.md。
// 原文件 SHA-256：2f5074300cd51f83bd46922aae3a6ee151ea7dd4751a622e1600ad1e158978e2
import { calculateStatistics, calculateRank, calculateZScores } from "./statistics.mjs";
import { calculateStudentValueAdded } from "./studentValueAddedService.mjs";
import { calculateClassValueAdded } from "./classValueAddedService.mjs";

const boundaries = [
  [1.75, null], [1.25, 1.75], [0.75, 1.25], [0.25, 0.75],
  [-0.25, 0.25], [-0.75, -0.25], [-1.25, -0.75], [-1.75, -1.25], [null, -1.75],
];
const levels = boundaries.map(([min, max], i) => ({
  level: `${i + 1}段`, z_score: { min, max },
}));

export function summarizeExam(input) {
  const subjects = input.subjects.map(({ name, max_score }) => {
    const values = input.rows.map((r) => r.scores[name]).filter((v) => v !== null);
    const stats = calculateStatistics(values);
    return {
      name, max_score, count: values.length, missing: input.rows.length - values.length,
      mean: values.length ? stats.mean : null, median: values.length ? stats.median : null,
      min: values.length ? stats.min : null, max: values.length ? stats.max : null,
      stddev: values.length ? stats.std_dev : null,
      pass_rate: values.length ? values.filter((v) => v >= max_score * 0.6).length / values.length : null,
      excellent_rate: values.length ? values.filter((v) => v >= max_score * 0.85).length / values.length : null,
    };
  });
  const students = input.rows.map((row) => ({
    student_id: row.student_id, name: row.name,
    total: input.subjects.every((s) => row.scores[s.name] !== null)
      ? input.subjects.reduce((sum, s) => sum + row.scores[s.name], 0) : null,
  }));
  const totals = students.map((s) => s.total).filter((v) => v !== null);
  for (const student of students) {
    student.rank = student.total === null ? null : calculateRank(student.total, totals);
  }
  return { subjects, students, comparison: null };
}

function comparePairs(pairs, beforeMax, afterMax, subject, className) {
  const entry = pairs.map((p) => p.before);
  const exit = pairs.map((p) => p.after);
  const entryZ = calculateZScores(entry);
  const exitZ = calculateZScores(exit);
  const data = pairs.map((p) => ({
    student_id: p.student_id, student_name: p.name, class_name: className,
    subject, entry_score: p.before, exit_score: p.after,
  }));
  const valueAdded = calculateStudentValueAdded({ allStudents: data, subject, levelDefinitions: levels });
  return {
    students: pairs.map((p, i) => ({
      ...p, delta: p.after - p.before,
      before_percent: p.before / beforeMax * 100,
      after_percent: p.after / afterMax * 100,
      percent_delta: (p.after / afterMax - p.before / beforeMax) * 100,
      rank_delta: calculateRank(p.before, entry) - calculateRank(p.after, exit),
      z_delta: exitZ[i] - entryZ[i],
      value_added: valueAdded[i],
    })),
    classes: calculateClassValueAdded({ studentGrades: data, subject, levelDefinitions: levels })
      .map(({ rank_in_grade, total_classes, ...metrics }) => metrics),
  };
}

export function compareExams(input, baseline, issue) {
  const before = baseline.input;
  const priorById = new Map(before.rows.map((r) => [r.student_id, r]));
  const commonSubjects = input.subjects.filter((s) => before.subjects.some((b) => b.name === s.name));
  const subjects = commonSubjects.map((s) => {
    const beforeMax = before.subjects.find((b) => b.name === s.name).max_score;
    if (beforeMax !== s.max_score) {
      issue("MAX_SCORE_CHANGED", `${s.name}两次满分不同（${beforeMax} → ${s.max_score}），原始分差不能直接解释为进步，请结合百分制和 Z 分变化。`, "warning");
    }
    const pairs = input.rows.flatMap((r) => {
      const b = priorById.get(r.student_id);
      return b && b.scores[s.name] !== null && r.scores[s.name] !== null
        ? [{ student_id: r.student_id, name: r.name, before: b.scores[s.name], after: r.scores[s.name] }] : [];
    });
    if (!pairs.length) issue("NO_SUBJECT_PAIRS", `${s.name}没有共同有效学生，未计算增值。`, "warning");
    return {
      name: s.name, before_max_score: beforeMax, after_max_score: s.max_score,
      count: pairs.length, ...comparePairs(pairs, beforeMax, s.max_score, s.name, input.class_name),
    };
  });
  if (!commonSubjects.length) issue("NO_COMMON_SUBJECTS", "两次考试没有共同学科，未计算对比。", "warning");
  if (commonSubjects.length !== before.subjects.length || commonSubjects.length !== input.subjects.length) {
    issue("SUBJECT_SET_CHANGED", "两次学科范围不同，总分对比仅使用共同学科。", "warning");
  }
  const completePairs = input.rows.flatMap((r) => {
    const b = priorById.get(r.student_id);
    if (!b || !commonSubjects.length || commonSubjects.some((s) => b.scores[s.name] === null || r.scores[s.name] === null)) return [];
    return [{
      student_id: r.student_id, name: r.name,
      before: commonSubjects.reduce((sum, s) => sum + b.scores[s.name], 0),
      after: commonSubjects.reduce((sum, s) => sum + r.scores[s.name], 0),
    }];
  });
  if (!completePairs.length) issue("NO_TOTAL_PAIRS", "没有共同学科成绩完整的共同学生，总分对比为空。", "warning");
  const beforeMax = commonSubjects.reduce((sum, s) => sum + before.subjects.find((b) => b.name === s.name).max_score, 0);
  const afterMax = commonSubjects.reduce((sum, s) => sum + s.max_score, 0);
  return {
    baseline_id: baseline.id, baseline_revision: baseline.revision,
    reference_scope: "matched_students_in_class",
    subject_names: commonSubjects.map((s) => s.name),
    ...comparePairs(completePairs, beforeMax, afterMax, "共同学科总分", input.class_name),
    subjects,
  };
}
