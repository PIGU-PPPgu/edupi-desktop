// 私有移植：Headteacher-helper/src/grade-engine/studentValueAddedService.ts
// 用户授权日期：2026-11-13；原文件 SHA-256：d50b0a35cc2b267977fd4faed60e69b84cd9d718fee46c6550c1bf07fe9fc9de
// 原项目未提供开源许可；不授予再分发许可。改动说明见 SOURCE.md。
/**
 * 学生增值评价计算服务
 * 用于计算单个学生的增值指标
 */
import { calculateZScores, calculatePercentile, determineLevel, determineLevelByZScore, isZScoreBasedConfig, calculateScoreValueAddedRate, calculateOLSBeta, } from "./statistics.mjs";
// ============================================
// 核心计算函数
// ============================================
/**
 * 计算学生增值评价
 * ✅ 正确计算Z分数、等级和增值率
 */
export function calculateStudentValueAdded(params) {
    const { allStudents, subject, levelDefinitions } = params;
    if (allStudents.length === 0) {
        return [];
    }
    // 1. 计算全年级的Z分数
    const allEntryScores = allStudents.map((s) => s.entry_score);
    const allExitScores = allStudents.map((s) => s.exit_score);
    const entryZScores = calculateZScores(allEntryScores);
    const exitZScores = calculateZScores(allExitScores);
    // 当相关性过低时，限制beta最小值为0.8，与classValueAddedService保持一致
    const regressionBeta = Math.max(calculateOLSBeta(entryZScores, exitZScores), 0.8);
    // 2. 计算百分位和等级（支持六段和九段）
    const useZScore = isZScoreBasedConfig(levelDefinitions);
    const entryLevels = useZScore
        ? entryZScores.map((z) => determineLevelByZScore(z, levelDefinitions))
        : allEntryScores.map((score) => determineLevel(calculatePercentile(score, allEntryScores), levelDefinitions));
    const exitLevels = useZScore
        ? exitZScores.map((z) => determineLevelByZScore(z, levelDefinitions))
        : allExitScores.map((score) => determineLevel(calculatePercentile(score, allExitScores), levelDefinitions));
    // 3. 为每个学生计算增值数据
    const results = allStudents.map((student, index) => {
        const entryZScore = entryZScores[index];
        const exitZScore = exitZScores[index];
        // 确定等级（已在上方按配置类型预计算）
        const entryLevel = entryLevels[index];
        const exitLevel = exitLevels[index];
        // 计算标准分（500 + 100 * Z）
        const entryStandardScore = 500 + 100 * entryZScore;
        const exitStandardScore = 500 + 100 * exitZScore;
        // 计算增值率
        const scoreValueAddedRate = calculateScoreValueAddedRate(entryZScore, exitZScore, regressionBeta);
        // 计算等级变化
        const levelChange = calculateLevelChange(entryLevel, exitLevel);
        // 判断是否巩固/转化
        // 九段评价：顶级是"1段"；六段评价：顶级是"A+"
        const topLevel = useZScore ? "1段" : "A+";
        const isConsolidated = entryLevel === topLevel && exitLevel === topLevel;
        const isTransformed = levelChange > 0;
        return {
            student_id: student.student_id,
            student_name: student.student_name,
            class_name: student.class_name,
            subject,
            // 分数数据
            entry_score: student.entry_score,
            exit_score: student.exit_score,
            entry_z_score: entryZScore,
            exit_z_score: exitZScore,
            score_value_added: exitStandardScore - entryStandardScore,
            score_value_added_rate: scoreValueAddedRate,
            // 能力数据
            entry_level: entryLevel,
            exit_level: exitLevel,
            level_change: levelChange,
            is_consolidated: isConsolidated,
            is_transformed: isTransformed,
        };
    });
    return results;
}
// ============================================
// 辅助函数
// ============================================
/**
 * 计算等级变化
 * @returns 正数表示进步，负数表示退步，0表示保持
 */
function calculateLevelChange(entryLevel, exitLevel) {
    const levelOrder = {
        "A+": 6,
        A: 5,
        "B+": 4,
        B: 3,
        "C+": 2,
        C: 1,
        "1段": 9,
        "2段": 8,
        "3段": 7,
        "4段": 6,
        "5段": 5,
        "6段": 4,
        "7段": 3,
        "8段": 2,
        "9段": 1,
    };
    return (levelOrder[exitLevel] ?? 0) - (levelOrder[entryLevel] ?? 0);
}
