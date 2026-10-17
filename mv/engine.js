'use strict';
/* EduPi film engine — every frame is a pure function of t. */
const W = 1920, H = 1080, V = DATA.vo;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const sm = u => { u = clamp(u); return u * u * (3 - 2 * u); };
const eo = u => 1 - Math.pow(1 - clamp(u), 3);
const lerp = (a, b, u) => a + (b - a) * u;
const rnd = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const $ = id => document.getElementById(id);
const _eC = {}; const E = sel => _eC[sel] || (_eC[sel] = document.querySelector(sel));

const SC = [], EV = [], ST = [], CUR = [], STAND = [], CAM = [], WIG = [], HIDECUR = [], WIPES = [];
let T = 0;

/* ---------- timeline layout ---------- */
function scene(def) {
  const s = Object.assign({ items: [], lines: [], pre: .9, post: 1.0, kind: 'paper', part: 1 }, def);
  s.t0 = T; s.L = {};
  let t = T + s.pre;
  if (def.dur) t = T + def.dur - s.post;
  else {
    for (const [id, lead] of s.lines) { t += (lead || 0); s.L[id] = t; t += V[id].d + .4; }
    t -= .4;
  }
  s.t1 = t + s.post; T = s.t1; SC.push(s);
  s.w = (id, word, off = 0) => { const x = V[id].text; const i = Math.max(0, x.indexOf(word)); return s.L[id] + V[id].d * (i / x.length) + off; };
  s.at = (id, dt = 0) => s.L[id] + dt;
  return s;
}
const sceneAt = t => { for (const s of SC) if (t >= s.t0 && t < s.t1) return s; return SC[SC.length - 1]; };

/* ---------- paper primitives ---------- */
const FH = '"Kaiti SC","STKaiti","Bradley Hand",cursive', FS = '"Songti SC","STSong",serif', FM = 'Menlo,monospace';
const INK = '#3a3228', GRAPH = '#4a4540', BLUE = '#2a5aa8', RED = '#b5322f', PALE = '#d9cfb8';

function sample(pts, seed, amp = 1.3) {
  const out = []; let idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5));
    for (let k = 0; k < n; k++) {
      const u = k / n; idx++;
      out.push([lerp(x0, x1, u) + (rnd(seed + idx * 3.1) - .5) * 2 * amp, lerp(y0, y1, u) + (rnd(seed + idx * 5.3) - .5) * 2 * amp]);
    }
  }
  out.push(pts[pts.length - 1].slice()); return out;
}
const rrect = (x, y, w, h, r = 14) => [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r], [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r], [x + r, y]];
const ellipse = (cx, cy, rx, ry, a0 = -1.2, turns = 1.08) => { const o = []; for (let i = 0; i <= 40; i++) { const a = a0 + i / 40 * turns * 2 * Math.PI; o.push([cx + rx * Math.cos(a) * (1 + i / 400), cy + ry * Math.sin(a) * (1 + i / 400)]); } return o; };
const arrow = (x0, y0, x1, y1) => { const a = Math.atan2(y1 - y0, x1 - x0), L = 18; return [[x0, y0], [x1, y1], [x1 - L * Math.cos(a - .45), y1 - L * Math.sin(a - .45)], [x1, y1], [x1 - L * Math.cos(a + .45), y1 - L * Math.sin(a + .45)]]; };
const arc = (x0, y0, x1, y1, h) => { const o = []; for (let i = 0; i <= 30; i++) { const u = i / 30; o.push([lerp(x0, x1, u), lerp(y0, y1, u) - 4 * h * u * (1 - u) * (1)]); } return o; };

const P = {
  poly(s, o) { const it = Object.assign({ type: 'poly', color: GRAPH, w: 3, seed: s.items.length * 7 + 3, amp: 1.3 }, o); it.sm = sample(it.pts, it.seed, it.amp); s.items.push(it); if (it.sfx !== false) EV.push({ type: 'scratch', t0: it.t0, t1: it.t1 }); return it; },
  text(s, o) { const it = Object.assign({ type: 'text', font: 'hw', size: 40, color: GRAPH, x: 0, y: 0, align: 'left', rot: 0 }, o); s.items.push(it); if (it.t1 > it.t0) EV.push({ type: 'scratch', t0: it.t0, t1: it.t1 }); return it; },
  bars(s, o) { const it = Object.assign({ type: 'bars' }, o); s.items.push(it); it.days.forEach((d, i) => { if (d.v > 0) EV.push({ type: 'blip', t: it.t0 + i * it.dt, val: d.v / 112 }); }); return it; },
  dots(s, o) { const it = Object.assign({ type: 'dots', r: 11, color: BLUE }, o); s.items.push(it); it.pts.forEach((p, i) => EV.push({ type: 'pop', t: it.t0 + i * it.dt, val: i })); return it; },
  grid(s, o) { s.items.push(Object.assign({ type: 'static' }, o)); },
};

const fontOf = (f, size) => (f === 'hw' ? FH : f === 'serif' ? FS : FM).replace(/^/, `${size}px `);
function layoutText(ctx, it) {
  if (it._lay) return it._lay;
  ctx.font = fontOf(it.font, it.size);
  const lines = it.text.split('\n'), lay = []; let n = 0;
  const lh = it.size * 1.38;
  lines.forEach((ln, li) => {
    const adv = []; let w = 0;
    for (const ch of ln) { const a = ctx.measureText(ch).width; adv.push(a); w += a; }
    const x0 = it.align === 'center' ? it.x - w / 2 : it.align === 'right' ? it.x - w : it.x;
    let x = x0;
    [...ln].forEach((ch, ci) => { lay.push({ ch, x, y: it.y + li * lh, i: n++ }); x += adv[ci]; });
  });
  return (it._lay = lay);
}

const noise = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i * .37) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v < 128 ? 80 : 255; d.data[i + 3] = Math.abs(rnd(i * .91) - .5) * 38; } g.putImageData(d, 0, 0); return c; })();
const rampC = u => { u = clamp(u); const a = [239, 217, 168], b = [42, 74, 122]; return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], u))).join(',')})`; };

function itemAlpha(it, t) {
  let a = 1;
  if (it.fo) a *= 1 - sm((t - it.fo[0]) / Math.max(.01, it.fo[1] - it.fo[0]));
  return a;
}

function drawItem(g, it, t) {
  if (t < it.t0) return null;
  const al = itemAlpha(it, t); if (al <= 0) return null;
  g.save(); g.globalAlpha = al; g.lineCap = 'round'; g.lineJoin = 'round';
  let tip = null;
  if (it.type === 'poly') {
    const p = it.t1 > it.t0 ? clamp((t - it.t0) / (it.t1 - it.t0)) : 1, n = Math.floor(p * (it.sm.length - 1));
    const pass = (w, a, ox, oy) => {
      g.strokeStyle = it.color; g.lineWidth = w; g.globalAlpha = al * a; g.beginPath();
      for (let i = 0; i <= n; i++) { if (it.dash && ((i / 3) | 0) % 2) { g.moveTo(it.sm[Math.min(i + 1, n)][0] + ox, it.sm[Math.min(i + 1, n)][1] + oy); continue; } i === 0 ? g.moveTo(it.sm[i][0] + ox, it.sm[i][1] + oy) : g.lineTo(it.sm[i][0] + ox, it.sm[i][1] + oy); }
      g.stroke();
    };
    pass(it.w, .88, 0, 0); pass(it.w * .45, .5, .8, .7);
    if (it.fill && p >= 1) { g.globalAlpha = al * it.fill[1]; g.fillStyle = it.fill[0]; g.beginPath(); it.sm.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.fill(); }
    if (t <= it.t1 + .05) tip = it.sm[n];
  } else if (it.type === 'text') {
    const lay = layoutText(g, it), typed = it.t1 > it.t0, p = typed ? clamp((t - it.t0) / (it.t1 - it.t0)) : sm((t - it.t0) / .35);
    const cnt = typed ? Math.floor(p * lay.length) : lay.length;
    g.font = fontOf(it.font, it.size); g.fillStyle = it.color; g.textBaseline = 'alphabetic';
    for (let i = 0; i < cnt; i++) { const c = lay[i]; g.save(); g.translate(c.x, c.y + (rnd(i * 1.7 + it.x) - .5) * (it.font === 'hw' ? 2.4 : 0)); g.rotate(it.rot + (rnd(i * 2.3) - .5) * (it.font === 'hw' ? .035 : 0)); g.fillText(c.ch, 0, 0); g.restore(); }
    if (typed && cnt < lay.length && cnt > 0) { const c = lay[cnt - 1]; tip = [c.x + it.size * .5, c.y - it.size * .18]; } else if (typed && t <= it.t1 + .05 && lay.length) { const c = lay[lay.length - 1]; tip = [c.x + it.size * .5, c.y - it.size * .18]; }
    if (!typed) g.globalAlpha = al;
  } else if (it.type === 'bars') {
    const n = it.days.length, { x0, step, bw, yb, sc } = it;
    let lead = -1;
    it.days.forEach((d, i) => {
      const ti = it.t0 + i * it.dt; if (t < ti) return;
      let h = d.v * sc * eo((t - ti) / .3);
      if (it.collapse) h *= 1 - sm((t - it.collapse[0] - i * .01) / .5);
      if (h < .5) return; lead = i;
      g.fillStyle = rampC(d.v / 112); g.strokeStyle = 'rgba(58,50,40,.65)'; g.lineWidth = 1.3;
      g.fillRect(x0 + i * step, yb - h, bw, h); g.strokeRect(x0 + i * step, yb - h, bw, h);
    });
    const ie = Math.min(n - 1, Math.floor((t - it.t0) / it.dt));
    if (t >= it.t0 && t <= it.t0 + n * it.dt + .3) { const d = it.days[Math.max(0, ie)]; tip = [x0 + Math.max(0, ie) * step + bw / 2, yb - d.v * sc * eo((t - (it.t0 + Math.max(0, ie) * it.dt)) / .3)]; }
  } else if (it.type === 'dots') {
    it.pts.forEach((p, i) => {
      const ti = it.t0 + i * it.dt; if (t < ti) return; const u = eo((t - ti) / .22);
      g.fillStyle = it.color; g.strokeStyle = 'rgba(40,40,40,.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(p[0], p[1], it.r * (.3 + .7 * u), 0, 7); g.fill(); g.stroke();
    });
    const ie = Math.min(it.pts.length - 1, Math.floor((t - it.t0) / it.dt));
    if (t >= it.t0 && t <= it.t0 + it.pts.length * it.dt + .2) tip = it.pts[Math.max(0, ie)];
  } else if (it.type === 'static') it.draw(g, t, al);
  g.restore(); return tip;
}

function penWindows(s) { // [{t0,t1,tip(t)}]
  if (s._pen) return s._pen; const w = [];
  s.items.forEach(it => {
    if (it.nopen) return;
    if (it.type === 'poly') w.push({ t0: it.t0, t1: it.t1, it });
    else if (it.type === 'text' && it.t1 > it.t0) w.push({ t0: it.t0, t1: it.t1, it });
    else if (it.type === 'bars') w.push({ t0: it.t0, t1: it.t0 + it.days.length * it.dt + .3, it });
    else if (it.type === 'dots') w.push({ t0: it.t0, t1: it.t0 + it.pts.length * it.dt + .2, it });
  });
  w.sort((a, b) => a.t0 - b.t0); return (s._pen = w);
}
function tipOf(w, t, g) {
  const it = w.it;
  if (it.type === 'poly') { const p = clamp((t - it.t0) / Math.max(.01, it.t1 - it.t0)); return it.sm[Math.min(it.sm.length - 1, Math.floor(p * (it.sm.length - 1)))]; }
  if (it.type === 'text') { const lay = layoutText(g, it); const p = clamp((t - it.t0) / (it.t1 - it.t0)); const c = lay[Math.max(0, Math.min(lay.length - 1, Math.floor(p * lay.length) - 1))]; return [c.x + it.size * .5, c.y - it.size * .18]; }
  if (it.type === 'bars') { const n = it.days.length, i = clamp(Math.floor((t - it.t0) / it.dt), 0, n - 1); return [it.x0 + i * it.step + it.bw / 2, it.yb - it.days[i].v * it.sc * eo((t - (it.t0 + i * it.dt)) / .3)]; }
  const i = clamp(Math.floor((t - it.t0) / it.dt), 0, it.pts.length - 1); return it.pts[i];
}
const PARK = [2100, 1200];
function penPos(s, t, g) {
  const ws = penWindows(s); if (!ws.length) return null;
  let act = null, prev = null, next = null;
  for (const w of ws) { if (t >= w.t0 && t <= w.t1) act = w; if (w.t1 < t) prev = w; if (w.t0 > t && !next) next = w; }
  if (act) { const tp = tipOf(act, t, g); return { x: tp[0], y: tp[1], lift: 0, tap: act.it.type === 'bars' || act.it.type === 'dots' }; }
  const mix = (a, b, u, h) => ({ x: lerp(a[0], b[0], sm(u)), y: lerp(a[1], b[1], sm(u)) - Math.sin(Math.PI * clamp(u)) * h, lift: Math.sin(Math.PI * clamp(u)) });
  if (prev && next && next.t0 - prev.t1 <= 2.0) return mix(tipOf(prev, prev.t1, g), tipOf(next, next.t0, g), (t - prev.t1) / (next.t0 - prev.t1), 40);
  if (next && next.t0 - t < .9) return mix(PARK, tipOf(next, next.t0, g), 1 - (next.t0 - t) / .9, 0);
  if (prev && t - prev.t1 < 1.0) return mix(tipOf(prev, prev.t1, g), PARK, (t - prev.t1) / 1.0, 30);
  return null;
}
function drawPencil(g, p) {
  const ang = .93, L = 300, ww = 20, lift = p.lift || 0;
  const body = (ox, oy, shadow) => {
    g.save(); g.translate(p.x + ox, p.y + oy); g.rotate(ang);
    if (shadow) { g.fillStyle = 'rgba(40,30,20,.16)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(52, -ww / 2); g.lineTo(L, -ww / 2); g.lineTo(L, ww / 2); g.lineTo(52, ww / 2); g.closePath(); g.fill(); g.restore(); return; }
    g.fillStyle = '#e8cfa0'; g.beginPath(); g.moveTo(0, 0); g.lineTo(52, -ww / 2); g.lineTo(52, ww / 2); g.closePath(); g.fill();
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(14, -3.6); g.lineTo(14, 3.6); g.closePath(); g.fill();
    g.fillStyle = '#c8473f'; g.fillRect(52, -ww / 2, (L - 52) / 2, ww);
    g.fillStyle = '#3b6fc4'; g.fillRect(52 + (L - 52) / 2, -ww / 2, (L - 52) / 2, ww);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(52, -ww / 2, L - 52, 4);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2; g.strokeRect(52, -ww / 2, L - 52, ww);
    g.restore();
  };
  body(14 + lift * 26, 18 + lift * 30, true); body(0, 0, false);
}

function drawPaper(s, t) {
  const g = $('paper').getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#f3ecdc'; g.fillRect(0, 0, W, H);
  g.fillStyle = g.createPattern(noise, 'repeat'); g.globalAlpha = .55; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  g.fillStyle = 'rgba(120,100,70,.16)'; for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) g.fillRect(x, y, 2, 2);
  for (const it of s.items) drawItem(g, it, t);
  const p = penPos(s, t, g);
  if (p) {
    let ty = p.y; if (p.tap) ty -= Math.abs(Math.sin(t * 22)) * 7;
    drawPencil(g, { x: p.x, y: ty, lift: p.lift });
  }
  if (s.vignette !== false) { const gr = g.createRadialGradient(W / 2, H / 2, 500, W / 2, H / 2, 1150); gr.addColorStop(0, 'rgba(90,70,40,0)'); gr.addColorStop(1, 'rgba(90,70,40,.18)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
}

/* ---------- desk primitives ---------- */
const cam = () => $('cam');
function rectOf(el) { let x = 0, y = 0, e = el; const c = cam(); while (e && e !== c) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; }
const _pC = {};
function pt(sel, fx = .5, fy = .5) { const k = sel; const r = _pC[k] || (_pC[k] = rectOf(E(sel))); return { x: r.x + fx * r.w, y: r.y + fy * r.h, top: r.y, w: r.w }; }

const D = {
  rev(sel, t0, dur = .4, dy = 12, t1) { ST.push(t => { const el = E(sel); let p = sm((t - t0) / dur); if (t1 !== undefined) p *= 1 - sm((t - t1) / .3); el.style.opacity = p; el.style.transform = `translateY(${(1 - p) * dy}px)`; }); },
  slide(sel, t0, dx = 60, dur = .45, t1) { ST.push(t => { const el = E(sel); let p = sm((t - t0) / dur); if (t1 !== undefined) p *= 1 - sm((t - t1) / .35); el.style.opacity = p; el.style.transform = `translateX(${(1 - p) * dx}px)`; }); },
  cls(sel, c, t0, t1 = 1e9) { ST.push(t => E(sel).classList.toggle(c, t >= t0 && t < t1)); },
  txt(sel, t0, a, b) { ST.push(t => { const el = E(sel); const v = t >= t0 ? b : a; if (el.textContent !== v) el.textContent = v; }); },
  html(sel, t0, a, b) { ST.push(t => { const el = E(sel); const v = t >= t0 ? b : a; if (el._h !== v) { el.innerHTML = v; el._h = v; } }); },
  typed(sel, str, t0, t1, keep = true) { ST.push(t => { const el = E(sel); const n = Math.floor(str.length * clamp((t - t0) / (t1 - t0))); const v = t < t0 ? '' : str.slice(0, n) + (n < str.length ? '▏' : ''); if (el.textContent !== v) el.textContent = v; }); EV.push({ type: 'keys', t0, t1 }); },
  press(sel, t0) { ST.push(t => { const u = clamp((t - t0) / .22); E(sel).style.transform = (t >= t0 && u < 1) ? `scale(${1 - .06 * Math.sin(Math.PI * u)})` : ''; }); },
  cur(t, sel, fx, fy, o = {}) { CUR.push(Object.assign({ t, sel, fx, fy }, o)); if (o.click) EV.push({ type: 'click', t: t + .12 }); },
  curXY(t, x, y, o = {}) { CUR.push(Object.assign({ t, x, y }, o)); },
  stand(t, sel, fx = .9, o = {}) { STAND.push(Object.assign({ t, sel, fx }, o)); },
  cam(t, z, cx, cy) { CAM.push({ t, z, cx, cy }); },
  wig(t0, t1) { WIG.push({ t0, t1 }); },
  hideCur(t0, t1) { HIDECUR.push([t0, t1]); },
};

/* mascot */
const SPR = ['.....KK.....', '.....KK.....', '..BBBBBBBB..', '.BBBBBBBBBB.', '.BWWBBBBWWB.', '.BWWBBBBWWB.', '.BBBBBBBBBB.', '.BBBLLLLBBB.', '.BBBBBBBBBB.', '..BBBBBBBB..', '..KK....KK..', '..KK....KK..'];
const COL = { K: '#1b2a52', B: '#2d65d8', W: '#ffffff', L: '#9dbcff' };
function drawMascot(look, blink) {
  const c = $('masc'), g = c.getContext('2d'); g.clearRect(0, 0, 12, 12);
  SPR.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.') return; let col = COL[ch]; g.fillStyle = col; g.fillRect(x, y, 1, 1); }));
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  if (blink) { [2, 3, 8, 9].forEach(x => { px(x, 4, COL.B); px(x, 5, COL.K); }); }
  else { const lx = look < 0 ? 2 : 3, rx = look < 0 ? 8 : 9; px(lx, 5, COL.K); px(rx, 5, COL.K); }
}
function standPos(st) { const p = pt(st.sel, st.fx, 0); return { x: p.x, y: p.top }; }
const hopDur = (i) => { if (i === 0) return .75; const a = standPos(STAND[i - 1]), b = standPos(STAND[i]); const d = Math.hypot(b.x - a.x, b.y - a.y); return clamp(.42 + d / 2400, .5, .9); };
function mascotState(t) {
  if (!STAND.length) return null;
  let k = -1; STAND.forEach((s, i) => { if (s.t <= t) k = i; });
  const n = STAND[k + 1], nI = k + 1;
  let x, y, sx = 1, sy = 1, air = false, dust = null;
  if (k >= 0) { const q = standPos(STAND[k]); x = q.x; y = q.y; const lt = t - STAND[k].t; if (lt < .22) { const u = lt / .22; sy = 1 - .24 * (1 - u); sx = 1 + .16 * (1 - u); } else { sy = 1 + .02 * Math.sin(t * 5); } }
  if (n) {
    const hd = Math.min(hopDur(nI), Math.max(.3, n.t - (k >= 0 ? STAND[k].t : n.t - 1) - .1)), t0 = n.t - hd, qn = standPos(n);
    const from = k >= 0 ? standPos(STAND[k]) : { x: qn.x - 120, y: qn.y - 420 };
    if (t >= t0 - .14 && t < t0 && k >= 0) { const u = (t - (t0 - .14)) / .14; sy = 1 - .25 * sm(u); sx = 1 + .18 * sm(u); x = from.x; y = from.y; }
    if (t >= t0 || (k < 0)) {
      const u = clamp((t - t0) / hd); const dist = Math.hypot(qn.x - from.x, qn.y - from.y), H0 = 110 + dist * .08;
      x = lerp(from.x, qn.x, u); y = lerp(from.y, qn.y, u) - 4 * H0 * u * (1 - u) * (k >= 0 ? 1 : .0); if (k < 0) y = lerp(from.y, qn.y, eo(u));
      sy = 1 + .16 * Math.sin(Math.PI * u); sx = 1 - .10 * Math.sin(Math.PI * u); air = true;
    }
  }
  if (x === undefined) return null;
  WIG.forEach(w => { if (t >= w.t0 && t < w.t1) x += Math.round(Math.sin((t - w.t0) * 26) * 4 * (1 - (t - w.t0) / (w.t1 - w.t0))); });
  return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, sx, sy, air };
}
function drawDust(t) {
  const c = $('dust'), g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  STAND.forEach((st, i) => { const lt = t - st.t; if (lt < 0 || lt > .45) return; const q = standPos(st), u = lt / .45; g.fillStyle = `rgba(150,160,185,${.7 * (1 - u)})`; for (let j = 0; j < 8; j++) { const dir = j < 4 ? -1 : 1, sp = 18 + rnd(i * 9 + j) * 34; g.fillRect(Math.round(q.x + dir * (6 + sp * eo(u))), Math.round(q.y - 4 - (rnd(j + i) * 14) * eo(u)), 5, 5); } });
}

/* cursor */
function curPos(t) {
  if (!CUR.length) return { x: 960, y: 540 };
  let k = 0; CUR.forEach((w, i) => { if (w.t <= t) k = i; });
  const A = CUR[k], B = CUR[k + 1];
  const r = w => w.sel ? pt(w.sel, w.fx ?? .5, w.fy ?? .5) : { x: w.x, y: w.y };
  const a = r(A); if (!B) return a;
  const st = A.t + (A.dw ?? .35); if (t <= st) return a;
  const b = r(B), u = sm((t - st) / Math.max(.1, B.t - st)), d = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / (d || 1), ny = (b.x - a.x) / (d || 1), arcv = Math.sin(Math.PI * u) * d * .07;
  return { x: lerp(a.x, b.x, u) + nx * arcv, y: lerp(a.y, b.y, u) + ny * arcv };
}
function drawCursor(t) {
  const p = curPos(t); const el = $('cur'); el.style.transform = `translate(${p.x - 5}px,${p.y - 3}px)`;
  let vis = 1; HIDECUR.forEach(([a, b]) => { vis = Math.min(vis, 1 - (sm((t - a) / .3) - sm((t - b) / .3))); }); el.style.opacity = vis;
  let ring = 0, rp = null; CUR.forEach(w => { if (w.click) { const lt = t - (w.t + .12); if (lt >= 0 && lt < .45) { ring = 1 - lt / .45; rp = { x: w.sel ? pt(w.sel, w.fx ?? .5, w.fy ?? .5).x : w.x, y: w.sel ? pt(w.sel, w.fx ?? .5, w.fy ?? .5).y : w.y, u: lt / .45 }; } } });
  const rg = $('ring'); if (rp) { rg.style.opacity = ring * .8; rg.style.transform = `translate(${rp.x - 30}px,${rp.y - 30}px) scale(${.3 + 1.1 * rp.u})`; } else rg.style.opacity = 0;
}

function camAt(t) {
  if (!CAM.length) return { z: 1, cx: 960, cy: 540 };
  let k = -1; CAM.forEach((c, i) => { if (c.t <= t) k = i; });
  if (k < 0) return CAM[0]; const A = CAM[k], B = CAM[k + 1]; if (!B) return A;
  const u = sm((t - A.t) / (B.t - A.t)); return { z: lerp(A.z, B.z, u), cx: lerp(A.cx, B.cx, u), cy: lerp(A.cy, B.cy, u) };
}
function applyCam(t) {
  const c = camAt(t), z = Math.max(1, c.z);
  const cx = clamp(c.cx, W / 2 / z, W - W / 2 / z), cy = clamp(c.cy, H / 2 / z, H - H / 2 / z);
  $('cam').style.transform = `translate(${(W / 2 - cx * z).toFixed(2)}px,${(H / 2 - cy * z).toFixed(2)}px) scale(${z.toFixed(4)})`;
}

/* subtitles */
const SUBS = [];
function buildSubs() {
  SC.forEach(s => { for (const id in s.L) { const txt = V[id].text, cl = txt.match(/[^，。：；？、]+[，。：；？、]?/g) || [txt], ch = []; let cur = '';
    cl.forEach(c => { if ((cur + c).length > 21 && cur) { ch.push(cur); cur = c; } else cur += c; }); if (cur) ch.push(cur);
    const tot = ch.reduce((a, c) => a + c.length, 0); let tt = s.L[id] + .05;
    ch.forEach(c => { const d = (V[id].d - .1) * c.length / tot; SUBS.push({ t0: tt, t1: tt + d, text: c.replace(/[，；、]$/, '').replace(/[。]$/, ''), kind: s.kind }); tt += d; }); } });
}
function drawSub(t, s) {
  const el = $('sub'); const cur = SUBS.find(x => t >= x.t0 && t < x.t1);
  if (!cur || s.nosub) { el.style.opacity = 0; return; }
  const o = Math.min(sm((t - cur.t0) / .12), 1 - sm((t - cur.t1 + .1) / .1)); el.className = s.kind === 'paper' ? 'paper' : 'pill'; if (el.textContent !== cur.text) el.textContent = cur.text; el.style.opacity = o;
}

/* wipe */
function drawWipe(t) {
  const g = $('wipe').getContext('2d'); g.clearRect(0, 0, W, H);
  for (const tc of WIPES) { const u = (t - (tc - .55)) / 1.1; if (u < 0 || u > 1) continue; const a = u < .5 ? u * 2 : 2 - u * 2;
    for (let i = 0; i < 48; i++) for (let j = 0; j < 27; j++) { const th = rnd(i * 7.3 + j * 13.1); if (th < a) { g.fillStyle = rnd(i + j * 3) > .5 ? '#2d65d8' : '#4a7be0'; g.fillRect(i * 40, j * 40, 40, 40); } } }
}

/* chapter + part tag */
function drawChrome(t, s) {
  const chap = $('chap');
  if (s.kind === 'desk' && s.chap) { const lab = `<b>${s.chap[0]}</b>${s.chap[1]}`; if (chap._l !== lab) { chap.innerHTML = lab; chap._l = lab; } chap.style.opacity = Math.min(sm((t - s.t0 - .2) / .3), 1 - sm((t - s.t1 + .4) / .3)); } else chap.style.opacity = 0;
  const pt_ = $('part'); const names = ['', '作品概述', '核心功能演示与典型应用场景模拟', '用户交互过程与成效'];
  pt_.textContent = `PART ${s.part} · ${names[s.part]}`; pt_.style.color = s.kind === 'paper' ? '#8a7d63' : '#2b3a55'; pt_.style.opacity = s.nopart ? 0 : .9;
}

/* views, scrim, phone */
function applyViews(t) {
  const desks = SC.filter(s => s.kind === 'desk'), vis = {};
  SC.forEach((s, i) => { if (s.kind !== 'desk') return; const prev = SC[i - 1], next = SC[i + 1];
    let v = 1; if (!(prev && prev.kind === 'desk' && prev.view === s.view)) v *= sm((t - s.t0 - .05) / .35);
    if (!(next && next.kind === 'desk' && next.view === s.view)) v *= 1 - sm((t - s.t1 + .4) / .35);
    if (t < s.t0 - .5 || t > s.t1 + .5) v = 0; vis[s.view] = Math.max(vis[s.view] || 0, v); });
  document.querySelectorAll('#main .view').forEach(el => { el.style.opacity = vis[el.id] || 0; });
  let ph = 0; SC.forEach(s => { if (s.phone) ph = Math.max(ph, sm((t - s.t0 - .1) / .5) * (1 - sm((t - s.t1 + .5) / .5))); });
  $('scrim').style.opacity = ph; $('phone').style.opacity = ph; $('phone').style.transform = `translateY(${(1 - ph) * 40}px)`;
}

function render(t) {
  const s = sceneAt(t), paper = s.kind === 'paper';
  $('paper').style.display = paper ? 'block' : 'none'; $('deskwrap').style.display = paper ? 'none' : 'block';
  if (paper) drawPaper(s, t);
  else {
    ST.forEach(f => f(t)); applyViews(t); applyCam(t);
    const m = mascotState(t), mc = $('masc');
    if (m) { const cp = curPos(t); const look = cp.x < m.x ? -1 : 1, blink = ((t * 1.0 + Math.sin(t * .7)) % 3.3) < .12; drawMascot(look, blink); mc.style.display = 'block'; mc.style.transform = `translate(${m.x - 30}px,${m.y - 60}px) scale(${m.sx.toFixed(3)},${m.sy.toFixed(3)})`; } else mc.style.display = 'none';
    drawDust(t); drawCursor(t);
  }
  { const ph = !!s.phone; $('win').style.display = ph ? 'none' : ''; $('realbg').style.display = ph ? 'block' : 'none'; }
  drawSub(t, s); drawWipe(t); drawChrome(t, s);
}
window.renderWipeOnly = t => { $('paper').style.display = 'none'; $('deskwrap').style.display = 'none'; ['sub', 'chap', 'part'].forEach(i => { $(i).style.opacity = 0; }); document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; $('stage').style.background = 'transparent'; drawWipe(t); };
