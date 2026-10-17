'use strict';
/* Scene script. Times are anchored to voiceover lines via s.L / s.w / s.at. */
const DAYS = []; for (let d = new Date(Date.UTC(2026, 7, 15)); d <= Date.UTC(2026, 9, 15); d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10); DAYS.push({ k, v: DATA.commits[k] || 0 }); }
const Tx = (s, t0, t1, text, x, y, size, color, o = {}) => P.text(s, Object.assign({ t0, t1, text, x, y, size, color }, o));
const FADE = (it, a, b) => { it.fo = [a, b]; return it; };
const part = (n, title, sub) => { const s = scene({ id: 'card' + n, kind: 'paper', part: n, dur: 2.7, pre: .3, post: .6, nosub: true, nopart: true });
  Tx(s, s.t0 + .4, s.t0 + .4, `PART ${n} / 3`, 960, 330, 30, '#8a7d63', { font: 'mono', align: 'center' });
  Tx(s, s.t0 + .6, s.t0 + 1.4, `第${'一二三'[n - 1]}部分`, 960, 470, 110, INK, { font: 'serif', align: 'center' });
  Tx(s, s.t0 + 1.4, s.t0 + 2.0, title, 960, 580, sub ? 60 : 70, BLUE, { align: 'center' }); return s; };

/* =============== PART 1 · 作品概述 =============== */
part(1, '作品概述');

const A = scene({ id: 'A', part: 1, lines: [['a1', .4], ['a2', .5]], post: 1.4 });
{ const s = A, x0 = 170, step = 25.5, bw = 17, yb = 800, sc = 4.5, a2 = s.L.a2, cT = a2 + 3.3;
  const ttl = Tx(s, s.t0 + .2, s.t0 + .2, 'EduPi Desktop · 每日提交次数', 170, 150, 46, INK, { font: 'serif' }); FADE(ttl, cT + .3, cT + 1.1);
  const sub = Tx(s, s.t0 + .4, s.t0 + .4, '2026-08-15 → 2026-10-15 · git log', 172, 192, 22, '#8a7d63', { font: 'mono' }); FADE(sub, cT + .3, cT + 1.1);
  P.grid(s, { t0: s.t0 + .3, fo: [cT + .3, cT + 1.1], draw(g, t, al) {
    g.strokeStyle = PALE; g.lineWidth = 1; g.font = '17px Menlo'; g.fillStyle = '#8a7d63';
    [0, 40, 80, 120].forEach(v => { const y = yb - v * sc; g.beginPath(); g.moveTo(150, y); g.lineTo(1780, y); g.stroke(); g.fillText(String(v), 104, y + 6); });
    [0, 17, 32, 47, 61].forEach(i => g.fillText(DAYS[i].k.slice(5), x0 + i * step - 20, yb + 34)); } });
  P.poly(s, { t0: s.t0 + .3, t1: s.t0 + .9, pts: [[150, yb], [1780, yb]], w: 3, fo: [cT + .3, cT + 1.1] });
  P.poly(s, { t0: s.t0 + .5, t1: s.t0 + 1.0, pts: [[150, yb], [150, 250]], w: 3, fo: [cT + .3, cT + 1.1] });
  P.bars(s, { t0: s.at('a1', .3), dt: .075, days: DAYS, x0, step, bw, yb, sc, collapse: [cT, cT + .8], fo: [cT + .9, cT + 1.0] });
  P.poly(s, { t0: a2 + .2, t1: a2 + .9, pts: ellipse(x0 + 32 * step + bw / 2, 300, 36, 34), color: RED, w: 3.2, fo: [cT, cT + .6] });
  P.poly(s, { t0: a2 + .95, t1: a2 + 1.15, pts: [[1052, 252], [1018, 286]], color: RED, w: 2.4, fo: [cT, cT + .6] });
  Tx(s, a2 + 1.15, a2 + 2.2, '9/16 · 112 次\n单日峰值', 1062, 236, 36, RED, { fo: [cT, cT + .6] });
  Tx(s, a2 + 1.9, a2 + 2.9, '共 1206 次提交\n62 天', 200, 340, 40, BLUE, { fo: [cT, cT + .6] });
  const b0 = cT + 1.0, box = (i, label) => { const bx = [220, 760, 1300][i], t = b0 + i * 1.7;
    P.poly(s, { t0: t, t1: t + .75, pts: rrect(bx, 400, 400, 170), w: 3.4 }); Tx(s, t + .8, t + 1.25, label, bx + 200, 505, 60, INK, { align: 'center' });
    if (i < 2) P.poly(s, { t0: t + 1.3, t1: t + 1.6, pts: arrow(bx + 410, 485, bx + 540, 485), w: 3.4 }); };
  box(0, '学校通知'); box(1, 'Excel 表格'); box(2, '日程');
  Tx(s, b0 + 5.0, b0 + 6.2, '反复整理，一遍又一遍', 960, 700, 62, RED, { align: 'center' });
  P.poly(s, { t0: b0 + 6.3, t1: b0 + 6.9, pts: [[470, 730], [600, 742], [760, 726], [940, 744], [1120, 728], [1300, 742], [1450, 730]], color: RED, w: 3 }); }

const B = scene({ id: 'B', part: 1, lines: [['b1', .3], ['b2', .4]], post: 1.3 });
{ const s = B, b2 = s.L.b2, out = [b2 - .3, b2 + .5];
  const k = Tx(s, s.w('b1', '垂类', -.2), s.w('b1', '垂类', 1.9), '垂类个人智能体', 960, 330, 118, INK, { font: 'serif', align: 'center' }); FADE(k, ...out);
  FADE(Tx(s, s.w('b1', '它不是', -.1), s.w('b1', '它不是', 2.2), '教育行业 · 教师的搭档，不是又一个聊天框', 960, 450, 44, BLUE, { align: 'center' }), ...out);
  [['记得每一个学生', '记得', 400], ['懂你的日程', '懂你', 960], ['把事情提前准备好', '提前', 1520]].forEach(([tx, w, x]) => { const t = s.w('b1', w, -.1);
    FADE(Tx(s, t, t + 1.0, tx, x, 640, 44, INK, { align: 'center' }), ...out); FADE(P.poly(s, { t0: t + 1.05, t1: t + 1.5, pts: [[x - 150, 662], [x - 30, 670], [x + 150, 660]], color: RED, w: 3 }), ...out); });
  const y1 = 430, xa = 170, xb = 1750, xh = h => xa + h / 24 * (xb - xa);
  FADE(Tx(s, b2 + .2, b2 + .2, '一天', 170, 372, 40, BLUE, { }), b2 + 14, b2 + 15);
  P.poly(s, { t0: b2 + .3, t1: b2 + 1.2, pts: [[xa, y1], [xb, y1]], w: 3.4 });
  P.grid(s, { t0: b2 + .9, draw(g, t, al) { g.strokeStyle = GRAPH; g.fillStyle = '#8a7d63'; g.font = '17px Menlo'; g.lineWidth = 2; for (let h = 0; h <= 24; h += 3) { g.beginPath(); g.moveTo(xh(h), y1 - 9); g.lineTo(xh(h), y1 + 9); g.stroke(); g.fillText(String(h).padStart(2, '0') + ':00', xh(h) - 21, y1 + 36); } } });
  P.dots(s, { t0: s.w('b2', '每小时', -.1), dt: .1, pts: Array.from({ length: 24 }, (_, h) => [xh(h + .5), y1]), r: 6, color: '#8fb0e0' });
  Tx(s, s.w('b2', '每小时', 1.2), s.w('b2', '每小时', 2.2), '每小时 · 主动巡检', xh(14), 372, 32, '#5a7fb5', { align: 'center' });
  const t1 = s.w('b2', '早上七点半', -.1); P.dots(s, { t0: t1, dt: .1, pts: [[xh(7.5), y1]], r: 16, color: BLUE }); Tx(s, t1 + .3, t1 + 1.3, '07:30 早安简报', xh(7.5) + 20, 368, 36, BLUE, { align: 'center' });
  const t2 = s.w('b2', '晚上十一点', -.1); P.dots(s, { t0: t2, dt: .1, pts: [[xh(23), y1]], r: 16, color: BLUE }); Tx(s, t2 + .3, t2 + 1.3, '23:00 整理记忆', xh(23) - 40, 505, 36, BLUE, { align: 'center' });
  const tw = s.w('b2', '周五', -1.6), cx = i => 170 + i * 226 + 103; FADE(Tx(s, tw - .2, tw - .2, '一周', 170, 706, 40, BLUE, {}), b2 + 14, b2 + 15);
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach((d, i) => { const t = tw + i * .14; P.poly(s, { t0: t, t1: t + .13, pts: rrect(170 + i * 226, 740, 206, 76, 12), w: 2.6, sfx: false }); Tx(s, t + .1, t + .1, d, cx(i), 790, 32, GRAPH, { align: 'center' }); });
  const t3 = s.w('b2', '周五', -.1); P.dots(s, { t0: t3, dt: .1, pts: [[cx(4), 840]], r: 14, color: BLUE }); Tx(s, t3 + .3, t3 + 1.3, '18:00 周报初稿', cx(4), 895, 34, BLUE, { align: 'center' });
  const t4 = s.w('b2', '周日', -.1); P.dots(s, { t0: t4, dt: .1, pts: [[cx(6), 840]], r: 14, color: BLUE }); Tx(s, t4 + .3, t4 + 1.4, '20:00 跨周期深度分析', 1790, 895, 34, BLUE, { align: 'right' }); }

const C = scene({ id: 'C', part: 1, lines: [['c1', .3], ['c2', .4]], post: 1.2 });
{ const s = C, names = ['感知', '记忆', '潜意识', '能力', '调度', '交付'], bx = i => 100 + i * 296, by = 250, c2 = s.L.c2;
  const subs = ['7 类意图规则\n校历 · 课表', '学生画像卡\n语义检索', '夜间“做梦”\n洞察浮出', '6 个诊断工具\n场景技能', '六心跳\n每小时巡检', '落盘 · 飞书\n推送给老师'];
  const subT = [s.w('c2', '感知层', .1), s.w('c2', '记忆层', .1), s.w('c2', '学生画像', .9), s.w('c2', '能力层', .1), s.w('c2', '场景技能', 1.1), s.w('c2', '交付层', .1)];
  names.forEach((n, i) => { const t = s.w('c1', n, -.15);
    P.poly(s, { t0: t, t1: t + .55, pts: rrect(bx(i), by, 240, 140, 16), w: 3.4, fill: i === 5 ? [BLUE, .10] : null });
    Tx(s, t + .6, t + .95, n, bx(i) + 120, by + 84, 50, INK, { font: 'serif', align: 'center' });
    if (i > 0) P.poly(s, { t0: t - .22, t1: t - .02, pts: arrow(bx(i - 1) + 246, by + 70, bx(i) - 8, by + 70), w: 3, sfx: false });
    Tx(s, subT[i], subT[i] + .9, subs[i], bx(i) + 120, by + 192, 24, BLUE, { align: 'center' }); });
  const ts = s.w('c2', '四十多个', -.3); const pts = []; [15, 14, 14].forEach((n, r) => { for (let c = 0; c < n; c++) pts.push([200 + c * 52, 600 + r * 56]); });
  P.dots(s, { t0: ts, dt: .07, pts, r: 12, color: '#5b85c9' });
  Tx(s, ts + 1.2, ts + 2.4, '43 个班主任场景技能', 1050, 650, 50, INK, {}); Tx(s, ts + 2.4, ts + 2.4, '每个点 = skills/ 目录下的 1 个技能', 1052, 700, 22, '#8a7d63', { font: 'mono' });
  const tf = s.w('c2', '送回', -.1); P.poly(s, { t0: tf, t1: tf + 1.2, pts: arc(bx(5) + 120, by - 4, bx(1) + 120, by - 4, 100), color: RED, w: 3, dash: true });
  P.poly(s, { t0: tf + 1.2, t1: tf + 1.4, pts: arrow(bx(1) + 140, by - 40, bx(1) + 120, by - 6), color: RED, w: 3, sfx: false });
  Tx(s, tf + 1.2, tf + 2.3, '老师确认 / 修改 → 再学习', 960, 118, 38, RED, { align: 'center' }); }

const Dd = scene({ id: 'D', part: 1, lines: [['d1', .3], ['d2', .4]], post: 1.3 });
{ const s = Dd, lv = [['L1 工具', '点按钮 → 执行', '工具'], ['L2 助手', '提问 → 回答', '助手'], ['L3 主动助手', '提醒你该做这个了', '主动助手'], ['L4 无感搭档', '老师正常说话\n背后全做完', '第四级'], ['L5 自主智能', '跨域洞察 · 自主执行\n自我进化', '最后']];
  lv.forEach(([n, d, w], i) => { const h = 150 + i * 100, x = 190 + i * 300, top = 860 - h, t = s.w('d1', w, i === 0 ? -.1 : (i === 4 ? .3 : -.1));
    P.poly(s, { t0: t, t1: t + .55, pts: [[x, 860], [x, top], [x + 280, top], [x + 280, 860]], w: 3.4, dash: i === 4, fill: i === 3 ? [BLUE, .16] : null });
    Tx(s, t + .6, t + 1.05, n, x + 140, top + 58, i === 3 ? 42 : 38, i === 3 ? BLUE : INK, { align: 'center' });
    Tx(s, t + 1.1, t + 1.1, d, x + 140, top + 104, 24, '#6b6150', { align: 'center' }); });
  const t4 = s.w('d1', '第四级', 1.0); Tx(s, t4, t4 + .8, '我们的定位', 1230, 358, 44, RED, { align: 'center', rot: -.04 });
  P.poly(s, { t0: t4 + .8, t1: t4 + 1.1, pts: arrow(1230, 376, 1230, 404), color: RED, w: 3, sfx: false });
  Tx(s, s.at('d2', .3), s.at('d2', 2.0), '桌面端 = 看得见的工作台', 960, 190, 54, INK, { font: 'serif', align: 'center' });
  Tx(s, s.w('d2', 'Core', -.1), s.w('d2', 'Core', 2.2), 'Core 在本机运行 · 教学数据保存在本地', 960, 262, 40, BLUE, { align: 'center' }); }

/* =============== PART 2 · 核心功能演示与典型应用场景 =============== */
part(2, '核心功能演示与典型应用场景模拟', true);

const desk = (o) => scene(Object.assign({ kind: 'desk', part: 2, pre: .8, post: 1.2 }, o));
const navOn = (s, id) => D.cls(id, 'on', s.t0 + .3, s.t1 + .2);

/* --- real-client takes (footage recorded separately; scenes only carry timing anchors) --- */
const E1 = desk({ id: 'E', view: 'guide', real: true, chap: ['01', ' 首次进入'], lines: [['e1', 1.0], ['e2', 1.0]], post: 4.0 });
const F1 = desk({ id: 'F', view: 'cal', real: true, chap: ['02', ' 日程'], lines: [['f1', 1.0], ['f2', 1.0], ['f3', 1.0]], post: 1.6 });
const G1 = desk({ id: 'G', view: 'today', real: true, chap: ['03', ' 今天 · 工作区'], lines: [['g1', 1.0], ['g2', 1.0]], post: 9.0 });
const H1 = desk({ id: 'H', view: 'stu', real: true, chap: ['04', ' 待我确认 · 学生档案'], lines: [['h1', 1.0], ['h2', 1.0], ['h3', 1.0]], post: 1.6 });
const I1 = desk({ id: 'I', view: 'mat', real: true, chap: ['05', ' 教学材料'], lines: [['i1', 1.0], ['i2', 1.0]], post: 1.6 });
const J1 = desk({ id: 'J', view: 'chatv', real: true, chap: ['06', ' AI 协作'], lines: [['j1', 1.0], ['j2', 1.0]], post: 12.0 });

/* --- 典型场景：飞书渠道（手机视图） --- */
const mkSet = (key, msgs) => { const set = document.createElement('div'); set.className = 'pset'; set.id = 'ps-' + key; $('pscr').appendChild(set);
  msgs.forEach((m, i) => { const d = document.createElement('div'); d.id = `pm-${key}${i}`; d.className = 'pm ' + m.type; d.style.opacity = 0;
    d.innerHTML = m.type === 'card' ? `<div class="b"><div class="ch" style="background:${m.color}">${m.head}</div><div class="cb">${m.body}</div>${m.foot ? `<div class="cf">${m.foot.map(f => `<span>${f}</span>`).join('')}</div>` : ''}</div>` : `<div class="b">${m.body}</div>`;
    set.appendChild(d); }); return set; };
mkSet('k', [{ type: 'me', body: '（转发）家长：老师，我家孩子这学期数学退步了，该怎么办？帮我回一下，语气温和，给出具体建议。' },
  { type: 'card', color: '#2d65d8', head: '回复草稿 · 内部草稿 · 不外发', body: 'XX 妈妈您好，孩子这学期在计算准确率上有进步，但最近几周在“移项变号”上遇到了困难。我在课堂上会重点关注，建议在家用 2–3 道类似的题做练习，具体题目附在后面。', foot: ['修改', '确认后发送'] },
  { type: 'me', body: '把称呼改成“小明妈妈”' }, { type: 'bot', body: '已按你的修改保存。确认之后才会发送。' }]);
mkSet('l', [{ type: 'card', color: '#177a55', head: '早安简报 · 07:30', body: '今天周四，有这些事：<br>· 第 3 节 七年级数学<br>· 周五前提交：班主任工作计划<br>· 张三需要课前留意（移项变号）<br><b>已经帮你做了：</b>班主任工作计划初稿', foot: ['查看初稿'] },
  { type: 'card', color: '#a76308', head: '周报初稿 · 周五 18:00', body: '本周班级情况、重点学生跟进、下周安排……<br>（初稿，来自行事历与记忆库，供你修改）', foot: ['改一改', '确认提交'] }]);
mkSet('m', [{ type: 'me', body: '李四体育课摔了一下，手腕有点肿' }, { type: 'card', color: '#b83f4c', head: '安全事件 · 即时提醒', body: '识别到受伤信息：李四 · 体育课 · 手腕肿。<br>建议：立即联系校医，通知家长，并记录事件。', foot: ['生成事件报告', '家长沟通话术'] }]);

const K1 = desk({ id: 'K', view: 'chatv', phone: true, chap: ['A', ' 典型场景一 · 家长沟通'], lines: [['k1', .8], ['k2', .4]], post: 1.3 });
{ const s = K1, k1 = s.L.k1, k2 = s.L.k2; D.hideCur(s.t0, 1e9);
  D.rev('#pm-k0', k1 + 1.8, .4, 10); D.rev('#pm-k1', s.w('k2', '写出一份', -.2), .5, 12); D.rev('#pm-k2', s.w('k2', '老师改个称呼', .2), .4, 10); D.rev('#pm-k3', s.w('k2', '才会发出去', -.4), .4, 10);
  D.stand(k2 + 1.6, '#pm-k1', .1);
  ST.push(t => { E('#ps-k').style.opacity = (t >= s.t0 && t < s.t1 + .01) ? 1 : 0; });
  D.cam(s.t0, 1, 960, 540); D.cam(s.t0 + 1.0, 1.1, 960, 520); D.cam(s.t1 - .3, 1.1, 960, 520); }
const L1 = desk({ id: 'L', view: 'chatv', phone: true, chap: ['B', ' 典型场景二 · 早安简报与周报'], lines: [['l1', .8], ['l2', .4]], post: 1.3 });
{ const s = L1, l1 = s.L.l1, l2 = s.L.l2;
  D.rev('#pm-l0', l1 + .5, .5, 12); D.rev('#pm-l1', l2 + .6, .5, 12); D.stand(l1 + 1.6, '#pm-l0', .1); D.stand(l2 + 1.4, '#pm-l1', .1);
  ST.push(t => { E('#ps-l').style.opacity = (t >= s.t0 && t < s.t1 + .01) ? 1 : 0; });
  D.cam(s.t0, 1.1, 960, 520); D.cam(s.t1 - .3, 1.1, 960, 520); }
const M1 = desk({ id: 'M', view: 'chatv', phone: true, chap: ['C', ' 典型场景三 · 安全事件'], lines: [['m1', .8]], post: 1.6 });
{ const s = M1, m1 = s.L.m1; D.hideCur(s.t0, s.t1 + 1);
  D.rev('#pm-m0', m1 + .6, .4, 10); D.rev('#pm-m1', m1 + 2.4, .45, 12); D.stand(m1 + 3.6, '#pm-m1', .1); D.wig(m1 + 3.8, m1 + 5.0);
  ST.push(t => { E('#ps-m').style.opacity = (t >= s.t0 && t < s.t1 + .01) ? 1 : 0; });
  D.cam(s.t0, 1.1, 960, 520); D.cam(s.t1 - .3, 1.1, 960, 520); }

/* =============== PART 3 · 用户交互过程与成效 =============== */
part(3, '用户交互过程与成效');

const N1 = scene({ id: 'N', part: 3, lines: [['n1', .3], ['n2', .4]], post: 1.3 });
{ const s = N1, names = ['老师说话\n或上传文件', '感知', '记忆', '技能', '产物', '老师确认'], keys = ['说话', '感知', '写入记忆', '调用技能', '准备产物', '待确认'], bx = i => 130 + i * 286, by = 360;
  names.forEach((n, i) => { const t = s.w('n1', keys[i], i === 0 ? -.5 : -.2);
    P.poly(s, { t0: t, t1: t + .55, pts: rrect(bx(i), by, 230, 150, 16), w: 3.4, fill: i === 5 ? [BLUE, .12] : null });
    Tx(s, t + .6, t + .95, n, bx(i) + 115, by + (i === 0 ? 60 : 88), i === 0 ? 32 : 46, INK, { font: 'serif', align: 'center' });
    if (i > 0) P.poly(s, { t0: t - .2, t1: t, pts: arrow(bx(i - 1) + 236, by + 75, bx(i) - 8, by + 75), w: 3, sfx: false }); });
  const t4 = s.w('n1', '准备产物', .5); Tx(s, t4, t4 + .7, '待确认', bx(4) + 115, by + 200, 36, '#a76308', { align: 'center' });
  const t5 = s.w('n1', '待确认', .5); Tx(s, t5, t5 + 1.0, '接受 · 修改 · 拒绝', bx(5) + 115, by + 200, 32, BLUE, { align: 'center' });
  const tf = s.at('n2', .4); P.poly(s, { t0: tf, t1: tf + 1.4, pts: arc(bx(5) + 115, by + 160, bx(2) + 115, by + 160, -170), color: RED, w: 3, dash: true });
  P.poly(s, { t0: tf + 1.4, t1: tf + 1.6, pts: arrow(bx(2) + 135, by + 262, bx(2) + 115, by + 164), color: RED, w: 3, sfx: false });
  Tx(s, tf + 1.2, tf + 2.4, '反馈回流记忆 → 下一次更准', 960, 790, 44, RED, { align: 'center' });
  const tp = s.w('n2', '人，始终', -.1); Tx(s, tp, tp + 1.4, '人，始终在回路中', 960, 895, 66, INK, { font: 'serif', align: 'center' }); }

const O1 = scene({ id: 'O', part: 3, lines: [['o1', .3], ['o2', .4], ['o3', .5]], post: 3.2 });
{ const s = O1, o3 = s.L.o3, out = [o3 + .1, o3 + 1.1], x0 = 180, cx = i => x0 + i * 266, cy = 250;
  const E_ = [['E0', '代码', '已写入代码', 2, '代码'], ['E1', '隔离测试', '隔离路径通过', 2, '隔离测试'], ['E2', '本机真实数据', '本机数据路径可用', 1, '本机真实数据'], ['E3', '运行时闭环', '指定闭环可回放', 1, '运行时闭环'], ['E4', '真实渠道', '指定渠道消息闭环', 0, '真实渠道'], ['E5', '教师真人', '指定教师场景试用', 0, '教师真人']];
  FADE(Tx(s, s.t0 + .3, s.t0 + 1.4, '证据等级 · 不自己给自己打分', 960, 170, 54, INK, { font: 'serif', align: 'center' }), ...out);
  E_.forEach(([id, nm, can, st, key], i) => { const t = s.w('o1', key, -.15), x = cx(i), col = st === 0 ? '#8a7d63' : st === 1 ? '#a76308' : BLUE;
    FADE(P.poly(s, { t0: t, t1: t + .55, pts: rrect(x, cy, 230, 210, 14), w: 3.4, dash: st === 0, color: GRAPH, fill: st === 2 ? [BLUE, .22] : null }), ...out);
    if (st === 1) FADE(P.poly(s, { t0: t + .55, t1: t + .8, pts: [[x + 6, cy + 146], [x + 224, cy + 146], [x + 224, cy + 204], [x + 6, cy + 204], [x + 6, cy + 146]], w: 1.5, color: '#a76308', fill: ['#a76308', .22], sfx: false }), ...out);
    FADE(Tx(s, t + .6, t + .6, id, x + 115, cy + 62, 40, INK, { font: 'mono', align: 'center' }), ...out);
    FADE(Tx(s, t + .9, t + 1.4, nm, x + 115, cy + 120, 28, INK, { align: 'center' }), ...out);
    FADE(Tx(s, t + 1.4, t + 1.4, can, x + 115, cy + 262, 22, '#6b6150', { align: 'center' }), ...out);
    const ts = st === 2 ? s.w('o2', '代码和隔离测试', .3) : st === 1 ? s.w('o2', '目前', 2.2) + (i - 2) * .5 : s.w('o2', '真实飞书', .2) + (i - 4) * .5;
    FADE(Tx(s, ts, ts + .6, st === 2 ? '已完成' : st === 1 ? '进行中' : '待补齐', x + 115, cy + 322, 34, col, { align: 'center' }), ...out); });
  const t75 = s.w('o2', '七十五项', -.2); FADE(Tx(s, t75, t75 + .8, 'Core L4 无密钥测试（隔离）：75 / 75', 960, 790, 40, BLUE, { align: 'center' }), ...out);
  FADE(Tx(s, t75 + 1.0, t75 + 1.0, '● 已完成　◐ 进行中　○ 待补齐　· 引自 Desktop 验收矩阵 E0–E5', 960, 835, 20, '#8a7d63', { font: 'mono', align: 'center' }), ...out);
  Tx(s, o3 + 1.0, o3 + 2.4, '把时间还给教学', 960, 360, 112, INK, { font: 'serif', align: 'center' });
  const tg = s.w('o3', '期待', 1.8); Tx(s, tg, tg + 1.4, '项目目标：把 80% 非教学时间还给老师', 960, 450, 38, '#6b6150', { align: 'center' });
  const t1 = s.w('o3', 'EduPi 不替', -.1); Tx(s, t1, t1 + 1.8, 'EduPi 不替教师作最后决定。', 960, 590, 66, BLUE, { align: 'center' });
  const t2 = s.w('o3', '它负责准备', -.1); Tx(s, t2, t2 + 1.4, '它准备，教师确认。', 960, 680, 56, INK, { align: 'center' });
  const t3 = s.w('o3', '教师负责确认', .6); Tx(s, t3, t3 + 1.2, '教育行业的垂类个人智能体', 960, 790, 46, RED, { align: 'center' });
  Tx(s, t3 + 1.4, t3 + 1.4, 'github.com/PIGU-PPPgu/edupi-desktop  ·  github.com/PIGU-PPPgu/edupi', 960, 850, 22, '#8a7d63', { font: 'mono', align: 'center' }); }

/* ---------- boot ---------- */
[CUR, STAND, CAM].forEach(a => a.sort((x, y) => x.t - y.t));
for (let i = 1; i < SC.length; i++) if (SC[i].kind !== SC[i - 1].kind) { WIPES.push(SC[i].t0); EV.push({ type: 'wipe', t: SC[i].t0 }); }
STAND.forEach(st => EV.push({ type: 'land', t: st.t }));
buildSubs();
window.DUR = T;
window.getEvents = () => ({ ev: EV, vo: SC.flatMap(s => Object.keys(s.L).map(id => ({ id, t: s.L[id] }))), dur: T, scenes: SC.map(s => ({ id: s.id, kind: s.kind, part: s.part, real: !!s.real, chap: s.chap || null, t0: s.t0, t1: s.t1, L: s.L })), parts: [1, 2, 3].map(p => { const ss = SC.filter(s => s.part === p); return { p, t0: ss[0].t0, t1: ss[ss.length - 1].t1 }; }) });
window.renderAt = t => { render(t); };
document.fonts.ready.then(() => { render(0); window.ready = true; });
