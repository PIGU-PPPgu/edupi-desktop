// 私有移植：Headteacher-helper/src/grade-engine/classValueAddedService.ts
// 用户授权日期：2026-11-13；原文件 SHA-256：f406f894f49941d8270dd7df37c3c60b919b6ca06ad7c2ddd7cd7caa967d59a4
// 原项目未提供开源许可；不授予再分发许可。改动说明见 SOURCE.md。
/**
 * 班级增值评价计算服务
 * 优先级 P0 - 核心功能
 */
import { calculateZScores, calculateScoreValueAddedRate, shrinkValueAddedRate, calculateOLSBeta, safeDivide, groupBy, calculateStandardError, calculateConfidenceInterval, } from "./statistics.mjs";
function isValidFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function normalizeText(value, fallback) {
    const trimmed = value?.trim();
    return trimmed || fallback;
}
function average(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
// ============================================
// 核心计算函数
// ============================================
/**
 * 计算班级增值评价
 * ✅ 修复：Z分数基于传入的共同有效群体计算（入口目前只传同班）
 */
export function calculateClassValueAdded(params) {
    const { studentGrades, subject } = params;
    const sanitizedStudentGrades = studentGrades
        .map((student) => ({
        ...student,
        class_name: normalizeText(student.class_name, "未知班级"),
        subject: normalizeText(student.subject, subject || "未分类科目"),
    }))
        .filter((student) => isValidFiniteNumber(student.entry_score) &&
        isValidFiniteNumber(student.exit_score));
    if (sanitizedStudentGrades.length === 0) {
        return [];
    }
    // 1. 按班级分组
    const classesByName = groupBy(sanitizedStudentGrades, (s) => s.class_name);
    // 2. ✅ 计算传入共同群体的Z分数（关键修复）
    const allEntryScores = sanitizedStudentGrades.map((s) => s.entry_score);
    const allExitScores = sanitizedStudentGrades.map((s) => s.exit_score);
    const gradeEntryZScores = calculateZScores(allEntryScores);
    const gradeExitZScores = calculateZScores(allExitScores);
    // 计算OLS回归斜率（用于均值回归修正）
    // 当相关性过低（跨量纲考试，如中考→高中期末）时，限制beta最小值为0.8
    // 防止低相关性导致的过度均值回归修正，产生极端TVA
    const rawBeta = calculateOLSBeta(gradeEntryZScores, gradeExitZScores);
    const regressionBeta = Math.max(rawBeta, 0.8);
    const lowCorrelationWarning = rawBeta < 0.7;
    // 3. 为每个学生分配Z分数
    const studentsWithZScores = sanitizedStudentGrades.map((student, index) => ({
        ...student,
        entry_z_score: gradeEntryZScores[index],
        exit_z_score: gradeExitZScores[index],
    }));
    // 5. 计算每个班级的增值数据
    const results = [];
    for (const className of Object.keys(classesByName)) {
        // 获取该班级学生的带Z分数数据
        const classStudentsWithZ = studentsWithZScores.filter((s) => s.class_name === className);
        const classResult = calculateSingleClassValueAdded({
            className,
            students: classStudentsWithZ,
            subject,
            regressionBeta,
            lowCorrelationWarning,
        });
        results.push(classResult);
    }
    // 6. 添加排名信息
    addRankings(results);
    return results;
}
/**
 * 计算单个班级的增值评价
 * ✅ 修复：使用传入共同群体Z分数，添加原始分和标准分
 */
function calculateSingleClassValueAdded(params) {
    const { className, students, subject, regressionBeta, lowCorrelationWarning, } = params;
    // 1. 提取分数数据
    const entryScores = students.map((s) => s.entry_score);
    const exitScores = students.map((s) => s.exit_score);
    // 2. ✅ 使用传入共同群体Z分数（已在上层计算）
    const entryZScores = students.map((s) => s.entry_z_score || 0);
    const exitZScores = students.map((s) => s.exit_z_score || 0);
    // 3. ✅ 计算班级平均原始分和标准分
    const avgEntryScore = average(entryScores);
    const avgExitScore = average(exitScores);
    const avgEntryZScore = average(entryZScores);
    const avgExitZScore = average(exitZScores);
    // 标准分 = 500 + 100 * Z分数（参照汇优评公式）
    const avgStandardEntryScore = 500 + 100 * avgEntryZScore;
    const avgStandardExitScore = 500 + 100 * avgExitZScore;
    // 4. 计算分数增值指标
    const scoreValueAddedRates = entryZScores.map((entryZ, i) => calculateScoreValueAddedRate(entryZ, exitZScores[i], regressionBeta));
    const avgScoreValueAddedRate = average(scoreValueAddedRates.filter((rate) => Number.isFinite(rate)));
    // 小样本收缩（高中选科班级保护）
    const shrunkAvgScoreValueAddedRate = shrinkValueAddedRate(avgScoreValueAddedRate, students.length);
    const avgZScoreChange = avgExitZScore - avgEntryZScore;
    // 5. 计算进步学生比例
    const progressStudentCount = scoreValueAddedRates.filter((rate) => Number.isFinite(rate) && rate > 0).length;
    const progressStudentRatio = safeDivide(progressStudentCount, students.length);
    // 10. 薄弱学生关注度（BQAI）：后25%学生的平均增值率
    const sortedByEntry = [...students].sort((a, b) => a.entry_score - b.entry_score);
    const bottomQuartileCount = Math.max(1, Math.floor(sortedByEntry.length * 0.25));
    const bottomQuartileStudents = sortedByEntry.slice(0, bottomQuartileCount);
    const bottomQuartileRates = bottomQuartileStudents.map((s) => {
        const idx = students.indexOf(s);
        return calculateScoreValueAddedRate(entryZScores[idx], exitZScores[idx], regressionBeta);
    });
    const bottomQuartileValueAddedRate = bottomQuartileRates.filter(Number.isFinite).length > 0
        ? average(bottomQuartileRates.filter(Number.isFinite))
        : undefined;
    // 11. 置信区间（基于增值率残差的标准误）
    const validRates = scoreValueAddedRates.filter(Number.isFinite);
    const se = calculateStandardError(validRates);
    const ci80 = calculateConfidenceInterval(shrunkAvgScoreValueAddedRate, se, 0.8);
    const ci95 = calculateConfidenceInterval(shrunkAvgScoreValueAddedRate, se, 0.95);
    return {
        class_name: className,
        subject,
        // ✅ 新增：原始分和标准分
        avg_score_entry: avgEntryScore,
        avg_score_exit: avgExitScore,
        avg_score_standard_entry: avgStandardEntryScore,
        avg_score_standard_exit: avgStandardExitScore,
        // 分数增值（已收缩）
        avg_score_value_added_rate: shrunkAvgScoreValueAddedRate,
        progress_student_ratio: progressStudentRatio,
        avg_z_score_change: avgZScoreChange,
        // 学生统计
        total_students: students.length,
        // 统计有效性
        warnings: [
            ...(students.length < 15 ? ["样本量不足15人，结果仅供参考"] : []),
            ...(lowCorrelationWarning
                ? ["入口与出口考试相关性较低（跨量纲），增值结果仅供参考"]
                : []),
        ],
        // 公平性指标
        bottom_quartile_value_added_rate: bottomQuartileValueAddedRate,
        // 置信区间
        value_added_rate_se: se,
        ci_lower_80: ci80.lower,
        ci_upper_80: ci80.upper,
        ci_lower_95: ci95.lower,
        ci_upper_95: ci95.upper,
    };
}
/**
 * 添加排名信息
 */
function addRankings(results) {
    // 按分数增值率降序排序
    const sorted = [...results].sort((a, b) => b.avg_score_value_added_rate - a.avg_score_value_added_rate);
    // 添加排名
    sorted.forEach((result, index) => {
        result.rank_in_grade = index + 1;
        result.total_classes = results.length;
    });
}
// ============================================
// 辅助函数
// ============================================
/**
 * 按科目分组计算班级增值
 */
export function calculateClassValueAddedBySubject(allStudentGrades, levelDefinitions) {
    const gradesBySubject = groupBy(allStudentGrades, (s) => s.subject);
    const results = {};
    for (const [subject, grades] of Object.entries(gradesBySubject)) {
        results[subject] = calculateClassValueAdded({
            studentGrades: grades,
            subject,
            levelDefinitions,
            gradeStudents: grades, // 使用该科目的所有学生作为年级数据
        });
    }
    return results;
}
