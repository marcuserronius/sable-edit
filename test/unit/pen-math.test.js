import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, arcGeom, retype } from '../../src/path-math.js';
import { subOf, endKind, reverseSub, penNode, canClose, closeSub } from '../../src/pen-math.js';
import { Tools } from '../../src/tools.js';
import '../../src/tools/path.js';

const P = d => parsePath(d), D = s => serPath(retype(s));

test('subOf / endKind: endpoints of open subpaths only', () => {
  const s = P('M0 0 L10 0 L10 10 M20 20 L30 30 Z M40 40');
  assert.deepEqual(subOf(s, 1), { m: 0, last: 2, closed: false });
  assert.deepEqual(subOf(s, 4), { m: 3, last: 4, closed: true });
  assert.equal(endKind(s, 0), 'start'); assert.equal(endKind(s, 2), 'end'); assert.equal(endKind(s, 1), null);
  assert.equal(endKind(s, 3), null); assert.equal(endKind(s, 4), null);   // closed: no endpoints
  assert.equal(endKind(s, 6), 'lone'); assert.equal(endKind(s, 5), null);  // 5 is the Z
});

test('reverseSub: lines, cubics, quadratics and arcs run backwards; twice is the identity', () => {
  const d = 'M0 0 L10 0 C10 5 15 10 20 10 Q25 10 30 5 A5 6 30 0 1 40 5';
  const r = reverseSub(P(d), 0);
  assert.equal(D(r.segs), 'M40 5 A5 6 30 0 0 30 5 Q25 10 20 10 C15 10 10 5 10 0 H0');
  assert.equal(D(reverseSub(r.segs, 0).segs), 'M0 0 H10 C10 5 15 10 20 10 Q25 10 30 5 A5 6 30 0 1 40 5');
  assert.equal(r.map(0), 4); assert.equal(r.map(4), 0); assert.equal(r.map(2), 2);
});

test('reverseSub: only the named subpath moves; a closed one is refused; the S / T flag follows its node', () => {
  const s = P('M0 0 L5 5 M10 10 L20 10 L20 20');
  assert.equal(D(reverseSub(s, 2).segs), 'M0 0 L5 5 M20 20 V10 H10');
  assert.equal(reverseSub(P('M0 0 L5 5 L9 0 Z'), 0), null);
  const t = P('M0 0 C0 5 5 10 10 10 S20 15 20 20');       // symmetric node at (10,10)
  assert.ok(t[2].sm);
  const r = reverseSub(t, 0);
  assert.equal(D(r.segs), 'M20 20 C20 15 15 10 10 10 S0 5 0 0');
});

test('penNode: a click is a line, a pending handle or a drag makes a curve; the node becomes symmetric (S form on the next one)', () => {
  let s = P('M0 0');
  let r = penNode(s, 0, [10, 0]);
  assert.equal(D(r.segs), 'M0 0 H10'); assert.equal(r.idx, 1); assert.equal(r.out, null);
  r = penNode(s, 0, [10, 0], { drag: [14, 4] });                 // press-drag: incoming control mirrors the drag about the new node
  assert.equal(D(r.segs), 'M0 0 C0 0 6 -4 10 0');
  assert.deepEqual(r.out, { pt: [14, 4], sym: true });
  const r2 = penNode(r.segs, 1, [20, 0], { out: r.out });        // next click continues the curve; its first control is the mirror: S
  assert.equal(D(r2.segs), 'M0 0 C0 0 6 -4 10 0 S20 0 20 0');
  assert.equal(r2.out, null);
});

test('penNode: Alt breaks the node (incoming stays put, only the outgoing handle is pulled); a pending broken handle is a plain C control', () => {
  const s = P('M0 0');
  const r = penNode(s, 0, [10, 0], { drag: [14, 4], alt: true });
  assert.equal(D(r.segs), 'M0 0 H10');                           // nothing to curve yet
  assert.deepEqual(r.out, { pt: [14, 4], sym: false });
  const r2 = penNode(r.segs, 1, [20, 0], { out: r.out });
  assert.equal(D(r2.segs), 'M0 0 H10 C14 4 20 0 20 0');
});

test('penNode: kind Q puts the control at the pointer when dragged, else at the middle; kind L ignores a pending handle', () => {
  const s = P('M0 0');
  assert.equal(D(penNode(s, 0, [10, 0], { kind: 'Q' }).segs), 'M0 0 Q5 0 10 0');
  assert.equal(D(penNode(s, 0, [10, 0], { kind: 'Q', drag: [5, -8] }).segs), 'M0 0 Q5 -8 10 0');
  assert.equal(D(penNode(s, 0, [10, 0], { kind: 'L', out: { pt: [1, 1], sym: false }, drag: [3, 3] }).segs), 'M0 0 H10');
});

test('penNode: kind A, dragged: the arc passes through the pointer; clicked: tangent to the previous segment, else a 1 radian arc', () => {
  const s = P('M0 0'), r = penNode(s, 0, [10, 0], { kind: 'A', drag: [5, -5] }), a = r.segs[1];
  assert.equal(a.t, 'A');
  const g = arcGeom([0, 0], [10, 0], ...a.arc), m = g.pt(g.th1 + g.dth / 2);
  assert.ok(Math.hypot(m[0] - 5, m[1] + 5) < 1e-6);                // the arc's middle is the pointer
  const c = penNode(s, 0, [10, 0], { kind: 'A' }).segs[1];
  assert.equal(c.t, 'A'); assert.equal(c.arc[0], c.arc[1]);
  const l = penNode(s, 0, [10, 0], { kind: 'A', drag: [5, 0] }).segs[1];  // collinear: no arc through three points, falls back to the default arc
  assert.equal(l.t, 'A');
});

test('penNode: inserts after the head (later subpaths follow) and never mutates its input', () => {
  const s = P('M0 0 L5 0 M20 20 L30 30'), before = JSON.stringify(s);
  const r = penNode(s, 1, [9, 9]);
  assert.equal(D(r.segs), 'M0 0 L5 0 L9 9 M20 20 L30 30');
  assert.equal(JSON.stringify(s), before);
});

test('canClose / closeSub: needs a segment; a straight close is just Z; a pending handle or a curve kind closes with a curve', () => {
  const two = P('M0 0 L10 0'), three = P('M0 0 L10 0 L10 10');
  assert.equal(canClose(two, 1), true);                            // two nodes are enough: a balloon is two curves between two nodes
  assert.equal(D(closeSub(two, 1, { kind: 'Q' }).segs), 'M0 0 L10 0 Q5 0 0 0 Z');
  assert.equal(canClose(P('M0 0'), 0), false);                     // a lone node has nothing to close
  assert.equal(canClose(three, 1), false);                         // not the end
  assert.equal(canClose(three, 2), true);
  const r = closeSub(three, 2);
  assert.equal(D(r.segs), 'M0 0 L10 0 L10 10 Z'); assert.equal(r.idx, 0);
  assert.equal(endKind(r.segs, 0), null);                          // closed: no endpoints
  const c = closeSub(three, 2, { out: { pt: [10, 15], sym: false } });
  assert.equal(D(c.segs), 'M0 0 L10 0 L10 10 C10 15 0 0 0 0 Z');
  assert.equal(D(closeSub(three, 2, { kind: 'Q' }).segs), 'M0 0 L10 0 L10 10 Q5 5 0 0 Z');
  assert.equal(closeSub(P('M0 0 L5 5 L9 0 Z'), 2), null);          // already closed
  assert.equal(D(closeSub(three, 2, { drag: [5, 12] }).segs), 'M0 0 L10 0 L10 10 C10 10 -5 -12 0 0 Z'); // a drag at the closing node pulls a handle (incoming = mirror of it)
});

test('the path pen tool is registered as a pen tool, and says what a drawable path is', () => {
  const t = Tools.get('path');
  assert.ok(t.pen); assert.equal(t.tag, 'path');
  const mk = d => ({ getAttribute: () => d });
  assert.equal(t.real(mk('M1 2')), false); assert.equal(t.real(mk('')), false); assert.equal(t.real(mk('M1 2 L3 4')), true);
});
