import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, nodeType, nodeHandles, handleLinks, dragHandle, setNodeType, healSmooth, fixSmooth, deleteNodes } from '../../src/path-math.js';

const P = parsePath, S = serPath;

test('S and T survive a parse / serialize round trip, written absolute', () => {
  assert.equal(S(P('M0 0 C10 0 20 10 30 10 S50 30 60 30 T 80 80')), 'M0 0 C10 0 20 10 30 10 S50 30 60 30 T80 80');
  assert.equal(S(P('M0 0 Q10 10 20 0 T40 0 T60 0')), 'M0 0 Q10 10 20 0 T40 0 T60 0');
  assert.equal(S(P('M0 0 c10 0 20 10 30 10 s20 20 30 20')), 'M0 0 C10 0 20 10 30 10 S50 30 60 30');
  assert.equal(P('M0 0 C1 1 2 2 3 3 S5 5 6 6')[2].sm, 1);
});
test('a flagged segment whose control point is no longer the reflection is written in full', () => {
  const s = P('M0 0 C10 0 20 10 30 10 S50 30 60 30');
  s[2].pts[0] = [41, 11];
  assert.equal(S(s), 'M0 0 C10 0 20 10 30 10 C41 11 50 30 60 30');
  healSmooth(s); assert.equal(s[2].sm, undefined);
});
test('nodeType: symmetric, smooth, corner, and none where a side has no curve', () => {
  const t = d => nodeType(P(d), 1);
  assert.equal(t('M0 0 C10 0 20 10 30 10 C40 10 50 0 60 0'), 'symmetric');
  assert.equal(t('M0 0 C10 0 20 10 30 10 C50 10 60 0 70 0'), 'smooth');
  assert.equal(t('M0 0 C10 0 20 10 30 10 C40 20 50 0 60 0'), 'corner');
  assert.equal(t('M0 0 C10 0 20 10 30 10 S 50 0 60 0'), 'symmetric');
  assert.equal(t('M0 0 C10 0 20 10 30 10 L 60 0'), null);
  assert.equal(nodeType(P('M0 0 C10 0 20 10 30 10'), 0), null);
});
test('a closed path whose last point sits on its start joins its last and first handles', () => {
  const s = P('M0 0 C0 10 10 20 20 20 C30 20 40 10 40 0 C40 -10 10 -10 0 0 Z');
  const h = nodeHandles(s, 0);
  assert.deepEqual([h.a, h.b], [{ i: 3, k: 1 }, { i: 1, k: 0 }]);
  assert.equal(nodeType(s, 0), 'corner');
  assert.deepEqual(nodeHandles(s, 3).b, { i: 1, k: 0 });
});
test('dragging a handle: a smooth node keeps the angle and the other length, a symmetric one mirrors, force overrides', () => {
  const base = 'M0 0 C10 0 20 10 30 10 C50 10 60 0 70 0';
  let s = P(base), L = handleLinks(s, 2, 0);       // the outgoing handle (50,10) of the smooth node (30,10)
  dragHandle(s, 2, 0, [30, 30], L, null);          // pull it straight down: the incoming handle swings straight up, length 10 kept
  assert.deepEqual(s[1].pts[1], [30, 0]);
  s = P(base); dragHandle(s, 2, 0, [30, 30], handleLinks(s, 2, 0), 'free');
  assert.deepEqual(s[1].pts[1], [20, 10]);          // alt: untouched
  s = P('M0 0 C10 0 20 10 30 10 C40 10 50 0 60 0');  // symmetric
  dragHandle(s, 2, 0, [35, 20], handleLinks(s, 2, 0), null);
  assert.deepEqual(s[1].pts[1], [25, 0]);
  s = P('M0 0 C10 0 20 10 30 10 C40 20 50 0 60 0'); // corner: shift makes it symmetric and flags the segment, so it is written as S
  dragHandle(s, 2, 0, [40, 20], handleLinks(s, 2, 0), 'sym'); fixSmooth(s);
  assert.equal(S(s), 'M0 0 C10 0 20 0 30 10 S50 0 60 0');   // incoming handle mirrored onto (20,0)
});
test('dragging the handle of an S segment mirrors the previous one and alt breaks it back to a C', () => {
  let s = P('M0 0 C10 0 20 10 30 10 S50 0 60 0');
  dragHandle(s, 2, 0, [40, 30], handleLinks(s, 2, 0), null); fixSmooth(s);
  assert.deepEqual(s[1].pts[1], [20, -10]); assert.equal(S(s), 'M0 0 C10 0 20 -10 30 10 S50 0 60 0');
  s = P('M0 0 C10 0 20 10 30 10 S50 0 60 0');
  dragHandle(s, 2, 0, [40, 30], handleLinks(s, 2, 0), 'free'); fixSmooth(s);
  assert.equal(S(s), 'M0 0 C10 0 20 10 30 10 C40 30 50 0 60 0');
});
test('fixSmooth cascades down a chain of T segments', () => {
  const q = P('M0 0 Q10 10 20 0 T40 0 T60 0');
  q[1].pts[0] = [30, -20];                 // move the head's control point: each T after it follows
  fixSmooth(q);
  assert.deepEqual(q[2].pts[0], [10, 20]); // the head's control reflected through (20,0)
  assert.deepEqual(q[3].pts[0], [70, -20]); // and that one reflected through (40,0)
});
test('setNodeType: symmetric flags S, smooth swings the outgoing handle, corner drops the S', () => {
  const s = P('M0 0 C10 0 20 10 30 10 C50 20 60 0 70 0');
  assert.equal(nodeType(s, 1), 'corner');
  assert.equal(S(setNodeType(s, 1, 'symmetric')), 'M0 0 C10 0 20 10 30 10 S60 0 70 0');
  const sm = setNodeType(s, 1, 'smooth');
  assert.equal(nodeType(sm, 1), 'smooth'); assert.equal(Math.hypot(sm[2].pts[0][0] - 30, sm[2].pts[0][1] - 10).toFixed(3), Math.hypot(20, 10).toFixed(3));
  const sym = setNodeType(s, 1, 'symmetric');
  assert.equal(S(setNodeType(sym, 1, 'corner')), 'M0 0 C10 0 20 10 30 10 C40 10 60 0 70 0');
  assert.equal(setNodeType(P('M0 0 C10 0 20 10 30 10 L 60 0'), 1, 'smooth'), null);
});
test('deleting a node ahead of an S leaves it written in full, with its shape intact', () => {
  const s = P('M0 0 L5 5 C10 0 20 10 30 10 S50 0 60 0');
  const r = deleteNodes(s, [1]);
  assert.match(S(r), /^M0 0 C/);
  healSmooth(r); assert.ok(r.every(q => !q.sm || q.t !== 'C' || r[r.indexOf(q) - 1].t === 'C'));
});
