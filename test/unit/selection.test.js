import test from 'node:test';
import assert from 'node:assert/strict';
import { selection } from '../../src/selection.js';
import { parsePath, serPath, deleteNodes, deleteSegments, deletePoints, nearestSeg, segD, segInfo } from '../../src/path-math.js';

const d = (s, f) => { const r = f(parsePath(s)); return r && serPath(r); };

test('selection: plain pick replaces, shift toggles within a kind, the other kind starts over', () => {
  const S = selection();
  S.pick('node', 1); S.pick('node', 3, true); assert.deepEqual(S.items, [1, 3]);
  S.pick('node', 1, true); assert.deepEqual(S.items, [3]);
  S.pick('seg', 2, true); assert.equal(S.kind, 'seg'); assert.deepEqual(S.items, [2]);
  S.pick('seg', 2, true); assert.equal(S.size, 0); assert.equal(S.kind, null);
});
test('selection.press: an unselected item is picked at once; a selected one waits for the release to collapse or toggle', () => {
  const S = selection();
  S.pick('node', 1); S.pick('node', 2, true);
  const rel = S.press('node', 2, false);
  assert.deepEqual(S.items, [1, 2]);          // still both, so the pair can be dragged
  rel(); assert.deepEqual(S.items, [2]);      // released without a drag: collapse
  S.pick('node', 4, true);
  S.press('node', 4, true)(); assert.deepEqual(S.items, [2]);   // shift-click on a selected one drops it
  S.press('node', 7, true); assert.deepEqual(S.items, [2, 7]);
});
test('selection.keep drops items that no longer exist', () => {
  const S = selection(); S.pick('node', 1); S.pick('node', 5, true);
  S.keep('node', i => i < 3); assert.deepEqual(S.items, [1]);
  S.keep('node', () => false); assert.equal(S.kind, null);
});

test('deleteNodes: the neighbours join, each kept segment keeps its curve', () => {
  assert.equal(d('M0 0 L10 0 L10 10 L0 10 Z', s => deleteNodes(s, [2])), 'M0 0 L10 0 L0 10 Z');
  assert.equal(d('M0 0 C1 1 2 2 3 3 C4 4 5 5 6 6 L9 9', s => deleteNodes(s, [1])), 'M0 0 C4 4 5 5 6 6 L9 9');
});
test('deleteNodes: deleting a first node promotes the next; several at once; pinned ones stay; never below two nodes', () => {
  assert.equal(d('M0 0 L10 0 L10 10 L0 10 Z', s => deleteNodes(s, [0])), 'M10 0 L10 10 L0 10 Z');
  assert.equal(d('M0 0 L10 0 L10 10 L0 10 L0 5', s => deleteNodes(s, [1, 2, 3])), 'M0 0 L0 5');
  assert.equal(d('M0 0 L10 0 L10 10 L0 10', s => deleteNodes(s, [1, 2], new Set([1]))), 'M0 0 L10 0 L0 10');
  assert.equal(d('M0 0 L10 0 L10 10', s => deleteNodes(s, [0, 1])), null);
  assert.equal(d('M0 0 L10 0 L10 10 Z', s => deleteNodes(s, [3])), null);   // a Z is not a node
});
test('deleteNodes: a node promoted to M drops its arc flags', () => {
  assert.equal(d('M0 0 A5 5 0 0 1 10 0 L10 10', s => deleteNodes(s, [0])), 'M10 0 L10 10');
});
test('deleteSegments: an open path is cut into pieces', () => {
  assert.equal(d('M0 0 L10 0 L10 10 L20 10', s => deleteSegments(s, [2])), 'M0 0 L10 0 M10 10 L20 10');
  assert.equal(d('M0 0 L10 0 L10 10 L20 10', s => deleteSegments(s, [1, 3])), 'M10 0 L10 10');
  assert.equal(d('M0 0 L10 0', s => deleteSegments(s, [1])), null);   // nothing would be left
});
test('deleteSegments: a closed path is opened, starting where the cut ends', () => {
  const sq = 'M0 0 L10 0 L10 10 L0 10 Z';
  assert.equal(d(sq, s => deleteSegments(s, [2])), 'M10 10 L0 10 L0 0 L10 0');
  assert.equal(d(sq, s => deleteSegments(s, [4])), 'M0 0 L10 0 L10 10 L0 10');          // the closing line itself
  assert.equal(d('M0 0 L10 0 L10 10 L0 0 Z', s => deleteSegments(s, [1])), 'M10 0 L10 10 L0 0'); // Z closes onto the start: no extra edge
});
test('deleteSegments: curves and other subpaths survive', () => {
  assert.equal(d('M0 0 L5 5 M20 20 C21 21 22 22 23 23 L30 30', s => deleteSegments(s, [3])), 'M0 0 L5 5 M23 23 L30 30');
  assert.equal(d('M0 0 L5 5 M20 20 C21 21 22 22 23 23 L30 30', s => deleteSegments(s, [4])), 'M0 0 L5 5 M20 20 C21 21 22 22 23 23');
});
test('deletePoints: respects the minimum and pinned points', () => {
  const p = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.deepEqual(deletePoints(p, [1], 3), [[0, 0], [1, 1], [0, 1]]);
  assert.equal(deletePoints(p, [0, 1], 3), null);
  assert.deepEqual(deletePoints(p, [0, 1], 2, new Set([0])), [[0, 0], [1, 1], [0, 1]]);
});
test('nearestSeg / segD / segInfo', () => {
  const s = parsePath('M0 0 L10 0 L10 10 Z');
  assert.equal(nearestSeg(s, [10, 6]).i, 2);
  assert.equal(nearestSeg(s, [4, 5]).i, 3);                 // on the closing line
  assert.equal(nearestSeg(parsePath('M0 0 L10 0 L10 10 L0 0 Z'), [5, 1]).i, 1); // the zero-length Z is never picked
  assert.equal(segD(s, 3), 'M10 10 L0 0');
  assert.equal(segD(s, 0), '');
  assert.deepEqual(segInfo(s)[3], { from: [10, 10], to: [0, 0] });
});
