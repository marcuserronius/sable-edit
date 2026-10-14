import test from 'node:test';
import assert from 'node:assert/strict';
import { convertShape, convertible, readShape, toSegs, pathBox, flatten, detectRect, detectEllipse, KINDS } from '../../src/convert.js';
import { parsePath } from '../../src/path-math.js';

const g = a => k => (k in a ? String(a[k]) : null);
const conv = (tag, a, to, o) => convertShape(tag, g(a), to, o);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('readShape: sizes must be positive; one missing radius follows the other; a zero radius means sharp corners', () => {
  assert.equal(readShape('rect', g({ width: 0, height: 5 })), null);
  assert.equal(readShape('circle', g({ r: 0 })), null);
  assert.equal(readShape('ellipse', g({ rx: 5 })).ry, 5);
  assert.deepEqual(readShape('rect', g({ x: 1, y: 2, width: 40, height: 20, rx: 6 })), { t: 'rect', x: 1, y: 2, w: 40, h: 20, rx: 6, ry: 6 });
  assert.equal(readShape('rect', g({ width: 40, height: 20, rx: 6, ry: 0 })).rx, 0);
  assert.equal(readShape('rect', g({ width: 40, height: 20, rx: 100 })).rx, 20);       // clamped to half the width
  assert.equal(readShape('polygon', g({ points: '1,2' })), null);
  assert.equal(readShape('path', g({ d: 'M0 0' })), null);
});

test('to path: every shape, exactly; straight runs are H / V; arcs are quarter turns', () => {
  assert.equal(conv('rect', { x: 10, y: 20, width: 100, height: 80 }, 'path').attrs.d, 'M10 20 H110 V100 H10 Z');
  assert.equal(conv('circle', { cx: 50, cy: 50, r: 10 }, 'path').attrs.d, 'M60 50 A10 10 0 0 1 50 60 A10 10 0 0 1 40 50 A10 10 0 0 1 50 40 A10 10 0 0 1 60 50 Z');
  assert.equal(conv('ellipse', { cx: 0, cy: 0, rx: 30, ry: 10 }, 'path').attrs.d, 'M30 0 A30 10 0 0 1 0 10 A30 10 0 0 1 -30 0 A30 10 0 0 1 0 -10 A30 10 0 0 1 30 0 Z');
  assert.equal(conv('line', { x1: 0, y1: 0, x2: 10, y2: 5 }, 'path').attrs.d, 'M0 0 L10 5');
  assert.equal(conv('line', { x1: 0, y1: 4, x2: 10, y2: 4 }, 'path').attrs.d, 'M0 4 H10');
  assert.equal(conv('polygon', { points: '0,0 10,0 10,10' }, 'path').attrs.d, 'M0 0 H10 V10 Z');
  assert.equal(conv('polyline', { points: '0,0 10,0 15,9' }, 'path').attrs.d, 'M0 0 H10 L15 9');
  for (const t of ['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']) assert.equal(conv(t, { x1: 0, y1: 0, x2: 1, y2: 1, width: 4, height: 4, r: 3, rx: 3, ry: 2, points: '0,0 4,0 4,4' }, 'path').exact, true);
});

test('to path: a rounded rect gets its corners as arcs; fully round sides have no zero-length lines', () => {
  assert.equal(conv('rect', { x: 0, y: 0, width: 100, height: 60, rx: 10, ry: 5 }, 'path').attrs.d,
    'M10 0 H90 A10 5 0 0 1 100 5 V55 A10 5 0 0 1 90 60 H10 A10 5 0 0 1 0 55 V5 A10 5 0 0 1 10 0 Z');
  assert.equal(conv('rect', { x: 0, y: 0, width: 20, height: 20, rx: 10 }, 'path').attrs.d,
    'M10 0 A10 10 0 0 1 20 10 A10 10 0 0 1 10 20 A10 10 0 0 1 0 10 A10 10 0 0 1 10 0 Z');
  assert.equal(conv('rect', { x: 0, y: 0, width: 100, height: 60 }, 'path').exact, true);
});

test('to path with arcs:false: cubic beziers within a hair of the circle', () => {
  const d = conv('circle', { cx: 0, cy: 0, r: 100 }, 'path', { arcs: false }).attrs.d;
  assert.ok(!d.includes('A') && d.includes('C'));
  const segs = parsePath(d), c = segs.filter(s => s.t === 'C');
  assert.ok(c.length >= 4);
  for (const s of c) near(Math.hypot(...s.pts.at(-1)), 100, 1e-2);                    // every end point is on the circle
  const mid = pathBox(segs); near(mid[0], -100, 1e-2); near(mid[3], 100, 1e-2);
});

test('pathBox: curve extremes, not control points; arcs by their sweep', () => {
  const b = pathBox(parsePath('M0 0 C0 100 100 100 100 0'));                            // a hump: peak at y = 75
  near(b[1], 0); near(b[3], 75); near(b[0], 0); near(b[2], 100);
  const q = pathBox(parsePath('M0 0 Q50 100 100 0')); near(q[3], 50);
  const half = pathBox(parsePath('M0 0 A50 50 0 0 1 100 0'));                          // the upper half (clockwise from the left, sweep 1)
  near(half[1], -50); near(half[3], 0);
  const full = pathBox(toSegs({ t: 'ellipse', cx: 10, cy: 20, rx: 30, ry: 5 })); [-20, 15, 40, 25].forEach((v, i) => near(full[i], v));
  const rot = pathBox(parsePath('M 0 0 A 40 10 90 1 1 0 20'));                         // rotated 90 degrees: its x extent is the small radius
  assert.ok(rot[2] - rot[0] <= 20 + 1e-6);
});

test('ellipse / circle / rect <-> each other', () => {
  let r = conv('circle', { cx: 50, cy: 40, r: 10 }, 'ellipse'); assert.deepEqual(r.attrs, { cx: '50', cy: '40', rx: '10', ry: '10' }); assert.equal(r.exact, true);
  r = conv('circle', { cx: 50, cy: 40, r: 10 }, 'rect'); assert.deepEqual(r.attrs, { x: '40', y: '30', width: '20', height: '20', rx: '10' }); assert.equal(r.exact, true);   // rx alone: ry follows
  r = conv('ellipse', { cx: 50, cy: 40, rx: 30, ry: 10 }, 'rect'); assert.deepEqual(r.attrs, { x: '20', y: '30', width: '60', height: '20', rx: '30', ry: '10' }); assert.equal(r.exact, true);
  r = conv('ellipse', { cx: 0, cy: 0, rx: 40, ry: 10 }, 'circle'); assert.equal(+r.attrs.r, 20); assert.equal(r.exact, false);   // sqrt(40 * 10): the area is kept
  r = conv('ellipse', { cx: 0, cy: 0, rx: 7, ry: 7 }, 'circle'); assert.equal(r.exact, true);
  r = conv('rect', { x: 0, y: 0, width: 60, height: 20 }, 'ellipse'); assert.deepEqual(r.attrs, { cx: '30', cy: '10', rx: '30', ry: '10' }); assert.equal(r.exact, false);
  r = conv('rect', { x: 0, y: 0, width: 60, height: 20, rx: 30, ry: 10 }, 'ellipse'); assert.equal(r.exact, true);              // fully round IS an ellipse
  r = conv('rect', { x: 0, y: 0, width: 60, height: 20, rx: 30 }, 'ellipse'); assert.equal(r.exact, true);                      // ry follows rx, then clamps to 10
  r = conv('rect', { x: 0, y: 0, width: 60, height: 20, rx: 5 }, 'ellipse'); assert.equal(r.exact, false);
  r = conv('rect', { x: 0, y: 0, width: 20, height: 20, rx: 10 }, 'circle'); assert.deepEqual(r.attrs, { cx: '10', cy: '10', r: '10' }); assert.equal(r.exact, true);
  r = conv('rect', { x: 0, y: 0, width: 20, height: 20 }, 'circle'); assert.equal(r.attrs.r, '10'); assert.equal(r.exact, false);   // a square's circle is inscribed, still a different outline
  r = conv('rect', { x: 0, y: 0, width: 100, height: 25 }, 'circle'); near(+r.attrs.r, Math.sqrt(50 * 12.5), 1e-3);
});

test('round trips: circle / ellipse / rect through a path come back exactly', () => {
  let d = conv('circle', { cx: 50, cy: 40, r: 10 }, 'path').attrs.d, r = conv('path', { d }, 'circle');
  assert.deepEqual(r.attrs, { cx: '50', cy: '40', r: '10' }); assert.equal(r.exact, true);
  d = conv('ellipse', { cx: 5, cy: -4, rx: 30, ry: 12 }, 'path').attrs.d; r = conv('path', { d }, 'ellipse');
  assert.deepEqual(r.attrs, { cx: '5', cy: '-4', rx: '30', ry: '12' }); assert.equal(r.exact, true);
  assert.equal(conv('path', { d }, 'circle').exact, false);                              // not round: same centre, area-equal radius
  d = conv('rect', { x: 3, y: 4, width: 50, height: 20 }, 'path').attrs.d; r = conv('path', { d }, 'rect');
  assert.deepEqual(r.attrs, { x: '3', y: '4', width: '50', height: '20' }); assert.equal(r.exact, true);
  const rounded = conv('rect', { x: 3, y: 4, width: 50, height: 20, rx: 4 }, 'path').attrs.d;
  r = conv('path', { d: rounded }, 'rect'); assert.equal(r.exact, false); assert.equal(r.attrs.width, '50');                // the bounding box
  r = conv('polygon', { points: '0,0 10,0 10,5 0,5' }, 'rect'); assert.equal(r.exact, true);
  r = conv('polyline', { points: '0,0 10,0 10,5 0,5 0,0' }, 'rect'); assert.equal(r.exact, true);
  r = conv('polygon', { points: '0,0 10,0 10,5 0,5' }, 'rect'); assert.deepEqual(r.attrs, { x: '0', y: '0', width: '10', height: '5' });
});

test('recognising: survives the 3-decimal rounding a path goes through, and tells a tilted square or a half circle from the real thing', () => {
  assert.ok(detectEllipse(parsePath('M60.0004 50 A10 10 0 0 1 50 60.0004 A10 10 0 0 1 39.9996 50 A10 10 0 0 1 50 40 A10 10 0 0 1 60 50 Z')));
  assert.equal(detectEllipse(parsePath('M60 50 A10 10 0 0 1 40 50 Z')), null);                      // a half turn is not an ellipse
  assert.equal(detectEllipse(parsePath('M0 0 A10 10 0 0 1 10 10 A5 5 0 0 1 0 0')), null);           // different arcs
  assert.equal(detectRect(parsePath('M0 5 L5 0 L10 5 L5 10 Z')), null);                            // a diamond: 4 points, not axis-aligned
  assert.equal(detectRect(parsePath('M0 0 H10 V10 H0 V5 Z')), null);                               // five points
  assert.equal(detectRect(parsePath('M0 0 H10 L0 10 H10 Z')), null);                               // a bow tie
});

test('bounding-box approximations of other shapes: rect / ellipse / circle', () => {
  const tri = { points: '0,0 40,0 20,30' };
  let r = conv('polygon', tri, 'rect'); assert.deepEqual(r.attrs, { x: '0', y: '0', width: '40', height: '30' }); assert.equal(r.exact, false);
  r = conv('polygon', tri, 'ellipse'); assert.deepEqual(r.attrs, { cx: '20', cy: '15', rx: '20', ry: '15' }); assert.equal(r.exact, false);
  r = conv('polygon', tri, 'circle'); near(+r.attrs.r, Math.sqrt(20 * 15), 1e-3);
  r = conv('path', { d: 'M0 0 C0 100 100 100 100 0' }, 'rect'); assert.equal(r.attrs.height, '75');   // the curve's extent, not its control points
  assert.equal(conv('polyline', { points: '0,0 10,0' }, 'rect'), null);                             // no height: nothing to wrap
  assert.equal(conv('line', { x1: 0, y1: 0, x2: 9, y2: 9 }, 'rect'), null);
  assert.equal(conv('line', { x1: 0, y1: 0, x2: 9, y2: 9 }, 'ellipse'), null);
});

test('polygon <-> polyline: a closed outline keeps its closing edge as a last point', () => {
  let r = conv('polygon', { points: '0,0 10,0 10,10' }, 'polyline'); assert.equal(r.attrs.points, '0,0 10,0 10,10 0,0'); assert.equal(r.exact, true);
  r = conv('polyline', { points: '0,0 10,0 10,10 0,0' }, 'polygon'); assert.equal(r.attrs.points, '0,0 10,0 10,10'); assert.equal(r.exact, true);   // it already came back: no extra edge
  r = conv('polyline', { points: '0,0 10,0 10,10' }, 'polygon'); assert.equal(r.attrs.points, '0,0 10,0 10,10'); assert.equal(r.exact, false);       // an open one is closed
  assert.equal(conv('polyline', { points: '0,0 10,0' }, 'polygon'), null);                         // two points are not a polygon
});

test('path -> polygon / polyline: straight paths are exact, curves are flattened within the tolerance', () => {
  let r = conv('path', { d: 'M0 0 H10 V10 Z' }, 'polygon'); assert.equal(r.attrs.points, '0,0 10,0 10,10'); assert.equal(r.exact, true);
  r = conv('path', { d: 'M0 0 H10 V10 Z' }, 'polyline'); assert.equal(r.attrs.points, '0,0 10,0 10,10 0,0'); assert.equal(r.exact, true);
  r = conv('path', { d: 'M0 0 H10 V10 H0 L0 0' }, 'polygon'); assert.equal(r.attrs.points, '0,0 10,0 10,10 0,10'); assert.equal(r.exact, true);   // ends where it began, no Z
  r = conv('path', { d: 'M0 0 L10 0 L10 10' }, 'polygon'); assert.equal(r.exact, false);          // open -> the polygon adds an edge
  assert.equal(conv('path', { d: 'M0 0 L10 0 M20 20 L30 30' }, 'polygon'), null);                 // two subpaths: they would not fit
  assert.equal(conv('path', { d: 'M0 0 L10 0 Z L5 5' }, 'polyline'), null);                         // drawing after the Z starts another
  const tol = 0.05;
  r = conv('circle', { cx: 0, cy: 0, r: 100 }, 'polygon', { tol }); assert.equal(r.exact, false);
  const pts = r.attrs.points.split(' ').map(s => s.split(',').map(Number));
  assert.ok(pts.length > 20 && pts.length < 400);
  for (const p of pts) near(Math.hypot(...p), 100, 1e-3);                                          // vertices are on the circle...
  for (let i = 0; i < pts.length; i++) {                                                           // ...and no edge sags further than the tolerance
    const a = pts[i], b = pts[(i + 1) % pts.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.ok(100 - Math.hypot(...m) <= tol + 1e-3, `edge ${i} sags ${100 - Math.hypot(...m)}`);
  }
  const bez = flatten(parsePath('M0 0 C0 100 100 100 100 0'), 0.1);
  assert.equal(bez.exact, false); assert.ok(bez.pts.length > 4);
  assert.equal(conv('rect', { x: 0, y: 0, width: 10, height: 5 }, 'polygon').exact, true);        // sharp corners: nothing to flatten
  assert.equal(conv('rect', { x: 0, y: 0, width: 10, height: 5, rx: 2 }, 'polygon').exact, false);
});

test('to line: only what already is one straight segment', () => {
  let r = conv('path', { d: 'M1 2 L11 7' }, 'line'); assert.deepEqual(r.attrs, { x1: '1', y1: '2', x2: '11', y2: '7' }); assert.equal(r.exact, true);
  r = conv('polyline', { points: '1,2 11,7' }, 'line'); assert.equal(r.exact, true);
  assert.equal(conv('polyline', { points: '1,2 11,7 20,0' }, 'line'), null);
  assert.equal(conv('path', { d: 'M1 2 Q5 9 11 7' }, 'line'), null);
  assert.equal(conv('rect', { width: 5, height: 5 }, 'line'), null);
  assert.equal(conv('circle', { r: 5 }, 'line'), null);
});

test('convertible lists what is on offer; a shape with no geometry offers nothing; the tag itself is never offered', () => {
  const t = (tag, a) => convertible(tag, g(a)).map(x => x.tag);
  assert.deepEqual(t('line', { x1: 0, y1: 0, x2: 5, y2: 5 }), ['path', 'polyline']);
  assert.deepEqual(t('circle', { r: 5 }), ['path', 'rect', 'ellipse', 'polygon', 'polyline']);
  assert.deepEqual(t('rect', { width: 5, height: 5 }), ['path', 'circle', 'ellipse', 'polygon', 'polyline']);
  assert.deepEqual(t('polygon', { points: '0,0 9,0 9,9' }), ['path', 'rect', 'circle', 'ellipse', 'polyline']);
  assert.deepEqual(t('rect', { width: 0, height: 5 }), []);
  assert.equal(conv('rect', { width: 5, height: 5 }, 'rect'), null);
  assert.equal(conv('rect', { width: 5, height: 5 }, 'text'), null);
  assert.ok(KINDS.every(k => convertible(k, g({ width: 4, height: 4, r: 2, rx: 2, ry: 2, x1: 0, y1: 0, x2: 4, y2: 4, points: '0,0 4,0 4,4', d: 'M0 0 L4 0 L4 4 Z' })).every(c => c.tag !== k)));
});

test('every conversion keeps the shape where it was: the box of the result matches the box of the source (exact ones)', () => {
  const src = {
    rect: { x: 10, y: 20, width: 60, height: 30, rx: 8 }, circle: { cx: 5, cy: 6, r: 12 }, ellipse: { cx: -3, cy: 9, rx: 25, ry: 7 },
    line: { x1: 3, y1: 4, x2: 30, y2: 12 }, polygon: { points: '0,0 40,5 30,40 -5,30' }, polyline: { points: '0,0 40,5 30,40' },
  };
  for (const [tag, a] of Object.entries(src)) {
    const p = conv(tag, a, 'path'), b0 = pathBox(parsePath(p.attrs.d));
    for (const k of convertible(tag, g(a)).filter(c => c.exact).map(c => c.tag)) {
      const r = conv(tag, a, k), segs = toSegs(readShape(k, g(r.attrs))), b1 = pathBox(segs);
      b0.forEach((v, i) => near(v, b1[i], 2e-3));
    }
  }
});
