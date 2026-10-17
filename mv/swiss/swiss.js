'use strict';
/* EduPi — Swiss Motion film. Every frame is a pure function of t. */
const W = 1920, H = 1080, M = 96, GUT = 24, COL = 122;
const cx = i => M + i * (COL + GUT), cw = n => n * COL + (n - 1) * GUT;   // column x / span width
const INK = '#111111', PAGE = '#EFEEE9', PAPER = '#FFFFFF', G1 = '#DAD9D4', G2 = '#BDBCB6', G3 = '#8C8B86', SIG = '#1F3FFF';
const V = DATA.vo, FPS = 30, BEAT = 0.625;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, u) => a + (b - a) * u;
/* cubic-bezier(.7,0,.2,1) — the one precise ease */
const bez = (() => { const x1 = .7, y1 = 0, x2 = .2, y2 = 1; const cX = t => 3 * x1 * (1 - t) ** 2 * t + 3 * x2 * (1 - t) * t * t + t ** 3, cY = t => 3 * y1 * (1 - t) ** 2 * t + 3 * y2 * (1 - t) * t * t + t ** 3;
  return u => { u = clamp(u); let a = 0, b = 1, t = u; for (let i = 0; i < 28; i++) { const x = cX(t); if (x < u) a = t; else b = t; t = (a + b) / 2; } return cY(t); }; })();
const E = (t, t0, d) => bez((t - t0) / d);                    // eased progress
const Lin = (t, t0, d) => clamp((t - t0) / d);                  // linear progress
const q = t => Math.round(t / (BEAT / 4)) * (BEAT / 4);         // quantise to a 16th

const $st = document.getElementById('st');
const SC = [], SNAPS = [];
let T = 0;

/* ---------- layout ---------- */
function scene(def) {
  const s = Object.assign({ pre: 1.0, post: 1.2, part: 1, lines: [], real: false, U: [], subBox: null, label: '' }, def);
  s.t0 = T; s.L = {}; let t = T + s.pre;
  if (def.dur) { s.t1 = T + def.dur; }
  else { for (const [id, lead] of s.lines) { t += (lead || 0); s.L[id] = t; t += V[id].d + 0.5; } s.t1 = t - 0.5 + s.post; }
  T = s.t1; SC.push(s);
  s.el = document.createElement('div'); s.el.className = 'scene'; $st.appendChild(s.el);
  s.add = (e) => { s.el.appendChild(e); return e; };
  return s;
}
const wordT = (s, id, needle, off = 0) => { const v = V[id]; let acc = '', hit = null; for (const w of v.words) { acc += w.text; if (hit === null && acc.includes(needle)) { hit = w.t; } } return s.L[id] + (hit === null ? 0 : hit) + off; };

/* ---------- primitives ---------- */
function box(s, x, y, w, h, bg, extra = '') { const e = document.createElement('div'); e.className = 'abs'; e.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};${extra}`; return s.add(e); }
function wipeIn(s, el, t0, d, dir = 'r', hold = false, out = null) {           // clip-reveal a box
  s.U.push(t => { const p = E(t, t0, d); let q2 = out ? E(t, out[0], out[1]) : 0;
    const a = 100 - p * 100, b = q2 * 100;
    if (t < t0) { el.style.visibility = 'hidden'; return; } el.style.visibility = 'visible';
    el.style.clipPath = dir === 'r' ? `inset(0 ${a}% 0 ${b}%)` : dir === 'l' ? `inset(0 ${b}% 0 ${a}%)` : dir === 'u' ? `inset(${a}% 0 ${b}% 0)` : `inset(${b}% 0 ${a}% 0)`; });
  SNAPS.push(t0 + d);
}
function txt(s, o) {            // clip-revealed text: words rise from below the baseline
  const { x, y, w, size, weight = 700, color = INK, text, t0, d = BEAT / 2, lh = 1.12, tr = 0, out = null, align = 'left', mono = false } = o;
  const lines = text.split('\n'); const els = [];
  lines.forEach((ln, i) => { const c = document.createElement('div'); c.className = 'clip'; c.style.cssText = `left:${x}px;top:${y + i * size * lh}px;width:${w || 1600}px;height:${size * lh}px;`;
    const sp = document.createElement('span'); sp.textContent = ln; sp.style.cssText = `font-size:${size}px;font-weight:${weight};color:${color};line-height:${size * lh}px;letter-spacing:${tr}em;text-align:${align};`; c.appendChild(sp); s.add(c); els.push(sp); });
  s.U.push(t => { els.forEach((sp, i) => { const a = E(t, t0 + i * 0.06, d), b = out ? E(t, out[0] + i * 0.04, out[1]) : 0; sp.style.transform = `translateY(${(1 - a) * 115 - b * 115}%)`; }); });
  SNAPS.push(t0 + d);
}
function note(s, x, y, text, t0, o = {}) { return txt(s, Object.assign({ x, y, size: 19, weight: 500, color: G3, text, t0, d: BEAT / 3, lh: 1.5, w: 900 }, o)); }
function vline(s, x, y, h, t0, d, color = INK, w = 1) { const e = box(s, x, y, w, h, color); s.U.push(t => { const p = Lin(t, t0, d); e.style.display = t < t0 ? 'none' : 'block'; e.style.height = h * p + 'px'; }); }
function hline(s, x, y, wd, t0, d, color = INK, h = 1) { const e = box(s, x, y, wd, h, color); s.U.push(t => { const p = Lin(t, t0, d); e.style.display = t < t0 ? 'none' : 'block'; e.style.width = wd * p + 'px'; }); }
function numeral(s, x, y, text, size, t0, o = {}) { return txt(s, Object.assign({ x: x - size * 0.045, y, size, weight: 800, text, t0, d: BEAT, lh: 0.95, tr: -0.02, w: 1500 }, o)); }
function cell(s, x, y, w, h, bg, label, t0, o = {}) {                                // snapped flat block + label
  const e = box(s, x, y, w, h, bg, `display:flex;align-items:${o.va || 'flex-end'};padding:${o.pad ?? 12}px;`); if (o.border) e.style.boxShadow = `inset 0 0 0 ${o.border}px ${o.bcolor || INK}`;
  if (label) { const sp = document.createElement('span'); sp.textContent = label; sp.style.cssText = `font-size:${o.size || 20}px;font-weight:${o.weight || 700};color:${o.color || '#fff'};line-height:1.2;white-space:pre`; e.appendChild(sp); }
  wipeIn(s, e, t0, o.d || BEAT / 2, o.dir || 'r', false, o.out || null); return e; }

/* ---------- subtitles: part of the layout, clip-revealed per word ---------- */
function subtitles(s, box_) {
  const bx = s.subBox || box_ || { x: M, y: 700, w: 1000, size: 40 };
  const lead = document.createElement('div'); lead.className = 'abs note'; lead.style.cssText = `left:${bx.x}px;top:${bx.y - 34}px;width:${bx.w}px`; lead.textContent = s.label || ''; s.add(lead);
  const rl = box(s, bx.x, bx.y - 44, 0, 1, INK); s.U.push(t => { const p = E(t, s.t0 + 0.4, 0.6); rl.style.width = bx.w * p + 'px'; });
  const chunks = [];
  for (const id in s.L) {
    const text = V[id].text, words = V[id].words; let cur = 0; const items = [];
    words.forEach((w, i) => { let pos = text.indexOf(w.text, cur); if (pos < 0 || pos - cur > 8) pos = cur; const end = pos + w.text.length; const nxt = i + 1 < words.length ? text.indexOf(words[i + 1].text, end) : text.length; const stop = nxt < 0 ? Math.min(text.length, end + 1) : nxt;
      items.push({ s: text.slice(pos, stop).replace(/^[，。：；？！、]+/, ''), t: s.L[id] + w.t, e: s.L[id] + w.t + w.d }); cur = stop; });
    // sentence / clause chunks
    let ch = { items: [], len: 0 };
    items.forEach(it => { ch.items.push(it); ch.len += it.s.length; if (/[。？！：；]$/.test(it.s) || (/，$/.test(it.s) && ch.len >= 14) || ch.len >= 26) { chunks.push(ch); ch = { items: [], len: 0 }; } });
    if (ch.items.length) chunks.push(ch);
  }
  chunks.forEach((c, k) => {
    const start = c.items[0].t, speechEnd = c.items[c.items.length - 1].e, nxt = chunks[k + 1] ? chunks[k + 1].items[0].t : 1e9;
    const hold = Math.max(start + 1.8, speechEnd + 0.6), end = Math.min(hold, nxt - 0.02);
    const el = document.createElement('div'); el.className = 'abs'; el.style.cssText = `left:${bx.x}px;top:${bx.y}px;width:${bx.w}px;font-size:${bx.size || 40}px;font-weight:700;line-height:1.3;letter-spacing:-.005em`;
    const ws = c.items.map(it => { const wc = document.createElement('span'); wc.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top;line-height:1.3;'; const wi = document.createElement('span'); wi.style.cssText = 'display:inline-block;will-change:transform;transform:translateY(115%)'; wi.textContent = it.s; wc.appendChild(wi); el.appendChild(wc); return wi; });
    s.add(el); el.style.display = 'none';
    s.U.push(t => { if (t < start - 0.05 || t > end + 0.4) { el.style.display = 'none'; return; } el.style.display = 'block';
      const ex = E(t, end, 0.22); ws.forEach((wi, i) => { const a = E(t, c.items[i].t - 0.05, 0.18); wi.style.transform = `translateY(${(1 - a) * 115 - ex * 115}%)`; }); });
  });
}

/* ---------- artifact frame with real footage ---------- */
function artifact(s, o) {
  const { x = 680, y = 156, w = 1144, h = 644, take, fig, t0f } = o;
  const fr = box(s, x, y, w, h, PAPER, 'overflow:hidden;box-shadow:inset 0 0 0 1px ' + INK + ';'); const img = document.createElement('img'); img.className = 'fr'; img.draggable = false; fr.appendChild(img);
  const hl = document.createElement('div'); hl.className = 'abs'; hl.style.cssText = 'left:0;top:0;width:100%;height:100%;pointer-events:none'; fr.appendChild(hl);
  s.take = take; s.frame = { img, w, h, hl, cam: o.cam || [], marks: o.marks || [], t0f: t0f ?? s.t0 };
  wipeIn(s, fr, s.t0 + 0.2, 0.6, 'r');
  rule(s, x, y + h + 24, w, s.t0 + 0.5);
  note(s, x, y + h + 34, fig, s.t0 + 0.7, { w: 900 });
  const tag = document.createElement('div'); tag.className = 'abs note'; tag.style.cssText = `left:${x + w - 420}px;top:${y + h + 34}px;width:420px;text-align:right;color:${SIG};font-weight:700`; s.add(tag); s.warpTag = tag;
  s.U.push(t => { const ws = (WARPS[take] || []).find(r => t - s.t0 >= r[0] && t - s.t0 <= r[1]); tag.textContent = ws ? `■ 等待服务响应 · 加速 ×${ws[2]}` : ''; });
  s.U.push(t => { // camera push (precise ease) + highlight rectangles
    const rel = t - s.t0, cams = s.frame.cam; let z = 1, fx_ = 720, fy = 405, prev = null;
    for (const c of cams) { if (rel >= c[0]) { const p = E(rel, c[0], c[4] || 0.6); const from = prev ? { z: prev[1], x: prev[2], y: prev[3] } : { z: 1, x: 720, y: 405 }; z = lerp(from.z, c[1], p); fx_ = lerp(from.x, c[2], p); fy = lerp(from.y, c[3], p); prev = c; } }
    const sx = w / 1440; let tx = clamp(w / 2 - fx_ * sx * z, w - w * z, 0), ty = clamp(h / 2 - fy * sx * z, h - h * z, 0); img.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
    s.frame.z = z; s.frame.tx = tx; s.frame.ty = ty; });
  (o.marks || []).forEach(m => { const r = document.createElement('div'); r.className = 'abs'; r.style.cssText = `border:3px solid ${SIG};display:none`; hl.appendChild(r); s.U.push(t => { const rel = t - s.t0, a = E(rel, m[0], 0.35), b = m[5] ? E(rel, m[5], 0.3) : 0; if (rel < m[0] || b >= 1) { r.style.display = 'none'; return; } r.style.display = 'block'; const z = s.frame.z, sc = w / 1440 * z; r.style.left = m[1] * sc + s.frame.tx - 4 + 'px'; r.style.top = m[2] * sc + s.frame.ty - 4 + 'px'; r.style.width = m[3] * sc * a + 8 + 'px'; r.style.height = m[4] * sc + 8 + 'px'; }); });
}
function rule(s, x, y, wd, t0) { hline(s, x, y, wd, t0, 0.5, INK, 1); }
const WARPS = (window.DATA && window.DATA.warps) || {};
const ZOOM = { tour: 2.1, ctx: 1.35, upload: 2.0, staged: 1.35, source: 1.9, pending: 1.9, brief: 1.45, next: 1.9, done: 1.3, lane: 1.7, accept: 2.2, family: 1.6, table: 1.15, detail: 1.6, intake: 1.5, weekly: 1.4 };
function autoMarks(take, dur) {
  const ms = ((window.DATA.marks || {})[take] || []).filter(m => m.box && m.box[1] + m.box[3] < 800 && m.box[0] + m.box[2] < 1440 && ZOOM[m.name]);
  const cam = [], hl = []; ms.forEach((m, i) => { const [x, y, w, h] = m.box, nx = ms[i + 1] ? ms[i + 1].t : dur - 1.2, end = Math.min(m.t + 3.0, nx - 0.2);
    const z = Math.max(1, Math.min(ZOOM[m.name], 1440 * 0.78 / w, 810 * 0.78 / h)); cam.push([m.t + 0.15, z, x + w / 2, y + h / 2, 0.7]); hl.push([m.t + 0.2, x, y, w, h, end]);
    if (!ms[i + 1] || ms[i + 1].t - m.t > 4.5) cam.push([Math.min(end + 0.2, m.t + 3.4), 1, 720, 405, 0.7]); });
  return { cam, hl };
}
const TAKEFRAMES = { n: {} };
function spread(s, o) {          // left-page programme for scenes that show an artifact
  numeral(s, M, 88, o.num, 300, s.t0 + 0.2);
  txt(s, { x: M, y: 400, size: 46, weight: 800, text: o.rule, t0: s.t0 + 0.5, lh: 1.16, w: 560, tr: -0.01 });
  o.notes.forEach((n, i) => note(s, M, 548 + i * 28, n, s.t0 + 0.7 + i * 0.1, { w: 540 }));
  s.subBox = { x: M, y: 700, w: 540, size: 34 };
}
function chrome(s, partLabel) {  // small technical notes in the corners
  note(s, M, 36, 'EduPi — 垂类个人智能体', s.t0 + 0.2, { w: 500 });
  note(s, W - M - 400, 36, partLabel, s.t0 + 0.2, { w: 400, align: 'right' });
  hline(s, M, 70, W - 2 * M, s.t0 + 0.1, 0.6, INK, 1);
}

/* ================== SCENES ================== */
const P = ['', 'PART 1 / 3 · 作品概述', 'PART 2 / 3 · 核心功能演示与典型应用场景模拟', 'PART 3 / 3 · 用户交互过程与成效'];
function card(n, title, sub) {
  const s = scene({ id: 'card' + n, part: n, dur: 2.8, pre: 0.3, post: 0.6, kind: 'card' });
  numeral(s, M, 120, String(n), 640, s.t0 + 0.3, { d: BEAT });
  txt(s, { x: 900, y: 470, size: 112, weight: 800, text: title, t0: s.t0 + 0.7, lh: 1.05, w: 960, tr: -0.015 });
  if (sub) note(s, 900, 470 + 112 * 1.05 * title.split('\n').length + 24, sub, s.t0 + 1.1, { w: 900 });
  hline(s, 900, 440, 924, s.t0 + 0.5, 0.6, INK, 2);
  note(s, M, 36, 'EduPi — 垂类个人智能体', s.t0 + 0.2); note(s, W - M - 300, 36, `${n} / 3`, s.t0 + 0.2, { w: 300, align: 'right' });
  return s;
}
const CAT = { 教学: [INK, '#fff'], 学生: [G3, '#fff'], 家校: [G2, INK], 行政: [G1, INK] };

/* -------- PART 1 -------- */
card(1, '作品概述', '数据之前，先看老师的一周。');

const SA = scene({ id: 'A', part: 1, label: '01 / 老师的一周', lines: [['a1', 0.6], ['a2', 0.4]], post: 1.6 });
{ const s = SA; chrome(s, P[1]); s.subBox = { x: M, y: 760, w: 560, size: 34 };
  numeral(s, M, 96, '4', 380, s.t0 + 0.3); txt(s, { x: M + 270, y: 330, size: 40, weight: 800, text: '类事务', t0: s.t0 + 0.6, w: 400 });
  [['教学', '备课 · 授课 · 批改'], ['学生', '成长 · 状态 · 安全'], ['家校', '沟通 · 家访 · 家长会'], ['行政', '周报 · 计划 · 检查']].forEach(([k, d], i) => {
    const y = 470 + i * 56; cell(s, M, y, 28, 28, CAT[k][0], '', s.t0 + 0.9 + i * 0.12); txt(s, { x: M + 44, y: y - 4, size: 30, weight: 800, text: k, t0: s.t0 + 0.9 + i * 0.12, w: 100 }); note(s, M + 130, y + 3, d, s.t0 + 0.9 + i * 0.12, { w: 400 }); });
  const days = ['周一', '周二', '周三', '周四', '周五'], X0 = 680, Y0 = 156, CW = 220, GW = 11, RH = 90, RG = 8;
  days.forEach((d, i) => note(s, X0 + i * (CW + GW), Y0 - 34, d, s.t0 + 0.4, { w: 200 }));
  const grid = [['教学:备课', '教学:授课', '学生:晨检', '家校:群消息', '行政:例会', '教学:批改', '学生:谈话', '行政:周报'], ['教学:授课', '教学:授课', '家校:电话', '学生:跟进', '行政:检查', '教学:备课', '家校:群消息', '教学:批改'], ['学生:晨检', '教学:授课', '行政:计划', '教学:授课', '家校:家访', '学生:谈话', '教学:备课', '行政:材料'], ['教学:授课', '家校:群消息', '教学:授课', '学生:跟进', '教学:批改', '行政:例会', '学生:谈话', '家校:电话'], ['学生:晨检', '教学:授课', '教学:授课', '行政:周报', '家校:家长会', '教学:批改', '行政:总结', '学生:跟进']];
  const due = { '0,7': 1, '1,4': 1, '2,2': 1, '3,5': 1, '4,3': 1, '4,6': 1, '1,6': 1 };
  grid.forEach((col, d) => col.forEach((c, r) => { const [k, l] = c.split(':'); const t = wordT(s, 'a1', '不只是上课', 0.25) + (d + r) * 0.075; const e = cell(s, X0 + d * (CW + GW), Y0 + r * (RH + RG), CW, RH, CAT[k][0], l, q(t), { color: CAT[k][1], size: 22, d: BEAT / 3, pad: 12 }); }));
  Object.keys(due).forEach(k => { const [d, r] = k.split(',').map(Number); const t = s.L.a2 + 0.2 + (d + r) * 0.1; cell(s, X0 + d * (CW + GW) + CW - 54, Y0 + r * (RH + RG) - 10, 54, 26, INK, '截止', q(t), { size: 15, color: '#fff', va: 'center', pad: 8, d: BEAT / 4 }); });
  note(s, X0, Y0 + 8 * (RH + RG) + 4, '示意：一位班主任兼数学老师的一周，40 个格子，7 个截止点', s.t0 + 1.0, { w: 900 });
  subtitles(s); }

const SB = scene({ id: 'B', part: 1, label: '02 / 幕后', lines: [['b1', 0.6], ['b2', 0.4]], post: 1.6 });
const lanes = [['教学', '课前准备清单', 0, 1, '−1 天'], ['学生', '学生跟进名单', 1, 3, '−2 天'], ['家校', '家长回复草稿', 1, 2, '−1 天'], ['行政', '周报与计划初稿', 2, 4, '−2 天']];
function laneChart(s, X0, Y0, tDue, tDel, wide = 1144, opts = {}) {
  const CW2 = wide / 5, LH = opts.lh || 170, days = ['周一', '周二', '周三', '周四', '周五'];
  days.forEach((d, i) => note(s, X0 + i * CW2, Y0 - 34, d, tDue - 0.5, { w: 200 }));
  hline(s, X0, Y0 - 8, wide, tDue - 0.5, 0.6, INK, 1);
  (opts.sel || lanes).forEach(([k, label, dl, du, off], i) => { const y = Y0 + i * (LH + 12);
    cell(s, X0, y, wide, LH, G1, '', tDue - 0.3 + i * 0.1, { d: BEAT / 2 }); txt(s, { x: X0 + 14, y: y + 10, size: 22, weight: 800, text: k, t0: tDue - 0.2 + i * 0.1, w: 200 });
    const dx = X0 + (du + 1) * CW2 - 10; cell(s, dx, y, 10, LH, INK, '', q(tDue + i * 0.15), { d: BEAT / 4, dir: 'u' }); cell(s, dx - 74, y, 74, 28, INK, '截止', q(tDue + i * 0.15), { size: 15, va: 'center', pad: 10, d: BEAT / 4 });
    cell(s, X0 + dl * CW2 + 8, y + 60, CW2 * 1.0 - 16, 76, SIG, label, q(tDel(i)), { size: 22, va: 'center', pad: 16, d: BEAT / 2 });
    txt(s, { x: X0 + dl * CW2 + 8, y: y + 142, size: 19, weight: 700, color: SIG, text: `提前交付 ${off}`, t0: q(tDel(i)) + 0.3, d: BEAT / 3, w: 300 }); });
}
{ const s = SB; chrome(s, P[1]); s.subBox = { x: M, y: 760, w: 560, size: 34 };
  txt(s, { x: M - 6, y: 110, size: 210, weight: 800, text: 'EduPi', t0: s.t0 + 0.4, d: BEAT, tr: -0.03, w: 700, lh: 1 });
  txt(s, { x: M, y: 360, size: 44, weight: 800, text: '教育垂类\n个人智能体', t0: s.t0 + 0.9, w: 560, lh: 1.15 });
  note(s, M, 560, '记住每个学生 · 听懂随口一句话 · 在截止前交付', s.t0 + 1.2, { w: 560 });
  laneChart(s, 680, 156, s.L.b1 + 0.6, i => wordT(s, 'b2', '截止之前', 0.3) + i * 0.9);
  note(s, 680, 156 + 4 * 182 + 6, '示意：四类事务各有截止点；蓝色块为 EduPi 提前交付的成果', s.t0 + 1.2, { w: 900 });
  subtitles(s); }

const SC_ = scene({ id: 'C', part: 1, label: '03 / 提醒 ≠ 交付', lines: [['c1', 0.6], ['c2', 0.4]], post: 1.8 });
{ const s = SC_; chrome(s, P[1]); s.subBox = { x: M, y: 760, w: 560, size: 34 };
  txt(s, { x: M - 4, y: 110, size: 150, weight: 800, text: '提醒', t0: s.t0 + 0.4, d: BEAT, tr: -0.03, lh: 1 });
  txt(s, { x: M - 4, y: 270, size: 150, weight: 800, text: '≠ 交付', t0: s.t0 + 0.7, d: BEAT, tr: -0.03, lh: 1 });
  note(s, M, 470, '提醒：截止当天说一声。交付：截止之前，成果已在手里。', s.t0 + 1.2, { w: 540 });
  const X0 = 680, Y0 = 190, CW2 = 1144 / 5; ['周一', '周二', '周三', '周四', '周五'].forEach((d, i) => note(s, X0 + i * CW2, Y0 - 34, d, s.t0 + 0.4, { w: 200 })); hline(s, X0, Y0 - 8, 1144, s.t0 + 0.4, 0.6);
  cell(s, X0, Y0, 1144, 170, G1, '', s.t0 + 0.8); txt(s, { x: X0 + 14, y: Y0 + 10, size: 22, weight: 800, text: '提醒', t0: s.t0 + 0.9, w: 200 });
  const dueX = X0 + 5 * CW2 - 10; cell(s, dueX, Y0, 10, 170, INK, '', s.t0 + 1.1, { dir: 'u', d: BEAT / 4 }); cell(s, dueX - 74, Y0, 74, 28, INK, '截止', s.t0 + 1.1, { size: 15, va: 'center', pad: 10, d: BEAT / 4 });
  cell(s, dueX - 190, Y0 + 60, 150, 50, G3, '该做了', wordT(s, 'c1', '该做了', -0.2), { size: 22, va: 'center', pad: 14, d: BEAT / 4 });
  const Y1 = Y0 + 230; cell(s, X0, Y1, 1144, 520, G1, '', s.t0 + 1.0); txt(s, { x: X0 + 14, y: Y1 + 10, size: 22, weight: 800, text: 'EduPi', t0: s.t0 + 1.1, w: 200 }); cell(s, dueX, Y1, 10, 520, INK, '', s.t0 + 1.2, { dir: 'u', d: BEAT / 4 }); cell(s, dueX - 74, Y1, 74, 28, INK, '截止', s.t0 + 1.2, { size: 15, va: 'center', pad: 10, d: BEAT / 4 });
  [['计划初稿', '周三', 2, '计划'], ['课前准备清单', '明天的课之前', 0.5, '课前'], ['家长回复草稿', '随问随备', 1, '家长群']].forEach(([lab, when, dl, key], i) => { const y = Y1 + 70 + i * 148; const t = q(wordT(s, 'c2', key, -0.1)); cell(s, X0 + dl * CW2 + 8, y, CW2 * 1.5, 80, SIG, lab, t, { size: 24, va: 'center', pad: 18, d: BEAT / 2 }); note(s, X0 + dl * CW2 + 8, y + 88, '已就绪 · ' + when, t + 0.3, { color: SIG, weight: 700, w: 420 }); cell(s, dueX - 150, y + 14, 110, 52, INK, '确认', q(wordT(s, 'c2', '确认', -0.1)), { size: 22, va: 'center', pad: 16, d: BEAT / 4 }); });
  subtitles(s); }

const SD = scene({ id: 'D', part: 1, label: '04 / 能力来自哪里', lines: [['d1', 0.6], ['d2', 0.4]], post: 1.8 });
{ const s = SD; chrome(s, P[1]); s.subBox = { x: M, y: 800, w: 1000, size: 36 };
  const mods = [['01', '感知', '意图 · 校历 · 课表'], ['02', '记忆', '学生画像 · 检索'], ['03', '潜意识', '夜间整理 · 洞察'], ['04', '能力', '诊断 · 场景技能'], ['05', '调度', '心跳 · 主动巡检'], ['06', '交付', '落盘 · 推送']];
  const outT = s.L.d2 + 0.2;
  mods.forEach(([n, name, kw], i) => { const x = cx(2 * i), w = cw(2), t = q(wordT(s, 'd1', name, -0.2));
    const e = cell(s, x, 150, w, 330, i === 5 ? SIG : PAPER, '', t, { border: 1, d: BEAT / 2 }); txt(s, { x: x + 16, y: 170, size: 24, weight: 700, color: i === 5 ? '#fff' : G3, text: n, t0: t + 0.1, w: 200, out: [outT, 0.4] }); txt(s, { x: x + 16, y: 360, size: 58, weight: 800, color: i === 5 ? '#fff' : INK, text: name, t0: t + 0.15, w: 260, tr: -0.01, out: [outT, 0.4] }); note(s, x + 16, 436, kw, t + 0.25, { color: i === 5 ? '#fff' : G3, w: 240, out: [outT, 0.4] }); });
  numeral(s, M, 520, '43', 220, wordT(s, 'd1', '四十多个', -0.2), { out: [outT, 0.5] }); note(s, M + 330, 590, '个班主任场景技能', wordT(s, 'd1', '四十多个', 0.1), { size: 19, w: 400, out: [outT, 0.4] });
  const bw = 1728 - 400; for (let i = 0; i < 43; i++) { const x = M + 400 + i * (bw / 43); cell(s, x, 640, bw / 43 + 1, 96, INK, '', q(wordT(s, 'd1', '四十多个', 0.1) + i * 0.025), { d: BEAT / 4, out: [outT + i * 0.008, 0.3] }); }
  const lv = [['L1', '工具'], ['L2', '助手'], ['L3', '主动助手'], ['L4', '无感搭档'], ['L5', '自主智能']];
  numeral(s, M, 120, 'L4', 300, outT + 0.5); txt(s, { x: M, y: 420, size: 44, weight: 800, text: '无感搭档', t0: outT + 0.8, w: 560 }); note(s, M, 500, '老师正常说话，背后的事已经做完。我们的定位。', outT + 1.0, { w: 540 });
  lv.forEach(([l, n], i) => { const bh = 120 + i * 112, x = 780 + i * 208, y = 760 - bh; const sig = i === 3; const e = cell(s, x, y, 184, bh, sig ? SIG : (i === 4 ? PAPER : INK), '', outT + 0.5 + i * 0.12, { dir: 'u', border: i === 4 ? 1 : 0, d: BEAT / 2 }); txt(s, { x: x + 14, y: y + 12, size: 30, weight: 800, color: sig ? '#fff' : (i === 4 ? INK : '#fff'), text: l, t0: outT + 0.7 + i * 0.12, w: 160 }); txt(s, { x: x + 14, y: y + 52, size: 20, weight: 700, color: sig ? '#fff' : (i === 4 ? G3 : '#fff'), text: n, t0: outT + 0.8 + i * 0.12, w: 160 }); });
  note(s, 780, 776, 'EduPi Core 在本机运行 · 教学数据保存在本地', wordT(s, 'd2', '本地', -0.4), { w: 700, color: INK, weight: 700 });
  subtitles(s); }

/* -------- PART 2 -------- */
card(2, '核心功能演示\n与典型场景', '真实桌面客户端 · 模拟数据');

function realScene(id, num, label, rule_, notes, lines, take, extra = {}) {
  const s = scene(Object.assign({ id, part: 2, real: true, label, lines, post: extra.post ?? 3.0, pre: 1.0 }, {})); chrome(s, P[2]);
  spread(s, { num, rule: rule_, notes });
  const am = autoMarks(take, 99); artifact(s, { take, fig: `FIG ${num} — 真实桌面客户端 v0.3.70 · 模拟数据`, cam: am.cam, marks: am.hl });
  subtitles(s); return s;
}
const SE = realScene('E', '01', '01 / 首次进入', '七步新手教程\n教师上下文', ['连接模型 · 确认教师资料 · 导入名单', '导入校历 · 上传材料 · 第一次备课', '教师上下文：证据条数 · 不外发'], [['e1', 1.0], ['e2', 0.8]], 'E', { post: 4.0 });
const SF = realScene('F', '02', '02 / 日程', '通知先暂存\n确认才接入', ['上传 → 待接入材料 → 确认类型 / 学科 / 班级', '月历汇总：校历 · 课表 · 任务，并标明来源', '日期不确定：标为“日期待确认”，附原文'], [['f1', 1.0], ['f2', 0.8], ['f3', 0.8]], 'F', { post: 2.5 });
const SG = realScene('G', '03', '03 / 今天 · 工作区', '截止之前\n已经备好', ['今天：简报 · 接下来的日程 · 待判断事项', '工作区：待处理 / 进行中 / 待我确认 / 已完成', '周报、计划、发言提纲：初稿已备好'], [['g1', 1.0], ['g2', 0.8]], 'G', { post: 8.0 });
const SH = realScene('H', '04', '04 / 学生与家校', '随口一句\n留下可审核的记录', ['观察与记忆候选：来源 · 证据 · 教师内部', '接受 / 修改 / 拒绝 / 暂缓，接受后留回执', '学生档案：学习记录 · 同伴互动 · 家校人物'], [['h1', 1.0], ['h2', 0.8], ['h3', 0.8]], 'H', { post: 6.0 });
const SI = realScene('I', '05', '05 / 教学材料', '按类型归档\n备课时取材', ['教案 · 通知 · 试卷分析', '类型 · 学科 · 班级 · 来源', '可查看详情，暂存的材料可移除'], [['i1', 1.0]], 'I', { post: 3.0 });

/* -------- phone scenario simulations (flat, schematic) -------- */
function phoneScene(id, num, label, rule_, lines, msgs, post = 2.2) {
  const s = scene({ id, part: 2, label, lines, post, pre: 1.0 }); chrome(s, P[2]);
  numeral(s, M, 88, num, 300, s.t0 + 0.2);
  txt(s, { x: M, y: 400, size: 46, weight: 800, text: rule_, t0: s.t0 + 0.5, lh: 1.16, w: 560, tr: -0.01 });
  note(s, M, 548, '渠道场景示意 · 非真实飞书录屏', s.t0 + 0.7, { w: 540 }); s.subBox = { x: M, y: 700, w: 540, size: 34 };
  const X = 1004, Y = 130, Wd = 820, Ht = 730; cell(s, X, Y, Wd, Ht, PAPER, '', s.t0 + 0.3, { border: 3, d: 0.6 });
  box(s, X, Y, Wd, 64, INK); note(s, X + 24, Y + 18, '班主任AI助手 · 飞书机器人（示意）', s.t0 + 0.6, { color: '#fff', w: 600 });
  let y = Y + 92; msgs.forEach(m => { const t = q(m.t(s)); const h = m.h || 90; const mine = m.who === 'me'; const w = m.w || 560;
    const x = mine ? X + Wd - w - 24 : X + 24; const bg = mine ? INK : (m.card ? PAPER : G1);
    const e = cell(s, x, y, w, h, bg, '', t, { border: m.card ? 2 : 0, d: BEAT / 2, dir: mine ? 'l' : 'r' });
    if (m.card) cell(s, x, y, 8, h, SIG, '', t + 0.1, { d: BEAT / 4, dir: 'u' });
    txt(s, { x: x + (m.card ? 28 : 18), y: y + 12, size: 21, weight: m.card ? 700 : 500, color: mine ? '#fff' : INK, text: m.text, t0: t + 0.2, w: w - 40, lh: 1.4 });
    y += h + 16; }); subtitles(s); return s;
}
phoneScene('K', 'A', 'A / 家校沟通', '家长一问\n回复已写好', [['k1', 1.0], ['k2', 0.6]], [
  { who: 'me', text: '（转发）家长：老师，孩子这学期\n数学退步了，该怎么办？', t: s => wordT(s, 'k1', '家长在群里', 0.0), h: 100, w: 500 },
  { who: 'bot', card: true, text: '回复草稿 · 内部草稿 · 不外发\nXX 妈妈您好，孩子这学期在计算准确率上有进步，\n但最近在“移项变号”上遇到困难。我在课堂上会重点关注，\n建议在家用 2–3 道类似题练习。', t: s => wordT(s, 'k1', '已经写好', 0.0), h: 210, w: 700 },
  { who: 'me', text: '改成“小明妈妈”，确认', t: s => wordT(s, 'k2', '老师改个', 0.0), h: 60, w: 380 },
  { who: 'bot', text: '已保存修改。确认之后才会发送。', t: s => wordT(s, 'k2', '确认之后', 0.0), h: 60, w: 460 }]);
phoneScene('L', 'B', 'B / 提前交付', '周报，提前\n一天就绪', [['l1', 1.0], ['l2', 0.6]], [
  { who: 'bot', card: true, text: '早安简报 · 07:30\n今天 18:00 前：第 7 周班级周报\n周一：班主任工作计划 · 家长会发言提纲\n已备好：周报初稿、计划初稿', t: s => wordT(s, 'l1', '早安简报', -0.3), h: 170, w: 700 },
  { who: 'bot', card: true, text: '第 7 周班级周报 · 初稿已生成（周四 21:00）\n截止：周五 18:00 · 提前 21 小时交付\n本周班级情况 · 重点学生跟进 · 下周安排', t: s => wordT(s, 'l2', '初稿已经生成', -0.2), h: 150, w: 700 }]);
phoneScene('M', 'C', 'C / 安全事件', '一句话\n同一轮就识别', [['m1', 1.0]], [
  { who: 'me', text: '李四体育课摔了一下，手腕有点肿', t: s => s.L.m1 + 0.8, h: 60, w: 520 },
  { who: 'bot', card: true, text: '安全事件 · 即时提醒\n识别到受伤信息：李四 · 体育课 · 手腕肿\n建议：联系校医、通知家长、记录事件', t: s => wordT(s, 'm1', '立刻', -0.6), h: 150, w: 700 }], 2.6);

/* -------- PART 3 -------- */
card(3, '用户交互过程\n与成效', '先看闭环，再看证据');

const SN = scene({ id: 'N', part: 3, label: '01 / 交互闭环', lines: [['n1', 0.8], ['n2', 0.6]], post: 1.8 });
{ const s = SN; chrome(s, P[3]); s.subBox = { x: M, y: 700, w: 1100, size: 38 };
  const mods = [['说话\n或上传', '说话'], ['感知', '感知'], ['记忆', '记忆'], ['技能', '技能'], ['产物', '准备'], ['教师确认', '待确认']];
  mods.forEach(([name, key], i) => { const x = cx(2 * i), w = cw(2), t = q(wordT(s, 'n1', key, -0.2)); cell(s, x, 190, w, 250, i === 5 ? SIG : PAPER, '', t, { border: 1, d: BEAT / 2 });
    txt(s, { x: x + 18, y: 210, size: 22, weight: 700, color: i === 5 ? '#fff' : G3, text: '0' + (i + 1), t0: t + 0.1, w: 100 }); txt(s, { x: x + 18, y: 300, size: name.includes('\n') ? 38 : 52, weight: 800, color: i === 5 ? '#fff' : INK, text: name, t0: t + 0.15, w: w - 30, lh: 1.1 });
    if (i < 5) hline(s, x + w, 315, GUT, t + 0.2, 0.15, INK, 2); });
  note(s, cx(8), 460, '全部停在“待确认”', wordT(s, 'n1', '待确认', -0.1), { w: 500 });
  const t2 = wordT(s, 'n2', '反馈', -0.3); vline(s, cx(11) + cw(2) / 2 - cw(2) / 2 + 134, 440, 90, t2, 0.2, SIG, 3); hline(s, cx(4) + 134, 530, cx(11) + 134 - (cx(4) + 134), t2 + 0.2, 0.9, SIG, 3); vline(s, cx(4) + 134, 440, 90, t2 + 1.1, 0.2, SIG, 3);
  note(s, cx(5), 548, '反馈回流记忆 → 下一次更准', t2 + 0.6, { color: SIG, weight: 700, w: 600 });
  txt(s, { x: M - 4, y: 590, size: 96, weight: 800, text: '人，始终在回路中。', t0: wordT(s, 'n2', '人', -0.2), d: BEAT, tr: -0.02, w: 1600, lh: 1.0 });
  subtitles(s); }

const SO = scene({ id: 'O', part: 3, label: '02 / 证据与成效', lines: [['o1', 0.8], ['o2', 0.5], ['o3', 0.8]], post: 3.2 });
{ const s = SO; chrome(s, P[3]); s.subBox = { x: M, y: 800, w: 1100, size: 36 };
  const cells = [['E0', '代码', 2, '已写入代码'], ['E1', '隔离测试', 2, '隔离路径通过'], ['E2', '本机真实数据', 1, '本机数据路径可用'], ['E3', '运行时闭环', 1, '指定闭环可回放'], ['E4', '真实渠道', 0, '指定渠道消息闭环'], ['E5', '教师真人', 0, '指定教师场景试用']];
  const out = s.L.o3 + 0.1; const ks = ['代码', '隔离测试', '本机真实数据', '运行时闭环', '真实渠道', '教师真人'];
  txt(s, { x: M, y: 100, size: 56, weight: 800, text: '证据等级 · 不自己给自己打分', t0: s.t0 + 0.4, w: 1500, tr: -0.01, out: [out, 0.4] });
  cells.forEach(([id, name, st, can], i) => { const x = cx(2 * i), w = cw(2), t = q(wordT(s, 'o1', ks[i], -0.2)); const y = 220, hh = 330;
    cell(s, x, y, w, hh, PAPER, '', t, { border: 1, d: BEAT / 2, out: [out + i * 0.05, 0.4] });
    if (st === 2) cell(s, x, y, w, hh, INK, '', t + 0.15, { d: BEAT / 2, dir: 'u', out: [out + i * 0.05, 0.4] }); else if (st === 1) cell(s, x, y + hh / 2, w, hh / 2, INK, '', t + 0.15, { d: BEAT / 2, dir: 'u', out: [out + i * 0.05, 0.4] });
    txt(s, { x: x + 18, y: y + 14, size: 72, weight: 800, color: st === 2 ? '#fff' : INK, text: id, t0: t + 0.2, w: w - 20, tr: -0.02, out: [out + i * 0.05, 0.4] }); txt(s, { x: x + 18, y: y + 104, size: 28, weight: 700, color: st === 2 ? '#fff' : INK, text: name, t0: t + 0.3, w: w - 20, out: [out + i * 0.05, 0.4] });
    const stT = st === 2 ? wordT(s, 'o2', '通过', -0.4) : st === 1 ? s.L.o2 + 0.2 : wordT(s, 'o2', '飞书', -0.3); const stL = st === 2 ? '已完成' : st === 1 ? '进行中' : '待补齐';
    txt(s, { x: x + 18, y: y + hh - 52, size: 28, weight: 800, color: st === 2 || st === 1 ? '#fff' : G3, text: stL, t0: q(stT) + i * 0.08, w: w - 20, out: [out + i * 0.05, 0.4] });
    note(s, x, y + hh + 14, can, t + 0.5, { w: w, out: [out + i * 0.05, 0.4] }); });
  note(s, M, 640, '引自 Desktop 验收矩阵 E0–E5 · Core L4 无密钥测试（隔离）：75 / 75', wordT(s, 'o2', '目前', 0.2), { w: 1200, color: INK, weight: 700, out: [out, 0.4] });
  const c0 = out + 0.7; txt(s, { x: M - 6, y: 150, size: 200, weight: 800, text: '老师只管教书。', t0: c0, d: BEAT, tr: -0.03, w: 1800, lh: 1 });
  txt(s, { x: M, y: 410, size: 84, weight: 800, text: 'EduPi 在幕后准备，', t0: wordT(s, 'o3', '幕后', -0.3), w: 1700, tr: -0.015, lh: 1.05 });
  txt(s, { x: M, y: 515, size: 84, weight: 800, color: SIG, text: '在截止之前交付。', t0: wordT(s, 'o3', '截止', -0.3), w: 1700, tr: -0.015, lh: 1.05 });
  note(s, M, 640, '教师负责确认 · 不替教师作最后决定', wordT(s, 'o3', '教师负责', -0.2), { w: 900, color: INK, weight: 700 });
  note(s, M, 674, 'github.com/PIGU-PPPgu/edupi-desktop  ·  github.com/PIGU-PPPgu/edupi', wordT(s, 'o3', '教师负责', 0.4), { w: 1200 });
  subtitles(s); }

/* ---------- transitions (wipe between scenes) ---------- */
const BOUND = []; for (let i = 1; i < SC.length; i++) BOUND.push(SC[i].t0);
function wipeAt(t) {
  const w = document.getElementById('wipe'); let show = false;
  for (const b of BOUND) { const u = (t - (b - 0.32)) / 0.64; if (u >= 0 && u <= 1) { show = true; const up = u < .5 ? bez(u * 2) : 1 - bez((u - .5) * 2); w.style.display = 'block'; const left = u < .5; w.style.clipPath = left ? `inset(0 ${100 - up * 100}% 0 0)` : `inset(0 0 0 ${(1 - up) * 100}%)`; w.style.clipPath = u < .5 ? `inset(0 ${100 - bez(u * 2) * 100}% 0 0)` : `inset(0 0 0 ${bez((u - .5) * 2) * 100}%)`; } }
  if (!show) w.style.display = 'none';
}
for (let i = 1; i < SC.length; i++) SNAPS.push(SC[i].t0);

/* ---------- render ---------- */
const sceneAt = t => { for (const s of SC) if (t >= s.t0 && t < s.t1) return s; return SC[SC.length - 1]; };
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let cur = null;
window.renderAt = async t => {
  const s = sceneAt(t); if (cur !== s) { if (cur) cur.el.style.display = 'none'; s.el.style.display = 'block'; cur = s; }
  s.U.forEach(f => f(t));
  if (s.real && s.frame) { const n = Math.max(1, Math.min(9999, Math.floor((t - s.frame.t0f) * FPS) + 1)); const src = `file://${DATA.sp}/sframes/${s.take}/${String(n).padStart(5, '0')}.jpg`; if (s.frame.img.dataset.src !== src) { s.frame.img.dataset.src = src; s.frame.img.src = src; try { await s.frame.img.decode(); } catch (e) { /* hold previous frame */ } } }
  wipeAt(t);
};
window.DUR = T;
window.getEvents = () => ({ dur: T, scenes: SC.map(s => ({ id: s.id, kind: s.kind || 'swiss', part: s.part, real: !!s.real, t0: s.t0, t1: s.t1, L: s.L })), vo: SC.flatMap(s => Object.keys(s.L).map(id => ({ id, t: s.L[id] }))), snaps: SNAPS.slice().sort((a, b) => a - b) });
document.fonts.load('800 100px Inter').then(() => document.fonts.ready).then(() => { renderAt(0); window.ready = true; });
