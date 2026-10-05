import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, arcGeom, split, dc } from '../../src/path-math.js';

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
