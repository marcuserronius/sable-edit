import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleFrom } from '../../src/tools/circle.js';
import { rectFrom } from '../../src/tools/rect.js';
import { ellipseFrom } from '../../src/tools/ellipse.js';
import { lineFrom } from '../../src/tools/line.js';
import { Tools } from '../../src/tools.js';
import { placeMenu, placeSub } from '../../src/menu.js';

test('circleFrom: centre + rim point -> cx, cy, r', () => {
  assert.deepEqual(circleFrom([10, 20], [13, 24]), { cx: 10, cy: 20, r: 5 });
  assert.deepEqual(circleFrom([0, 0], [0, -7.12345]), { cx: 0, cy: 0, r: 7.123 });
});

test('circleFrom: radius at or below the threshold makes nothing', () => {
  assert.equal(circleFrom([5, 5], [5, 5]), null);
  assert.equal(circleFrom([5, 5], [6, 5], 2), null);
  assert.equal(circleFrom([5, 5], [8, 5], 2).r, 3);
});

test('tool registry: circle is registered; re-registering an id replaces it', () => {
  assert.equal(Tools.get('circle').label, 'Circle');
  const n = Tools.list.length, old = Tools.get('circle');
  Tools.register({ ...old, label: 'Circle2' });
  assert.equal(Tools.list.length, n);
  assert.equal(Tools.get('circle').label, 'Circle2');
  Tools.register(old);
});

test('placeMenu: opens at the pointer, flips left / clamps up at the viewport edge', () => {
  assert.deepEqual(placeMenu(100, 100, 150, 80, 1000, 800), { left: 100, top: 100 });
  assert.deepEqual(placeMenu(900, 100, 150, 80, 1000, 800), { left: 750, top: 100 });
  assert.deepEqual(placeMenu(100, 780, 150, 80, 1000, 800), { left: 100, top: 716 });
  assert.deepEqual(placeMenu(10, 10, 150, 900, 1000, 800), { left: 10, top: 4 });
});

test('placeSub: flyout to the right of its row, else to the left, kept inside the viewport', () => {
  const row = { left: 100, right: 250, top: 120 };
  assert.deepEqual(placeSub(row, 140, 60, 1000, 800), { left: 250, top: 120 });
  assert.deepEqual(placeSub({ left: 800, right: 950, top: 120 }, 140, 60, 1000, 800), { left: 660, top: 120 });
  assert.deepEqual(placeSub(row, 140, 90, 1000, 200), { left: 250, top: 106 });
});

test('rectFrom: two opposite corners in any drag direction -> x, y (top-left), width, height', () => {
  assert.deepEqual(rectFrom([10, 20], [40, 50]), { x: 10, y: 20, width: 30, height: 30 });
  assert.deepEqual(rectFrom([40, 50], [10, 20]), { x: 10, y: 20, width: 30, height: 30 });
  assert.deepEqual(rectFrom([10, 50], [40, 20]), { x: 10, y: 20, width: 30, height: 30 });
  assert.deepEqual(rectFrom([0, 0], [1.23456, 2]), { x: 0, y: 0, width: 1.235, height: 2 });
});

test('rectFrom: both sides must be above the threshold', () => {
  assert.equal(rectFrom([5, 5], [5, 5]), null);
  assert.equal(rectFrom([5, 5], [50, 6], 2), null); // a flat sliver
  assert.equal(rectFrom([5, 5], [6, 50], 2), null);
  assert.deepEqual(rectFrom([5, 5], [8, 9], 2), { x: 5, y: 5, width: 3, height: 4 });
});

test('tool registry: rect is registered', () => assert.equal(Tools.get('rect').label, 'Rectangle'));

test('ellipseFrom: bounding-box corners in any direction -> centre and radii', () => {
  assert.deepEqual(ellipseFrom([10, 20], [50, 60]), { cx: 30, cy: 40, rx: 20, ry: 20 });
  assert.deepEqual(ellipseFrom([50, 20], [10, 30]), { cx: 30, cy: 25, rx: 20, ry: 5 });
  assert.deepEqual(ellipseFrom([0, 0], [1, 3.3333]), { cx: 0.5, cy: 1.667, rx: 0.5, ry: 1.667 });
});

test('ellipseFrom: both sides must be above the threshold', () => {
  assert.equal(ellipseFrom([5, 5], [5, 5]), null);
  assert.equal(ellipseFrom([5, 5], [50, 6], 2), null);
  assert.equal(ellipseFrom([5, 5], [6, 50], 2), null);
});

test('lineFrom: keeps the press as the start and the release as the end', () => {
  assert.deepEqual(lineFrom([10, 20], [4, 2.5]), { x1: 10, y1: 20, x2: 4, y2: 2.5 });
  assert.equal(lineFrom([5, 5], [5, 5]), null);
  assert.equal(lineFrom([5, 5], [6, 5], 2), null);
  assert.deepEqual(lineFrom([5, 5], [5, 9], 2), { x1: 5, y1: 5, x2: 5, y2: 9 });
});

test('tool registry: ellipse and line are registered', () => {
  assert.equal(Tools.get('ellipse').label, 'Ellipse');
  assert.equal(Tools.get('line').label, 'Line');
});
