/*
 * THE AMAZING SPIDER-MAN — a live, singing, evolving comic book.
 * 100% JavaScript: every panel is drawn procedurally on <canvas>, every note
 * is synthesised with the Web Audio API (including the "singing" voice, which
 * is a formant synthesiser), and the page layout itself is built from JS.
 *
 * Timeline (synced to the theme song):
 *   pencil sketch  →  inked black & white  →  flat colour  →  Ben-Day halftone "POP!"
 * Hover a panel to make it react; click to splash colour, shoot webs, throw punches.
 */
(() => {
'use strict';

/* ======================================================================
 * Utilities
 * ==================================================================== */
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const backOut = t => { const c = 1.70158; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const approach = (v, target, k) => v + (target - v) * clamp(k);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const mix2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const vlen = a => Math.hypot(a[0], a[1]);
const nrm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l]; };
const pick = arr => arr[(Math.random() * arr.length) | 0];
const perfNow = () => performance.now() / 1000;

// Stable hash noise in [0,1)
function rnd(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Seeded PRNG (mulberry32)
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- colour ---------- */
const colCache = new Map();
function rgb(hex) {
  let c = colCache.get(hex);
  if (!c) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    c.l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    colCache.set(hex, c);
  }
  return c;
}
const luma = hex => rgb(hex).l;
// How a colour reads in the black & white inked stage
function bwOf(hex) {
  const l = luma(hex);
  return l > 0.55 ? '#ffffff' : l > 0.3 ? '#a9a9a9' : '#161616';
}
function mixCol(a, b, t) {
  if (t >= 1) return b;
  if (t <= 0) return a;
  const A = rgb(a), B = rgb(b);
  return `rgb(${(A[0] + (B[0] - A[0]) * t) | 0},${(A[1] + (B[1] - A[1]) * t) | 0},${(A[2] + (B[2] - A[2]) * t) | 0})`;
}

/* ---------- geometry ---------- */
function ellipse(cx, cy, rx, ry, rot = 0, n = 30) {
  const p = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    p.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return p;
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function roundRect(x, y, w, h, r, n = 4) {
  const p = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return p;
}
function capsule(a, b, ra, rb, n = 8) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), p = [];
  for (let i = 0; i <= n; i++) {
    const t = ang - Math.PI / 2 + (i / n) * Math.PI;
    p.push([b[0] + Math.cos(t) * rb, b[1] + Math.sin(t) * rb]);
  }
  for (let i = 0; i <= n; i++) {
    const t = ang + Math.PI / 2 + (i / n) * Math.PI;
    p.push([a[0] + Math.cos(t) * ra, a[1] + Math.sin(t) * ra]);
  }
  return p;
}
// Catmull-Rom spline through points
function spline(pts, closed = true, seg = 6) {
  const out = [], n = pts.length, cnt = closed ? n : n - 1;
  for (let i = 0; i < cnt; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const p3 = pts[closed ? (i + 2) % n : Math.min(i + 2, n - 1)];
    for (let j = 0; j < seg; j++) {
      const t = j / seg, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function star(cx, cy, r1, r2, n, seed = 1) {
  const p = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU + seed;
    const r = i % 2 ? r2 * (0.85 + 0.3 * rnd(seed * 99, i)) : r1 * (0.8 + 0.4 * rnd(seed * 77, i));
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return p;
}

/* ======================================================================
 * Scene description: panels "build" a list of items every frame, and the
 * renderer draws those items in whatever art stage the comic is in.
 * ==================================================================== */
const BANG = '"Bangers", Impact, "Arial Black", sans-serif';
const NEUE = '"Comic Neue", "Comic Sans MS", "Chalkboard SE", cursive';

class Scene {
  constructor() { this.items = []; }
  shape(pts, o = {}) {
    this.items.push({
      pts, closed: o.closed !== false, fill: o.fill || null, bw: o.bw, grad: o.grad,
      w: o.w ?? 2, ink: o.ink || '#111', sketch: o.sketch !== false, hatch: o.hatch,
      glow: o.glow, alpha: o.alpha ?? 1, instant: o.instant, noInk: o.noInk, dash: o.dash,
      guide: o.guide, colorOnly: o.colorOnly, ord: o.ord,
    });
    return this;
  }
  line(pts, o = {}) { return this.shape(pts, { ...o, closed: false }); }
  text(text, x, y, o = {}) {
    this.items.push({
      text, x, y, size: o.size || 20, font: o.font || BANG, fill: o.fill || '#111', bw: o.bw,
      stroke: o.stroke, sw: o.sw || 0, align: o.align || 'center', rot: o.rot || 0,
      alpha: o.alpha ?? 1, shadow: o.shadow, instant: o.instant, maxW: o.maxW, lh: o.lh,
      sketch: o.sketch !== false, ord: o.ord,
    });
    return this;
  }
}

/* ---------- renderer ---------- */
const PENCIL = '#3b3b46';

function trace(ctx, pts, closed, prog, jit) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const upto = prog * segs, full = Math.floor(upto);
  const P = i => {
    const k = i % n, q = pts[k];
    if (!jit) return q;
    const d = jit(k);
    return [q[0] + d[0], q[1] + d[1]];
  };
  const a = P(0);
  ctx.moveTo(a[0], a[1]);
  for (let i = 1; i <= Math.min(full, segs); i++) { const q = P(i); ctx.lineTo(q[0], q[1]); }
  const fr = upto - full;
  if (fr > 0 && full < segs) {
    const q0 = P(full), q1 = P(full + 1);
    ctx.lineTo(q0[0] + (q1[0] - q0[0]) * fr, q0[1] + (q1[1] - q0[1]) * fr);
  }
  if (closed && prog >= 1) ctx.closePath();
}

function bbox(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

function fillFor(ctx, it, c) {
  if (it.grad) {
    const [, y0, , y1] = bbox(it.pts);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    it.grad.forEach((col, k) => g.addColorStop(k / (it.grad.length - 1), mixCol(it.bw || bwOf(col), col, c)));
    return g;
  }
  return mixCol(it.bw || bwOf(it.fill), it.fill, c);
}

function hatch(ctx, pts, prog, alpha, seed) {
  const [x0, y0, x1, y1] = bbox(pts);
  ctx.save();
  ctx.beginPath(); trace(ctx, pts, true, 1, null); ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PENCIL; ctx.lineWidth = 0.7;
  ctx.beginPath();
  const start = x0 + y0, end = x1 + y1, step = 4.5;
  const lim = start + (end - start) * prog;
  for (let c = start; c < lim; c += step) {
    const j = (rnd(seed, c | 0) - 0.5) * 2;
    ctx.moveTo(c - y0 + j, y0); ctx.lineTo(c - y1 - j, y1);
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, it, st, sp, ip, i, boil) {
  ctx.save();
  ctx.translate(it.x, it.y);
  if (it.rot) ctx.rotate(it.rot);
  let size = it.size;
  const fs = s => (it.font === NEUE ? '700 ' : '') + s + 'px ' + it.font;
  ctx.font = fs(size);
  const lines = String(it.text).split('\n');
  if (it.maxW) {
    const mw = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (mw > it.maxW) { size *= it.maxW / mw; ctx.font = fs(size); }
  }
  ctx.textAlign = it.align; ctx.textBaseline = 'middle';
  const lh = size * (it.lh || 1.12), y0 = -((lines.length - 1) * lh) / 2;
  if (it.sketch && sp > 0 && st.sketchAlpha > 0.02) {
    ctx.globalAlpha = it.alpha * st.sketchAlpha * sp * 0.8;
    ctx.strokeStyle = PENCIL; ctx.lineWidth = 0.75;
    lines.forEach((l, j) => {
      for (let k = 0; k < 2; k++) {
        ctx.strokeText(l, (rnd(i, j, k + boil) - 0.5) * 1.8, y0 + j * lh + (rnd(i, j + 9, k + boil) - 0.5) * 1.8);
      }
    });
  }
  if (ip > 0) {
    ctx.globalAlpha = it.alpha * ip;
    const c = st.color;
    lines.forEach((l, j) => {
      const y = y0 + j * lh;
      if (it.shadow) {
        ctx.fillStyle = mixCol(bwOf(it.shadow[0]), it.shadow[0], c);
        if (it.stroke) { ctx.lineWidth = it.sw; ctx.strokeStyle = it.stroke; ctx.lineJoin = 'round'; ctx.strokeText(l, it.shadow[1], y + it.shadow[2]); }
        ctx.fillText(l, it.shadow[1], y + it.shadow[2]);
      }
      if (it.stroke) { ctx.lineWidth = it.sw; ctx.strokeStyle = it.stroke; ctx.lineJoin = 'round'; ctx.strokeText(l, 0, y); }
      ctx.fillStyle = mixCol(it.bw || bwOf(it.fill), it.fill, c);
      ctx.fillText(l, 0, y);
    });
  }
  ctx.restore();
}

function renderItems(ctx, items, st, now) {
  const N = items.length, boil = Math.floor(now * 5);
  for (let i = 0; i < N; i++) {
    const it = items[i];
    const ord = it.ord != null ? it.ord : (i / N) * 0.72;
    const sp = it.instant ? 1 : clamp((st.sketch - ord) / 0.28);
    const ip = it.instant ? (st.ink > 0 ? 1 : 0) : clamp((st.ink - ord) / 0.28);

    if (it.text != null) { drawText(ctx, it, st, sp, ip, i, boil); continue; }
    const pts = it.pts;
    if (!pts || pts.length < 2) continue;

    if (it.guide) { // construction lines: pencil only, erased as ink arrives
      const a = st.sketchAlpha * (1 - st.ink) * 0.55;
      if (sp > 0 && a > 0.02) {
        ctx.globalAlpha = a; ctx.strokeStyle = PENCIL; ctx.lineWidth = 0.7;
        ctx.beginPath(); trace(ctx, pts, it.closed, sp, k => [(rnd(i, k, boil) - 0.5) * 3, (rnd(i, k + 50, boil) - 0.5) * 3]); ctx.stroke();
      }
      continue;
    }
    if (it.colorOnly) {
      const a = it.alpha * st.color;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      if (it.fill) {
        ctx.fillStyle = it.fill;
        if (it.glow) { ctx.shadowColor = it.fill; ctx.shadowBlur = 14; }
        ctx.beginPath(); trace(ctx, pts, true, 1, null); ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = it.ink; ctx.lineWidth = it.w;
        ctx.beginPath(); trace(ctx, pts, it.closed, 1, null); ctx.stroke();
      }
      continue;
    }

    const a = it.alpha;
    if ((it.fill || it.grad) && ip > 0 && it.closed) {
      ctx.globalAlpha = a * ip;
      ctx.fillStyle = fillFor(ctx, it, st.color);
      if (it.glow && st.color > 0) { ctx.shadowColor = it.fill; ctx.shadowBlur = 22 * st.color; }
      ctx.beginPath(); trace(ctx, pts, true, 1, null); ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (it.sketch && sp > 0 && st.sketchAlpha > 0.02) {
      ctx.globalAlpha = a * st.sketchAlpha * (it.w > 0 ? 0.75 : 0.4);
      ctx.strokeStyle = PENCIL; ctx.lineWidth = 0.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        trace(ctx, pts, it.closed, sp, j => [(rnd(i, j, k * 31 + boil) - 0.5) * 2.4, (rnd(i, j, k * 57 + boil + 7) - 0.5) * 2.4]);
        ctx.stroke();
      }
      if (it.closed && it.fill && (it.hatch || (it.hatch !== false && luma(it.fill) < 0.3))) {
        hatch(ctx, pts, sp, a * st.sketchAlpha * 0.45, i);
      }
    }
    if (!it.noInk && it.w > 0 && ip > 0) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = it.ink === '#111' ? '#111' : mixCol(bwOf(it.ink), it.ink, st.color);
      ctx.lineWidth = it.w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (it.glow && st.color > 0) { ctx.shadowColor = it.ink; ctx.shadowBlur = 16 * st.color; }
      if (it.dash) ctx.setLineDash(it.dash);
      ctx.beginPath(); trace(ctx, pts, it.closed, ip, null); ctx.stroke();
      if (it.dash) ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
}

/* ======================================================================
 * Characters
 * ==================================================================== */
const RED = '#d8232c', BLUE = '#1f4db5';
const SR = { fill: RED, bw: '#ffffff' };
const SB = { fill: BLUE, bw: '#1b1b1b', hatch: true };

// Spider emblem (chest)
function emblem(S, c, s, ang, W) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const T = ([x, y]) => [c[0] + (x * cs - y * sn) * s, c[1] + (x * sn + y * cs) * s];
  S.shape(ellipse(0, 1.5, 1.7, 2.8).map(T), { fill: '#111', bw: '#111', w: 0 });
  S.shape(ellipse(0, -2.4, 1.2, 1.2).map(T), { fill: '#111', bw: '#111', w: 0 });
  for (const sg of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const up = j < 2, oy = -1 + j * 1.2;
      const knee = [sg * 4.2, oy + (up ? -2.6 : 1.2) + j * 0.3];
      const tip = [sg * 5.2, oy + (up ? -5.5 + j * 1.5 : 4.5 + (j - 2) * 1.6)];
      S.line([[sg * 1, oy], knee, tip].map(T), { w: W * 0.55 });
    }
  }
}

function torso(S, N, Pv, s, W) {
  const d = sub(Pv, N), L = vlen(d), u = [d[0] / L, d[1] / L], v = [-u[1], u[0]];
  const at = (t, w) => [N[0] + u[0] * L * t + v[0] * w * s, N[1] + u[1] * L * t + v[1] * w * s];
  const prof = [[0.02, 13], [0.18, 15.5], [0.45, 12.5], [0.7, 9.8], [0.95, 10.8]];
  const pw = t => {
    for (let k = 1; k < prof.length; k++) if (t <= prof[k][0]) {
      const [ta, wa] = prof[k - 1], [tb, wb] = prof[k];
      return lerp(wa, wb, (t - ta) / (tb - ta));
    }
    return prof[prof.length - 1][1];
  };
  const left = prof.map(([t, w]) => at(t, w)), right = prof.map(([t, w]) => at(t, -w)).reverse();
  const outline = spline([...left, at(1.1, 0), ...right, at(-0.04, 0)], true, 5);
  S.shape(outline, { ...SR, w: W });
  const C = at(0.3, 0);
  for (let i = 0; i < outline.length; i += 3) S.line([C, mix2(C, outline[i], 0.97)], { w: W * 0.4 });
  for (const k of [0.4, 0.72]) S.shape(outline.filter((_, i) => i % 3 === 0).map(q => mix2(C, q, k)), { w: W * 0.4 });
  for (const sg of [1, -1]) {
    const outer = [], inner = [];
    for (let t = 0.26; t <= 0.98; t += 0.06) {
      const w = pw(t);
      outer.push(at(t, sg * w));
      inner.push(at(t, sg * w * lerp(1, 0.52, smooth((t - 0.26) / 0.22))));
    }
    S.shape([...outer, ...inner.reverse()], { ...SB, w: W * 0.8 });
  }
  emblem(S, at(0.3, 0), s * 0.95, Math.atan2(u[1], u[0]) - Math.PI / 2, W);
}

// Masked head. rx/ry radii, hr rotation, o: {turn, lx, ly, squint}
function head(S, H, rx, ry, hr, o = {}) {
  const turn = o.turn || 0, sq = clamp(o.squint || 0), lx = o.lx || 0, ly = o.ly || 0;
  const W = o.w || 1 + rx * 0.035;
  const c = Math.cos(hr), sn = Math.sin(hr);
  const L = ([x, y]) => { const X = x * rx, Y = y * ry; return [H[0] + X * c - Y * sn, H[1] + X * sn + Y * c]; };
  const bnd = a => { let x = Math.cos(a), y = Math.sin(a); if (y > 0) x *= 1 - 0.16 * y; return [x, y]; };
  const out = [];
  for (let i = 0; i < 40; i++) out.push(L(bnd((i / 40) * TAU)));
  S.shape(out, { ...SR, w: W * 1.15 });
  // web pattern
  const C = [turn * 0.35, 0.2], R = 14;
  for (let i = 0; i < R; i++) {
    const b = bnd((i / R) * TAU + 0.12);
    S.line([L(C), L(mix2(C, b, 0.98))], { w: W * 0.45 });
  }
  for (const k of [0.3, 0.58, 0.84]) {
    const pts = [];
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < 4; j++) {
        const a = ((i + j / 4) / R) * TAU + 0.12, bow = 1 - 0.1 * Math.sin((Math.PI * j) / 4);
        pts.push(L(mix2(C, bnd(a), k * bow)));
      }
    }
    S.shape(pts, { w: W * 0.45 });
  }
  // eyes
  const EYE = [[0.1, 0.3], [0.07, 0.0], [0.22, -0.3], [0.55, -0.42], [0.83, -0.2], [0.8, 0.1], [0.47, 0.3]];
  for (const side of [-1, 1]) {
    const far = side * turn < 0;
    const wk = far ? 1 - 0.55 * Math.abs(turn) : 1 + 0.1 * Math.abs(turn);
    const pts = EYE.map(([x, y]) => {
      let X = side * (0.07 + (x - 0.07) * wk) + turn * 0.35 + lx * 0.07;
      let Y = -0.05 + (y + 0.05) * (1 - 0.6 * sq) + ly * 0.05;
      return L([X, Y]);
    });
    S.shape(spline(pts, true, 5), { fill: '#ffffff', bw: '#ffffff', w: W * 2.3 });
  }
}

/* Full figure. Poses are in "unit" coords facing +x, pelvis at origin, y down. */
const POSES = {
  crouch: {
    pelvis: [0, 0], neck: [8, -36], head: [12, -48],
    fSh: [10, -33], fEl: [24, -14], fHand: [22, 16],
    bSh: [4, -34], bEl: [-5, -16], bHand: [4, 19],
    fHip: [3, 0], fKnee: [22, -10], fFoot: [20, 20], fToe: [27, 22],
    bHip: [-3, 0], bKnee: [-18, 2], bFoot: [-8, 20], bToe: [-1, 22],
  },
  swing: {
    pelvis: [0, 0], neck: [2, -40], head: [3, -53],
    bSh: [0, -37], bEl: [3, -56], bHand: [4, -74],
    fSh: [4, -37], fEl: [18, -30], fHand: [31, -38],
    fHip: [3, 0], fKnee: [16, 12], fFoot: [8, 30], fToe: [14, 33],
    bHip: [-3, 0], bKnee: [-6, 20], bFoot: [-16, 36], bToe: [-10, 40],
  },
  kick: {
    pelvis: [0, 0], neck: [-12, -38], head: [-16, -50],
    fSh: [-9, -35], fEl: [-22, -26], fHand: [-33, -18],
    bSh: [-12, -36], bEl: [2, -44], bHand: [14, -52],
    fHip: [3, 0], fKnee: [22, -3], fFoot: [42, -6], fToe: [44, -14],
    bHip: [-3, 0], bKnee: [8, 16], bFoot: [-8, 24], bToe: [-2, 28],
  },
  stand: {
    pelvis: [0, 0], neck: [0, -40], head: [0, -53],
    fSh: [12, -37], fEl: [25, -54], fHand: [22, -72],
    bSh: [-12, -37], bEl: [-24, -20], bHand: [-11, -4],
    fHip: [6, 1], fKnee: [9, 20], fFoot: [10, 40], fToe: [17, 42],
    bHip: [-6, 1], bKnee: [-9, 20], bFoot: [-10, 40], bToe: [-17, 42],
  },
};

function spidey(S, pose, X, Y, s, f = 1, rot = 0, o = {}) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const T = ([x, y]) => { x *= f; return [X + (x * c - y * sn) * s, Y + (x * sn + y * c) * s]; };
  const P = {};
  for (const k in pose) P[k] = T(pose[k]);
  const W = Math.max(1.2, s * 1.1);
  // gesture-drawing construction lines (visible only in pencil)
  S.line([P.pelvis, P.neck], { guide: true });
  S.shape(ellipse(P.head[0], P.head[1], 10.5 * s, 12.5 * s), { guide: true });
  S.line([P.fSh, P.fEl, P.fHand], { guide: true }); S.line([P.bSh, P.bEl, P.bHand], { guide: true });
  S.line([P.fHip, P.fKnee, P.fFoot], { guide: true }); S.line([P.bHip, P.bKnee, P.bFoot], { guide: true });

  const leg = (h, kn, an, tk) => {
    S.shape(capsule(P[h], P[kn], 7 * s, 5.6 * s), { ...SB, w: W });
    S.shape(capsule(P[kn], P[an], 5.6 * s, 4.2 * s), { ...SB, w: W });
    S.shape(capsule(mix2(P[kn], P[an], 0.45), P[an], 5.3 * s, 4.4 * s), { ...SR, w: W });
    S.shape(capsule(P[an], P[tk], 4.4 * s, 3.2 * s), { ...SR, w: W });
  };
  const arm = (sh, el, hd) => {
    S.shape(capsule(P[sh], P[el], 5.4 * s, 4.5 * s), { ...SB, w: W });
    S.shape(capsule(P[el], P[hd], 4.5 * s, 3.7 * s), { ...SR, w: W });
    const a = P[el], b = P[hd], d = nrm(sub(b, a)), pp = [-d[1], d[0]];
    for (const k of [0.33, 0.66]) {
      const m = mix2(a, b, k), r = lerp(4.5, 3.7, k) * s;
      S.line([add(m, mul(pp, r)), sub(m, mul(pp, r))], { w: W * 0.45 });
    }
    S.line([a, b], { w: W * 0.4 });
    S.shape(ellipse(P[hd][0], P[hd][1], 4.8 * s, 4.4 * s), { ...SR, w: W });
  };
  leg('bHip', 'bKnee', 'bFoot', 'bToe');
  arm('bSh', 'bEl', 'bHand');
  torso(S, P.neck, P.pelvis, s, W);
  leg('fHip', 'fKnee', 'fFoot', 'fToe');
  S.shape(capsule(P.neck, mix2(P.neck, P.head, 0.6), 5 * s, 5 * s), { ...SR, w: W });
  const hr = Math.atan2(P.head[1] - P.neck[1], P.head[0] - P.neck[0]) + Math.PI / 2;
  head(S, P.head, 10.5 * s, 12.5 * s, hr, o);
  arm('fSh', 'fEl', 'fHand');
  return P;
}

/* ---------- SCRAPJAW, the scrap-metal menace (an original villain) ---------- */
function robot(S, X, Y, s, o = {}) {
  const tilt = o.tilt || 0, c = Math.cos(tilt), sn = Math.sin(tilt);
  const T = ([x, y]) => [X + (x * c - y * sn) * s, Y + (x * sn + y * c) * s];
  const TP = pts => pts.map(T);
  const STEEL = '#8e98a6', DARK = '#4a515c', PLATE = '#6f7886', RUST = '#a0582f';
  const W = Math.max(1.3, s * 1.8);
  const lx = o.lx || 0, ly = o.ly || 0, jaw = o.jaw || 0, raise = o.raise || 0;
  const arm = (side, r) => {
    const sh = [48 * side, -114], el = [76 * side, -86 - r * 34], cl = [66 * side, -50 - r * 86];
    S.shape(TP(capsule(sh, el, 9, 8)), { fill: DARK, w: W });
    S.shape(TP(ellipse(el[0], el[1], 10, 10)), { fill: STEEL, w: W });
    S.shape(TP(capsule(el, cl, 8, 7)), { fill: STEEL, w: W });
    const d = nrm(sub(cl, el)), pp = [-d[1], d[0]];
    for (const sg of [-1, 1]) {
      const b = add(cl, mul(pp, sg * 6)), tip = add(add(cl, mul(d, 20)), mul(pp, sg * 11));
      S.shape(TP([b, tip, add(cl, mul(d, 8))]), { fill: '#c9ced6', w: W * 0.8 });
    }
  };
  arm(-1, 0);
  S.shape(TP(capsule([-24, -45], [-28, -8], 10, 9)), { fill: DARK, w: W });
  S.shape(TP(capsule([24, -45], [28, -8], 10, 9)), { fill: DARK, w: W });
  S.shape(TP(roundRect(-50, -12, 36, 14, 5)), { fill: STEEL, w: W });
  S.shape(TP(roundRect(14, -12, 36, 14, 5)), { fill: STEEL, w: W });
  S.shape(TP(roundRect(-48, -130, 96, 88, 14)), { fill: STEEL, w: W });
  S.shape(TP(roundRect(-32, -116, 64, 44, 6)), { fill: PLATE, w: W * 0.8 });
  for (let k = 0; k < 4; k++) S.line(TP([[-24, -106 + k * 9], [24, -106 + k * 9]]), { w: W * 0.6 });
  S.shape(TP(ellipse(-30, -58, 9, 5, 0.3)), { fill: RUST, w: 0 });
  S.shape(TP(ellipse(28, -120, 6, 4, -0.4)), { fill: RUST, w: 0 });
  for (const [x, y] of [[-40, -122], [40, -122], [-40, -52], [40, -52], [0, -52]]) {
    S.shape(TP(ellipse(x, y, 2.6, 2.6, 0, 10)), { fill: '#d5dae1', w: W * 0.5 });
  }
  (o.dents || []).forEach(([x, y, r]) => S.line(TP([[x - r, y - r * 0.4], [x, y + r * 0.3], [x + r, y - r * 0.2]]), { w: W * 0.8 }));
  S.text('SJ-9', T([0, -60])[0], T([0, -60])[1], { size: 11 * s, rot: tilt, fill: '#ffd23f', stroke: '#111', sw: 2.5 });
  // head
  S.shape(TP(rect(-11, -140, 22, 12)), { fill: DARK, w: W });
  S.shape(TP(roundRect(-34, -186, 68, 50, 10)), { fill: STEEL, w: W });
  S.line(TP([[0, -186], [7, -208]]), { w: W });
  S.shape(TP(ellipse(7, -211, 4.5, 4.5, 0, 12)), { fill: o.blink ? '#ffe45c' : '#b58d1b', glow: o.blink, w: W * 0.8 });
  S.shape(TP(ellipse(0, -158, 16, 14)), { fill: '#222', w: W });
  if (o.ko) {
    S.line(TP([[-8, -165], [8, -151]]), { w: W * 1.4, ink: '#ff3b3b' });
    S.line(TP([[8, -165], [-8, -151]]), { w: W * 1.4, ink: '#ff3b3b' });
  } else {
    S.shape(TP(ellipse(lx * 3.5, -158 + ly * 2.5, 11, 10)), { fill: '#ff2b2b', bw: '#ffffff', glow: true, w: W * 0.6 });
    S.shape(TP(ellipse(lx * 6, -158 + ly * 4.5, 4, 4, 0, 12)), { fill: '#fff5a0', bw: '#111', w: 0 });
  }
  S.shape(TP([[-30, -181], [0, -170], [30, -181], [30, -174], [0, -163], [-30, -174]]), { fill: DARK, w: W * 0.8 });
  const jy = -146 + jaw * 7;
  S.shape(TP(roundRect(-26, jy, 52, 12, 3)), { fill: DARK, w: W });
  const teeth = [];
  for (let k = 0; k <= 8; k++) teeth.push([-22 + k * 5.5, jy + (k % 2 ? 6 : 1)]);
  S.line(TP(teeth), { w: W * 0.7, ink: '#e8e8e8' });
  arm(1, raise);
  return { eye: T([lx * 3.5, -158]), head: T([0, -165]), chest: T([0, -95]) };
}

/* ---------- lettering helpers ---------- */
function caption(S, x, y, w, h, text, o = {}) {
  S.shape(rect(x, y, w, h), { fill: '#ffe46b', bw: '#ffffff', w: 2, ...o });
  S.text(text, x + w / 2, y + h / 2 + 1, { size: o.size || 15, font: NEUE, fill: '#111', maxW: w - 12, instant: o.instant, alpha: o.alpha });
}
function balloon(S, cx, cy, rx, ry, tx, ty, text, o = {}) {
  const base = { fill: o.robot ? '#e3f6ff' : '#ffffff', bw: '#ffffff', w: 2, alpha: o.alpha ?? 1, instant: o.instant };
  const body = o.robot ? roundRect(cx - rx, cy - ry, rx * 2, ry * 2, 7) : ellipse(cx, cy, rx, ry, 0, 40);
  const d = nrm([tx - cx, ty - cy]), pp = [-d[1], d[0]];
  const tw = Math.min(rx, ry) * 0.32, b0 = [cx + d[0] * rx * 0.5, cy + d[1] * ry * 0.5];
  const tip = [tx, ty];
  S.shape([add(b0, mul(pp, tw)), tip, sub(b0, mul(pp, tw))], base);
  S.shape(body, base);
  // patch hides the balloon outline where the tail joins
  const edge = 1 / Math.hypot(d[0] / rx, d[1] / ry);
  const D = vlen(sub(tip, [cx, cy])), rb = vlen(sub(b0, [cx, cy]));
  const hw = r => tw * clamp((D - r) / (D - rb)) - 1.6;
  const e2 = [cx + d[0] * (edge + 3), cy + d[1] * (edge + 3)];
  S.shape([add(b0, mul(pp, tw - 1.6)), add(e2, mul(pp, hw(edge + 3))), sub(e2, mul(pp, hw(edge + 3))), sub(b0, mul(pp, tw - 1.6))],
    { ...base, w: 0, sketch: false });
  S.text(text, cx, cy, { size: o.size || 13.5, font: NEUE, fill: '#111', maxW: rx * 1.55, alpha: base.alpha, instant: o.instant });
}

/* ======================================================================
 * FX (bursts, webs, lasers, particles) – live in panel.fx
 * ==================================================================== */
function drawFx(S, p, now) {
  p.fx = p.fx.filter(f => now - f.t0 < f.life);
  for (const f of p.fx) {
    const age = now - f.t0, k = age / f.life;
    const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    if (f.type === 'burst') {
      const sc = backOut(clamp(age / 0.25)), r = f.size * sc;
      if (r < 1) continue;
      S.shape(star(f.x, f.y, r, r * 0.6, f.n || 12, f.seed), { fill: '#ffe14d', bw: '#ffffff', w: 3, alpha: fade, instant: true });
      S.shape(star(f.x, f.y, r * 0.72, r * 0.44, f.n || 12, f.seed + 3), { fill: '#ff5a2e', bw: '#ffffff', w: 0, alpha: fade, instant: true });
      S.text(f.word, f.x, f.y, { size: f.size * 0.62 * sc, fill: '#ffffff', bw: '#ffffff', stroke: '#111', sw: 4, rot: f.rot, alpha: fade, instant: true, maxW: r * 1.6 });
    } else if (f.type === 'web') {
      const from = typeof f.from === 'function' ? f.from() : f.from;
      const ext = clamp(age / 0.13), to = mix2(from, f.to, ext);
      S.line([from, to], { w: 2.2, ink: '#f4f4f8', alpha: fade, instant: true });
      S.line([from, to], { w: 0.8, ink: '#111', alpha: fade, instant: true });
      if (ext >= 1) {
        const sr = 16 * backOut(clamp((age - 0.13) / 0.2));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          S.line([f.to, [f.to[0] + Math.cos(a) * sr, f.to[1] + Math.sin(a) * sr]], { w: 1.4, alpha: fade, instant: true });
        }
        for (const q of [0.45, 0.85]) S.shape(ellipse(f.to[0], f.to[1], sr * q, sr * q, 0, 8), { w: 1.2, alpha: fade, instant: true });
      }
    } else if (f.type === 'laser') {
      if (age < 0.4) {
        const fl = 0.7 + 0.3 * Math.sin(age * 90);
        S.line([f.from, f.to], { w: 9 * fl, ink: '#ff2b2b', glow: true, instant: true });
        S.line([f.from, f.to], { w: 3, ink: '#fff7d0', instant: true });
        S.shape(ellipse(f.to[0], f.to[1], 14 * fl, 14 * fl, 0, 14), { fill: '#ffef7a', glow: true, w: 0, instant: true });
      }
    } else if (f.type === 'scorch') {
      S.shape(ellipse(f.x, f.y, 16, 7, 0, 16), { fill: '#1d1210', bw: '#111', w: 0, alpha: 0.65 * fade, instant: true, sketch: false });
    } else if (f.type === 'part') {
      const x = f.x + f.vx * age, y = f.y + f.vy * age + 0.5 * (f.g ?? 400) * age * age;
      if (f.kind === 'spark') {
        const vy = f.vy + (f.g ?? 400) * age, d = nrm([f.vx, vy]);
        S.line([[x, y], [x - d[0] * 9, y - d[1] * 9]], { w: 2.2, ink: '#ffcf33', glow: true, alpha: fade, instant: true });
      } else if (f.kind === 'bolt') {
        S.shape(ellipse(x, y, 5, 5, age * f.spin, 6), { fill: '#b9c0c9', w: 1.4, alpha: fade, instant: true });
      } else if (f.kind === 'confetti') {
        S.shape(ellipse(x, y, 5, 2.5, age * f.spin, 4), { fill: f.color, w: 0, alpha: fade, instant: true });
      } else if (f.kind === 'firework') {
        S.shape(ellipse(x, y, 3.2, 3.2, 0, 8), { fill: f.color, glow: true, w: 0, alpha: fade, instant: true });
      }
    }
  }
}

function burst(p, x, y, word, size = 44, now = perfNow()) {
  p.fx.push({ type: 'burst', x, y, word, t0: now, life: 1.15, size, n: 12 + ((Math.random() * 5) | 0), seed: Math.random() * 10, rot: (Math.random() - 0.5) * 0.5 });
}
function particles(p, x, y, n, kind, o = {}) {
  const now = perfNow();
  const colors = o.colors || ['#ff3b3b', '#ffd23f', '#3fa9ff', '#7bff6b', '#ff7ae1', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const a = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 2) : Math.random() * TAU;
    const sp = (o.speed || 200) * (0.4 + Math.random() * 0.8);
    p.fx.push({ type: 'part', kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g, t0: now, life: (o.life || 1) * (0.7 + Math.random() * 0.5), spin: (Math.random() - 0.5) * 20, color: pick(colors) });
  }
}

/* ======================================================================
 * Audio: synth band + formant "singer"
 * ==================================================================== */
const Sound = (() => {
  let ctx = null, master, revSend, noise, songBus = null, muted = false;
  let songT0 = -1;
  const BPM = 150, SPB = 60 / BPM;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.85;
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const rev = ctx.createConvolver(); rev.buffer = ir;
    revSend = ctx.createGain(); revSend.gain.value = 0.25;
    revSend.connect(rev); rev.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const resume = () => ctx && ctx.state !== 'running' && ctx.resume();

  /* ---- building blocks ---- */
  const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const F = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  function O(type, freq, t, stop) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.start(t); o.stop(stop); return o;
  }
  function N(t, stop) {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(stop); return s;
  }
  function env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  function hiss(out, t, dur, freq, vol) {
    const s = N(t, t + dur + 0.05), f = F('highpass', freq, 0.8), g = G(0);
    env(g, t, 0.01, vol, dur * 0.4, dur * 0.6);
    s.connect(f); f.connect(g); g.connect(out);
  }

  /* ---- the singer: sawtooth "vocal folds" through vowel formant filters ---- */
  const VOW = {
    a: [730, 1090, 2440], ae: [660, 1720, 2410], e: [530, 1840, 2480], i: [270, 2290, 3010],
    I: [390, 1990, 2550], o: [570, 840, 2410], u: [300, 870, 2240], uh: [640, 1190, 2390], er: [490, 1350, 1690],
  };
  function sing(out, t, dur, midi, vowel, prev, syl) {
    const f = mtof(midi), end = t + dur;
    const [v1, v2] = vowel.split('>'), A = VOW[v1], B = v2 ? VOW[v2] : null;
    const g = G(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.04);
    g.gain.linearRampToValueAtTime(0.8, Math.max(t + 0.06, end - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.09);
    const lfo = O('sine', 5.6, t, end + 0.12), lg = G(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.18, dur * 0.4));
    lg.gain.linearRampToValueAtTime(f * 0.02, t + Math.min(0.5, dur));
    lfo.connect(lg);
    for (const dt of [0, -7, 7]) {
      const o = O('sawtooth', prev ? mtof(prev) : f, t, end + 0.12);
      o.detune.value = dt;
      o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      lg.connect(o.frequency);
      o.connect(g);
    }
    const vo = G(0.9);
    const gains = [1, 0.6, 0.32], bws = [80, 100, 140];
    A.forEach((Fq, k) => {
      const b = F('bandpass', Fq, Fq / bws[k]);
      if (B) {
        b.frequency.setValueAtTime(Fq, t + dur * 0.45);
        b.frequency.linearRampToValueAtTime(B[k], t + dur * 0.85);
      }
      const bg = G(gains[k]);
      g.connect(b); b.connect(bg); bg.connect(vo);
    });
    const body = F('lowpass', Math.min(f * 3, 1800), 0.7), bg = G(0.06);
    g.connect(body); body.connect(bg); bg.connect(vo);
    vo.connect(out);
    // consonants
    const c = syl.toLowerCase().replace(/[^a-z]/g, '');
    if (/^(s|sh|ch|f|th|h|wh)/.test(c)) hiss(out, t - 0.05, 0.07, /^(s|sh|ch)/.test(c) ? 5200 : 2400, 0.22);
    else if (/^(t|k|p|c)/.test(c)) hiss(out, t - 0.015, 0.025, 2800, 0.3);
    if (/(s|z)$/.test(c)) hiss(out, end - 0.05, 0.09, 5500, 0.16);
    else if (/(t|d|k)$/.test(c)) hiss(out, end - 0.02, 0.02, 3000, 0.18);
  }

  /* ---- band ---- */
  function brass(out, t, dur, notes, vol = 0.1) {
    const lp = F('lowpass', 700, 2.5), g = G(0);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(3400, t + 0.045);
    lp.frequency.exponentialRampToValueAtTime(1200, t + dur + 0.06);
    env(g, t, 0.02, vol, dur, 0.14);
    for (const m of notes) for (const dt of [-9, 9]) {
      const o = O('sawtooth', mtof(m), t, t + dur + 0.3); o.detune.value = dt; o.connect(lp);
    }
    lp.connect(g); g.connect(out);
  }
  function bass(out, t, dur, m) {
    const lp = F('lowpass', 480, 3), g = G(0);
    env(g, t, 0.008, 0.34, dur * 0.4, dur * 0.7);
    O('sawtooth', mtof(m), t, t + dur + 0.2).connect(lp);
    O('sine', mtof(m), t, t + dur + 0.2).connect(g);
    lp.connect(g); g.connect(out);
  }
  function kick(out, t, v = 0.9) {
    const o = O('sine', 150, t, t + 0.4), g = G(0);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    env(g, t, 0.004, v, 0.02, 0.3);
    o.connect(g); g.connect(out);
  }
  function snare(out, t, v = 0.32) {
    const s = N(t, t + 0.25), f = F('highpass', 1300), g = G(0);
    env(g, t, 0.003, v, 0.01, 0.15);
    s.connect(f); f.connect(g); g.connect(out);
    const o = O('triangle', 190, t, t + 0.12), g2 = G(0);
    env(g2, t, 0.003, v * 0.6, 0.01, 0.07);
    o.connect(g2); g2.connect(out);
  }
  function hat(out, t, v = 0.06) {
    const s = N(t, t + 0.08), f = F('highpass', 7500), g = G(0);
    env(g, t, 0.002, v, 0.005, 0.04);
    s.connect(f); f.connect(g); g.connect(out);
  }
  function crash(out, t, v = 0.2, dur = 1.6) {
    const s = N(t, t + dur + 0.1), f = F('highpass', 4200), g = G(0);
    env(g, t, 0.005, v, 0.05, dur);
    s.connect(f); f.connect(g); g.connect(out);
  }

  /* ---- the theme song (original melody & lyrics) ----
   * [syllable, vowel, midi, beats]; "~" joins syllables, trailing "-" is a hyphen; null vowel = rest */
  const LINES = [
    [['Spi~', 'a>i', 67, .5], ['der-', 'er', 70, .5], ['Man,', 'ae', 74, 1], ['Spi~', 'a>i', 72, .5], ['der-', 'er', 69, .5], ['Man,', 'ae', 65, 1],
     ['swing~', 'I', 67, .5], ['ing', 'I', 69, .5], ['high', 'a>i', 70, .5], ['a~', 'uh', 72, .5], ['bove', 'uh', 74, .5], ['the', 'uh', 72, .5], ['town!', 'a>u', 70, 1]],
    [['Web', 'e', 67, .5], ['in', 'I', 70, .5], ['hand,', 'ae', 74, 1], ['take', 'e>i', 72, .5], ['a', 'uh', 69, .5], ['stand,', 'ae', 65, 1],
     ['nev~', 'e', 67, .5], ['er', 'er', 69, .5], ['gon~', 'uh', 70, .5], ['na', 'uh', 69, .5], ['let', 'e', 67, .5], ['us', 'uh', 66, .5], ['down!', 'a>u', 67, 1]],
    [['When', 'e', 74, .5], ['the', 'uh', 74, .5], ['night', 'a>i', 75, 1], ['falls', 'o', 74, 1], ['and', 'ae', 72, .5], ['the', 'uh', 72, .5],
     ['ci~', 'I', 70, .5], ['ty', 'i', 72, .5], ['calls,', 'o', 74, 1], ['', null, 0, 2],
     ["he's", 'i', 70, .5], ['there', 'e', 72, .5], ['in', 'I', 74, .5], ['red', 'e', 77, 1], ['and', 'ae', 75, .5], ['blue!', 'u', 74, 3], ['', null, 0, 2]],
    [['Spi~', 'a>i', 67, .5], ['der-', 'er', 70, .5], ['Man,', 'ae', 74, 1], ['Spi~', 'a>i', 72, .5], ['der-', 'er', 69, .5], ['Man,', 'ae', 65, 1],
     ['friend~', 'e', 67, .5], ['ly', 'i', 69, .5], ['he~', 'i', 70, .5], ['ro,', 'o', 72, .5], ['here', 'i', 74, .5], ['for', 'o', 66, .5], ['you!', 'u', 67, 1],
     ['Spi~', 'a>i', 74, .5], ['der-', 'er', 78, .5], ['MAAAN!', 'ae', 79, 5], ['', null, 0, 2]],
  ];
  const CH = {
    Gm: { b: 43, t: [55, 58, 62] }, F: { b: 41, t: [53, 57, 60] }, Cm: { b: 36, t: [55, 60, 63] },
    D: { b: 38, t: [54, 57, 62] }, Eb: { b: 39, t: [55, 58, 63] }, Bb: { b: 46, t: [53, 58, 62] }, G: { b: 43, t: [55, 59, 62] },
  };
  const PROG = 'Gm F Gm Gm Gm F Cm D Eb Bb Bb F Bb Eb Bb D Gm F Eb D G G G G'.split(' ');
  const VOCAL_START = 8, SONG_BEATS = 58;

  // syllable timeline for the karaoke bar
  const SYL = [];
  { let b = 0; LINES.forEach((line, li) => line.forEach((n, si) => { if (n[1]) SYL.push({ li, si, b0: b, dur: n[3] }); b += n[3]; })); }

  /* ---- the words: the browser's speech voice sings each phrase in time,
   * pitched to the tune, over the formant "choir" voice ---- */
  const PHRASES = [];
  {
    let b = 0;
    LINES.forEach(line => line.forEach(([syl, vow, m, d]) => {
      if (vow) {
        const k = Math.floor(b / 4);
        let ph = PHRASES[PHRASES.length - 1];
        if (!ph || ph.k !== k) { ph = { k, b0: b, b1: b, say: '', syl: 0, top: 0 }; PHRASES.push(ph); }
        ph.say += syl.endsWith('~') ? syl.slice(0, -1) : syl.endsWith('-') ? syl : syl + ' ';
        ph.syl++; ph.b1 = b + d; ph.top = Math.max(ph.top, m);
      }
      b += d;
    }));
    PHRASES.forEach(ph => { ph.say = ph.say.replace('MAAAN', 'Man').trim(); });
  }
  const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
  let voice = null, speechTimers = [];
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^en[-_]US/i.test(v.lang) && /Google|Samantha|Aria|Jenny|Guy|Alex/i.test(v.name)) ||
      vs.find(v => /^en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if (canSpeak) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
  function stopSpeech() {
    speechTimers.forEach(clearTimeout); speechTimers = [];
    if (canSpeak) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  function scheduleSpeech(t0) {
    if (!canSpeak) return;
    // unlock speech inside the click (iOS/Safari need this)
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
    for (const ph of PHRASES) {
      const dur = (ph.b1 - ph.b0) * SPB, last = ph === PHRASES[PHRASES.length - 1];
      const at = (t0 + (VOCAL_START + ph.b0) * SPB - ctx.currentTime) * 1000 - 80;
      speechTimers.push(setTimeout(() => {
        if (muted) return;
        const u = new SpeechSynthesisUtterance(ph.say);
        if (voice) u.voice = voice;
        u.lang = 'en-US';
        u.rate = last ? 0.75 : clamp(ph.syl / (dur * 4.2), 0.75, 1.6);
        u.pitch = clamp(0.8 + ((ph.top - 65) / 14) * 0.9, 0.5, 2);
        u.volume = 1;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }, Math.max(0, at)));
    }
  }

  function playSong() {
    if (!init()) return null;
    resume();
    stopSong();
    const bus = G(1); bus.connect(master); bus.connect(revSend);
    songBus = bus;
    const t0 = ctx.currentTime + 0.15, B = b => t0 + b * SPB;
    // --- intro: brass fanfare ---
    const intro = [[0, 'Gm', 1.2, 0.13], [1.5, 'Gm', 0.3], [2.5, 'Gm', 0.3], [3, 'Gm', 0.6], [4, 'F', 1.2, 0.13], [5.5, 'F', 0.3], [6, 'D', 1.6, 0.14]];
    intro.forEach(([b, ch, d, v]) => brass(bus, B(b), d * SPB, CH[ch].t.map(m => m + 12), v || 0.1));
    ['Gm', 'Gm', 'F', 'D'].forEach((ch, i) => { bass(bus, B(i * 2), SPB * 0.9, CH[ch].b); bass(bus, B(i * 2 + 1), SPB * 0.9, CH[ch].b + 12); });
    crash(bus, B(0), 0.16);
    // --- drums ---
    for (let b = 0; b < 56; b += 0.5) {
      const inBar = b % 4;
      hat(bus, B(b), inBar % 1 ? 0.04 : 0.065);
      if (b >= 6 && b < 8) continue;
      if (inBar === 0 || inBar === 2.5) kick(bus, B(b));
      if (inBar === 1 || inBar === 3) snare(bus, B(b));
    }
    for (let k = 0; k < 8; k++) snare(bus, B(6 + k * 0.25), 0.12 + k * 0.03);
    // --- verse backing ---
    PROG.forEach((name, i) => {
      const b = VOCAL_START + i * 2, ch = CH[name];
      bass(bus, B(b), SPB * 0.9, ch.b);
      bass(bus, B(b + 1), SPB * 0.9, ch.b + 7);
      if (i < 20) { brass(bus, B(b + 0.5), SPB * 0.22, ch.t, 0.045); brass(bus, B(b + 1.5), SPB * 0.22, ch.t, 0.045); }
    });
    brass(bus, B(48), SPB * 6, CH.G.t.map(m => m + 12), 0.08);
    crash(bus, B(48), 0.2, 2.5);
    brass(bus, B(56), SPB * 1.5, [...CH.G.t, 67], 0.14);
    kick(bus, B(56), 1); crash(bus, B(56), 0.25, 2.5); bass(bus, B(56), SPB * 2, 31);
    // --- vocals ---
    let b = VOCAL_START, prev = null;
    for (const line of LINES) for (const [syl, vow, m, d] of line) {
      if (!vow) { prev = null; b += d; continue; }
      sing(bus, B(b), d * SPB * 0.94, m, vow, prev, syl);
      prev = m; b += d;
    }
    songT0 = t0;
    scheduleSpeech(t0);
    return t0;
  }
  function stopSong() {
    stopSpeech();
    if (!songBus) return;
    const old = songBus; songBus = null;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => old.disconnect(), 400);
    songT0 = -1;
  }
  const songBeat = () => (ctx && songT0 >= 0 ? (ctx.currentTime - songT0) / SPB : null);

  /* ---- sound effects ---- */
  const sfx = {
    thwip() {
      if (!init()) return; const t = ctx.currentTime;
      const s = N(t, t + 0.25), f = F('bandpass', 900, 3), g = G(0);
      f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.1);
      env(g, t, 0.005, 0.6, 0.03, 0.14); s.connect(f); f.connect(g); g.connect(master);
      const o = O('sine', 1500, t, t + 0.2), g2 = G(0);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.14);
      env(g2, t, 0.004, 0.2, 0.02, 0.12); o.connect(g2); g2.connect(master);
    },
    pow() {
      if (!init()) return; const t = ctx.currentTime;
      kick(master, t, 1.1);
      const s = N(t, t + 0.35), f = F('lowpass', 1600), g = G(0);
      env(g, t, 0.002, 0.7, 0.02, 0.22); s.connect(f); f.connect(g); g.connect(master);
    },
    laser() {
      if (!init()) return; const t = ctx.currentTime;
      const o = O('sawtooth', 2200, t, t + 0.45), o2 = O('square', 2230, t, t + 0.45), f = F('lowpass', 4000), g = G(0);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.4); o2.frequency.exponentialRampToValueAtTime(95, t + 0.4);
      env(g, t, 0.005, 0.16, 0.2, 0.18); o.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    },
    tingle() {
      if (!init()) return; const t = ctx.currentTime;
      for (let i = 0; i < 7; i++) {
        const tt = t + i * 0.045, o = O('sine', 1700 + Math.random() * 1700, tt, tt + 0.5), g = G(0);
        env(g, tt, 0.004, 0.09, 0.02, 0.35); o.connect(g); g.connect(master); g.connect(revSend);
      }
    },
    boom() {
      if (!init()) return; const t = ctx.currentTime;
      const s = N(t, t + 1.6), f = F('lowpass', 500), g = G(0);
      f.frequency.exponentialRampToValueAtTime(90, t + 1.3);
      env(g, t, 0.005, 0.9, 0.1, 1.3); s.connect(f); f.connect(g); g.connect(master);
      const o = O('sine', 90, t, t + 1), g2 = G(0);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
      env(g2, t, 0.005, 0.8, 0.05, 0.8); o.connect(g2); g2.connect(master);
    },
    fanfare() {
      if (!init()) return; const t = ctx.currentTime;
      [67, 71, 74, 79].forEach((m, i) => brass(master, t + i * 0.1, i === 3 ? 0.5 : 0.08, [m, m - 12], 0.1));
      for (let i = 0; i < 10; i++) { const tt = t + 0.3 + Math.random() * 0.5; hiss(master, tt, 0.03, 3000, 0.15); }
    },
    whoosh() {
      if (!init()) return; const t = ctx.currentTime;
      const s = N(t, t + 0.9), f = F('bandpass', 300, 1.5), g = G(0);
      f.frequency.exponentialRampToValueAtTime(3500, t + 0.6);
      env(g, t, 0.25, 0.3, 0.1, 0.4); s.connect(f); f.connect(g); g.connect(master);
    },
  };

  return {
    init, resume, playSong, stopSong, songBeat, sfx, LINES, SYL, VOCAL_START, SONG_BEATS, SPB, BPM,
    get ctx() { return ctx; }, get master() { return master; },
    toggleMute() { muted = !muted; if (muted) stopSpeech(); if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03); return muted; },
  };
})();

/* ======================================================================
 * Panels
 * ==================================================================== */
function skylineData(seed, x0, x1, hMin, hMax, wMin, wMax) {
  const r = seeded(seed), out = [];
  let x = x0;
  while (x < x1) {
    const w = wMin + r() * (wMax - wMin), h = hMin + r() * (hMax - hMin);
    const wins = [];
    for (let wy = 12; wy < h - 10; wy += 15) for (let wx = 7; wx < w - 9; wx += 12) if (r() < 0.32) wins.push([wx, wy]);
    out.push({ x, w, h, wins, cap: r() });
    x += w + 1 + r() * 4;
  }
  return out;
}
function drawSkyline(S, data, baseY, fill, win, o = {}) {
  for (const b of data) {
    const x = b.x + (o.dx || 0);
    S.shape(rect(x, baseY - b.h, b.w, b.h + 2), { fill, w: o.w ?? 1.5, sketch: o.sketch });
    if (b.cap > 0.7) S.shape([[x + b.w * 0.3, baseY - b.h], [x + b.w * 0.5, baseY - b.h - 22], [x + b.w * 0.7, baseY - b.h]], { fill, w: o.w ?? 1.5 });
    for (const [wx, wy] of b.wins) S.shape(rect(x + wx, baseY - b.h + wy, 4.5, 6.5), { fill: win, bw: '#ffffff', w: 0, sketch: false });
  }
}

const PANELS = [
  /* 1 ─ Splash page */
  {
    W: 800, H: 380, wide: true, words: ['THWIP!'], web: true,
    init(p) {
      p.far = skylineData(11, -10, 820, 70, 190, 40, 90);
      p.aim = [-0.4, -0.9]; p.aimAmt = 0; p.squint = 0;
      const r = seeded(4); p.stars = Array.from({ length: 36 }, () => [r() * 800, r() * 200, 0.6 + r() * 1.4]);
    },
    build(p, S, now, dt, beatBob) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { grad: ['#08113a', '#2b2466', '#5d3a7c'], fill: '#08113a', bw: '#e4e4e4', sketch: false, noInk: true });
      for (const [x, y, r] of p.stars) S.shape(ellipse(x, y, r, r, 0, 6), { fill: '#fff8d8', colorOnly: true, alpha: 0.5 + 0.5 * Math.sin(now * 2 + x) });
      S.shape(ellipse(430, 84, 42, 42), { fill: '#fff2bf', bw: '#ffffff', glow: true, w: 2 });
      S.shape(ellipse(418, 74, 8, 6), { fill: '#eadba0', bw: '#dddddd', w: 0 });
      S.shape(ellipse(444, 98, 6, 5), { fill: '#eadba0', bw: '#dddddd', w: 0 });
      drawSkyline(S, p.far, 382, '#1d2356', '#ffd34d');
      // near building
      S.shape(rect(470, 262, 340, 130), { fill: '#262a58', bw: '#141414', w: 2.5 });
      S.shape(rect(460, 248, 352, 16), { fill: '#565b98', w: 2.5 });
      for (let c = 0; c < 5; c++) for (let rr = 0; rr < 2; rr++) {
        const lit = rnd(c, rr, 3) > 0.45;
        S.shape(rect(492 + c * 60, 285 + rr * 50, 28, 34), { fill: lit ? '#ffd34d' : '#12153a', bw: lit ? '#ffffff' : '#111', w: 2 });
      }
      // title
      S.text('THE AMAZING', 196, 50, { size: 38, fill: '#ffd23f', bw: '#ffffff', stroke: '#111', sw: 6, rot: -0.04 });
      S.text('SPIDER-MAN', 222, 128, { size: 104, maxW: 410, fill: '#e8262d', bw: '#ffffff', stroke: '#111', sw: 9, shadow: ['#1f4db5', 5, 7], rot: -0.04 });
      S.shape(rect(716, 14, 68, 76), { fill: '#ffffff', w: 2.5 });
      S.text('No.1', 750, 36, { size: 22 });
      S.text('12¢', 750, 67, { size: 30, fill: '#e8262d', bw: '#111' });
      // corner burst
      const bs = 1 + 0.06 * Math.sin(now * 5);
      S.shape(star(118, 236, 64 * bs, 42 * bs, 14, 2), { fill: '#ffe14d', bw: '#ffffff', w: 2.5 });
      S.text('LIVE!\nHOVER & CLICK!', 118, 236, { size: 21, fill: '#e8262d', bw: '#111', rot: -0.12, maxW: 90 });
      // Spidey (aims his web-shooter at your cursor)
      const s = 1.75, f = -1, X = 622, Y = 250 - 22 * s - beatBob * 3;
      const pose = { ...POSES.crouch };
      const shW = [X + pose.fSh[0] * f * s, Y + pose.fSh[1] * s];
      p.aimAmt = approach(p.aimAmt, p.hover ? 1 : 0, dt * 5);
      if (p.hover) p.aim = mix2(p.aim, nrm([(p.mx - shW[0]) * f, p.my - shW[1]]), clamp(dt * 12));
      const ad = nrm(p.aim);
      pose.fEl = mix2(POSES.crouch.fEl, add(pose.fSh, mul(ad, 17)), p.aimAmt);
      pose.fHand = mix2(POSES.crouch.fHand, add(pose.fSh, mul(ad, 34)), p.aimAmt);
      const Hw = [X + pose.head[0] * f * s, Y + pose.head[1] * s];
      const lx = p.hover ? clamp((p.mx - Hw[0]) / 220, -1, 1) : -0.5;
      const ly = p.hover ? clamp((p.my - Hw[1]) / 160, -1, 1) : -0.2;
      p.squint = approach(p.squint, p.hover && vlen(sub([p.mx, p.my], Hw)) < 90 ? 0.8 : 0, dt * 8);
      const P = spidey(S, pose, X, Y, s, f, 0, { turn: -0.3 + lx * 0.25, lx, ly, squint: Math.max(p.squint, p.jolt(now)) });
      p.hand = P.fHand;
      caption(S, 14, 318, 330, 48, 'ISSUE #1: THE SONG OF THE SPIDER!', { size: 17 });
      if (p.hoverAmt > 0.02) balloon(S, 700, 150, 88, 34, 648, 118, 'Hey there,\ntrue believer!', { alpha: p.hoverAmt, instant: true });
    },
  },

  /* 2 ─ Spider-sense */
  {
    W: 400, H: 300, words: ['!!', 'TINGLE!', 'ZING!'],
    init(p) { p.turn = 0; p.squint = 0; },
    click(p) { Sound.sfx.tingle(); },
    build(p, S, now, dt) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { fill: '#ffd23a', bw: '#ffffff', sketch: false, noInk: true });
      for (let i = 0; i < 18; i += 2) {
        const a0 = (i / 18) * TAU + now * 0.15, a1 = ((i + 1) / 18) * TAU + now * 0.15;
        S.shape([[200, 150], [200 + Math.cos(a0) * 400, 150 + Math.sin(a0) * 400], [200 + Math.cos(a1) * 400, 150 + Math.sin(a1) * 400]],
          { fill: '#ff9f1c', colorOnly: true, alpha: 0.55 });
      }
      torso(S, [200, 262], [200, 490], 5.2, 5);
      S.shape(capsule([200, 215], [200, 280], 30, 30), { ...SR, w: 3.5 });
      const H0 = [200, 142];
      const tx = p.hover ? clamp((p.mx - 200) / 200, -1, 1) : Math.sin(now * 0.7) * 0.2;
      p.turn = approach(p.turn, tx * 0.55, dt * 5);
      const jolt = p.jolt(now);
      p.squint = approach(p.squint, p.hover ? 0.35 : 0, dt * 5);
      const lx = p.hover ? clamp((p.mx - 200) / 150, -1, 1) : 0, ly = p.hover ? clamp((p.my - 140) / 120, -1, 1) : 0;
      head(S, H0, 76, 92, p.turn * 0.25, { turn: p.turn, lx, ly, squint: Math.max(p.squint, jolt) });
      // spider-sense tingles
      const n = Math.round(8 + p.hoverAmt * 6 + jolt * 10);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * Math.PI * 1.45;
        const dir = [Math.cos(a), Math.sin(a)], pp = [-dir[1], dir[0]];
        const st = [H0[0] + dir[0] * 92, H0[1] + dir[1] * 108];
        const amp = 5 + jolt * 5, len = 36 + p.hoverAmt * 10 + jolt * 22;
        const pts = [];
        for (let k = 0; k <= 5; k++) {
          const q = add(st, mul(dir, (len * k) / 5));
          const off = k === 0 || k === 5 ? 0 : (k % 2 ? 1 : -1) * amp * (0.8 + 0.4 * Math.sin(now * 30 + i * 3 + k));
          pts.push(add(q, mul(pp, off)));
        }
        S.line(pts, { w: 3.2 });
      }
      balloon(S, 82, 44, 72, 32, 132, 96, 'My spider-sense\nis TINGLING!');
      caption(S, 236, 264, 156, 28, "Something's coming...");
      if (p.hoverAmt > 0.02) balloon(S, 330, 60, 60, 26, 272, 96, 'Easy...\nEASY...', { alpha: p.hoverAmt, instant: true });
    },
  },

  /* 3 ─ Web-swinging */
  {
    W: 400, H: 300, words: ['THWIP!', 'WHEEE!'], web: true,
    init(p) { p.boost = 0; p.phase = 0; },
    click(p) { p.boost = Math.min(0.45, p.boost + 0.3); },
    build(p, S, now, dt) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { grad: ['#2c5cc2', '#7cb6ef', '#cfe9ff'], fill: '#2c5cc2', bw: '#f0f0f0', sketch: false, noInk: true });
      const o1 = now * 22, o2 = now * 70;
      for (let i = Math.floor(o1 / 62) - 1; i < Math.floor(o1 / 62) + 8; i++) {
        const x = i * 62 - o1, h = 80 + rnd(i, 3) * 120;
        S.shape(rect(x, H - h, 58, h + 2), { fill: '#6d8fca', w: 1.2 });
      }
      for (let i = Math.floor(o2 / 100) - 1; i < Math.floor(o2 / 100) + 6; i++) {
        const x = i * 100 - o2, h = 70 + rnd(i, 7) * 110;
        S.shape(rect(x, H - h, 94, h + 2), { fill: '#223a73', w: 2 });
        for (let r = 0; r * 18 + 14 < h - 8; r++) for (let c = 0; c < 4; c++) {
          if (rnd(i, r, c) < 0.4) S.shape(rect(x + 10 + c * 21, H - h + 12 + r * 18, 8, 9), { fill: '#ffe27a', bw: '#ffffff', w: 0, sketch: false });
        }
      }
      p.boost = Math.max(0, p.boost - dt * 0.12);
      p.phase += dt * (1.9 + p.boost * 1.5);
      const amp = 0.52 + p.boost, ang = amp * Math.sin(p.phase), vel = Math.cos(p.phase);
      const anchor = [205, -30], Lr = 168;
      const hand = [anchor[0] + Math.sin(ang) * Lr, anchor[1] + Math.cos(ang) * Lr];
      const rot = -ang * 0.9, s = 1.45, f = 1, c = Math.cos(rot), sn = Math.sin(rot);
      const [hx, hy] = POSES.swing.bHand;
      const X = hand[0] - (f * hx * c - hy * sn) * s, Y = hand[1] - (f * hx * sn + hy * c) * s;
      // speed lines
      const sg = Math.sign(vel) || 1;
      for (let k = 0; k < 5; k++) {
        const y = Y - 50 + k * 17, x = X - sg * (40 + k * 4);
        S.line([[x, y], [x - sg * (30 + 40 * Math.abs(vel)), y]], { w: 1.6, alpha: 0.4 + 0.6 * Math.abs(vel) });
      }
      S.line([anchor, hand], { w: 2.4, ink: '#f4f4f8' });
      S.line([anchor, hand], { w: 0.9 });
      const P = spidey(S, POSES.swing, X, Y, s, f, rot, { turn: 0.35, lx: 0.6, ly: 0.2, squint: p.jolt(now) });
      p.hand = P.fHand;
      caption(S, 8, 8, 196, 28, 'Swinging high above the town!');
      if (p.hoverAmt > 0.02) balloon(S, 320, 244, 70, 28, P.head[0] + 20, P.head[1] + 10, "Rent's cheaper\nup here!", { alpha: p.hoverAmt, instant: true });
    },
  },

  /* 4 ─ Enter SCRAPJAW */
  {
    W: 400, H: 300, words: ['ZZARK!', 'BZZT!', 'KZZT!'],
    init(p) {
      const r = seeded(77);
      p.junk = [0, 1, 2].map(i => {
        const cx = [40, 170, 360][i], w = [120, 110, 130][i], h = [70, 50, 80][i], pts = [];
        for (let k = 0; k <= 12; k++) { const a = Math.PI + (k / 12) * Math.PI; pts.push([cx + Math.cos(a) * w * (0.8 + r() * 0.3), 302 + Math.sin(a) * h * (0.7 + r() * 0.4)]); }
        return pts;
      });
      p.look = [0, 0];
    },
    click(p, x, y, now) {
      Sound.sfx.laser();
      p.fx.push({ type: 'laser', from: p.eye, to: [x, y], t0: now, life: 0.4 });
      p.fx.push({ type: 'scorch', x, y, t0: now, life: 5 });
      particles(p, x, y, 14, 'spark', { speed: 220, life: 0.6 });
      p.shakeT0 = now; p.fireT0 = now;
    },
    build(p, S, now, dt) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { grad: ['#1e1030', '#5a2140', '#b5503f'], fill: '#1e1030', bw: '#dcdcdc', sketch: false, noInk: true });
      S.shape(ellipse(80, 70, 26, 26), { fill: '#ffb38a', bw: '#ffffff', glow: true, w: 2 });
      p.junk.forEach((pts, i) => S.shape(pts, { fill: ['#4a3b3f', '#5c4a3a', '#3f3a45'][i], w: 2 }));
      for (const [x, y] of [[40, 262], [352, 250]]) {
        S.shape(ellipse(x, y, 20, 12), { fill: '#1b1b1b', w: 2 });
        S.shape(ellipse(x, y, 8, 5), { fill: '#6a6a6a', w: 1.5 });
      }
      S.shape([[120, 290], [150, 250], [196, 262], [180, 300]], { fill: '#7b5a3a', w: 2 });
      const target = p.hover ? [clamp((p.mx - 262) / 150, -1, 1), clamp((p.my - 90) / 120, -1, 1)] : [Math.sin(now * 0.8), 0.2];
      p.look = mix2(p.look, target, clamp(dt * 8));
      const firing = p.fireT0 != null && now - p.fireT0 < 0.6;
      const R = robot(S, 262, 294, 1.3, { lx: p.look[0], ly: p.look[1], jaw: 0.5 + 0.5 * Math.sin(now * 6), raise: firing ? 1 : 0.15 + 0.1 * Math.sin(now * 2), blink: Math.sin(now * 6) > 0 });
      p.eye = R.eye;
      if (p.hover) S.line([R.eye, [p.mx, p.my]], { w: 1.5, ink: '#ff3030', dash: [5, 6], instant: true, alpha: 0.8 });
      balloon(S, 102, 142, 84, 28, 205, 88, 'SURRENDER,\nWEB-HEAD!!', { robot: true, size: 15 });
      caption(S, 8, 8, 230, 28, 'Suddenly... SCRAPJAW attacks!');
      if (p.hoverAmt > 0.02) balloon(S, 340, 164, 52, 26, 296, 110, 'BEEP. I\nSEE YOU.', { robot: true, alpha: p.hoverAmt, instant: true });
    },
  },

  /* 5 ─ The battle */
  {
    W: 400, H: 300, words: ['POW!', 'BAM!', 'KRAK!', 'WHAM!', 'THOOM!'],
    init(p) { p.hits = 0; p.koT0 = null; p.kickT0 = -9; p.recoilT0 = -9; p.dents = []; p.look = [0, 0]; },
    click(p, x, y, now) {
      if (p.koT0 != null) return;
      p.kickT0 = now; p.recoilT0 = now + 0.1; p.hits++;
      Sound.sfx.pow();
      p.shakeT0 = now;
      const ip = p.chest || [300, 200];
      particles(p, ip[0], ip[1], 8, 'bolt', { speed: 260, dir: -0.6, spread: 2.2, life: 1.2, g: 600 });
      particles(p, ip[0], ip[1], 12, 'spark', { speed: 240, life: 0.5 });
      p.dents.push([(Math.random() - 0.5) * 60, -70 - Math.random() * 50, 6]);
      if (p.hits >= 5) {
        p.koT0 = now;
        setTimeout(() => { Sound.sfx.boom(); burst(p, 300, 150, 'KRA-KOOM!', 70); p.shakeT0 = perfNow(); }, 250);
      }
    },
    build(p, S, now, dt) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { fill: '#ffe35a', bw: '#ffffff', sketch: false, noInk: true });
      for (let i = 0; i < 22; i += 2) {
        const a0 = (i / 22) * TAU - now * 0.3, a1 = ((i + 1) / 22) * TAU - now * 0.3, c = [255, 150];
        S.shape([c, [c[0] + Math.cos(a0) * 450, c[1] + Math.sin(a0) * 450], [c[0] + Math.cos(a1) * 450, c[1] + Math.sin(a1) * 450]],
          { fill: '#ff9d2e', bw: '#e2e2e2', sketch: false, noInk: true });
      }
      let tilt = 0, ko = false;
      if (p.koT0 != null) {
        const a = now - p.koT0;
        ko = a < 3.6;
        tilt = a < 3.6 ? Math.min(1.25, a * 2.5) : Math.max(0, 1.25 - (a - 3.6) * 2);
        if (a > 4.3) { p.koT0 = null; p.hits = 0; p.dents = []; burst(p, 300, 110, "HE'S BACK!", 44); }
      }
      const ra = now - p.recoilT0;
      if (ra > 0 && ra < 0.5) tilt += Math.sin(ra * 25) * 0.12 * (1 - ra / 0.5);
      const target = p.hover ? [clamp((p.mx - 315) / 150, -1, 1), clamp((p.my - 120) / 120, -1, 1)] : [-0.8, 0.3];
      p.look = mix2(p.look, target, clamp(dt * 8));
      const R = robot(S, 318, 298, 1.05, { tilt, ko, lx: p.look[0], ly: p.look[1], jaw: ko ? 1 : 0.3, dents: p.dents, raise: 0.5 });
      p.chest = R.chest;
      const ka = now - p.kickT0;
      const k = ka < 0.1 ? ka / 0.1 : ka < 0.5 ? 1 - (ka - 0.1) / 0.4 : 0;
      const pose = { ...POSES.kick, fKnee: [22 + 6 * k, -3], fFoot: [42 + 10 * k, -6], fToe: [44 + 10 * k, -14] };
      const X = 150 + smooth(k) * 50, Y = 176 + Math.sin(now * 3) * 5;
      spidey(S, pose, X, Y, 1.45, 1, -0.08, { turn: 0.4, lx: 0.7, squint: 0.3 + k * 0.5 });
      caption(S, 8, 8, 196, 28, 'Web-head vs. Scrapjaw!');
      S.shape(rect(272, 8, 120, 28), { fill: '#ffffff', w: 2 });
      S.text('HITS ' + '★'.repeat(p.hits) + '☆'.repeat(Math.max(0, 5 - p.hits)), 332, 23, { size: 17, fill: '#e8262d', bw: '#111', maxW: 110 });
      if (p.hoverAmt > 0.02) balloon(S, 86, 58, 74, 30, 118, 96, 'Your warranty\njust expired!', { alpha: p.hoverAmt, instant: true });
    },
  },

  /* 6 ─ Finale */
  {
    W: 800, H: 380, wide: true, words: ['WOO-HOO!', 'BRAVO!', 'TA-DA!'],
    init(p) {
      p.far = skylineData(5, -10, 820, 50, 150, 34, 80);
      const r = seeded(9);
      p.webs = Array.from({ length: 16 }, () => [[-60 + r() * 120, -200 + r() * 60], [-60 + r() * 120, -120 + r() * 120]]);
    },
    click(p, x, y) {
      Sound.sfx.fanfare();
      particles(p, x, y, 40, 'firework', { speed: 260, life: 1.2, g: 120 });
      particles(p, x, y, 24, 'confetti', { speed: 180, life: 2, g: 160 });
    },
    build(p, S, now, dt, beatBob) {
      const { W, H } = p;
      S.shape(rect(0, 0, W, H), { grad: ['#4d3f96', '#ff8a5c', '#ffd98a'], fill: '#4d3f96', bw: '#f2f2f2', sketch: false, noInk: true });
      S.shape(ellipse(650, 236, 62, 62), { fill: '#fff0a0', bw: '#ffffff', glow: true, w: 2 });
      drawSkyline(S, p.far, 290, '#6d4a7a', '#ffe08a', { w: 1.2 });
      S.shape(rect(0, 288, 800, 95), { fill: '#7a5a4c', w: 2.5 });
      S.shape(rect(-5, 278, 810, 14), { fill: '#a88570', w: 2.5 });
      for (let i = 0; i < 6; i++) S.line([[i * 140 + 20, 312 + (i % 2) * 30], [i * 140 + 90, 312 + (i % 2) * 30]], { w: 1.2 });
      // water tower
      for (const [x0, x1] of [[78, 70], [158, 166], [100, 96], [136, 140]]) S.shape(rect(Math.min(x0, x1), 200, 6, 80), { fill: '#3b2b22', w: 1.5 });
      S.line([[72, 240], [164, 240]], { w: 2.5 });
      S.shape(rect(62, 120, 110, 84), { fill: '#9a6433', w: 2.5 });
      for (const y of [140, 170, 196]) S.line([[62, y], [172, y]], { w: 1.6 });
      S.shape([[56, 122], [117, 80], [178, 122]], { fill: '#6b3f22', w: 2.5 });
      // Scrapjaw, webbed up for the police
      const R = robot(S, 330, 286, 0.72, { ko: true, tilt: 0.08, jaw: 1 });
      for (const [a, b] of p.webs) S.line([[330 + a[0] * 0.72 * 1.3, 286 + a[1] * 0.72], [330 + b[0] * 0.72 * 1.3, 286 + b[1] * 0.72]], { w: 1.8, ink: '#f7f7fb' });
      S.shape(rect(268, 232, 124, 40), { fill: '#fff8e0', w: 2 });
      S.text('FOR THE POLICE!\n— your pal, Spidey', 330, 252, { size: 12, font: NEUE, maxW: 112 });
      // Spidey waves goodbye
      const s = 1.9, wave = Math.sin(now * (6 + p.hoverAmt * 6)) * (0.4 + p.hoverAmt * 0.6);
      const pose = { ...POSES.stand, fHand: [22 + wave * 8, -74 + Math.abs(wave) * 2], fEl: [26 + wave * 2, -55] };
      const lx = p.hover ? clamp((p.mx - 560) / 250, -1, 1) : 0, ly = p.hover ? clamp((p.my - 100) / 150, -1, 1) : 0;
      const P = spidey(S, pose, 560, 280 - 42 * s - beatBob * 4, s, 1, 0, { turn: lx * 0.25, lx, ly, squint: p.jolt(now) });
      balloon(S, 706, 72, 86, 44, P.head[0] + 18, P.head[1] - 6, 'Just another\nnight in the\nneighborhood!');
      caption(S, 10, 10, 290, 30, 'Dawn. The city sleeps safe once more.');
      S.text('THE END?', 680, 336, { maxW: 200, size: 46, fill: '#e8262d', bw: '#ffffff', stroke: '#111', sw: 7, shadow: ['#ffd23f', 3, 4], rot: -0.06 });
      if (p.hoverAmt > 0.02) balloon(S, 430, 178, 70, 28, 350, 170, 'BZZT... I WANT\nMY LAWYER.', { robot: true, alpha: p.hoverAmt, instant: true });
      void R;
    },
  },
];

/* ======================================================================
 * Art timeline (in song beats) – pencil → ink → colour → halftone pop
 * ==================================================================== */
const POP_BEAT = 49;
function stageFor(i, b) {
  const sketch = clamp((b - i * 0.9) / 11);
  const ink = clamp((b - 15 - i * 0.9) / 8);
  const color = smooth((b - 25 - i * 2.2) / 6);
  const halftone = clamp((b - POP_BEAT) / 1.5);
  return { sketch, ink, color, halftone, sketchAlpha: (1 - 0.7 * ink) * (1 - color) };
}
const FULL = { sketch: 1, ink: 1, color: 1, halftone: 1, sketchAlpha: 0 };

let artStart = null; // perf time when the art timeline began
const artBeat = () => (artStart == null ? 0 : (perfNow() - artStart) / Sound.SPB);

/* ======================================================================
 * DOM, styles, panels
 * ==================================================================== */
function injectHead() {
  document.title = 'The Amazing Spider-Man — Live Comic';
  const meta = document.createElement('meta');
  meta.name = 'viewport'; meta.content = 'width=device-width,initial-scale=1';
  document.head.appendChild(meta);
  const pre = document.createElement('link');
  pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = '';
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Bangers&family=Comic+Neue:wght@700&display=swap';
  document.head.append(pre, fonts);
  const css = document.createElement('style');
  css.textContent = `
  *{box-sizing:border-box}
  html,body{margin:0}
  body{min-height:100vh;padding:18px 16px 120px;font-family:${NEUE};color:#111;
    background-color:#16307a;background-image:radial-gradient(rgba(255,255,255,.13) 1.6px,transparent 1.7px);background-size:12px 12px}
  .book{max-width:1040px;margin:0 auto;background:#f3ecd9;padding:14px;border:4px solid #111;box-shadow:10px 10px 0 #111}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .panel{position:relative;transition:transform .12s ease-out,box-shadow .12s;cursor:crosshair;touch-action:manipulation}
  .panel:hover{box-shadow:8px 8px 0 rgba(0,0,0,.35)}
  .panel.wide{grid-column:span 2}
  .panel canvas{display:block;width:100%;height:auto}
  .foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:14px}
  .foot b{font-family:${BANG};font-weight:400;font-size:18px;letter-spacing:1px}
  .bar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
    background:#111;color:#fff;border-top:4px solid #e8262d}
  .bar button{font-family:${BANG};font-size:19px;letter-spacing:1px;padding:5px 12px;background:#ffd23f;color:#111;
    border:3px solid #fff;box-shadow:3px 3px 0 #e8262d;cursor:pointer;white-space:nowrap}
  .bar button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #e8262d}
  .lyrics{flex:1;position:relative;text-align:center;font-weight:700;font-size:clamp(15px,2.6vw,24px);min-height:36px;
    padding-top:6px;overflow:hidden}
  .lyrics span{color:#777;transition:color .08s}
  .lyrics span.done{color:#fff}
  .lyrics span.on{color:#ffd23f;text-shadow:0 0 12px rgba(255,210,63,.7)}
  .lyrics .spider{position:absolute;top:-2px;left:0;font-size:14px;transition:left .1s linear;pointer-events:none}
  .cover{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:16px;
    background:rgba(8,14,40,.88)}
  .cover .card{max-width:520px;width:100%;text-align:center;background:#f3ecd9;border:5px solid #111;box-shadow:12px 12px 0 #e8262d;padding:26px 22px}
  .cover h1{font-family:${BANG};font-weight:400;font-size:clamp(40px,9vw,68px);line-height:.95;margin:0 0 6px;color:#e8262d;
    -webkit-text-stroke:2px #111;text-shadow:4px 5px 0 #1f4db5;letter-spacing:2px}
  .cover p{margin:10px 0 18px;font-size:17px}
  .cover button{font-family:${BANG};font-size:28px;letter-spacing:1px;padding:10px 24px;background:#ffd23f;border:4px solid #111;
    box-shadow:5px 5px 0 #111;cursor:pointer}
  .cover button:hover{transform:rotate(-2deg) scale(1.05)}
  @media (max-width:640px){.grid{grid-template-columns:1fr}.panel.wide{grid-column:auto}.bar{flex-wrap:wrap}.lyrics{order:-1;flex-basis:100%}}
  `;
  document.head.appendChild(css);
}

function makePaper(ctx) {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#f5efdc'; g.fillRect(0, 0, 160, 160);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '90,70,40' : '255,255,255'},${Math.random() * 0.09})`;
    g.fillRect(Math.random() * 160, Math.random() * 160, 1 + Math.random(), 1 + Math.random());
  }
  return ctx.createPattern(c, 'repeat');
}
function makeDots(ctx) {
  const c = document.createElement('canvas'); c.width = c.height = 6;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.beginPath(); g.arc(3, 3, 1.35, 0, TAU); g.fill();
  return ctx.createPattern(c, 'repeat');
}

const panels = [];

function panelCoords(p, e) {
  const r = p.cv.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * p.W, ((e.clientY - r.top) / r.height) * p.H, (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5];
}

function makePanel(def, index, grid) {
  const el = document.createElement('div');
  el.className = 'panel' + (def.wide ? ' wide' : '');
  const cv = document.createElement('canvas');
  cv.width = def.W; cv.height = def.H;
  cv.style.aspectRatio = `${def.W} / ${def.H}`;
  el.appendChild(cv);
  grid.appendChild(el);
  const ctx = cv.getContext('2d');
  const p = {
    ...def, index, el, cv, ctx, scale: 1, mx: -999, my: -999, hover: false, hoverAmt: 0,
    fx: [], splashes: [], shakeT0: -9, joltT0: -9, last: perfNow(), visible: true,
    paper: makePaper(ctx), dots: makeDots(ctx),
  };
  p.jolt = now => { const a = now - p.joltT0; return a < 0.6 ? 1 - a / 0.6 : 0; };
  def.init && def.init(p);

  cv.addEventListener('pointermove', e => {
    const [x, y, nx, ny] = panelCoords(p, e);
    p.mx = x; p.my = y; p.hover = true;
    const k = p.wide ? 2.5 : 5;
    el.style.transform = `perspective(900px) rotateY(${nx * k}deg) rotateX(${-ny * k}deg) scale(1.012)`;
    el.style.zIndex = 2;
  });
  cv.addEventListener('pointerleave', () => { p.hover = false; el.style.transform = ''; el.style.zIndex = ''; });
  cv.addEventListener('pointerdown', e => {
    const [x, y] = panelCoords(p, e);
    p.mx = x; p.my = y;
    Sound.init(); Sound.resume();
    const now = perfNow();
    p.splashes.push({ x, y, t0: now, R: p.wide ? 170 : 120, seed: (Math.random() * 1000) | 0 });
    if (p.splashes.length > 12) p.splashes.shift();
    p.joltT0 = now;
    burst(p, x, y, pick(p.words), p.wide ? 50 : 42, now);
    if (p.web) { Sound.sfx.thwip(); p.fx.push({ type: 'web', from: () => p.hand || [x, y], to: [x, y], t0: now, life: 2.6 }); }
    p.click && p.click(p, x, y, now);
  });

  new ResizeObserver(() => {
    const w = cv.clientWidth; if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round((w * def.H / def.W) * dpr);
    p.scale = cv.width / def.W;
  }).observe(cv);
  new IntersectionObserver(es => { p.visible = es[0].isIntersecting; }).observe(cv);
  return p;
}

function renderPanel(p, now, beat, songBeat) {
  const { ctx, W, H } = p;
  const dt = Math.min(0.05, now - p.last); p.last = now;
  p.hoverAmt = approach(p.hoverAmt, p.hover ? 1 : 0, dt * 7);
  if (!p.visible) return;
  const st = stageFor(p.index, beat);
  const beatBob = songBeat != null && songBeat < Sound.SONG_BEATS ? Math.pow(1 - (songBeat % 1), 3) : 0;

  const S = new Scene();
  p.build(p, S, now, dt, beatBob);
  drawFx(S, p, now);
  const items = S.items;
  // panel border: drawn first by the pencil, rendered last
  const border = { pts: rect(2.5, 2.5, W - 5, H - 5), closed: true, w: 5 + beatBob * 2, ink: '#111', sketch: true, alpha: 1, ord: 0 };

  ctx.setTransform(p.scale, 0, 0, p.scale, 0, 0);
  ctx.fillStyle = p.paper; ctx.fillRect(0, 0, W, H);
  ctx.save();
  const sa = now - p.shakeT0;
  if (sa < 0.35) { const m = 6 * (1 - sa / 0.35); ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m); }
  renderItems(ctx, items, st, now);

  // click-splashes: fully inked & coloured art revealed through ragged ink-blots
  if (st.color < 1) {
    const live = p.splashes.filter(s => now - s.t0 > 0);
    if (live.length) {
      ctx.save(); ctx.beginPath();
      for (const s of live) {
        const r = s.R * backOut(clamp((now - s.t0) / 0.7));
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * TAU, rr = r * (0.82 + 0.3 * rnd(s.seed, i));
          const x = s.x + Math.cos(a) * rr, y = s.y + Math.sin(a) * rr;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
      }
      ctx.clip();
      ctx.fillStyle = p.paper; ctx.fillRect(0, 0, W, H);
      renderItems(ctx, items, FULL, now);
      ctx.restore();
    }
  } else if (p.splashes.length) p.splashes.length = 0;

  const ht = Math.max(st.halftone, 0);
  if (ht > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16 * ht;
    ctx.fillStyle = p.dots; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  ctx.restore();
  // "POP!" flash when the song hits the big final note
  const fb = beat - POP_BEAT;
  if (fb > 0 && fb < 1.4) { ctx.globalAlpha = 0.85 * (1 - fb / 1.4); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  renderItems(ctx, [border], st, now);
}

/* ---------- karaoke bar ---------- */
let lyricsEl, spiderEl, lyricLineIdx = -1, lyricSylIdx = -2, lineSpans = [];
function buildLyricLine(li) {
  lyricsEl.querySelectorAll('.line').forEach(n => n.remove());
  const div = document.createElement('div'); div.className = 'line';
  lineSpans = [];
  Sound.LINES[li].forEach(([syl, vow]) => {
    if (!vow) { lineSpans.push(null); return; }
    const sp = document.createElement('span');
    // "~" joins syllables of one word; a trailing "-" is a real hyphen (Spider-Man)
    sp.textContent = syl.endsWith('~') ? syl.slice(0, -1) : syl.endsWith('-') ? syl : syl + ' ';
    div.appendChild(sp); lineSpans.push(sp);
  });
  lyricsEl.appendChild(div);
}
function setLyricMessage(msg) {
  if (lyricLineIdx === -9) return;
  lyricLineIdx = -9; lyricSylIdx = -2;
  lyricsEl.querySelectorAll('.line').forEach(n => n.remove());
  const d = document.createElement('div'); d.className = 'line'; d.innerHTML = msg;
  lyricsEl.appendChild(d); spiderEl.style.opacity = 0;
}
function updateLyrics(sb) {
  if (sb == null || sb > Sound.SONG_BEATS) { setLyricMessage('<span class="done">🕷 Press ♪ SING for the theme song 🕷</span>'); return; }
  const vb = sb - Sound.VOCAL_START;
  if (vb < 0) { setLyricMessage('<span class="on">♪ ♫ ♪ ♫ ♪</span>'); return; }
  let cur = -1;
  for (let i = 0; i < Sound.SYL.length; i++) if (Sound.SYL[i].b0 <= vb) cur = i; else break;
  if (cur < 0) return;
  const syl = Sound.SYL[cur];
  if (syl.li !== lyricLineIdx) { lyricLineIdx = syl.li; buildLyricLine(syl.li); lyricSylIdx = -2; }
  const active = vb < syl.b0 + syl.dur;
  const key = cur * 2 + (active ? 1 : 0);
  if (key !== lyricSylIdx) {
    lyricSylIdx = key;
    lineSpans.forEach((sp, si) => { if (!sp) return; sp.className = si < syl.si ? 'done' : si === syl.si ? (active ? 'on' : 'done') : ''; });
  }
  const sp = lineSpans[syl.si];
  if (sp) {
    spiderEl.style.opacity = 1;
    spiderEl.style.left = sp.offsetLeft + sp.offsetWidth / 2 - 7 + 'px';
    spiderEl.style.transform = `translateY(${-Math.abs(Math.sin(sb * Math.PI)) * 6}px)`;
  }
}

/* ---------- boot ---------- */
function start() {
  panels.forEach(p => { p.fx = []; p.splashes = []; });
  const t0 = Sound.playSong();
  const lead = t0 != null ? t0 - Sound.ctx.currentTime : 0.1;
  artStart = perfNow() + lead;
}

function boot() {
  injectHead();
  const book = document.createElement('div'); book.className = 'book';
  const grid = document.createElement('div'); grid.className = 'grid';
  book.appendChild(grid);
  const foot = document.createElement('div'); foot.className = 'foot';
  foot.innerHTML = '<span><b>HOVER</b> to make panels react · <b>CLICK</b> to splash colour, shoot webs & throw punches</span><span>Drawn, inked, coloured &amp; sung live — 100% JavaScript</span>';
  book.appendChild(foot);
  document.body.appendChild(book);
  PANELS.forEach((d, i) => panels.push(makePanel(d, i, grid)));

  const bar = document.createElement('div'); bar.className = 'bar';
  const mk = (label, fn, title) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.onclick = fn; bar.appendChild(b); return b; };
  mk('♪ SING', () => { Sound.playSong(); }, 'Play the theme song');
  mk('↺ REDRAW', () => { Sound.sfx.whoosh(); start(); }, 'Start again from pencils');
  lyricsEl = document.createElement('div'); lyricsEl.className = 'lyrics';
  spiderEl = document.createElement('span'); spiderEl.className = 'spider'; spiderEl.textContent = '🕷';
  lyricsEl.appendChild(spiderEl);
  bar.appendChild(lyricsEl);
  const muteBtn = mk('🔊', () => { muteBtn.textContent = Sound.toggleMute() ? '🔇' : '🔊'; }, 'Mute / unmute');
  document.body.appendChild(bar);

  const cover = document.createElement('div'); cover.className = 'cover';
  cover.innerHTML = `<div class="card"><h1>THE AMAZING<br>SPIDER-MAN</h1>
    <p>A live comic that draws itself — pencils, inks, colours — while it <b>sings you its theme song</b>.</p>
    <button type="button">▶ OPEN THE COMIC</button><p style="font-size:13px;margin:14px 0 0">🔊 Sound on for the full experience</p></div>`;
  document.body.appendChild(cover);
  cover.querySelector('button').onclick = () => {
    Sound.init(); Sound.resume(); Sound.sfx.whoosh();
    cover.remove();
    start();
  };
  // make sure canvas text redraws with the comic fonts once loaded
  if (document.fonts && document.fonts.load) { document.fonts.load('20px Bangers'); document.fonts.load('700 16px "Comic Neue"'); }

  const frame = () => {
    const now = perfNow(), beat = artBeat(), sb = Sound.songBeat();
    for (const p of panels) renderPanel(p, now, beat, sb);
    updateLyrics(sb);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__comic = { Sound, panels, start, artBeat, setBeat: b => { artStart = perfNow() - b * Sound.SPB; } };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
