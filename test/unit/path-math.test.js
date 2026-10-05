import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, arcGeom, arcFit, split, dc } from '../../src/path-math.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('parsePath: relative commands become absolute', () => {
  const s = parsePath('M10 10 l 5 5');
  assert.deepEqual(s[1], { t: 'L', pts: [[15, 15]] });
});
test('parsePath: implicit lineto after M, H/V become L', () => {
  const s = parsePath('M0 0 10 10 H 20 V 30');
  assert.deepEqual(s.map(q => q.t), ['M', 'L', 'L', 'L']);
  assert.deepEqual(s[3].pts[0], [20, 30]);
});
test('parsePath: S reflects the previous cubic control point', () => {
  const s = parsePath('M0 0 C 0 10, 10 10, 10 0 S 20 -10, 20 0');
  assert.equal(s[2].t, 'C');
  assert.deepEqual(s[2].pts[0], [10, -10]);
});
test('parsePath: compact number formats', () => {
  const s = parsePath('M.5-.5L1e1 2E-1');
  assert.deepEqual(s[0].pts[0], [0.5, -0.5]);
  assert.deepEqual(s[1].pts[0], [10, 0.2]);
});
test('parsePath: Z returns current point to subpath start', () => {
  const s = parsePath('M5 5 L 10 5 Z l 1 1');
  assert.deepEqual(s.at(-1).pts[0], [6, 6]);
});
test('parsePath: empty or garbage input yields no segments', () => {
  assert.deepEqual(parsePath(''), []);
});

test('split: de Casteljau halves meet at the curve point', () => {
  const cp = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const [L, R] = split(cp, 0.5), mid = dc(cp, 0.5);
  assert.deepEqual(L.at(-1), mid);
  assert.deepEqual(R[0], mid);
  assert.deepEqual(L[0], cp[0]);
  assert.deepEqual(R.at(-1), cp[3]);
});

test('arcGeom: semicircle has centre at chord midpoint', () => {
  const g = arcGeom([0, 0], [10, 0], 5, 5, 0, 0, 1);
  close(g.cx, 5); close(g.cy, 0); close(g.rx, 5);
});
test('arcGeom: too-small radii are scaled up to fit', () => {
  const g = arcGeom([0, 0], [10, 0], 1, 1, 0, 0, 1);
  close(g.rx, 5); close(g.ry, 5);
});
test('arcGeom: degenerate arcs return null', () => {
  assert.equal(arcGeom([0, 0], [0, 0], 5, 5, 0, 0, 1), null);
  assert.equal(arcGeom([0, 0], [10, 0], 0, 5, 0, 0, 1), null);
});

/* arcFit: each handle changes only its own parameter, and the handle ends up under the pointer. */
const P = [30, 140], E = [150, 120], GAP = 10, BASE = [80, 50, 20, 0, 1];
const handleX = q => [q.cx + (q.rx + GAP) * q.c, q.cy + (q.rx + GAP) * q.s];
const handleY = q => [q.cx - (q.ry + GAP) * q.s, q.cy + (q.ry + GAP) * q.c];

test('arcFit rx: recovers a reachable target and leaves ry/rotation/flags alone', () => {
  for (const rx of [70, 90, 200]) {
    const r = arcFit(P, E, BASE, 'rx', handleX(arcGeom(P, E, rx, 50, 20, 0, 1)), { gap: GAP });
    close(r[0], rx, 1e-2); assert.deepEqual(r.slice(2), [20, 0, 1]);
    close(r[1], arcGeom(P, E, ...BASE).ry, 1e-2);
  }
});
test('arcFit ry: recovers a reachable target and leaves rx/rotation/flags alone', () => {
  for (const ry of [45, 90, 300]) {
    const r = arcFit(P, E, BASE, 'ry', handleY(arcGeom(P, E, 80, ry, 20, 0, 1)), { gap: GAP });
    close(r[1], ry, 1e-2); assert.deepEqual(r.slice(2), [20, 0, 1]);
  }
});
test('arcFit rot: changes rotation only, handle direction matches the pointer', () => {
  const q = arcGeom(P, E, ...BASE);
  for (const deg of [0, 45, 90, -120]) {
    const p = [q.cx + 110 * Math.cos(deg * Math.PI / 180), q.cy + 110 * Math.sin(deg * Math.PI / 180)];
    const r = arcFit(P, E, BASE, 'rot', p), q2 = arcGeom(P, E, ...r);
    assert.equal(r[0], +q.rx.toFixed(3)); assert.equal(r[1], +q.ry.toFixed(3)); assert.deepEqual(r.slice(3), [0, 1]);
    const dx = p[0] - q2.cx, dy = p[1] - q2.cy, along = (dx * -q2.c + dy * -q2.s) / Math.hypot(dx, dy);
    close(along, 1, 1e-6);
  }
});
test('arcFit rot: shift snaps to 15 degrees', () => {
  const q = arcGeom(P, E, ...BASE), r = arcFit(P, E, BASE, 'rot', [q.cx - 100, q.cy - 30], { shift: true });
  assert.equal(r[2] % 15, 0);
});
test('arcFit rx/ry with shift makes the arc circular', () => {
  const r = arcFit(P, E, BASE, 'rx', [250, 120], { gap: GAP, shift: true });
  assert.equal(r[0], r[1]);
});
test('arcFit flip: only the flags change, and the pointer picks the side', () => {
  const r = arcFit(P, E, BASE, 'flip', [100, 200]);
  assert.deepEqual(r.slice(0, 3), [80, 50, 20]); assert.notDeepEqual(r.slice(3), [0, 1]);
  assert.deepEqual(arcFit(P, E, BASE, 'flip', arcGeom(P, E, ...BASE).pt(arcGeom(P, E, ...BASE).th1 + arcGeom(P, E, ...BASE).dth / 2)).slice(3), [0, 1]);
});
test('arcFit: degenerate arc is returned unchanged', () => {
  const a = [5, 5, 0, 0, 1];
  assert.equal(arcFit([0, 0], [0, 0], a, 'rx', [3, 3]), a);
});

/* Shrinking a radius below what spans the chord used to make the SVG spec inflate the other radius (semicircle + rx 0.1
   drew ry = 36000). arcFit now stops at the smallest radius that still fits. */
test('arcFit rx: semicircle cannot shrink below the half-chord, and nothing blows up', () => {
  const p = [30, 130], e = [150, 130], semi = [60, 60, 0, 0, 1];
  for (const x of [165, 160, 120, 90]) {
    const r = arcFit(p, e, semi, 'rx', [x, 130], { gap: 16 });
    assert.equal(r[0], 60); assert.equal(arcGeom(p, e, ...r).ry, 60);
  }
});
test('arcFit ry: a semicircle can still flatten (no floor when the chord lies on the x axis)', () => {
  const p = [30, 130], e = [150, 130], r = arcFit(p, e, [60, 60, 0, 0, 1], 'ry', [90, 130 + 16 + 20], { gap: 16 });
  close(r[1], 20, 1e-2); assert.equal(r[0], 60);
});
test('arcFit: the floor is exactly where the SVG clamp starts (never scales the drawn radii)', () => {
  for (const kind of ['rx', 'ry']) {
    const r = arcFit(P, E, BASE, kind, [q0().cx, q0().cy], { gap: GAP }), g = arcGeom(P, E, ...r);
    close(g.rx, r[0], 2e-3); close(g.ry, r[1], 2e-3);
  }
});
test('arcFit shift: circular floor is the half-chord', () => {
  const r = arcFit(P, E, BASE, 'rx', [q0().cx, q0().cy], { gap: GAP, shift: true });
  close(r[0], Math.hypot(E[0] - P[0], E[1] - P[1]) / 2, 2e-3); assert.equal(r[0], r[1]);
});
function q0() { return arcGeom(P, E, ...BASE); }