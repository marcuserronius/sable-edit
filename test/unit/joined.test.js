import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, twins, twinOf, nodeHandles, nodeType, handleLinks, dragHandle, deleteNodes } from '../../src/path-math.js';
import { endKind, canClose } from '../../src/pen-math.js';

/* a joined node: the last point sits on the first, whether or not a Z closes it; a Z that draws a line is a segment of its own */
const LEAF = 'M50 100 C50 50 150 50 150 100 C150 150 50 150 50 100';

test('twins: the end of a subpath that sits on its start is one node with it, with or without a zero-length Z; a Z that draws a line is not', () => {
  assert.deepEqual(twins(parsePath(LEAF + ' Z')), [2, -1, 0, -1]);
  assert.deepEqual(twins(parsePath(LEAF)), [2, -1, 0]);                            // never closed: the same node
  assert.deepEqual(twins(parsePath('M50 100 L150 100 L100 160 Z')), [-1, -1, -1, -1]); // the Z draws a line back: two nodes
  assert.deepEqual(twins(parsePath('M0 0 L10 0 L10 10 M20 20 C20 30 30 30 30 20 L20 20 Z')), [-1, -1, -1, 5, -1, 3, -1]); // each subpath on its own
  const s = parsePath(LEAF + ' Z');
  assert.equal(twinOf(s, 0), 2); assert.equal(twinOf(s, 2), 0); assert.equal(twinOf(s, 1), -1);
  assert.equal(twinOf(parsePath('M0 0'), 0), -1); assert.equal(twinOf(parsePath('M0 0 L5 5'), 1), -1);
});

test('a joined node has the handles of its last and first segments, Z or not, and keeps them symmetric together', () => {
  for (const d of [LEAF + ' Z', LEAF]) {
    const s = parsePath(d);
    for (const j of [0, 2]) { const h = nodeHandles(s, j); assert.deepEqual([h.a.i, h.a.k, h.b.i, h.b.k], [2, 1, 1, 0]); assert.equal(nodeType(s, j), 'symmetric'); }
    dragHandle(s, 1, 0, [60, 40], handleLinks(s, 1, 0));  // the first segment's handle at the joint drags the last segment's one with it, mirrored
    assert.deepEqual(s[2].pts[1], [40, 160]);
  }
});

test('a Z that draws a line does not join anything: the nodes at its ends have no handles to share', () => {
  const s = parsePath('M50 100 C50 50 150 50 150 100 C150 150 100 170 100 160 Z');
  assert.equal(nodeHandles(s, 0).a, null);
});

test('a loop has no endpoints for the pen, and cannot be closed again', () => {
  assert.equal(endKind(parsePath(LEAF), 0), null); assert.equal(endKind(parsePath(LEAF), 2), null);
  assert.equal(canClose(parsePath(LEAF), 2), false);
  assert.equal(endKind(parsePath('M50 100 L150 100 L100 160'), 2), 'end');        // an open path whose ends are apart keeps its ends
  assert.equal(canClose(parsePath('M50 100 L150 100 L100 160'), 2), true);
});

test('deleting both halves of a joined node leaves the rest of the path, closed by a real line', () => {
  const r = deleteNodes(parsePath('M50 100 C50 50 150 50 150 100 C150 150 100 170 100 160 C60 150 50 150 50 100 Z'), [0, 3]);
  assert.equal(serPath(r), 'M150 100 C150 150 100 170 100 160 Z');
});
