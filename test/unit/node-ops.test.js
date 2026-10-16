import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, twins, segInfo, deleteNodes, handleLinks, dragHandle, nodeType } from '../../src/path-math.js';
import { nodeTypeAny, setNodeTypes } from '../../src/node-type.js';
import { unattached, joinNodes, splitNodes, splitSegments, cutSegments } from '../../src/node-ops.js';
import { arcGeom, retype } from '../../src/path-math.js';
import { pathNodes } from '../../src/policy.js';

const P = parsePath, S = serPath;
const join = (d, idxs, o) => { const r = joinNodes(P(d), idxs, o); return r && { d: S(r.segs), sel: r.sel }; };
const split = (d, idxs) => { const r = splitNodes(P(d), idxs); return r && { d: S(r.segs), sel: r.sel }; };

/* ---- subpaths: M / m ---- */
test('a drawing command straight after a Z starts a new subpath at the old start: parsePath writes that M in', () => {
  assert.equal(S(P('M0 0 L10 0 L10 10 Z L20 20 L30 20')), 'M0 0 L10 0 L10 10 Z M0 0 L20 20 L30 20');
  assert.equal(S(P('m5 5 l10 0 l0 10 z l20 20')), 'M5 5 L15 5 L15 15 Z M5 5 L25 25');   // (relative: from the start the Z went back to)
  assert.equal(S(P('M0 0 L10 0 Z M20 20 L30 20')), 'M0 0 L10 0 Z M20 20 L30 20');       // an M of its own is left alone
});

test('relative m starts a subpath from the end of the one before it (or from its start, after a Z)', () => {
  assert.equal(S(P('M10 10 l10 0 l0 10 m5 5 l10 0')), 'M10 10 L20 10 L20 20 M25 25 L35 25');
  assert.equal(S(P('M10 10 l10 0 l0 10 z m5 5 l10 0')), 'M10 10 L20 10 L20 20 Z M15 15 L25 15');
});

test('every subpath has its own nodes, and a subpath that ends on its start is one joined node, whatever comes before or after it', () => {
  const d = 'M0 0 L10 0 L10 10 Z M30 0 C30 10 40 10 40 0 C40 -10 30 -10 30 0 M50 0 L60 0';
  const s = P(d);
  assert.deepEqual(twins(s), [-1, -1, -1, -1, 6, -1, 4, -1, -1]);
  assert.equal(pathNodes(s).pts.length, 3 + 2 + 2);                                           // the joined node counts once
  assert.deepEqual(pathNodes(s).ends, [3, 5, 6]);                                             // the closed subpath has no ends; the loop has its joined node; the open one both
});

test('node types work inside any subpath, and on a joined node of the second one', () => {
  const d = 'M0 0 L10 0 L10 10 Z M30 0 C30 10 40 10 40 0 C40 -10 30 -10 30 0 Z M50 0 L60 0 L70 20';
  const s = P(d), info = segInfo(s);
  assert.equal(nodeTypeAny(s, 1, info), 'corner');                                               // first subpath
  assert.equal(nodeTypeAny(s, 4, info), 'symmetric');                                            // the joined node of the second (its M and last point)
  assert.equal(nodeTypeAny(s, 6, info), 'symmetric');
  assert.equal(nodeTypeAny(s, 9, info), 'corner');                                               // the middle of the third
  assert.equal(nodeTypeAny(s, 8, info), null);                                                   // its first node has one side only
  const r = setNodeTypes(s, [2], 'smooth');                                                      // a node of the first subpath leaves the others alone
  assert.equal(S(r.segs).slice(S(r.segs).indexOf('M30')), 'M30 0 C30 10 40 10 40 0 C40 -10 30 -10 30 0 Z M50 0 L60 0 L70 20');   // (the second subpath is as it was)
  assert.notEqual(S(r.segs).slice(0, S(r.segs).indexOf('M30')), 'M0 0 L10 0 L10 10 Z ');
});

test('dragging a handle at a joined node in the second subpath moves its partner across the joint, and the first subpath is untouched', () => {
  const s = P('M0 0 L10 0 L10 10 Z M50 100 C50 50 150 50 150 100 C150 150 50 150 50 100');
  const first = S(s).split(' M')[0];
  dragHandle(s, 5, 0, [60, 40], handleLinks(s, 5, 0));
  assert.deepEqual(s[6].pts[1], [40, 160]);
  assert.equal(S(s).split(' M')[0], first);
});

test('deleting nodes takes them out of their own subpath only; a subpath left with one node goes', () => {
  assert.equal(S(deleteNodes(P('M0 0 L10 0 L10 10 M20 20 L30 20 L30 30'), [2])), 'M0 0 L10 0 M20 20 L30 20 L30 30');
  assert.equal(S(deleteNodes(P('M0 0 L10 0 L10 10 M20 20 L30 20 L30 30'), [4, 5])), 'M0 0 L10 0 L10 10');
});

/* ---- unattached nodes ---- */
test('unattached: exactly two different ends of open subpaths (a lone M counts)', () => {
  const d = 'M0 0 L10 0 L10 10 M20 20 L30 20 M40 40';
  assert.deepEqual(unattached(P(d), [2, 3]), ['end', 'start']);
  assert.deepEqual(unattached(P(d), [0, 5]), ['start', 'lone']);
  assert.equal(unattached(P(d), [1, 3]), null);                      // an inner node
  assert.equal(unattached(P(d), [2]), null); assert.equal(unattached(P(d), [2, 2]), null); assert.equal(unattached(P(d), [0, 2, 3]), null);
  assert.equal(unattached(P('M0 0 L10 0 L10 10 Z M20 20 L30 20'), [0, 4]), null);   // a closed subpath has no ends
});

/* ---- Join with segment ---- */
test('join: the end of one subpath to the start of the next gets a line, and the two become one subpath', () => {
  assert.deepEqual(join('M0 0 L10 0 M20 0 L30 0', [1, 2]), { d: 'M0 0 L10 0 L20 0 L30 0', sel: [1, 2] });
});

test('join: ends are reversed as needed (end-end, start-start, start-end), the subpath order of the path is kept', () => {
  assert.equal(join('M0 0 L10 0 M30 0 L20 0', [1, 3]).d, 'M0 0 L10 0 L20 0 L30 0');                // end + end: the second is turned round
  assert.equal(join('M10 0 L0 0 M20 0 L30 0', [0, 2]).d, 'M0 0 L10 0 L20 0 L30 0');                // start + start: the first
  assert.equal(join('M10 0 L0 0 M30 0 L20 0', [0, 3]).d, 'M0 0 L10 0 L20 0 L30 0');                // start + end: both are turned round (10,0 meets 20,0)
  assert.equal(join('M20 0 L30 0 M0 0 L10 0', [1, 2]).d, 'M20 0 L30 0 L0 0 L10 0');                // the nodes are in the order of the path
  assert.equal(join('M0 0 L10 0 M99 99 L98 98 M20 0 L30 0', [1, 4]).d, 'M0 0 L10 0 L20 0 L30 0 M99 99 L98 98');   // others keep their place
});

test('join: curves keep their handles when a subpath is reversed to join', () => {
  const r = join('M0 0 L10 0 M40 0 C40 10 30 10 20 0', [1, 2]);
  assert.equal(r.d, 'M0 0 L10 0 L40 0 C40 10 30 10 20 0');
  const q = join('M0 0 L10 0 M20 0 C25 10 35 10 40 0', [1, 3]);                                       // end of the first + end of the second
  assert.equal(q.d, 'M0 0 L10 0 L40 0 C35 10 25 10 20 0');
});

test('join: a lone M is an end', () => {
  assert.deepEqual(join('M0 0 M10 5', [0, 1]), { d: 'M0 0 L10 5', sel: [0, 1] });
  assert.equal(join('M0 0 L10 0 M20 5', [1, 2]).d, 'M0 0 L10 0 L20 5');
});

test('join: the two ends of one subpath are closed by a Z that draws the line', () => {
  assert.deepEqual(join('M0 0 L10 0 L10 10', [0, 2]), { d: 'M0 0 L10 0 L10 10 Z', sel: [0, 2] });
  assert.equal(join('M0 0 L10 0', [0, 1]).d, 'M0 0 L10 0 Z');
});

test('join: refuses what is not two unattached nodes', () => {
  assert.equal(join('M0 0 L10 0 L20 0', [0, 1]), null);
  assert.equal(join('M0 0 L10 0 L10 10 Z M20 0 L30 0', [0, 4]), null);
  assert.equal(join('M0 0 L10 0', [0]), null);
});

/* ---- Merge ---- */
test('merge: two ends become one node at the average of their positions', () => {
  assert.deepEqual(join('M0 0 L10 0 M20 10 L30 10', [1, 2], { merge: true }), { d: 'M0 0 L15 5 L30 10', sel: [1] });
  assert.equal(join('M0 0 L10 0 M30 10 L20 10', [1, 2], { merge: true }).d, 'M0 0 L20 5 L20 10');                  // (10,0) and (30,10) meet at (20,5)
  assert.equal(join('M0 0 L10 0 M20 10 L30 10', [1, 3], { merge: true }).d, 'M0 0 L20 5 L20 10');   // (the same, by the second subpath's end)
});

test('merge: a bezier handle at each node moves with its node', () => {
  const r = join('M0 0 C0 10 10 10 10 0 M20 0 C20 10 30 10 30 0', [1, 2], { merge: true });
  assert.equal(r.d, 'M0 0 C0 10 15 10 15 0 C15 10 30 10 30 0');    // (10,0) and (20,0) meet at (15,0): the handle at the first node moves +5, the one at the second -5
});

test('merge: the two ends of one subpath become one joined node, closed with a Z that draws nothing', () => {
  const r = join('M0 0 L20 0 L20 20 L2 4', [0, 3], { merge: true });
  assert.equal(r.d, 'M1 2 L20 0 L20 20 L1 2 Z');
  assert.deepEqual(r.sel, [0]);
  assert.deepEqual(twins(P(r.d)), [3, -1, -1, 0, -1]);
  assert.equal(join('M0 0 L20 0', [0, 1], { merge: true }), null);                                    // nothing would be left of it
});

/* ---- Split ---- */
test('split: a node inside an open subpath becomes the end of one subpath and the M of the next', () => {
  assert.deepEqual(split('M0 0 L10 0 L20 0 L30 0', [2]), { d: 'M0 0 L10 0 L20 0 M20 0 L30 0', sel: [3] });
  assert.equal(pathNodes(P(split('M0 0 L10 0 L20 0 L30 0', [2]).d)).pts.length, 5);                 // one node more: the two halves are separate nodes
});

test('split: curves keep their shape and handles on each side', () => {
  assert.equal(split('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', [1]).d, 'M0 0 C0 10 10 10 10 0 M10 0 C10 -10 20 -10 20 0');
  assert.equal(split('M0 0 C0 10 10 10 10 0 S20 -10 20 0', [1]).d, 'M0 0 C0 10 10 10 10 0 M10 0 C10 -10 20 -10 20 0');   // an S needs a curve before it: its implied control is written out
});

test('split: several nodes at once; other subpaths are left alone', () => {
  assert.deepEqual(split('M0 0 L10 0 L20 0 L30 0 M50 50 L60 60', [1, 2]), { d: 'M0 0 L10 0 M10 0 L20 0 M20 0 L30 0 M50 50 L60 60', sel: [2, 4] });
  assert.equal(split('M0 0 L10 0 L20 0 M50 50 L60 60 L70 70', [4]).d, 'M0 0 L10 0 L20 0 M50 50 L60 60 M60 60 L70 70');
});

test('split: nothing to do at an end, a lone M or the joined node of a loop that was never closed', () => {
  assert.equal(split('M0 0 L10 0 L20 0', [0]), null);
  assert.equal(split('M0 0 L10 0 L20 0', [2]), null);
  assert.equal(split('M0 0 M5 5 L10 0', [0]), null);
  assert.equal(split('M0 0 L10 0 L10 10 L0 0', [0]), null);
  assert.equal(split('M0 0 L10 0 L10 10 L0 0', [3]), null);
  assert.equal(split('M0 0 L10 0 L20 0', []), null);
});

test('split: a loop that was never closed is cut at an inner node into two subpaths', () => {
  assert.equal(split('M0 0 L10 0 L10 10 L0 0', [1]).d, 'M0 0 L10 0 M10 0 L10 10 L0 0');
});

test('split: a closed subpath is opened at the node: it starts there, runs round, and ends there (one joined node, no Z)', () => {
  const r = split('M0 0 L10 0 L10 10 Z', [1]);                                                       // a Z that draws a line: that line is an L now
  assert.equal(r.d, 'M10 0 L10 10 L0 0 L10 0');
  assert.deepEqual(r.sel, [0]);
  assert.deepEqual(twins(P(r.d)), [3, -1, -1, 0]);
  assert.equal(split('M0 0 L10 0 L10 10 L0 0 Z', [1]).d, 'M10 0 L10 10 L0 0 L10 0');                  // a Z that draws nothing: the same
  assert.equal(split('M0 0 L10 0 L10 10 Z', [2]).d, 'M10 10 L0 0 L10 0 L10 10');
});

test('split: a closed subpath cut at its first node only loses its Z', () => {
  assert.equal(split('M0 0 L10 0 L10 10 Z', [0]).d, 'M0 0 L10 0 L10 10 L0 0');
  assert.equal(split('M0 0 L10 0 L10 10 L0 0 Z', [0]).d, 'M0 0 L10 0 L10 10 L0 0');
  assert.equal(split('M0 0 L10 0 L10 10 L0 0 Z', [3]).d, 'M0 0 L10 0 L10 10 L0 0');                   // (either half of the joined node)
});

test('split: two cuts in a closed subpath make two subpaths; the piece through the first node is rotated', () => {
  assert.equal(split('M0 0 L10 0 L10 10 L0 10 Z', [1, 2]).d, 'M10 0 L10 10 M10 10 L0 10 L0 0 L10 0');
  assert.equal(split('M0 0 L10 0 L10 10 L0 10 Z', [0, 2]).d, 'M0 0 L10 0 L10 10 M10 10 L0 10 L0 0');
});

test('split: bezier handles go round with their nodes when a closed subpath is rotated', () => {
  const d = 'M0 0 C0 10 10 10 10 0 C10 -10 0 -10 0 0 Z';
  assert.equal(split(d, [1]).d, 'M10 0 C10 -10 0 -10 0 0 C0 10 10 10 10 0');
  const r = P(split(d, [1]).d); assert.equal(nodeType(r, 0), 'symmetric');
});

test('split, then join with a segment, then merge: the pieces come back together', () => {
  const a = splitNodes(P('M0 0 L10 0 L20 0 L30 0'), [2]);
  assert.equal(S(joinNodes(a.segs, [2, 3], { merge: true }).segs), 'M0 0 L10 0 L20 0 L30 0');
});

/* ---- Segment menu: Add Node (splitSegments) and Break Segment (cutSegments) ---- */
const add = (d, idxs) => { const r = splitSegments(P(d), idxs); return r && { d: S(r.segs), sel: r.sel }; };
const brk = (d, idxs) => { const r = cutSegments(P(d), idxs); return r && { d: S(r.segs), sel: r.sel }; };

test('add node: a line is cut at its middle, a quadratic and a cubic at t = 0.5 (same curve), and the new node is selected', () => {
  assert.deepEqual(add('M0 0 L10 0', [1]), { d: 'M0 0 L5 0 L10 0', sel: [1] });
  assert.deepEqual(add('M0 0 Q10 10 20 0', [1]), { d: 'M0 0 Q5 5 10 5 Q15 5 20 0', sel: [1] });
  assert.deepEqual(add('M0 0 C0 10 10 10 10 0', [1]), { d: 'M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0', sel: [1] });
});

test('add node: H and V come back as H and V once retype has seen the halves', () => {
  const r = splitSegments(P('M0 0 H10 V10'), [1, 2]);
  assert.equal(S(retype(r.segs)), 'M0 0 H5 H10 V5 V10');
});

test('add node: an arc is cut half way round, both halves the same ellipse and sweep (also past a half turn)', () => {
  for (const d of ['M0 0 A10 10 0 0 1 20 0', 'M0 0 A10 10 0 1 1 10 10', 'M0 0 A20 10 30 0 0 25 5']) {
    const s = P(d), [, a] = s, r = splitSegments(s, [1]), [, h1, h2] = r.segs;
    const g = arcGeom([0, 0], a.pts[0], ...a.arc), g1 = arcGeom([0, 0], h1.pts[0], ...h1.arc), g2 = arcGeom(h1.pts[0], a.pts[0], ...h2.arc);
    for (const q of [g1, g2]) {
      assert.ok(Math.abs(q.cx - g.cx) < 0.01 && Math.abs(q.cy - g.cy) < 0.01 && Math.abs(q.rx - g.rx) < 0.01 && Math.abs(q.ry - g.ry) < 0.01, d);
      assert.ok(Math.abs(q.dth - g.dth / 2) < 1e-6, d);
    }
    assert.deepEqual(r.sel, [1]);
  }
});

test('add node: a Z that draws a line gets an L to its middle and keeps the Z; a Z that draws nothing is no segment', () => {
  assert.deepEqual(add('M0 0 L10 0 L10 10 Z', [3]), { d: 'M0 0 L10 0 L10 10 L5 5 Z', sel: [3] });
  assert.equal(add('M0 0 L10 0 L0 0 Z', [3]), null);
});

test('add node: several segments at once, each new node selected; an M alone gives nothing', () => {
  assert.deepEqual(add('M0 0 L10 0 L20 0 L30 0', [1, 3]), { d: 'M0 0 L5 0 L10 0 L20 0 L25 0 L30 0', sel: [1, 4] });
  assert.equal(add('M0 0 L10 0', [0]), null);
});

test('add node: a segment after a curve that was written S loses the flag but keeps its shape', () => {
  assert.equal(add('M0 0 C0 10 10 10 10 0 S20 -10 20 0', [1]).d, 'M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0 C10 -10 20 -10 20 0');
});

test('break: the segment becomes an M, and the two nodes it joined are the ends of the pieces either side (both selected)', () => {
  assert.deepEqual(brk('M0 0 L10 0 L20 0 L30 0', [2]), { d: 'M0 0 L10 0 M20 0 L30 0', sel: [1, 2] });
  assert.deepEqual(brk('M0 0 C0 10 10 10 10 0 L20 0 C20 10 30 10 30 0', [2]), { d: 'M0 0 C0 10 10 10 10 0 M20 0 C20 10 30 10 30 0', sel: [1, 2] });
  assert.deepEqual(brk('M0 0 L10 0 L20 0 M50 50 L60 60', [2]), { d: 'M0 0 L10 0 M20 0 M50 50 L60 60', sel: [1, 2] });   // other subpaths are left alone
});

test('break: a node left with no segment stays, as a lone M', () => {
  assert.deepEqual(brk('M0 0 L10 0 L20 0 L30 0', [1]), { d: 'M0 0 M10 0 L20 0 L30 0', sel: [0, 1] });
  assert.deepEqual(brk('M0 0 L10 0 L20 0 L30 0', [3]), { d: 'M0 0 L10 0 L20 0 M30 0', sel: [2, 3] });
  assert.deepEqual(brk('M0 0 L10 0 L20 0', [1, 2]), { d: 'M0 0 M10 0 M20 0', sel: [0, 1, 2] });
});

test('break: a closed subpath is opened at the cut (the two nodes are its ends), whether its Z draws a line, draws nothing, or is missing', () => {
  assert.deepEqual(brk('M0 0 L10 0 L10 10 Z', [2]), { d: 'M10 10 L0 0 L10 0', sel: [0, 2] });
  assert.equal(brk('M0 0 L10 0 L10 10 L0 0 Z', [2]).d, 'M10 10 L0 0 L10 0');
  assert.equal(brk('M0 0 L10 0 L10 10 L0 0', [2]).d, 'M10 10 L0 0 L10 0');
  assert.equal(brk('M0 0 L10 0 L10 10 Z', [3]).d, 'M0 0 L10 0 L10 10');            // cutting the closing line just drops the Z
  const r = cutSegments(P('M0 0 L10 0 L10 10 L0 0 Z'), [2]);
  assert.equal(twins(r.segs).every(x => x === -1), true);                           // the joined node is an ordinary one in the middle now
  assert.equal(pathNodes(P('M0 0 L10 0 L10 10 L0 0 Z')).pts.length, pathNodes(r.segs).pts.length);   // 3 nodes before, 3 after
});

test('break: two cuts in a closed subpath make two pieces', () => {
  assert.deepEqual(brk('M0 0 L10 0 L10 10 L0 10 Z', [1, 3]), { d: 'M10 0 L10 10 M0 10 L0 0', sel: [0, 1, 2, 3] });
  assert.equal(brk('M0 0 L10 0 L10 10 L0 10 Z', [1, 2, 3, 4]).d, 'M10 0 M10 10 M0 10 M0 0');
});

test('break: the node count never changes; nothing to cut gives null', () => {
  assert.equal(pathNodes(cutSegments(P('M0 0 L10 0 L20 0 L30 0'), [2]).segs).pts.length, 4);
  assert.equal(cutSegments(P('M0 0 L10 0'), [0]), null);
});
