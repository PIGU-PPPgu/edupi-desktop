// 私有移植：Headteacher-helper/src/pages/Seating.tsx
// 用户授权日期：2026-11-13；原文件 SHA-256：fd9d256f02cbccea509596d37a5cadfb164556b08266d206ed24209edaf1442c
// 原项目未提供开源许可；不授予再分发许可。保留移动端完整画像/邻座/互补评分。
// 修订：精确组容量、接回性别配对 rest、确定性硬约束求解及人工重验。
import { normalizeGender, buildGenderDeskPairs, meetsSeatingGenderStrategy } from './student-gender.mjs';

const SEARCH_LIMIT = Symbol('seating computation budget');
// Shared by soft grouping, candidate expansion and backtracking. The work cap
// is deterministic; the deadline also bounds expensive individual candidates.
function computationBudget() {
    const deadline = performance.now() + 2000;
    let work = 0;
    return (amount = 1) => {
        work += amount;
        if (work > 5000000 || performance.now() >= deadline) throw SEARCH_LIMIT;
    };
}

const getSlotFromBand = (band)=>{
    if (band === 'top') return 1;
    if (band === 'upper') return 2;
    if (band === 'middle') return 3;
    if (band === 'support') return 4;
    return 0;
};
const sciSubjects = [
    '数学',
    '物理',
    '化学',
    '生物',
    '地理'
];
const artSubjects = [
    '语文',
    '英语',
    '历史',
    '道法',
    '政治'
];
const normalizeTrait01 = (value)=>{
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed / 5));
};
const buildGradeDetail = (grade, subjectFullMarks = {})=>{
    const scores = grade?.scores || {};
    const values = Object.values(scores).filter(value => typeof value === 'number' && Number.isFinite(value));
    const total = Number.isFinite(Number(grade?.total)) ? Number(grade.total) : values.reduce((sum, value)=>sum + value, 0);
    const mean = values.length ? total / values.length : 0;
    const variance = values.length ? values.reduce((sum, value)=>sum + Math.pow(value - mean, 2), 0) / values.length : 0;
    const biasIndex = mean > 0 ? Math.sqrt(variance) / mean : 0;
    let arts = 0;
    let scis = 0;
    let artCount = 0;
    let sciCount = 0;
    Object.entries(scores).forEach(([subject, rawValue])=>{
        if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return;
        const value = rawValue;
        const full = Number(subjectFullMarks?.[subject]) || 100;
        const pct = value / full * 100;
        if (artSubjects.includes(subject)) {
            arts += pct;
            artCount += 1;
        }
        if (sciSubjects.includes(subject)) {
            scis += pct;
            sciCount += 1;
        }
    });
    const diff = (artCount ? arts / artCount : 0) - (sciCount ? scis / sciCount : 0);
    const biasDir = biasIndex < 0.15 ? '均衡' : diff > 10 ? '文科强' : diff < -10 ? '理科强' : '均衡';
    return {
        total,
        biasIndex,
        biasDir
    };
};
const stableProfileCompare = (a, b)=>{
    if (Math.abs(b.risk - a.risk) > 1e-9) return b.risk - a.risk;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return String(a.student.name || '').localeCompare(String(b.student.name || ''), 'zh-Hans-CN');
};
const isComplementDeskPair = (a, b)=>{
    const left = a?.slot || 0;
    const right = b?.slot || 0;
    return left === 1 && right === 4 || left === 4 && right === 1 || left === 2 && right === 3 || left === 3 && right === 2;
};
const neighborPenalty = (a, b)=>{
    if (!a || !b) return 0;
    let penalty = 0;
    if (a.talkative > 0.6 && b.talkative > 0.6) penalty += 5;
    else if (a.talkative > 0.4 && b.talkative > 0.4) penalty += 2;
    if (a.selfControl < 0.4 && b.selfControl < 0.4) penalty += 4;
    if (a.emotionStable < 0.45 && b.emotionStable < 0.45) penalty += 2.2;
    if (a.biasDir && b.biasDir && a.biasDir === b.biasDir && a.biasDir !== '均衡') penalty += 2.5;
    if (a.biasIndex > 0.25 && b.biasIndex > 0.25) penalty += 2;
    if (a.leadership > 0.7 && b.leadership > 0.7) penalty -= 0.8;
    return penalty;
};
const pairScore = (a, b, strategy = 'ignore')=>{
    if (!a || !b) return 0;
    let score = neighborPenalty(a, b);
    if (isComplementDeskPair(a, b)) score -= 2;
    if (a.slot && b.slot && a.slot === b.slot) score += 2;
    if (!meetsSeatingGenderStrategy(a.gender, b.gender, strategy)) score += 60;
    else if (strategy !== 'ignore') score -= 24;
    return score;
};
const buildDeskPairs = (profiles, strategy)=>{
    if (strategy !== 'ignore') {
        const { pairs, rest } = buildGenderDeskPairs({
            items: profiles,
            strategy,
            getGender: (profile)=>profile.gender,
            compare: stableProfileCompare
        });
        return {
            pairs14: pairs.filter((_, index)=>index % 2 === 0).map((pair)=>[
                    ...pair
                ]),
            pairs23: pairs.filter((_, index)=>index % 2 === 1).map((pair)=>[
                    ...pair
                ]),
            singles: rest
        };
    }
    const bySlot = {
        1: [],
        2: [],
        3: [],
        4: []
    };
    const noSlot = [];
    profiles.forEach((profile)=>{
        if (profile.slot >= 1 && profile.slot <= 4) bySlot[profile.slot].push(profile);
        else noSlot.push(profile);
    });
    [
        1,
        2,
        3,
        4
    ].forEach((slot)=>bySlot[slot].sort(stableProfileCompare));
    const pairSlots = (leftSlot, rightSlot)=>{
        const left = [
            ...bySlot[leftSlot]
        ];
        const right = [
            ...bySlot[rightSlot]
        ].sort((a, b)=>stableProfileCompare(b, a));
        const pairs = [];
        while(left.length && right.length)pairs.push([
            left.shift(),
            right.shift()
        ]);
        return {
            pairs,
            rest: [
                ...left,
                ...right
            ]
        };
    };
    const p14 = pairSlots(1, 4);
    const p23 = pairSlots(2, 3);
    return {
        pairs14: p14.pairs,
        pairs23: p23.pairs,
        singles: [
            ...p14.rest,
            ...p23.rest,
            ...noSlot
        ].sort(stableProfileCompare)
    };
};
const groupMetrics = (members)=>{
    const metrics = {
        risk: 0,
        talk: 0,
        self: 0,
        highBias: 0,
        lowSelf: 0,
        lib: 0,
        sci: 0,
        slots: {},
        size: members.length
    };
    members.forEach((profile)=>{
        metrics.risk += profile.risk;
        metrics.talk += profile.talkative;
        metrics.self += profile.selfControl;
        if (profile.biasIndex > 0.25) metrics.highBias += 1;
        if (profile.selfControl < 0.4) metrics.lowSelf += 1;
        if (profile.biasDir === '文科强') metrics.lib += 1;
        if (profile.biasDir === '理科强') metrics.sci += 1;
        if (profile.slot) metrics.slots[profile.slot] = (metrics.slots[profile.slot] || 0) + 1;
    });
    return metrics;
};
const scoreGroupAddition = (group, piece, capacity, avgRisk, strategy)=>{
    const next = group.concat(piece);
    const metrics = groupMetrics(next);
    const n = Math.max(1, next.length);
    let score = 0;
    score += Math.abs(capacity - next.length) * 1.8;
    score += Math.abs(metrics.risk / n - avgRisk) * 1.3;
    score += Math.max(0, metrics.talk / n - 0.58) * 10;
    score += Math.max(0, 0.48 - metrics.self / n) * 10;
    score += Math.max(0, metrics.lowSelf - 1) * 8;
    score += Math.max(0, metrics.highBias - 2) * 3;
    score += Math.max(0, Math.max(metrics.lib, metrics.sci) - Math.ceil(n * 0.65)) * 5;
    [
        1,
        2,
        3,
        4
    ].forEach((slot)=>{
        score += Math.max(0, (metrics.slots[slot] || 0) - Math.ceil(capacity / 4)) * 2;
    });
    if (piece.length === 2) score += pairScore(piece[0], piece[1], strategy) * 0.8;
    return score;
};
const groupOrderScore = (order, strategy)=>{
    let score = 0;
    const edges = [
        [
            0,
            1,
            1
        ],
        [
            2,
            3,
            1
        ],
        [
            4,
            5,
            1
        ],
        [
            0,
            2,
            0.7
        ],
        [
            1,
            3,
            0.7
        ],
        [
            2,
            4,
            0.7
        ],
        [
            3,
            5,
            0.7
        ]
    ];
    edges.forEach(([a, b, weight])=>{
        if (a < order.length && b < order.length) score += neighborPenalty(order[a], order[b]) * weight;
    });
    [
        [
            0,
            1,
            1,
            4
        ],
        [
            2,
            3,
            2,
            3
        ]
    ].forEach(([a, b, leftSlot, rightSlot])=>{
        if (a >= order.length || b >= order.length) return;
        const left = order[a]?.slot || 0;
        const right = order[b]?.slot || 0;
        if (left === leftSlot && right === rightSlot) score -= 20;
        else if (left === rightSlot && right === leftSlot) score += 8;
        else if (isComplementDeskPair(order[a], order[b])) score += 12;
        else score += 30;
    });
    [
        [
            0,
            1
        ],
        [
            2,
            3
        ]
    ].forEach(([a, b])=>{
        if (a >= order.length || b >= order.length) return;
        if (meetsSeatingGenderStrategy(order[a].gender, order[b].gender, strategy)) score -= strategy === 'ignore' ? 0 : 80;
        else score += strategy === 'ignore' ? 0 : 100;
    });
    for(let index = 4; index < order.length; index += 1){
        const profile = order[index];
        score += profile.risk * 0.2;
        if (profile.slot && order.slice(0, 4).some((item)=>item.slot === profile.slot)) score -= 1;
    }
    return score;
};
const optimizeGroupOrder = (members, strategy, spend)=>{
    if (members.length <= 2 || members.length > 7) return members;
    const arr = [
        ...members
    ];
    let best = [
        ...arr
    ];
    let bestScore = Infinity;
    const visit = (start)=>{
        spend();
        if (start === arr.length) {
            const score = groupOrderScore(arr, strategy);
            if (score < bestScore) {
                bestScore = score;
                best = [
                    ...arr
                ];
            }
            return;
        }
        for(let index = start; index < arr.length; index += 1){
            [arr[start], arr[index]] = [
                arr[index],
                arr[start]
            ];
            visit(start + 1);
            [arr[start], arr[index]] = [
                arr[index],
                arr[start]
            ];
        }
    };
    visit(0);
    return best;
};

// Public contract: zero-based rows/columns, one-based groups. Front means row 0.
import { object, issue, integer, ids, rosterFor, studentGender } from './student-gender.mjs';

function normalize(input, students, issues) {
  const raw = object(input) ? input : {};
  if (!object(input)) issue(issues, 'invalid_input', '排座输入必须是对象');
  const { roster, selected, className } = rosterFor(raw, students, issues);
  const rows = integer(raw.rows, Math.min(30, Math.max(1, Math.ceil(roster.length / 6))), 1, 30, '排数', issues);
  const columns = integer(raw.columns, 6, 1, 20, '列数', issues);
  const group_size = integer(raw.group_size, 4, 1, 6, '每组人数', issues);
  if (rows * columns > 200) issue(issues, 'grid_capacity_limit', '教室最多支持 200 个座位，请减少排数或列数');
  const mode = raw.mode ?? 'seating';
  if (!['seating', 'groups'].includes(mode)) issue(issues, 'invalid_mode', '请选择排座或分组模式');
  const constraints = object(raw.constraints) ? raw.constraints : {};
  if (raw.constraints !== undefined && !object(raw.constraints)) issue(issues, 'invalid_constraints', '排座约束必须是对象');
  const gender_strategy = constraints.gender_strategy ?? 'ignore';
  if (!['ignore', 'mixed', 'same'].includes(gender_strategy)) issue(issues, 'invalid_gender_strategy', '性别策略无效');
  const features = {};
  if (raw.features !== undefined && !object(raw.features)) issue(issues, 'invalid_features', '学生画像必须是对象');
  for (const [id, source] of Object.entries(object(raw.features) ? raw.features : {})) {
    if (!selected.includes(id)) { issue(issues, 'feature_student_missing', `画像学生未参与排座：${id}`); continue; }
    if (!object(source)) { issue(issues, 'invalid_feature', `学生画像无效：${id}`); continue; }
    const feature = {};
    if (source.gender !== undefined) feature.gender = normalizeGender(source.gender);
    if (source.front !== undefined) {
      if (typeof source.front !== 'boolean') issue(issues, 'invalid_front', '前排要求必须是布尔值');
      else feature.front = source.front;
    }
    for (const key of ['height', 'score', 'activity', 'self_control', 'emotion', 'leadership']) {
      if (source[key] === undefined) continue;
      const max = ['activity', 'self_control', 'emotion', 'leadership'].includes(key) ? 5 : Infinity;
      if (typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0 || source[key] > max) issue(issues, 'invalid_feature', `画像 ${key} 必须是 0 至 ${max === Infinity ? '合理上限' : max} 的数值`);
      else feature[key] = source[key];
    }
    features[id] = feature;
  }
  const avoid_pairs = [];
  if (constraints.avoid_pairs !== undefined && !Array.isArray(constraints.avoid_pairs)) issue(issues, 'invalid_avoid_pairs', '分离约束必须是学生对列表');
  for (const pair of Array.isArray(constraints.avoid_pairs) ? constraints.avoid_pairs : []) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(id => !selected.includes(id)) || pair[0] === pair[1]) issue(issues, 'invalid_avoid_pair', '分离约束必须包含两名不同的参与学生');
    else avoid_pairs.push([...pair]);
  }
  const fixed_seats = [];
  if (constraints.fixed_seats !== undefined && !Array.isArray(constraints.fixed_seats)) issue(issues, 'invalid_fixed_seats', '固定座位必须是列表');
  for (const seat of Array.isArray(constraints.fixed_seats) ? constraints.fixed_seats : []) {
    if (!object(seat) || !selected.includes(seat.student_id) || !Number.isInteger(seat.row) || !Number.isInteger(seat.column) || seat.row < 0 || seat.row >= rows || seat.column < 0 || seat.column >= columns) { issue(issues, 'invalid_fixed_seat', '固定座位超出范围或学生未参与'); continue; }
    if (fixed_seats.some(s => s.student_id === seat.student_id || s.row === seat.row && s.column === seat.column)) issue(issues, 'fixed_seat_conflict', '固定座位重复或同一学生固定多次');
    fixed_seats.push({ student_id: seat.student_id, row: seat.row, column: seat.column });
  }
  if (rows * columns < roster.length) issue(issues, 'capacity_exceeded', '座位容量不足以容纳全部学生');
  if (roster.filter(s => features[s.student_id]?.front).length > columns) issue(issues, 'front_capacity', '第一排座位不足以满足前排要求');
  for (const seat of fixed_seats) if (features[seat.student_id]?.front && seat.row !== 0) issue(issues, 'front_fixed_conflict', '固定座位与前排要求冲突');
  const normalized = { title: String(raw.title ?? '').trim(), class_name: className, mode, rows, columns, group_size, student_ids: selected, features, constraints: { gender_strategy, avoid_pairs, fixed_seats } };
  if (raw.exam_id !== undefined) normalized.exam_id = String(raw.exam_id);
  if (raw.assignments !== undefined) {
    if (!Array.isArray(raw.assignments)) issue(issues, 'invalid_assignments', '人工排座必须是列表');
    normalized.assignments = Array.isArray(raw.assignments) ? raw.assignments.map(a => object(a) ? { student_id: a.student_id, row: a.row, column: a.column, group: a.group } : {}) : [];
  }
  return { normalized, roster };
}

function profilesFor(input, roster, context, issues) {
  const exam = context?.exam;
  if (input.exam_id && (!exam || String(exam.id ?? exam.exam_id) !== input.exam_id)) issue(issues, 'exam_missing', '引用的考试不存在或编号不匹配');
  if (input.exam_id && exam?.input?.class_name && exam.input.class_name !== input.class_name) issue(issues, 'exam_class_mismatch', '只能引用同一班级的考试');
  const records = input.exam_id ? (exam?.result?.students ?? exam?.input?.records ?? exam?.input?.rows ?? exam?.records ?? []) : [];
  const scoreRows = new Map((exam?.input?.rows ?? []).map(r => [r.student_id, r]));
  const gradeMap = new Map((Array.isArray(records) ? records : []).map(r => [r.student_id, r]));
  const profiles = roster.map((student, index) => {
    const feature = input.features[student.student_id] ?? {};
    const linked = gradeMap.get(student.student_id);
    const grade = linked ? { ...scoreRows.get(student.student_id), ...linked } : undefined;
    const marks = Object.fromEntries((exam?.input?.subjects ?? []).map(s => [s.name, s.max_score]));
    const detail = buildGradeDetail(grade, exam?.input?.subject_full_marks ?? exam?.input?.full_marks ?? marks);
    const total = feature.score ?? (typeof grade?.total === 'number' && Number.isFinite(grade.total) ? grade.total : grade && Object.values(grade.scores ?? {}).length && Object.values(grade.scores).every(v => typeof v === 'number' && Number.isFinite(v)) ? detail.total : null);
    const talkative = normalizeTrait01(feature.activity ?? 2.5);
    const selfControl = normalizeTrait01(feature.self_control ?? 2.5);
    const leadership = normalizeTrait01(feature.leadership ?? 2.5);
    const emotionStable = normalizeTrait01(feature.emotion ?? 2.5);
    return { index, student: { ...student, _id: student.student_id }, grade, talkative, selfControl, leadership, emotionStable,
      total, biasIndex: detail.biasIndex, biasDir: detail.biasDir, slot: getSlotFromBand(grade?.band), rank: Number(grade?.rank) || 999,
      risk: talkative * 2 + (1 - selfControl) * 2 + detail.biasIndex * 1.5 + (1 - emotionStable) * 0.8 - leadership * 0.35,
      gender: feature.gender !== undefined ? normalizeGender(feature.gender) : studentGender(student), height: feature.height ?? null };
  });
  // Rank only supplied scores, never fabricate a score for missing data.
  const ranked = profiles.filter(p => p.total !== null).sort((a, b) => b.total - a.total || a.index - b.index);
  ranked.forEach((p, i) => { if (!p.slot) p.slot = Math.min(4, Math.floor(i * 4 / ranked.length) + 1); p.rank = i + 1; });
  return profiles;
}

function buildBalancedGroups(profiles, groupSize, strategy, spend) {
  const count = Math.ceil(profiles.length / groupSize);
  if (!count) return [];
  const capacities = Array.from({ length: count }, (_, i) => Math.floor(profiles.length / count) + (i < profiles.length % count ? 1 : 0));
  const groups = capacities.map(() => []);
  const { pairs14, pairs23, singles } = buildDeskPairs(profiles, strategy);
  const pieces = [...pairs14, ...pairs23, ...singles.map(p => [p])];
  const avgRisk = profiles.reduce((sum, p) => sum + p.risk, 0) / profiles.length;
  while (pieces.length) {
    const piece = pieces.shift();
    const available = groups.map((g, i) => {
      spend(g.length + piece.length);
      return { i, score: scoreGroupAddition(g, piece, capacities[i], avgRisk, strategy) };
    })
      .filter(({ i }) => groups[i].length + piece.length <= capacities[i]).sort((a, b) => a.score - b.score || a.i - b.i);
    if (available.length) groups[available[0].i].push(...piece);
    else if (piece.length > 1) pieces.unshift(...piece.map(p => [p]));
    else throw new Error('分组容量计算错误');
  }
  return groups.map(g => optimizeGroupOrder(g, strategy, spend));
}

const adjacent = (a, b) => a.row === b.row && Math.abs(a.column - b.column) === 1;
function validateAssignments(input, assignments, issues) {
  const selected = new Set(input.student_ids), seen = new Set(), occupied = new Set(), groups = new Map();
  const count = Math.ceil(selected.size / input.group_size);
  for (const a of assignments) {
    if (!selected.has(a.student_id)) issue(issues, 'assignment_student_missing', `排座学生未参与：${a.student_id ?? ''}`);
    if (seen.has(a.student_id)) issue(issues, 'duplicate_assignment', `学生重复排座：${a.student_id}`);
    seen.add(a.student_id);
    if (!Number.isInteger(a.row) || !Number.isInteger(a.column) || a.row < 0 || a.row >= input.rows || a.column < 0 || a.column >= input.columns) issue(issues, 'seat_out_of_bounds', '排座位置超出教室范围');
    const key = `${a.row}:${a.column}`;
    if (occupied.has(key)) issue(issues, 'seat_occupied', '同一座位不能安排多名学生');
    occupied.add(key);
    if (!Number.isInteger(a.group) || a.group < 1 || a.group > count) issue(issues, 'invalid_group', '分组编号超出范围');
    groups.set(a.group, (groups.get(a.group) ?? 0) + 1);
    if (input.features[a.student_id]?.front && a.row !== 0) issue(issues, 'front_required', '需要前排的学生必须安排在第一排');
  }
  for (const id of selected) if (!seen.has(id)) issue(issues, 'student_unassigned', `学生未排座：${id}`);
  for (let i = 1; i <= count; i++) {
    if (!groups.get(i)) issue(issues, 'empty_group', '不能存在空组');
    if (groups.get(i) > input.group_size) issue(issues, 'group_capacity', '分组人数超过容量');
  }
  for (const fixed of input.constraints.fixed_seats) {
    const a = assignments.find(a => a.student_id === fixed.student_id);
    if (!a || a.row !== fixed.row || a.column !== fixed.column) issue(issues, 'fixed_seat_violated', '排座未满足固定座位要求');
  }
  for (const [left, right] of input.constraints.avoid_pairs) {
    const a = assignments.find(a => a.student_id === left), b = assignments.find(a => a.student_id === right);
    if (a && b && (adjacent(a, b) || input.mode === 'groups' && a.group === b.group)) issue(issues, 'avoid_pair_violated', '需要分离的学生不能邻座或处于同一学习小组');
  }
}

function arrange(input, profiles, softGroups, issues, spend) {
  const preferred = softGroups.flat();
  const preferredIndex = new Map(preferred.map((p, i) => [p, i]));
  const groupOf = new Map(softGroups.flatMap((g, i) => g.map(p => [p.student._id, i + 1])));
  const fixed = new Map(input.constraints.fixed_seats.map(s => [s.student_id, s]));
  const lockedSlots = new Set(input.constraints.fixed_seats.map(s => s.row * input.columns + s.column));
  const hasHardConstraints = fixed.size > 0 || input.constraints.avoid_pairs.length > 0
    || Object.values(input.features).some(f => f.front);
  const avoided = new Map(profiles.map(p => [p.student._id, new Set()]));
  for (const [a, b] of input.constraints.avoid_pairs) { avoided.get(a).add(b); avoided.get(b).add(a); }
  const slots = Array.from({ length: input.rows * input.columns }, (_, i) => ({ row: Math.floor(i / input.columns), column: i % input.columns }));
  const capacities = softGroups.map(g => g.length);
  const placed = [], used = new Set(), assigned = new Set();
  const byId = new Map(profiles.map(p => [p.student._id, p]));
  const avgRisk = profiles.reduce((n, p) => n + p.risk, 0) / profiles.length;
  let nodes = 0;
  function candidates(p) {
    spend();
    const id = p.student._id;
    const groupOptions = input.mode === 'groups' ? softGroups.map((_, i) => i + 1) : [groupOf.get(id)];
    const availableGroups = groupOptions.flatMap(group => {
      spend(placed.length + 1);
      const members = placed.filter(a => a.group === group);
      if (members.length >= input.group_size || input.mode === 'groups' && members.some(a => avoided.get(id).has(a.student_id))) return [];
      let score = 0;
      if (input.mode === 'groups') {
        score = scoreGroupAddition(members.map(a => byId.get(a.student_id)), [p], capacities[group - 1], avgRisk, input.constraints.gender_strategy);
        if (group === groupOf.get(id)) score -= 4;
      }
      return [{ group, score }];
    });
    return slots.flatMap((s, index) => {
      spend();
      if (used.has(index) || input.features[id]?.front && s.row !== 0) return [];
      const lock = fixed.get(id);
      if (lock && (lock.row !== s.row || lock.column !== s.column)) return [];
      if (!lock && lockedSlots.has(index)) return [];
      spend(placed.length);
      if (placed.some(a => avoided.get(id).has(a.student_id) && adjacent(s, a))) return [];
      let score = Math.abs(index - preferredIndex.get(p)) * 0.02;
      for (const a of placed) {
        spend();
        const other = byId.get(a.student_id);
        if (adjacent(s, a)) score += pairScore(p, other, input.constraints.gender_strategy);
        if (a.column === s.column && Math.abs(a.row - s.row) === 1) score += neighborPenalty(p, other) * 0.7;
        if (p.height !== null && other.height !== null && a.column === s.column && a.row < s.row && other.height > p.height) score += (other.height - p.height) * 0.02;
      }
      return availableGroups.map(g => {
        spend();
        return { ...s, group: g.group, index, score: score + g.score };
      });
    }).sort((a, b) => { spend(); return a.score - b.score || a.index - b.index || a.group - b.group; });
  }
  function search() {
    spend();
    if (placed.length === profiles.length) return true;
    if (++nodes > 60000) throw SEARCH_LIMIT;
    let next, options;
    for (const p of preferred) {
      if (assigned.has(p.student._id)) continue;
      const choices = candidates(p);
      if (!choices.length) return false;
      if (!options || choices.length < options.length) { next = p; options = choices; }
      // Without hard constraints every remaining student fits any free seat.
      // Avoid recomputing all remaining students just to select a tied domain.
      if (!hasHardConstraints) break;
    }
    for (const slot of options) {
      assigned.add(next.student._id); used.add(slot.index);
      placed.push({ student_id: next.student._id, name: next.student.name, row: slot.row, column: slot.column, group: slot.group });
      if (search()) return true;
      placed.pop(); assigned.delete(next.student._id); used.delete(slot.index);
    }
    return false;
  }
  if (!search()) { issue(issues, 'constraints_unsatisfiable', '容量、固定、前排或分离约束无法同时满足'); return []; }
  return placed.sort((a, b) => a.row - b.row || a.column - b.column);
}

export function computeSeating(raw, students = [], context = {}) {
  const issues = [];
  const { normalized: input, roster } = normalize(raw, students, issues);
  const profiles = profilesFor(input, roster, context, issues);
  let assignments = [];
  if (!issues.some(i => i.severity === 'error')) {
    if (input.assignments !== undefined) {
      assignments = input.assignments.map(a => ({ ...a, name: roster.find(s => s.student_id === a.student_id)?.name ?? '' }));
    } else {
      const spend = computationBudget();
      try {
        assignments = arrange(input, profiles, buildBalancedGroups(profiles, input.group_size, input.constraints.gender_strategy, spend), issues, spend);
      } catch (error) {
        if (error !== SEARCH_LIMIT) throw error;
        issue(issues, 'search_limit', '排座计算达到上限，请减少座位或约束后重试');
      }
    }
    if (!issues.some(i => i.severity === 'error')) validateAssignments(input, assignments, issues);
  }
  const groups = [...new Set(assignments.map(a => a.group))].sort((a, b) => a - b).map(id => ({ id, student_ids: assignments.filter(a => a.group === id).map(a => a.student_id) }));
  const byId = new Map(profiles.map(p => [p.student._id, p]));
  let score = 0, genderPairs = 0, compliantPairs = 0;
  for (let i = 0; i < assignments.length; i++) for (let j = i + 1; j < assignments.length; j++) {
    const a = assignments[i], b = assignments[j];
    if (!byId.has(a.student_id) || !byId.has(b.student_id)) continue;
    if (adjacent(a, b)) {
      score += pairScore(byId.get(a.student_id), byId.get(b.student_id), input.constraints.gender_strategy);
      // Gender desk statistics count disjoint desk pairs, not the aisle edge.
      if (Math.min(a.column, b.column) % 2 === 0) { genderPairs++; if (meetsSeatingGenderStrategy(byId.get(a.student_id).gender, byId.get(b.student_id).gender, input.constraints.gender_strategy)) compliantPairs++; }
    } else if (a.column === b.column && Math.abs(a.row - b.row) === 1) score += neighborPenalty(byId.get(a.student_id), byId.get(b.student_id)) * 0.7;
  }
  if (input.constraints.gender_strategy !== 'ignore' && compliantPairs < genderPairs) issue(issues, 'gender_preference_unmet', '部分同桌未满足性别偏好，未知性别未作推测', 'warning');
  return { input, result: { assignments, groups, score: Number(score.toFixed(3)), gender_desk_pairs: genderPairs, gender_compliant_pairs: compliantPairs,
    linked_grade_count: profiles.filter(p => p.grade).length, profiles: profiles.map(p => ({ student_id: p.student._id, risk: p.risk, slot: p.slot, bias_index: p.biasIndex, bias_direction: p.biasDir })),
    can_save: !issues.some(i => i.severity === 'error') }, issues };
}
