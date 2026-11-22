// 私有移植：Headteacher-helper/src/utils/studentGender.ts
// 用户授权日期：2026-11-13；原文件 SHA-256：22d259853f789136687f1f414d4225461165adf03e1056fbc933baf1113131dd
// 原项目未提供开源许可；不授予再分发许可。纯函数 ESM 转换，未知性别不推测。
export const seatingGenderStrategyOptions = [
    {
        value: 'mixed',
        label: '男女同桌',
        hint: '优先安排一男一女同桌'
    },
    {
        value: 'same',
        label: '同性别同桌',
        hint: '优先安排男生或女生同座'
    },
    {
        value: 'ignore',
        label: '不考虑性别',
        hint: '沿用原有学习互补规则'
    }
];
export const dutyGenderRequirementOptions = [
    {
        value: 'any',
        label: '不限'
    },
    {
        value: 'male',
        label: '男生'
    },
    {
        value: 'female',
        label: '女生'
    }
];
export const normalizeGender = (value)=>{
    const gender = String(value ?? '').trim().toLowerCase();
    if ([
        '男',
        'male',
        'm',
        '男生'
    ].includes(gender)) return 'male';
    if ([
        '女',
        'female',
        'f',
        '女生'
    ].includes(gender)) return 'female';
    return 'unknown';
};
export const normalizeStoredGender = (value)=>{
    const gender = normalizeGender(value);
    return gender === 'male' ? '男' : gender === 'female' ? '女' : '';
};
export const genderCodeLabel = (value)=>value === 'male' ? '男' : value === 'female' ? '女' : '未知';
export const genderSummary = (items, getGender)=>{
    return items.reduce((acc, item)=>{
        const gender = normalizeGender(getGender(item));
        acc[gender] += 1;
        return acc;
    }, {
        male: 0,
        female: 0,
        unknown: 0
    });
};
export const meetsSeatingGenderStrategy = (a, b, strategy)=>{
    if (strategy === 'mixed') return a === 'male' && b === 'female' || a === 'female' && b === 'male';
    if (strategy === 'same') return a !== 'unknown' && a === b;
    return true;
};
const pairSequential = (left, right)=>{
    const pairs = [];
    const count = Math.min(left.length, right.length);
    for(let index = 0; index < count; index += 1)pairs.push([
        left[index],
        right[index]
    ]);
    return pairs;
};
const pairSameList = (items)=>{
    const pairs = [];
    for(let index = 1; index < items.length; index += 2)pairs.push([
        items[index - 1],
        items[index]
    ]);
    return pairs;
};
export const buildGenderDeskPairs = (props)=>{
    const { items, strategy, getGender, compare } = props;
    const sorted = compare ? [
        ...items
    ].sort(compare) : [
        ...items
    ];
    if (strategy === 'ignore') {
        return {
            pairs: pairSameList(sorted),
            rest: sorted.length % 2 ? [
                sorted[sorted.length - 1]
            ] : []
        };
    }
    const groups = sorted.reduce((acc, item)=>{
        acc[normalizeGender(getGender(item))].push(item);
        return acc;
    }, {
        male: [],
        female: [],
        unknown: []
    });
    if (strategy === 'mixed') {
        const mixedCount = Math.min(groups.male.length, groups.female.length);
        const pairs = pairSequential(groups.male.slice(0, mixedCount), groups.female.slice(0, mixedCount));
        const maleRest = groups.male.slice(mixedCount);
        const femaleRest = groups.female.slice(mixedCount);
        pairs.push(...pairSameList(maleRest), ...pairSameList(femaleRest));
        const unavoidable = [
            ...maleRest.length % 2 ? [
                maleRest[maleRest.length - 1]
            ] : [],
            ...femaleRest.length % 2 ? [
                femaleRest[femaleRest.length - 1]
            ] : [],
            ...groups.unknown
        ];
        pairs.push(...pairSameList(unavoidable));
        const rest = unavoidable.length % 2 ? [
            unavoidable[unavoidable.length - 1]
        ] : [];
        return {
            pairs,
            rest
        };
    }
    const pairs = [
        ...pairSameList(groups.male),
        ...pairSameList(groups.female)
    ];
    const maleRest = groups.male.length % 2 ? [
        groups.male[groups.male.length - 1]
    ] : [];
    const femaleRest = groups.female.length % 2 ? [
        groups.female[groups.female.length - 1]
    ] : [];
    const rest = [
        ...maleRest,
        ...femaleRest,
        ...groups.unknown
    ];
    if (rest.length >= 2) {
        pairs.push(...pairSameList(rest));
        return {
            pairs,
            rest: rest.length % 2 ? [
                rest[rest.length - 1]
            ] : []
        };
    }
    return {
        pairs,
        rest
    };
};
export const countGenderCompliantDeskPairs = (props)=>props.pairs.filter(([a, b])=>meetsSeatingGenderStrategy(normalizeGender(props.getGender(a)), normalizeGender(props.getGender(b)), props.strategy)).length;

// Classroom adapters share identity validation; names never identify students.
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const issue = (issues, code, message, severity = 'error') => issues.push({ code, message, severity });
export function integer(value, fallback, min, max, label, issues) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issue(issues, 'invalid_integer', `${label}必须是 ${min} 至 ${max} 的整数`);
    return fallback;
  }
  return value;
}
export function ids(value, label, issues) {
  if (!Array.isArray(value)) { issue(issues, 'invalid_ids', `${label}必须是学生编号列表`); return []; }
  const result = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim()) issue(issues, 'invalid_student_id', `${label}含无效学生编号`);
    else if (result.includes(id.trim())) issue(issues, 'duplicate_student', `${label}有重复学生：${id.trim()}`);
    else result.push(id.trim());
  }
  return result;
}
export function rosterFor(input, students, issues) {
  const className = typeof input.class_name === 'string' ? input.class_name.trim() : '';
  if (!className) issue(issues, 'class_required', '请选择班级');
  const roster = (Array.isArray(students) ? students : []).filter(s => object(s) && s.class_name === className);
  if (new Set(roster.map(s => s.student_id)).size !== roster.length) issue(issues, 'duplicate_roster', '班级名册有重复学生编号');
  const selected = input.student_ids === undefined ? roster.map(s => s.student_id) : ids(input.student_ids, '参与学生', issues);
  const byId = new Map(roster.map(s => [s.student_id, s]));
  for (const id of selected) if (!byId.has(id)) issue(issues, 'student_not_in_class', `学生不在所选班级：${id}`);
  if (!selected.length) issue(issues, 'empty_roster', '请至少选择一名学生');
  return { roster: selected.filter(id => byId.has(id)).map(id => byId.get(id)), selected, className };
}
export function studentGender(student) {
  if (student.gender !== undefined) return normalizeGender(student.gender);
  const values = (Array.isArray(student.traits) ? student.traits : []).flatMap(trait => {
    if (typeof trait === 'string') return [trait];
    return object(trait) && ['gender', '性别'].includes(trait.key ?? trait.name ?? trait.type) ? [trait.value] : [];
  }).map(normalizeGender).filter(gender => gender !== 'unknown');
  return new Set(values).size === 1 ? values[0] : 'unknown';
}
