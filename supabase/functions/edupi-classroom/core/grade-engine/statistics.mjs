// 私有移植：Headteacher-helper/src/grade-engine/statistics.ts
// 用户授权日期：2026-11-13；原文件 SHA-256：3dfb2fe83ba16ff0f8d9294566056f1129ba981457f737cfd2b2f2e1c124faca
// 原项目未提供开源许可；不授予再分发许可。改动说明见 SOURCE.md。
/**
 * 统计计算工具函数
 * 用于增值评价的核心统计计算
 */
// ============================================
// 基础统计函数
// ============================================
/**
 * 计算标准差（P0修复：使用样本标准差公式）
 *
 * 样本标准差公式：σ = sqrt(Σ(x-μ)² / (n-1))
 * 使用n-1而非n，提供无偏估计
 */
export function calculateStandardDeviation(values) {
    if (values.length === 0)
        return 0;
    if (values.length === 1)
        return 0; // 单个样本标准差为0
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    // P0修复：使用样本标准差公式（除以n-1而非n）
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
/**
 * 计算Z-Score（标准分）
 */
export function calculateZScore(value, mean, stdDev) {
    if (stdDev === 0)
        return 0;
    return (value - mean) / stdDev;
}
/**
 * 计算所有值的Z-Score
 */
export function calculateZScores(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = calculateStandardDeviation(values);
    return values.map((val) => calculateZScore(val, mean, stdDev));
}
/**
 * 计算中位数
 */
export function calculateMedian(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}
/**
 * 计算四分位数
 */
export function calculateQuartiles(values) {
    if (values.length === 0)
        return { q1: 0, q2: 0, q3: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const q2 = calculateMedian(sorted);
    const mid = Math.floor(sorted.length / 2);
    const lowerHalf = sorted.slice(0, mid);
    const upperHalf = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
    const q1 = calculateMedian(lowerHalf);
    const q3 = calculateMedian(upperHalf);
    return { q1, q2, q3 };
}
/**
 * 计算完整统计数据
 */
export function calculateStatistics(values) {
    if (values.length === 0) {
        return {
            count: 0,
            sum: 0,
            mean: 0,
            median: 0,
            std_dev: 0,
            min: 0,
            max: 0,
        };
    }
    const sum = values.reduce((acc, val) => acc + val, 0);
    const mean = sum / values.length;
    const std_dev = calculateStandardDeviation(values);
    const median = calculateMedian(values);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const { q1, q3 } = calculateQuartiles(values);
    return {
        count: values.length,
        sum,
        mean,
        median,
        std_dev,
        min,
        max,
        q1,
        q3,
    };
}
// ============================================
// 百分位和排名计算
// ============================================
/**
 * 计算百分位（P0修复：明确语义统一）
 *
 * 使用升序排列 + 标准百分位公式，确保"高分=高百分位"的语义一致性
 * 例如：
 * - 分数最高的学生：百分位=1.0（100th percentile，超过100%的数据）
 * - 分数最低的学生：百分位=0.0（0th percentile，超过0%的数据）
 *
 * 标准公式：percentile = (rank - 1) / (n - 1)
 * 其中rank是从1开始的升序排名
 *
 * @param value 目标值
 * @param allValues 所有值的数组
 * @returns 百分位（0-1），值越大表示排名越高
 */
export function calculatePercentile(value, allValues) {
    if (allValues.length === 0)
        return 0;
    if (allValues.length === 1)
        return 1; // 单个值百分位为1
    // 升序排列：低分在前，高分在后
    const sortedValues = [...allValues].sort((a, b) => a - b);
    // 找到第一个大于等于value的位置（严格升序排名）
    let rank = sortedValues.findIndex((v) => v >= value);
    if (rank === -1)
        rank = sortedValues.length - 1; // value大于所有值
    rank = rank + 1; // 转换为从1开始的排名
    // 标准百分位公式
    return (rank - 1) / (allValues.length - 1);
}
/**
 * 根据百分位获取值
 * @param percentile 百分位（0-1）
 * @param allValues 所有值的数组
 */
export function getValueAtPercentile(percentile, allValues) {
    if (allValues.length === 0)
        return 0;
    const sortedValues = [...allValues].sort((a, b) => b - a); // 降序
    const index = Math.floor(percentile * allValues.length);
    return sortedValues[Math.min(index, sortedValues.length - 1)];
}
/**
 * 计算排名
 * @param value 目标值
 * @param allValues 所有值的数组
 * @param descending 是否降序（true=分数越高排名越前）
 */
export function calculateRank(value, allValues, descending = true) {
    if (allValues.length === 0)
        return 0;
    const sortedValues = [...allValues].sort((a, b) => descending ? b - a : a - b);
    const rank = sortedValues.findIndex((v) => v === value) + 1;
    return rank;
}
/**
 * 获取百分位数据（包括值、百分位、排名）
 */
export function getPercentileData(value, allValues) {
    const percentile = calculatePercentile(value, allValues);
    const rank = calculateRank(value, allValues);
    return {
        value,
        percentile,
        rank,
        total: allValues.length,
    };
}
// ============================================
// 等级判定函数
// ============================================
/**
 * 根据百分位判定等级
 * @param percentile 百分位（0-1）
 * @param levelDefinitions 等级定义数组
 */
export function determineLevel(percentile, levelDefinitions) {
    for (const def of levelDefinitions) {
        if (percentile >= def.percentile.min && percentile < def.percentile.max) {
            return def.level;
        }
    }
    // 默认返回最低等级
    return "C";
}
/**
 * 按Z分数判定等级（深圳九段评价标准）
 * z_score区间：min=null表示-∞，max=null表示+∞
 * 1段: Z≥1.75, 2段:[1.25,1.75), ..., 9段: Z<-1.75
 */
export function determineLevelByZScore(zScore, levelDefinitions) {
    for (const def of levelDefinitions) {
        if (!def.z_score)
            continue;
        const { min, max } = def.z_score;
        const aboveMin = min === null || zScore >= min;
        const belowMax = max === null || zScore < max;
        if (aboveMin && belowMax)
            return def.level;
    }
    // 回退到百分位判定（兼容六段）
    return "C";
}
/**
 * 判断配置是否使用Z分段制
 */
export function isZScoreBasedConfig(levelDefinitions) {
    return levelDefinitions.some((d) => d.z_score !== undefined);
}
/**
 * 批量判定等级
 */
export function determineLevels(values, levelDefinitions) {
    return values.map((value) => {
        const percentile = calculatePercentile(value, values);
        return determineLevel(percentile, levelDefinitions);
    });
}
/**
 * 获取等级值（用于比较）
 */
export function getLevelValue(level) {
    const levelMap = {
        "A+": 6,
        A: 5,
        "B+": 4,
        B: 3,
        "C+": 2,
        C: 1,
        // 九段：1段最优=9分，9段最差=1分
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
    return levelMap[level] || 0;
}
/**
 * 比较两个等级
 * @returns 正数表示level1 > level2，负数表示level1 < level2
 */
export function compareLevels(level1, level2) {
    return getLevelValue(level1) - getLevelValue(level2);
}
/**
 * 计算等级变化
 * @returns 正数表示提升，负数表示降低
 */
export function calculateLevelChange(entryLevel, exitLevel) {
    return getLevelValue(exitLevel) - getLevelValue(entryLevel);
}
// ============================================
// 增值计算函数
// ============================================
/**
 * 计算OLS回归斜率 β（用于均值回归修正）
 * 当入口/出口分数都是Z分数时，截距α≈0，只需计算斜率
 * β = Σ(entryZ_i × exitZ_i) / Σ(entryZ_i²)
 */
export function calculateOLSBeta(entryZScores, exitZScores) {
    if (entryZScores.length < 2)
        return 1;
    const sumXY = entryZScores.reduce((sum, x, i) => sum + x * exitZScores[i], 0);
    const sumXX = entryZScores.reduce((sum, x) => sum + x * x, 0);
    return sumXX === 0 ? 1 : sumXY / sumXX;
}
/**
 * 计算分数增值率（OLS均值回归修正）
 * 公式：出口Z分数 - β × 入口Z分数
 * @param entryZScore 入口Z分数
 * @param exitZScore 出口Z分数
 * @param regressionBeta OLS回归斜率β（默认1，兼容旧逻辑）
 * @returns 回归修正后的增值（正值表示超预期进步，负值表示低于预期）
 */
export function calculateScoreValueAddedRate(entryZScore, exitZScore, regressionBeta = 1) {
    return exitZScore - regressionBeta * entryZScore;
}
/**
 * 贝叶斯收缩：小样本时将增值率向全年级均值（0）收缩
 * 公式：shrunk = rate * (n / (n + k))，k=15 为收缩强度
 * n=30 时保留 2/3；n=15 时收缩 50%；n=5 时收缩 75%
 */
export function shrinkValueAddedRate(rate, sampleSize, k = 15) {
    if (sampleSize <= 0)
        return 0;
    const shrinkFactor = sampleSize / (sampleSize + k);
    return rate * shrinkFactor;
}
/**
 * 计算进步人数占比
 */
export function calculateProgressRatio(entryScores, exitScores) {
    if (entryScores.length === 0 || entryScores.length !== exitScores.length) {
        return 0;
    }
    let progressCount = 0;
    for (let i = 0; i < entryScores.length; i++) {
        if (exitScores[i] > entryScores[i]) {
            progressCount++;
        }
    }
    return progressCount / entryScores.length;
}
/**
 * 判断是否巩固（保持最高等级）
 */
export function isConsolidated(entryLevel, exitLevel, highestLevel = "A+") {
    return entryLevel === highestLevel && exitLevel === highestLevel;
}
/**
 * 判断是否转化（等级提升）
 */
export function isTransformed(entryLevel, exitLevel) {
    return calculateLevelChange(entryLevel, exitLevel) > 0;
}
/**
 * 计算巩固率
 * @param students 学生数据数组，每个元素包含入口和出口等级
 */
export function calculateConsolidationRate(students) {
    const highestLevelStudents = students.filter((s) => s.entryLevel === "A+");
    if (highestLevelStudents.length === 0)
        return 0;
    const consolidatedCount = highestLevelStudents.filter((s) => s.exitLevel === "A+").length;
    return consolidatedCount / highestLevelStudents.length;
}
/**
 * 计算转化率
 * @param students 学生数据数组
 */
export function calculateTransformationRate(students) {
    // 可提升学生：入口不是最高等级的学生
    const improvableStudents = students.filter((s) => s.entryLevel !== "A+");
    if (improvableStudents.length === 0)
        return 0;
    const transformedCount = improvableStudents.filter((s) => isTransformed(s.entryLevel, s.exitLevel)).length;
    return transformedCount / improvableStudents.length;
}
/**
 * 计算贡献率（P0修复：处理年级下降的特殊情况）
 *
 * 正常情况（年级上升）：贡献率 = 教师增量 / 年级增量
 * 特殊情况（年级下降）：
 * - 教师上升 > 0, 年级下降 < 0 → 贡献率标记为"逆势增长"（正向贡献）
 * - 教师下降 < 0, 年级下降 < 0 → 按比例计算负向贡献
 *
 * @param teacherExcellentGain 该教师的优秀人数净增加
 * @param gradeExcellentGain 全年级的优秀人数净增加
 * @returns 贡献率（正常情况为比例值，年级下降时需特殊解释）
 */
export function calculateContributionRate(teacherExcellentGain, gradeExcellentGain) {
    if (gradeExcellentGain === 0)
        return 0;
    // P0修复：处理年级下降但教师上升的情况
    if (gradeExcellentGain < 0 && teacherExcellentGain > 0) {
        // 年级整体下降，但该教师逆势增长
        // 返回正值，表示正向贡献（在展示时需要特殊标注"逆势增长"）
        return Math.abs(teacherExcellentGain / gradeExcellentGain);
    }
    // 正常情况：年级上升，或教师与年级同向变化
    return teacherExcellentGain / gradeExcellentGain;
}
/**
 * 计算优秀人数净增加
 */
export function calculateExcellentGain(entryLevels, exitLevels, excellentLevels = ["A+", "A"]) {
    const entryExcellentCount = entryLevels.filter((level) => excellentLevels.includes(level)).length;
    const exitExcellentCount = exitLevels.filter((level) => excellentLevels.includes(level)).length;
    return exitExcellentCount - entryExcellentCount;
}
// ============================================
// 学科偏离度计算
// ============================================
/**
 * 计算学科偏离度（使用标准差）
 * @param subjectValueAddedRates 各科目的增值率数组
 */
export function calculateSubjectDeviation(subjectValueAddedRates) {
    return calculateStandardDeviation(subjectValueAddedRates);
}
/**
 * 计算学科偏离得分
 * @param totalValueAdded 总分增值率
 * @param subjectDeviation 学科偏离度
 * @param w1 总分增值权重（默认0.6）
 * @param w2 偏离度权重（默认0.4）
 */
export function calculateSubjectBalanceScore(totalValueAdded, subjectDeviation, w1 = 0.6, w2 = 0.4) {
    // 偏离度越小越好，所以用负数
    return w1 * totalValueAdded - w2 * subjectDeviation;
}
// ============================================
// 工具函数
// ============================================
/**
 * 安全除法（避免除以0）
 */
export function safeDivide(numerator, denominator, defaultValue = 0) {
    if (denominator === 0)
        return defaultValue;
    return numerator / denominator;
}
/**
 * 格式化百分比
 */
export function formatPercentage(value, decimals = 2) {
    return `${(value * 100).toFixed(decimals)}%`;
}
/**
 * 格式化小数
 */
export function formatDecimal(value, decimals = 2) {
    return value.toFixed(decimals);
}
/**
 * 对数组进行分组
 */
export function groupBy(array, keyFn) {
    return array.reduce((groups, item) => {
        const key = keyFn(item);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, Object.create(null));
}
// ============================================
// 异常值检测
// ============================================
/**
 * 检测Z分数异常值
 * @param zScores Z分数数组
 * @param threshold 异常值阈值（默认3，表示3倍标准差）
 * @returns 异常值的索引数组
 */
export function detectOutliers(zScores, threshold = 3) {
    return zScores
        .map((z, index) => ({ z, index }))
        .filter(({ z }) => Math.abs(z) > threshold)
        .map(({ index }) => index);
}
/**
 * 过滤掉Z分数异常值
 * @param values 原始数值数组
 * @param threshold 异常值阈值（默认3）
 * @returns 过滤后的数值数组
 */
export function filterOutliers(values, threshold = 3) {
    if (values.length === 0)
        return [];
    const zScores = calculateZScores(values);
    const outlierIndices = new Set(detectOutliers(zScores, threshold));
    return values.filter((_, index) => !outlierIndices.has(index));
}
/**
 * 获取异常值信息
 * @param values 原始数值数组
 * @param threshold 异常值阈值
 * @returns 异常值及其索引
 */
export function getOutlierInfo(values, threshold = 3) {
    if (values.length === 0)
        return [];
    const zScores = calculateZScores(values);
    const outlierIndices = detectOutliers(zScores, threshold);
    return outlierIndices.map((index) => ({
        index,
        value: values[index],
        zScore: zScores[index],
    }));
}
// ============================================
// 置信区间
// ============================================
/**
 * 计算均值的标准误（SEM = σ / sqrt(n)）
 */
export function calculateStandardError(values) {
    const n = values.length;
    if (n <= 1)
        return 0;
    return calculateStandardDeviation(values) / Math.sqrt(n);
}
/**
 * 计算均值的置信区间
 * @param mean 点估计（已收缩的增值率）
 * @param se 标准误
 * @param level 置信水平：0.80 → z=1.28，0.95 → z=1.96
 */
export function calculateConfidenceInterval(mean, se, level = 0.95) {
    const z = level === 0.8 ? 1.282 : 1.96;
    const margin = z * se;
    return { lower: mean - margin, upper: mean + margin, margin };
}
