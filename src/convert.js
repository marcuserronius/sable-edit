/* Shape conversion: the geometry of turning a rect / circle / ellipse / line / polygon / polyline / path into another of them.
   Pure (no DOM, no policy): convertShape(tag, get, to, opts) reads a shape through `get(attr)` and returns the attributes of the
   shape it becomes, or null when there is no sensible conversion. attach.js builds the element, policy.js (checkConvert) judges it.

     -> {tag, attrs: {name: 'value'}, exact}      exact: the same outline (same fill region, same stroke centre line); the join or cap
                                                    where a closed outline starts and ends is not counted

   Every shape can become a path (always exact), and a path is the pivot for the rest: polygon / polyline are got by flattening it.
   Exact where the geometry really is the target (a path that is an axis-aligned rectangle becomes a rect; a path of arcs around
   one centre becomes an ellipse or circle, so circle -> path -> circle is a round trip), a stated approximation otherwise:
     rect / circle / ellipse / path -> ellipse or rect   the bounding box (an ellipse is the one inscribed in it)
     -> circle          the ellipse's radii averaged so the area is kept: r = sqrt(rx * ry)
     curves -> polygon / polyline     flattened to straight edges within opts.tol (default: a little under 0.1% of the size)
   Not offered: anything -> line unless it already is one straight segment; line -> rect / circle / ellipse / polygon (no area);
   a path with several subpaths -> polygon / polyline (they hold one outline); degenerate shapes (no size) -> anything.
   Rounded rect <-> ellipse is exact only where the corners are fully round (rx >= width / 2 and ry >= height / 2: an ellipse IS that).
   opts: {arcs: false -> circle / ellipse / rounded corners as cubic beziers instead of arcs, tol: flattening tolerance} */
import { parsePath, serPath, segInfo, arcGeom, retype, convertSegments, dc } from './path-math.js';
import { rnd } from './util.js';

export const KINDS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline'];
export const LABELS = { path: 'Path', rect: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon', polyline: 'Polyline' };

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const flt = (get, a) => { const v = parseFloat(get(a)); return Number.isFinite(v) ? v : 0; };
const points = s => { const n = (s || '').match(NUM) || [], p = []; for (let i = 0; i + 1 < n.length; i += 2) p.push([+n[i], +n[i + 1]]); return p; };
const fmt = pts => pts.map(q => rnd(q[0]) + ',' + rnd(q[1])).join(' ');
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const SLOP = 3e-3;   // what a shape that went through 3-decimal rounding can be off by and still be recognised

/* a shape's geometry from its attributes, or null if it has none that can be drawn */
export function readShape(tag, get) {
  switch (tag) {
    case 'rect': {
      const x = flt(get, 'x'), y = flt(get, 'y'), w = flt(get, 'width'), h = flt(get, 'height');
      if (!(w > 0 && h > 0)) return null;
      const a = parseFloat(get('rx')), b = parseFloat(get('ry'));
      let rx = a >= 0 ? a : b >= 0 ? b : 0, ry = b >= 0 ? b : a >= 0 ? a : 0;   // one missing radius follows the other
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!(rx > 0 && ry > 0)) rx = ry = 0;                                       // a zero radius means sharp corners
      return { t: 'rect', x, y, w, h, rx, ry };
    }
    case 'circle': { const r = flt(get, 'r'); return r > 0 ? { t: 'circle', cx: flt(get, 'cx'), cy: flt(get, 'cy'), r } : null; }
    case 'ellipse': {
      const a = parseFloat(get('rx')), b = parseFloat(get('ry')), rx = a >= 0 ? a : b, ry = b >= 0 ? b : a;   // 'auto' / missing follows the other
      return rx > 0 && ry > 0 ? { t: 'ellipse', cx: flt(get, 'cx'), cy: flt(get, 'cy'), rx, ry } : null;
    }
    case 'line': return { t: 'line', p: [[flt(get, 'x1'), flt(get, 'y1')], [flt(get, 'x2'), flt(get, 'y2')]] };
    case 'polygon': case 'polyline': { const pts = points(get('points')); return pts.length >= 2 ? { t: tag, pts } : null; }
    case 'path': { const segs = parsePath(get('d') || ''); return segs.some(s => s.t !== 'M' && s.t !== 'Z') ? { t: 'path', segs } : null; }
  }
  return null;
}

/* ---- to path ---- */
const M = p => ({ t: 'M', pts: [[...p]] }), L = p => ({ t: 'L', pts: [[...p]], dirty: 1 }), Z = () => ({ t: 'Z', pts: [] });
const A = (rx, ry, p) => ({ t: 'A', arc: [rnd(rx), rnd(ry), 0, 0, 1], pts: [[...p]] });   // a quarter turn, clockwise on screen

/* any shape -> path segments (the outline, exactly) */
export function toSegs(g, opts = {}) {
  let segs;
  switch (g.t) {
    case 'path': return g.segs;
    case 'line': segs = [M(g.p[0]), L(g.p[1])]; break;
    case 'polygon': case 'polyline': segs = g.pts.map((p, i) => i ? L(p) : M(p)); if (g.t === 'polygon') segs.push(Z()); break;
    case 'circle': case 'ellipse': {
      const rx = g.t === 'circle' ? g.r : g.rx, ry = g.t === 'circle' ? g.r : g.ry, { cx, cy } = g;
      segs = [M([cx + rx, cy]), A(rx, ry, [cx, cy + ry]), A(rx, ry, [cx - rx, cy]), A(rx, ry, [cx, cy - ry]), A(rx, ry, [cx + rx, cy]), Z()];
      break;
    }
    case 'rect': {
      const { x, y, w, h, rx, ry } = g, r = x + w, b = y + h, round = rx > 0, S = [x + rx, y];
      segs = [M(S)];
      const line = p => { const q = segs.at(-1).pts.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) segs.push(L(p)); };   // no zero-length lines (fully round sides)
      const arc = p => { if (round) segs.push(A(rx, ry, p)); };
      line([r - rx, y]); arc([r, y + ry]); line([r, b - ry]); arc([r - rx, b]); line([x + rx, b]); arc([x, b - ry]); line([x, y + ry]);
      if (!round) segs.pop(); else arc(S);                // sharp: that last line only ran back to the start, the Z does it
      segs.push(Z());                                    // sharp: the Z is the last edge; round: the last arc ends on the start, the Z draws nothing
      break;
    }
    default: return null;
  }
  retype(segs);                                          // straight runs become H / V where they are
  if (opts.arcs === false) {
    const idx = segs.flatMap((s, i) => s.t === 'A' ? [i] : []), c = idx.length && convertSegments(segs, idx, 'C');
    if (c) { segs = c.segs; retype(segs); }
  }
  return segs;
}

/* ---- measuring ---- */
const roots = (a, b, c) => {                               // a t^2 + b t + c = 0, t in (0,1)
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter(t => t > 0 && t < 1);
  const D = b * b - 4 * a * c; if (D < 0) return [];
  const s = Math.sqrt(D); return [(-b + s) / (2 * a), (-b - s) / (2 * a)].filter(t => t > 0 && t < 1);
};
/* [x0, y0, x1, y1] of the drawn outline (curve extremes, not control points), or null */
export function pathBox(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  const info = segInfo(segs);
  segs.forEach((s, i) => {
    if (s.t === 'M') return void add(s.pts[0]);
    if (s.t === 'Z' || !info[i].from) return;
    const from = info[i].from, to = s.pts.at(-1); add(to);
    if (s.t === 'Q' || s.t === 'C') {
      const P = [from, ...s.pts];
      for (const k of [0, 1]) {
        const p = P.map(q => q[k]);
        const t = s.t === 'Q' ? roots(0, 2 * (p[0] - 2 * p[1] + p[2]), 2 * (p[1] - p[0]))
          : roots(-p[0] + 3 * p[1] - 3 * p[2] + p[3], 2 * (p[0] - 2 * p[1] + p[2]), p[1] - p[0]);
        t.forEach(u => add(dc(P, u)));
      }
    } else if (s.t === 'A') {
      const g = arcGeom(from, to, ...s.arc); if (!g) return;
      const sg = Math.sign(g.dth), cands = [Math.atan2(-g.ry * g.s, g.rx * g.c), Math.atan2(g.ry * g.c, g.rx * g.s)];
      for (const a of cands) for (const th of [a, a + Math.PI]) {
        const u = (((th - g.th1) * sg) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (u <= Math.abs(g.dth)) add(g.pt(th));
      }
    }
  });
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/* ---- flattening ---- */
/* one subpath -> {pts, closed (a Z), looped (it ends where it began), exact (it had no curves)}; null when there are several subpaths,
   or drawing after a Z (that starts another one) */
export function flatten(segs, tol) {
  if (segs.filter(s => s.t === 'M').length !== 1 || segs[0].t !== 'M') return null;
  const info = segInfo(segs), pts = [];
  let closed = false, exact = true;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], from = info[i].from, to = s.pts.at(-1);
    if (s.t === 'M') { pts.push([...to]); continue; }
    if (s.t === 'Z') { closed = true; continue; }
    if (closed) return null;
    if (s.t === 'L') { pts.push([...to]); continue; }
    exact = false;
    if (s.t === 'Q' || s.t === 'C') {
      const P = [from, ...s.pts];
      let m = 0; for (let k = 0; k + 2 < P.length; k++) m = Math.max(m, Math.hypot(P[k][0] - 2 * P[k + 1][0] + P[k + 2][0], P[k][1] - 2 * P[k + 1][1] + P[k + 2][1]));
      const n = Math.max(1, Math.ceil(Math.sqrt((s.t === 'Q' ? .25 : .75) * m / tol)));   // error of n equal steps <= d(d-1)/8 * m / n^2
      for (let j = 1; j < n; j++) pts.push(dc(P, j / n));
    } else {
      const g = arcGeom(from, to, ...s.arc);
      if (g) {
        const r = Math.max(g.rx, g.ry), step = Math.min(2 * Math.acos(Math.max(-1, 1 - Math.min(1, tol / r))), Math.PI / 2), n = Math.max(1, Math.ceil(Math.abs(g.dth) / step));
        for (let j = 1; j < n; j++) pts.push(g.pt(g.th1 + g.dth * j / n));
      }
    }
    pts.push([...to]);
  }
  const looped = pts.length > 2 && near(pts[0][0], pts.at(-1)[0], 1e-9) && near(pts[0][1], pts.at(-1)[1], 1e-9);
  return { pts, closed, looped, exact };
}

/* ---- recognising shapes in a path ---- */
/* a path that is an axis-aligned rectangle -> {x, y, w, h}, else null */
export function detectRect(segs) {
  const f = flatten(segs, 1);
  if (!f || !f.exact || !(f.closed || f.looped)) return null;
  const pts = f.looped ? f.pts.slice(0, -1) : f.pts;
  if (pts.length !== 4) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!(x1 - x0 > 0 && y1 - y0 > 0)) return null;
  const bits = pts.map(p => [near(p[0], x0, 1e-9) ? 0 : near(p[0], x1, 1e-9) ? 1 : -1, near(p[1], y0, 1e-9) ? 0 : near(p[1], y1, 1e-9) ? 1 : -1]);
  if (bits.some(b => b[0] < 0 || b[1] < 0) || new Set(bits.map(b => b.join())).size !== 4) return null;
  for (let i = 0; i < 4; i++) { const a = bits[i], b = bits[(i + 1) % 4]; if ((a[0] !== b[0]) === (a[1] !== b[1])) return null; }   // each edge runs along one side
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/* a path made only of arcs that go once round one ellipse (axis-aligned, or a circle) -> {cx, cy, rx, ry}, else null */
export function detectEllipse(segs) {
  const info = segInfo(segs);
  let c = null, tot = 0, dir = 0, arcs = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.t === 'M') { if (i) return null; continue; }
    if (s.t === 'Z') continue;
    if (s.t !== 'A' || !info[i].from) return null;
    const g = arcGeom(info[i].from, info[i].to, ...s.arc); if (!g) return null;
    let rx = g.rx, ry = g.ry;
    if (Math.abs(Math.sin(g.phi)) < 1e-6) { /* as is */ } else if (Math.abs(Math.cos(g.phi)) < 1e-6) [rx, ry] = [ry, rx];
    else if (Math.abs(rx - ry) < SLOP) ry = rx; else return null;
    const e = { cx: g.cx, cy: g.cy, rx, ry };
    if (c && !(near(c.cx, e.cx, SLOP) && near(c.cy, e.cy, SLOP) && near(c.rx, e.rx, SLOP) && near(c.ry, e.ry, SLOP))) return null;
    c = c || e;
    const sg = Math.sign(g.dth); if (dir && sg !== dir) return null; dir = sg;
    tot += Math.abs(g.dth); arcs++;
  }
  return arcs >= 2 && Math.abs(tot - 2 * Math.PI) < 5e-3 ? c : null;
}

/* ---- the conversion ---- */
const res = (tag, attrs, exact) => ({ tag, attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'number' ? String(rnd(v)) : v])), exact: !!exact });
const rectRes = (x, y, w, h, rx, ry, exact) => res('rect', { x, y, width: w, height: h, rx: rx > 0 ? rx : undefined, ry: rx > 0 && !near(rx, ry, 5e-4) ? ry : undefined }, exact);   // rx alone sets both
const ellRes = (e, exact) => res('ellipse', { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry }, exact);
const circRes = (e, exact) => res('circle', { cx: e.cx, cy: e.cy, r: Math.sqrt(e.rx * e.ry) }, exact && near(e.rx, e.ry, SLOP));   // equal area as the ellipse
const prim = g => g.t === 'rect' || g.t === 'circle' || g.t === 'ellipse';

export function convertShape(tag, get, to, opts = {}) {
  if (tag === to || !KINDS.includes(to)) return null;
  const g = readShape(tag, get); if (!g) return null;
  if (to === 'path') { const s = toSegs(g, opts); return s && res('path', { d: serPath(s) }, true); }
  if (g.t === 'line' && to !== 'polyline') return null;                  // a line has no area to wrap a shape around
  const segs = toSegs(g, { ...opts, arcs: true }), box = pathBox(segs);
  if (!box) return null;
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
  if (to === 'rect' || to === 'ellipse' || to === 'circle') {
    if (!(w > 0 && h > 0)) return null;
    const bb = { cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2 };
    if (to === 'rect') {
      if (g.t === 'circle' || g.t === 'ellipse') return rectRes(x0, y0, w, h, bb.rx, bb.ry, true);   // a fully rounded rect IS an ellipse
      const r = detectRect(segs); if (r) return rectRes(r.x, r.y, r.w, r.h, 0, 0, true);
      return rectRes(x0, y0, w, h, 0, 0, false);
    }
    if (g.t === 'circle') return to === 'ellipse' ? ellRes({ cx: g.cx, cy: g.cy, rx: g.r, ry: g.r }, true) : null;
    if (g.t === 'ellipse') return circRes(g, true);
    if (g.t === 'rect') { const full = g.rx >= g.w / 2 - 1e-9 && g.ry >= g.h / 2 - 1e-9; return to === 'ellipse' ? ellRes(bb, full) : circRes(bb, full); }
    const e = detectEllipse(segs);
    return to === 'ellipse' ? ellRes(e || bb, !!e) : circRes(e || bb, !!e);
  }
  /* line / polygon / polyline: flatten the one outline */
  const bx = Math.hypot(w, h), f = flatten(segs, opts.tol > 0 ? opts.tol : Math.max(1e-3, bx * 5e-4));
  if (!f) return null;
  if (to === 'line') return f.pts.length === 2 && f.exact ? res('line', { x1: f.pts[0][0], y1: f.pts[0][1], x2: f.pts[1][0], y2: f.pts[1][1] }, true) : null;
  if (to === 'polygon') {
    const pts = f.looped ? f.pts.slice(0, -1) : f.pts;
    return pts.length >= 3 ? res('polygon', { points: fmt(pts) }, f.exact && (f.closed || f.looped)) : null;
  }
  const pts = f.closed && !f.looped ? [...f.pts, f.pts[0]] : f.pts;       // a closed outline keeps its closing edge as a last point
  return pts.length >= 2 ? res('polyline', { points: fmt(pts) }, f.exact) : null;
}

/* every conversion on offer for a shape: [{tag, label, exact}] */
export function convertible(tag, get, opts) {
  return KINDS.map(k => { const r = convertShape(tag, get, k, opts); return r && { tag: k, label: LABELS[k], exact: r.exact }; }).filter(Boolean);
}
