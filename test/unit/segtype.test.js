import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, retype, convertSegment, convertSegments, deleteNodes, segInfo, dc, arcGeom } from '../../src/path-math.js';

const P = parsePath, S = serPath;

test('H and V stay H and V through a parse / serialize round trip, but only while they still are', () => {
  assert.equal(S(P('M0 0 H10 V10 L5 5 h-5 v-5')), 'M0 0 H10 V10 L5 5 H0 V0');
  const s = P('M0 0 H10 V10'); s[1].pts[0] = [10, 3];                 // an H that is no longer horizontal
  assert.equal(S(s), 'M0 0 L10 3 V10');
});
test('retype: only dirty lines are re-decided (H, V or L), the rest keep their command', () => {
  const s = P('M0 0 L10 0 L10 10 L20 25');                            // authored as L: stays L until it is touched
  assert.equal(S(s), 'M0 0 L10 0 L10 10 L20 25');
  s[1].dirty = 1; s[2].dirty = 1; s[3].dirty = 1; retype(s);
  assert.equal(S(s), 'M0 0 H10 V10 L20 25');
  assert.ok(s.every(q => !q.dirty));
  const t = P('M0 0 H10'); t[1].pts[0] = [10, 4]; t[1].dirty = 1; retype(t);
  assert.equal(S(t), 'M0 0 L10 4');
});
test('deleting a node marks the line that now starts elsewhere dirty', () => {
  const r = deleteNodes(P('M0 0 L10 0 L10 10 L0 10'), [1]);
  assert.equal(r[1].dirty, 1);
  assert.equal(S(retype(r)), 'M0 0 L10 10 L0 10');                    // the touched line is re-decided (still diagonal); the untouched one keeps its L
});
test('line -> quadratic / cubic: straight curves, controls at the middle / the thirds', () => {
  assert.equal(S(convertSegments(P('M0 0 L9 0'), [1], 'Q').segs), 'M0 0 Q4.5 0 9 0');
  assert.equal(S(convertSegments(P('M0 0 L9 0'), [1], 'C').segs), 'M0 0 C3 0 6 0 9 0');
});
test('quadratic -> cubic is exact; cubic -> quadratic recovers an elevated quadratic', () => {
  const q = P('M0 0 Q5 10 10 0'), c = convertSegments(q, [1], 'C').segs;
  for (const t of [0.1, 0.3, 0.5, 0.8]) {
    const a = dc([[0, 0], [5, 10], [10, 0]], t), b = dc([[0, 0], ...c[1].pts], t);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9);
  }
  assert.equal(S(convertSegments(c, [1], 'Q').segs), 'M0 0 Q5 10 10 0');
});
test('anything -> line keeps the end point', () => {
  assert.equal(S(convertSegments(P('M0 0 C1 5 2 5 10 0'), [1], 'L').segs), 'M0 0 L10 0');
  assert.equal(S(retype(convertSegments(P('M0 0 A5 5 0 0 1 10 0'), [1], 'L').segs)), 'M0 0 H10');   // a converted segment is dirty, so it picks H
});
test('arc -> cubic / quadratic stays on the circle, splitting a half turn into pieces', () => {
  const arc = P('M10 0 A10 10 0 0 1 -10 0');
  for (const [type, n, tol] of [['C', 2, 0.01], ['Q', 4, 0.2]]) {
    const r = convertSegments(arc, [1], type).segs; assert.equal(r.length, n + 1);
    let from = [10, 0];
    for (const q of r.slice(1)) {
      for (const t of [0.25, 0.5, 0.75]) { const p = dc([from, ...q.pts], t); assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 10) < tol, `${type} off the circle: ${p}`) }
      from = q.pts.at(-1);
    }
  }
});
test('curve -> arc fits a circle through the middle of the curve; a quarter circle comes back as itself', () => {
  assert.equal(S(convertSegments(P('M10 0 C10 5.523 5.523 10 0 10'), [1], 'A').segs), 'M10 0 A10 10 0 0 1 0 10');
  const long = S(convertSegments(P('M10 0 C10 -20 -10 -20 -10 0'), [1], 'A').segs);   // bulges away: the other sweep
  assert.match(long, /A[\d. ]+ 0 \d 0 -10 0$/);
});
test('line -> arc: tangent to the segment before when there is one, else a one radian arc', () => {
  assert.equal(S(convertSegments(P('M0 0 L10 0 L20 10'), [2], 'A').segs), 'M0 0 L10 0 A10 10 0 0 1 20 10');
  const g = arcGeom([0, 0], [10, 0], ...convertSegments(P('M0 0 L10 0'), [1], 'A').segs[1].arc);
  assert.ok(Math.abs(Math.abs(g.dth) - 1) < 1e-3);
});
test('convertSegments: selection follows, same type is left alone, M and Z are never converted', () => {
  const s = P('M0 0 L10 0 L10 10 Z');
  assert.equal(convertSegments(s, [1, 2], 'L'), null);
  assert.equal(convertSegments(s, [0, 3], 'C'), null);
  const r = convertSegments(P('M10 0 A10 10 0 0 1 -10 0 L-10 10'), [1, 2], 'C');
  assert.deepEqual(r.sel, [1, 2, 3]);
  assert.ok(r.segs.slice(1).every(q => q.t === 'C' && q.dirty));
});
test('converting the segment before an S writes the S out in full', () => {
  const r = convertSegments(P('M0 0 C1 5 2 5 10 0 S 20 -5 30 0'), [1], 'L');
  assert.equal(S(r.segs), 'M0 0 L10 0 C18 -5 20 -5 30 0');             // the S keeps the shape it had, written as a C
});
