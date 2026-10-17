/* In-page overlay for the real EduPi client: pixel mascot, cursor, ripples, captions, camera. Injected via add_init_script. */
(() => {
  if (window.__fx) return;
  const fx = window.__fx = {};
  const W = 1440, H = 810;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const sm = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const CSS = `
#fxl{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483600;pointer-events:none;overflow:hidden}
#fxcur{position:absolute;left:0;top:0;width:24px;height:24px;opacity:0;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))}
.fxring{position:absolute;width:40px;height:40px;border-radius:50%;border:3px solid #1F3FFF}
#fxm{position:absolute;left:0;top:0;width:46px;height:46px;image-rendering:pixelated;opacity:0;transform-origin:50% 100%}
.fxdust{position:absolute;width:4px;height:4px;background:rgba(120,130,160,.7)}
#fxsub{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:7px 22px;border-radius:24px;background:rgba(255,255,255,.82);backdrop-filter:blur(12px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 6px 18px rgba(0,0,0,.14);font:500 20px/1.35 -apple-system,"PingFang SC",sans-serif;color:#20242a;white-space:nowrap;opacity:0;transition:opacity .12s}
#fxchap{position:absolute;left:14px;top:10px;height:28px;padding:0 13px;border-radius:14px;background:rgba(255,255,255,.82);backdrop-filter:blur(12px);box-shadow:0 0 0 1px rgba(0,0,0,.08);font:600 13px/28px -apple-system,"PingFang SC",sans-serif;color:#2b3a55;opacity:0;transition:opacity .25s}
#fxchap b{color:#2d65d8;margin-right:6px}
#fxwarp{position:absolute;left:50%;top:10px;transform:translateX(-50%);height:26px;padding:0 14px;border-radius:13px;background:rgba(32,36,42,.82);color:#fff;font:600 12px/26px -apple-system,'PingFang SC',sans-serif;letter-spacing:.04em;opacity:0;transition:opacity .2s}
#fxpart{position:absolute;right:16px;top:12px;font:600 11px Menlo,monospace;letter-spacing:.06em;color:#2b3a55;opacity:0;text-shadow:0 0 6px rgba(255,255,255,.9)}
`;
  const style = document.createElement('style'); style.textContent = CSS;
  const layer = document.createElement('div'); layer.id = 'fxl';
  layer.innerHTML = `<svg id="fxcur" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#fff" stroke="#20242a" stroke-width="1.6" stroke-linejoin="round"/></svg><canvas id="fxm" width="12" height="12"></canvas><div id="fxsub"></div><div id="fxchap"></div><div id="fxpart"></div><div id="fxwarp"></div>`;
  const mount = () => { document.documentElement.appendChild(style); document.documentElement.appendChild(layer); };
  if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount);

  /* ---------- cursor + ripple ---------- */
  const cur = () => document.getElementById('fxcur');
  window.addEventListener('mousemove', e => { const c = cur(); if (!c) return; c.style.opacity = fx.curHidden ? 0 : 1; c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; fx.mx = e.clientX; fx.my = e.clientY; }, true);
  window.addEventListener('mousedown', e => {
    const r = document.createElement('div'); r.className = 'fxring'; r.style.left = (e.clientX - 20) + 'px'; r.style.top = (e.clientY - 20) + 'px'; layer.appendChild(r);
    r.animate([{ transform: 'scale(.3)', opacity: .85 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 450, easing: 'ease-out' }).onfinish = () => r.remove();
  }, true);
  fx.hideCursor = v => { fx.curHidden = !!v; const c = cur(); if (c && v) c.style.opacity = 0; };

  /* ---------- camera (transform on body so overlay stays screen-fixed) ---------- */
  const S = { s: 1, tx: 0, ty: 0 }; let camAnim = null;
  const applyCam = () => { const b = document.body; if (!b) return; b.style.transformOrigin = '0 0'; b.style.transform = (S.s === 1 && S.tx === 0 && S.ty === 0) ? '' : `translate(${S.tx.toFixed(2)}px,${S.ty.toFixed(2)}px) scale(${S.s.toFixed(4)})`; };
  fx.cam = (z, cx, cy, dur = 1.0) => {
    z = Math.max(1, z); const tx = clamp(W / 2 - cx * z, W - W * z, 0), ty = clamp(H / 2 - cy * z, H - H * z, 0);
    const from = { ...S }, t0 = performance.now(); camAnim = { from, to: { s: z, tx, ty }, t0, dur: Math.max(1, dur * 1000) };
  };
  fx.camState = () => ({ ...S });

  /* ---------- mascot ---------- */
  const SPR = ['.....KK.....', '.....KK.....', '..BBBBBBBB..', '.BBBBBBBBBB.', '.BWWBBBBWWB.', '.BWWBBBBWWB.', '.BBBBBBBBBB.', '.BBBLLLLBBB.', '.BBBBBBBBBB.', '..BBBBBBBB..', '..KK....KK..', '..KK....KK..'];
  const COL = { K: '#1b2a52', B: '#2d65d8', W: '#ffffff', L: '#9dbcff' };
  const M = { x: 0, y: 0, vis: false, att: null, hop: null, landT: -9, wig: null, look: 1 };
  const mc = () => document.getElementById('fxm');
  const drawM = (look, blink) => {
    const c = mc(); if (!c) return; const g = c.getContext('2d'); g.clearRect(0, 0, 12, 12);
    SPR.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.') return; g.fillStyle = COL[ch]; g.fillRect(x, y, 1, 1); }));
    if (blink) { [2, 3, 8, 9].forEach(x => { g.fillStyle = COL.B; g.fillRect(x, 4, 1, 1); g.fillStyle = COL.K; g.fillRect(x, 5, 1, 1); }); }
    else { g.fillStyle = COL.K; g.fillRect(look < 0 ? 2 : 3, 5, 1, 1); g.fillRect(look < 0 ? 8 : 9, 5, 1, 1); }
  };
  const posOf = (sel, f) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.left + f * r.width, y: Math.max(48, r.top) }; };
  const dust = (x, y) => { for (let j = 0; j < 8; j++) { const d = document.createElement('div'); d.className = 'fxdust'; d.style.left = x + 'px'; d.style.top = (y - 4) + 'px'; layer.appendChild(d); const dir = j < 4 ? -1 : 1, sp = 10 + Math.random() * 22; d.animate([{ transform: 'translate(0,0)', opacity: .8 }, { transform: `translate(${dir * sp}px,${-4 - Math.random() * 8}px)`, opacity: 0 }], { duration: 420, easing: 'ease-out' }).onfinish = () => d.remove(); } };
  fx.stand = (sel, f = 0.9, dur = 0.6) => {
    const p = posOf(sel, f); if (!p) return false;
    M.att = null;
    if (!M.vis) { M.x = p.x - 80; M.y = -60; M.vis = true; M.hop = { t0: performance.now(), dur: 750, sel, f, from: { x: M.x, y: M.y }, drop: true }; }
    else M.hop = { t0: performance.now(), dur: dur * 1000, sel, f, from: { x: M.x, y: M.y } };
    return true;
  };
  fx.wiggle = (dur = 1.2) => { M.wig = { t0: performance.now(), dur: dur * 1000 }; };
  fx.hideMascot = () => { M.vis = false; M.att = null; M.hop = null; const c = mc(); if (c) c.style.opacity = 0; };
  const frame = now => {
    if (camAnim) { const u = sm((now - camAnim.t0) / camAnim.dur); S.s = lerp(camAnim.from.s, camAnim.to.s, u); S.tx = lerp(camAnim.from.tx, camAnim.to.tx, u); S.ty = lerp(camAnim.from.ty, camAnim.to.ty, u); applyCam(); if (u >= 1) camAnim = null; }
    const c = mc();
    if (c && M.vis) {
      let x = M.x, y = M.y, sx = 1, sy = 1;
      if (M.hop) {
        const p = posOf(M.hop.sel, M.hop.f); const to = p || { x: M.hop.from.x, y: M.hop.from.y };
        const u = clamp((now - M.hop.t0) / M.hop.dur, 0, 1); const e = M.hop.drop ? 1 - Math.pow(1 - u, 3) : u;
        const dist = Math.hypot(to.x - M.hop.from.x, to.y - M.hop.from.y), H0 = M.hop.drop ? 0 : 50 + dist * .08;
        x = lerp(M.hop.from.x, to.x, e); y = lerp(M.hop.from.y, to.y, e) - 4 * H0 * u * (1 - u);
        sy = 1 + .16 * Math.sin(Math.PI * u); sx = 1 - .1 * Math.sin(Math.PI * u);
        M.x = x; M.y = y;
        if (u >= 1) { M.att = { sel: M.hop.sel, f: M.hop.f }; M.hop = null; M.landT = now; dust(to.x, to.y); }
      } else if (M.att) { const p = posOf(M.att.sel, M.att.f); if (p) { x = p.x; y = p.y; M.x = x; M.y = y; } }
      const lt = now - M.landT; if (lt < 220 && !M.hop) { const u = lt / 220; sy = 1 - .24 * (1 - u); sx = 1 + .16 * (1 - u); } else if (!M.hop) sy = 1 + .02 * Math.sin(now / 200);
      if (M.wig) { const u = (now - M.wig.t0) / M.wig.dur; if (u >= 1) M.wig = null; else x += Math.round(Math.sin((now - M.wig.t0) / 38) * 3 * (1 - u)); }
      const look = (typeof fx.mx === 'number' && fx.mx < x) ? -1 : 1, blink = ((now / 1000 + Math.sin(now / 700)) % 3.3) < .12;
      if (look !== M.look || blink !== M.blink) { M.look = look; M.blink = blink; drawM(look, blink); }
      else if (!M.drawn) { drawM(look, blink); M.drawn = true; }
      c.style.opacity = 1; c.style.transform = `translate(${Math.round(x * 2) / 2 - 23}px,${Math.round(y * 2) / 2 - 46}px) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* ---------- captions / chapter / part ---------- */
  fx.sub = t => { const e = document.getElementById('fxsub'); if (!e) return; if (!t) { e.style.opacity = 0; return; } e.textContent = t; e.style.opacity = 1; };
  fx.chap = (a, b) => { const e = document.getElementById('fxchap'); if (!e) return; if (!a) { e.style.opacity = 0; return; } e.innerHTML = `<b>${a}</b>${b || ''}`; e.style.opacity = 1; };
  fx.warp = (on, f) => { const e = document.getElementById('fxwarp'); if (!e) return; e.textContent = on ? `⏩ 等待服务响应 · 加速 ${f}×` : ''; e.style.opacity = on ? 1 : 0; };
  fx.hideAll = () => { layer.style.display = 'none'; };
  fx.part = t => { const e = document.getElementById('fxpart'); if (!e) return; e.textContent = t || ''; e.style.opacity = t ? .9 : 0; };
})();
