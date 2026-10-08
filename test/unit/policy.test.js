import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePolicy, checkWrite, checkWrites, parseTransform, parseMarkup, MARKUP_ATTR, canSet, modeOk, pathNodes, polyNodes, pinnedIdx, OPEN, CAPS } from '../../src/policy.js';
import { parsePath } from '../../src/path-math.js';

/* a stand-in for an element: just enough for resolve() and checkWrite() */
const el = (tag, attrs = {}, cls = '') => ({ tagName: tag, attrs, matches: s => s === '.' + cls || s === tag || s === '#' + attrs.id });
const get = e => a => (a in e.attrs ? e.attrs[a] : null);
const write = (pol, e, attr, nw, hint) => checkWrite(pol.resolve(e), e.tagName, get(e), attr, nw, hint);
const caps = p => [...p.caps].sort();

/* ---- compiling and resolving ---- */
test('no policy compiles to null; OPEN allows everything', () => {
  assert.equal(compilePolicy(undefined), null);
  assert.equal(compilePolicy(null), null);
  assert.ok(CAPS.every(c => OPEN.can(c)) && OPEN.selectable && OPEN.propOk('anything'));
});

test('default-deny: a shape no rule grants anything to is not selectable', () => {
  const pol = compilePolicy([{ select: '.edit', can: 'all' }]);
  assert.equal(pol.resolve(el('rect', {}, 'edit')).selectable, true);
  assert.equal(pol.resolve(el('rect', {}, 'other')).selectable, false);
  assert.deepEqual(caps(pol.resolve(el('rect', {}, 'other'))), []);
});

test('capability names: all, wildcards and exact names; unknown names throw', () => {
  const p = rule => compilePolicy([{ can: rule }]).resolve(el('path'));
  assert.deepEqual(caps(p('all')), [...CAPS].sort());
  assert.deepEqual(caps(p('transform.*')), ['transform.move', 'transform.rotate', 'transform.scale', 'transform.skew']);
  assert.deepEqual(caps(p(['geometry.edit', 'nodes.insert'])), ['geometry.edit', 'nodes.insert']);
  assert.throws(() => p('geometry.edti'), /unknown capability "geometry.edti"/);
  assert.throws(() => p('transform.flip'), /unknown capability/);
});

test('typos in a rule are errors, not silent holes', () => {
  assert.throws(() => compilePolicy([{ selct: 'path', can: 'all' }]), /unknown rule key "selct"/);
  assert.throws(() => compilePolicy([{ can: 'all', attrs: { forbid: ['x'] } }]), /unknown attrs key "forbid"/);
  assert.throws(() => compilePolicy({ rule: [] }), /unknown policy key/);
  assert.throws(() => compilePolicy([{ pin: ['endpoint'] }]), /bad pin/);
});

test('rules apply in order: later can/cannot override earlier; within one rule cannot wins', () => {
  const e = el('path', {}, 'a');
  const pol = compilePolicy([
    { can: 'all' },
    { select: '.a', cannot: 'transform.*' },
    { select: '.a', can: 'transform.move' },
    { select: '.a', can: ['nodes.insert'], cannot: ['nodes.insert'] },
  ]);
  assert.deepEqual(caps(pol.resolve(e)), ['attrs.edit', 'geometry.edit', 'nodes.delete', 'transform.move']);
});

test('select accepts a selector, a function, an element, or a list of them', () => {
  const a = el('rect', { id: 'a' }), b = el('rect', { id: 'b' }), c = el('rect', { id: 'c' });
  const pol = compilePolicy([{ select: ['#a', e => e === b], can: 'all' }]);
  assert.equal(pol.resolve(a).selectable, true);
  assert.equal(pol.resolve(b).selectable, true);
  assert.equal(pol.resolve(c).selectable, false);
  assert.equal(compilePolicy([{ select: c, can: 'all' }]).resolve(c).selectable, true);
});

test('nodes.* need geometry.edit', () => {
  const p = compilePolicy([{ can: ['nodes.insert', 'nodes.delete', 'transform.move'] }]).resolve(el('path'));
  assert.deepEqual(caps(p), ['transform.move']);
});

test('modes: each needs one of its capabilities', () => {
  const p = compilePolicy([{ can: ['transform.skew', 'geometry.edit'] }]).resolve(el('path'));
  assert.equal(modeOk(p, 'scale'), false);
  assert.equal(modeOk(p, 'rotate'), true);   // skew alone is enough to show the mode
  assert.equal(modeOk(p, 'edit'), true);
});

test('create: true by default; false or a list restricts the tools', () => {
  assert.equal(compilePolicy([]).toolOk('circle'), true);
  assert.equal(compilePolicy({ rules: [], create: false }).toolOk('circle'), false);
  const some = compilePolicy({ rules: [], create: ['rect'] });
  assert.equal(some.toolOk('rect'), true);
  assert.equal(some.toolOk('circle'), false);
});

/* ---- capability checks on writes ---- */
test('geometry writes need geometry.edit; transform writes need a transform capability or the declared one', () => {
  const e = el('rect', { x: '0' });
  const edit = compilePolicy([{ can: 'geometry.edit' }]), xf = compilePolicy([{ can: 'transform.rotate' }]);
  assert.equal(write(edit, e, 'x', '5').ok, true);
  assert.deepEqual(write(xf, e, 'x', '5'), { ok: false, cap: 'geometry.edit', reason: 'capability' });
  assert.equal(write(xf, e, 'transform', 'rotate(10)').ok, true);
  assert.equal(write(edit, e, 'transform', 'rotate(10)').ok, false);
  // a declared capability replaces the guess: a scale gesture writing transform needs transform.scale specifically
  assert.equal(write(xf, e, 'transform', 'scale(2)', 'transform.scale').ok, false);
  assert.equal(write(xf, e, 'transform', 'rotate(5)', 'transform.rotate').ok, true);
  // moving a rect rewrites x/y under transform.move, not geometry.edit
  const mv = compilePolicy([{ can: 'transform.move' }]);
  assert.equal(write(mv, e, 'x', '9', 'transform.move').ok, true);
  assert.equal(write(mv, e, 'x', '9').ok, false);
});

test('a refused write names the capability that was missing', () => {
  const e = el('path', { d: 'M0 0 L10 10 L20 0' });
  const pol = compilePolicy([{ can: 'geometry.edit' }]);
  assert.deepEqual(write(pol, e, 'd', 'M0 0 L10 10 L15 5 L20 0'), { ok: false, cap: 'nodes.insert', reason: 'capability' });
  assert.deepEqual(write(pol, e, 'd', 'M0 0 L20 0'), { ok: false, cap: 'nodes.delete', reason: 'capability' });
  assert.equal(write(pol, e, 'd', 'M0 0 L10 15 L20 0').ok, true);
});

/* ---- attribute rules ---- */
test('attrs.edit is required for attributes like fill; deny globs block them', () => {
  const e = el('path', { fill: 'red', style: 'stroke:blue; opacity:.5' });
  const none = compilePolicy([{ can: 'geometry.edit' }]);
  assert.deepEqual(write(none, e, 'fill', 'green'), { ok: false, cap: 'attrs.edit', reason: 'capability' });
  const pol = compilePolicy([{ can: 'all', attrs: { deny: ['stroke*', 'style'] } }]);
  assert.equal(write(pol, e, 'fill', 'green').ok, true);
  assert.deepEqual(write(pol, e, 'stroke', 'green'), { ok: false, cap: 'attrs.edit', reason: 'attribute' });
  assert.equal(write(pol, e, 'stroke-width', '3').reason, 'attribute');
  assert.equal(write(pol, e, 'style', 'opacity:1').ok, false);   // deny 'style' blocks the whole attribute
});

test('allow list: only the listed attributes pass; deny still wins', () => {
  const e = el('rect');
  const pol = compilePolicy([{ can: 'all', attrs: { allow: ['fill', 'stroke*', 'class'], deny: ['stroke-width'] } }]);
  assert.equal(write(pol, e, 'fill', 'red').ok, true);
  assert.equal(write(pol, e, 'stroke-linecap', 'round').ok, true);
  assert.equal(write(pol, e, 'stroke-width', '4').ok, false);
  assert.equal(write(pol, e, 'data-x', '1').ok, false);
});

test('style is checked property by property, as the same names as the attributes', () => {
  const e = el('rect', { style: 'fill:red; stroke:blue' });
  const pol = compilePolicy([{ can: 'all', attrs: { deny: ['stroke*'] } }]);
  assert.equal(write(pol, e, 'style', 'fill:green; stroke:blue').ok, true);         // only fill changed
  assert.equal(write(pol, e, 'style', 'fill:red; stroke:black').ok, false);         // stroke changed
  assert.equal(write(pol, e, 'style', 'fill:red; stroke:blue; stroke-width:3').ok, false); // stroke-width added
  assert.equal(write(pol, e, 'style', 'fill:red').ok, false);                       // stroke removed
  assert.equal(write(pol, e, 'style', 'fill : red ;stroke:blue').ok, true);         // formatting only
  assert.equal(write(pol, e, 'style', null).ok, false);                             // wiping style removes stroke
});

test('style parsing ignores ; inside url() and quotes', () => {
  const e = el('rect', { style: "fill:url(data:image/png;base64,AAA); stroke:blue" });
  const pol = compilePolicy([{ can: 'all', attrs: { deny: ['stroke'] } }]);
  assert.equal(write(pol, e, 'style', "fill:url(data:image/png;base64,BBB); stroke:blue").ok, true);
  assert.equal(write(pol, e, 'style', "fill:url(data:image/png;base64,AAA); stroke:red").ok, false);
});

test('a later rule replaces the attrs list of an earlier one', () => {
  const e = el('rect', {}, 'x');
  const pol = compilePolicy([{ can: 'all', attrs: { deny: ['fill'] } }, { select: '.x', attrs: { deny: [] } }]);
  assert.equal(write(pol, e, 'fill', 'red').ok, true);
});

test('canSet answers for host UIs, including single style properties', () => {
  const p = compilePolicy([{ can: ['geometry.edit', 'attrs.edit'], attrs: { deny: ['stroke*'] } }]).resolve(el('rect'));
  assert.equal(canSet(p, 'rect', 'fill'), true);
  assert.equal(canSet(p, 'rect', 'stroke'), false);
  assert.equal(canSet(p, 'rect', 'style:fill'), true);
  assert.equal(canSet(p, 'rect', 'style:stroke-width'), false);
  assert.equal(canSet(p, 'rect', 'width'), true);
  assert.equal(canSet(p, 'rect', 'transform'), false);
});

/* ---- nodes and pins ---- */
test('pathNodes: anchors, and endpoints of open subpaths only', () => {
  const open = pathNodes(parsePath('M0 0 C 1 1 2 2 3 3 L 4 4'));
  assert.deepEqual(open.pts, [[0, 0], [3, 3], [4, 4]]);
  assert.deepEqual(open.ends, [0, 2]);
  assert.deepEqual(pathNodes(parsePath('M0 0 L1 1 L2 0 Z')).ends, []);                       // closed: none
  assert.deepEqual(pathNodes(parsePath('M0 0 L1 1 L2 0 Z M5 5 L6 6 L7 5')).ends, [3, 5]);     // second subpath is open
  assert.deepEqual(pathNodes(parsePath('M0 0 L1 1 M5 5 L6 6')).ends, [0, 1, 2, 3]);
  assert.deepEqual(pathNodes(parsePath('M0 0 L1 1 L2 0 Z')).seg, [0, 1, 2]);                  // Z has no anchor
});

test('pinnedIdx: endpoints, indices, negative indices, out of range ignored', () => {
  const n = polyNodes([[0, 0], [1, 1], [2, 2], [3, 3]], false);
  assert.deepEqual(pinnedIdx(n, ['endpoints']), [0, 3]);
  assert.deepEqual(pinnedIdx(n, [1, -1, 9, -9]), [1, 3]);
  assert.deepEqual(pinnedIdx(polyNodes([[0, 0], [1, 1], [2, 2]], true), ['endpoints']), []);
});

const PIN = compilePolicy([{ can: 'all', pin: ['endpoints'] }]);

test('pinned endpoints: an interior node may move, an endpoint may not', () => {
  const e = el('path', { d: 'M0 0 C 10 0, 20 0, 30 10 L 40 40 L 50 10' });
  assert.equal(write(PIN, e, 'd', 'M0 0 C 10 0 20 0 35 15 L 40 40 L 50 10').ok, true);
  assert.deepEqual(write(PIN, e, 'd', 'M5 0 C 10 0 20 0 30 10 L 40 40 L 50 10'), { ok: false, cap: 'pin', reason: 'pinned' });
  assert.equal(write(PIN, e, 'd', 'M0 0 C 10 0 20 0 30 10 L 40 40 L 50 12').reason, 'pinned');
});

test('pinned endpoints: control handles beside an endpoint stay free', () => {
  const e = el('path', { d: 'M0 0 C 10 0, 20 0, 30 10' });
  assert.equal(write(PIN, e, 'd', 'M0 0 C 10 9 20 9 30 10').ok, true);
});

test('pinned endpoints: relative path data is compared in absolute terms, within 3-decimal rounding tolerance', () => {
  const e = el('path', { d: 'm 10.0004 20 l 5 5 l 5 -5' });
  assert.equal(write(PIN, e, 'd', 'M10.0004 20 L15.0004 25 L20.0004 20').ok, true);
  assert.equal(write(PIN, e, 'd', 'M10 20 L 15.5 25 L 20.0004 20').ok, true);   // 0.0004 apart: rounding, not a move
});

test('pinned endpoints: deleting an endpoint is refused even where nodes.delete is allowed', () => {
  const e = el('path', { d: 'M0 0 L 10 10 L 20 0 L 30 10' });
  assert.equal(write(PIN, e, 'd', 'M10 10 L 20 0 L 30 10').ok, false);
  assert.equal(write(PIN, e, 'd', 'M0 0 L 20 0 L 30 10').ok, true);            // interior node deleted: endpoints intact
  assert.equal(write(PIN, e, 'd', 'M0 0 L 10 10 L 15 5 L 20 0 L 30 10').ok, true);   // interior node inserted
});

test('pinned: transforms are switched off', () => {
  const e = el('path', { d: 'M0 0 L 10 10 L 20 0' });
  assert.deepEqual(caps(PIN.resolve(e)), ['attrs.edit', 'geometry.edit', 'nodes.delete', 'nodes.insert']);
  assert.equal(write(PIN, e, 'transform', 'translate(5 5)', 'transform.move').ok, false);
  assert.equal(modeOk(PIN.resolve(e), 'scale'), false);
  assert.equal(modeOk(PIN.resolve(e), 'edit'), true);
});

test('pinned by index: nodes.insert and nodes.delete are switched off too (indices would shift)', () => {
  const pol = compilePolicy([{ can: 'all', pin: [0, -1] }]);
  const e = el('polyline', { points: '0,0 10,10 20,0' });
  assert.deepEqual(caps(pol.resolve(e)), ['attrs.edit', 'geometry.edit']);
  assert.equal(write(pol, e, 'points', '0,0 10,15 20,0').ok, true);
  assert.equal(write(pol, e, 'points', '0,0 20,0').reason, 'capability');
  assert.equal(write(pol, e, 'points', '1,0 10,10 20,0').reason, 'pinned');
});

test('pins on a closed shape pin nothing (but still switch transforms off); pins ignore shapes without nodes', () => {
  const poly = el('polygon', { points: '0,0 10,0 10,10' });
  assert.equal(write(PIN, poly, 'points', '1,1 10,0 10,10').ok, true);
  assert.equal(modeOk(PIN.resolve(poly), 'scale'), false);
  const rect = el('rect', { x: '0' });
  assert.equal(modeOk(PIN.resolve(rect), 'scale'), true);
  assert.equal(write(PIN, rect, 'x', '5').ok, true);
});

test('pinned line: both endpoints hold, one coordinate at a time', () => {
  const e = el('line', { x1: '0', y1: '0', x2: '10', y2: '10' });
  assert.equal(write(PIN, e, 'x1', '3').reason, 'pinned');
  assert.equal(write(PIN, e, 'y2', '3').reason, 'pinned');
  assert.equal(write(compilePolicy([{ can: 'all', pin: [0] }]), e, 'x2', '30').ok, true);   // only node 0 is pinned
});

test('removing the geometry attribute counts as deleting its nodes', () => {
  const e = el('path', { d: 'M0 0 L 10 10' });
  assert.equal(write(compilePolicy([{ can: 'geometry.edit' }]), e, 'd', null).cap, 'nodes.delete');
});

/* ---- ranges ---- */
const RANGE = compilePolicy([{ can: 'all', ranges: { r: [5, 50], width: [10, null], 'stroke-width': [null, 8], 'fill-*': [0, 1] } }]);

test('ranges clamp numeric attribute values and keep the unit', () => {
  const e = el('circle', { r: '20' });
  assert.deepEqual(write(RANGE, e, 'r', '100'), { ok: true, value: '50' });
  assert.deepEqual(write(RANGE, e, 'r', '2'), { ok: true, value: '5' });
  assert.deepEqual(write(RANGE, e, 'r', '30'), { ok: true });                  // inside: stored as given
  assert.deepEqual(write(RANGE, el('rect'), 'width', '4.5'), { ok: true, value: '10' });
  assert.deepEqual(write(RANGE, el('rect'), 'width', '1e3'), { ok: true });    // open upper end
  assert.deepEqual(write(RANGE, el('rect'), 'stroke-width', '12px'), { ok: true, value: '8px' });
  assert.deepEqual(write(RANGE, el('rect'), 'stroke-width', '-3'), { ok: true });   // open lower end
  assert.deepEqual(write(RANGE, el('rect'), 'fill-opacity', '1.7'), { ok: true, value: '1' });   // glob key
});

test('ranges refuse values that are not numbers, and removing a ranged attribute', () => {
  const e = el('circle', { r: '20' });
  assert.deepEqual(write(RANGE, e, 'r', 'big'), { ok: false, cap: 'range', reason: 'range' });
  assert.equal(write(RANGE, e, 'r', null).reason, 'range');
  assert.equal(write(RANGE, e, 'r', '').reason, 'range');
  assert.equal(write(RANGE, el('rect'), 'opacity', 'x').ok, true);   // not a ranged attribute
});

test('ranges also limit style properties of the same name; unchanged ones are left alone', () => {
  const e = el('rect', { style: 'fill:red; stroke-width:50' });      // already out of range: not our business until it is written
  assert.deepEqual(write(RANGE, e, 'style', 'fill:blue; stroke-width:50'), { ok: true });
  assert.deepEqual(write(RANGE, e, 'style', 'fill:red; stroke-width:20'), { ok: true, value: 'fill:red; stroke-width:8' });
  assert.equal(write(RANGE, e, 'style', 'fill:red; stroke-width:thick').reason, 'range');
  assert.equal(write(RANGE, e, 'style', 'fill:red').reason, 'range');            // dropping a ranged property
});

test('ranges: later rule replaces, {} clears, bad ranges throw; range() reports the limits', () => {
  const e = el('circle', {}, 'free');
  const pol = compilePolicy([{ can: 'all', ranges: { r: [5, 50] } }, { select: '.free', ranges: {} }]);
  assert.equal(pol.resolve(e).range('r'), null);
  assert.deepEqual(RANGE.resolve(e).range('r'), [5, 50]);
  assert.deepEqual(RANGE.resolve(e).range('width'), [10, null]);
  assert.deepEqual(RANGE.resolve(e).range('stroke-width'), [null, 8]);
  assert.equal(RANGE.resolve(e).range('cx'), null);
  assert.throws(() => compilePolicy([{ ranges: { r: [50, 5] } }]), /bad range for "r"/);
  assert.throws(() => compilePolicy([{ ranges: { r: ['a', 5] } }]), /bad range/);
});

test('ranges apply after the capability check, and to node-less attributes of any shape', () => {
  assert.equal(write(compilePolicy([{ can: 'transform.move', ranges: { r: [5, 50] } }]), el('circle'), 'r', '100').reason, 'capability');
});

/* ---- parseTransform ---- */
test('parseTransform matches the SVG transform list', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(parseTransform(''), [1, 0, 0, 1, 0, 0]));
  assert.ok(near(parseTransform('translate(5 7) scale(2)'), [2, 0, 0, 2, 5, 7]));
  assert.ok(near(parseTransform('translate(5) scale(2 3)'), [2, 0, 0, 3, 5, 0]));
  assert.ok(near(parseTransform('rotate(90)'), [0, 1, -1, 0, 0, 0]));
  assert.ok(near(parseTransform('rotate(90 10 10)'), [0, 1, -1, 0, 20, 0]));      // the centre (10,10) stays put
  assert.ok(near(parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]));
  assert.ok(near(parseTransform('skewX(45)'), [1, 0, 1, 1, 0, 0]));
  assert.ok(near(parseTransform('rotate(10 90 100) translate(30 0) scale(2 1) translate(-30 0)').slice(0, 4), parseTransform('rotate(10) scale(2 1)').slice(0, 4)));
});

/* ---- bounds ---- */
const BOX = { x: 0, y: 0, width: 100, height: 100 };
const BND = compilePolicy([{ can: 'all', bounds: BOX }]);
const pts = s => s.split(' ').map(q => q.split(',').map(Number));
const inside = (ps, b = [0, 0, 100, 100]) => ps.every(([x, y]) => x >= b[0] - 1e-3 && x <= b[2] + 1e-3 && y >= b[1] - 1e-3 && y <= b[3] + 1e-3);

test('bounds: object and array forms, null clears, nonsense throws', () => {
  const e = el('rect', {}, 'free');
  assert.deepEqual(compilePolicy([{ can: 'all', bounds: [0, 0, 100, 50] }]).resolve(e).bounds, [0, 0, 100, 50]);
  assert.deepEqual(BND.resolve(e).bounds, [0, 0, 100, 100]);
  assert.equal(compilePolicy([{ can: 'all', bounds: BOX }, { select: '.free', bounds: null }]).resolve(e).bounds, null);
  assert.throws(() => compilePolicy([{ bounds: { x: 0, y: 0, width: -1, height: 5 } }]), /bounds needs/);
  assert.throws(() => compilePolicy([{ bounds: { x: 0, y: 0 } }]), /bounds needs/);
});

test('bounds: a dragged vertex stops at the wall, the other vertices are left alone', () => {
  const e = el('polygon', { points: '10,10 50,10 50,50 10,50' });
  assert.deepEqual(write(BND, e, 'points', '150,-20 50,10 50,50 10,50'), { ok: true, value: '100,0 50,10 50,50 10,50' });
  assert.deepEqual(write(BND, e, 'points', '40,30 50,10 50,50 10,50'), { ok: true });   // inside: untouched
});

test('bounds: a shape already out of bounds may be edited as long as the edit does not make it worse', () => {
  const e = el('polygon', { points: '10,10 150,10 50,50' });
  assert.deepEqual(write(BND, e, 'points', '20,20 150,10 50,50'), { ok: true });          // unrelated vertex moved
  assert.deepEqual(write(BND, e, 'points', '10,10 190,10 50,50'), { ok: true, value: '10,10 100,10 50,50' }); // pushed further out: clamped
});

test('bounds: moving a shape slides it back in as a whole, nothing is squashed', () => {
  const e = el('polygon', { points: '10,10 50,10 50,50 10,50' });
  assert.deepEqual(write(BND, e, 'points', '210,10 250,10 250,50 210,50', 'transform.move'), { ok: true, value: '60,10 100,10 100,50 60,50' });
  assert.deepEqual(write(BND, e, 'points', '-90,-90 -50,-90 -50,-50 -90,-50', 'transform.move'), { ok: true, value: '0,0 40,0 40,40 0,40' });
  const p = el('path', { d: 'M10 10 L 30 10 L 30 30' });
  assert.deepEqual(write(BND, p, 'd', 'M110 10 L 130 10 L 130 30', 'transform.move'), { ok: true, value: 'M80 10 L100 10 L100 30' });
});

test('bounds: a path\'s bezier handles count too', () => {
  const e = el('path', { d: 'M10 10 C 20 0 30 0 40 10' });
  assert.deepEqual(write(BND, e, 'd', 'M10 10 C 20 -50 30 0 40 10'), { ok: true, value: 'M10 10 C20 0 30 0 40 10' });
  assert.deepEqual(write(BND, e, 'd', 'M10 10 C 20 0 130 40 40 10'), { ok: true, value: 'M10 10 C20 0 100 40 40 10' });
});

test('bounds: an arc that would bulge out is refused, one that stays in is fine', () => {
  const e = el('path', { d: 'M10 50 A 20 20 0 0 1 50 50' });
  assert.equal(write(BND, e, 'd', 'M10 50 A 20 20 0 0 1 50 50').ok, true);
  assert.deepEqual(write(BND, e, 'd', 'M10 50 A 20 80 0 0 1 50 50'), { ok: false, cap: 'bounds', reason: 'bounds' });
});

test('bounds: a rect resized past the wall stops at it; a corner drag keeps the opposite edges and slides along the other axis', () => {
  const e = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  const w = ch => checkWrites(BND.resolve(e), 'rect', get(e), ch);
  let r = w([{ attr: 'width', nw: '200' }]);
  assert.equal(r.values.get('width'), '90');
  r = w([{ attr: 'x', nw: '10' }, { attr: 'y', nw: '-30' }, { attr: 'width', nw: '70' }, { attr: 'height', nw: '90' }]);   // top-left... bottom edge fixed at 60
  assert.deepEqual([...r.values], [['x', '10'], ['y', '0'], ['width', '70'], ['height', '60']]);
  r = w([{ attr: 'x', nw: '-20' }, { attr: 'y', nw: '-20' }, { attr: 'width', nw: '50' }, { attr: 'height', nw: '50' }]);   // a move into the corner
  assert.deepEqual([...r.values], [['x', '0'], ['y', '0'], ['width', '50'], ['height', '50']]);
  r = w([{ attr: 'x', nw: '-20' }, { attr: 'y', nw: '30' }, { attr: 'width', nw: '50' }, { attr: 'height', nw: '50' }]);     // x blocked, y still slides
  assert.deepEqual([...r.values], [['x', '0'], ['y', '30'], ['width', '50'], ['height', '50']]);
});

test('bounds: circle, ellipse and line', () => {
  const c = el('circle', { cx: '50', cy: '50', r: '10' });
  assert.deepEqual(write(BND, c, 'r', '80'), { ok: true, value: '50' });
  assert.deepEqual(write(BND, c, 'cx', '150', 'transform.move'), { ok: true, value: '90' });
  const ell = el('ellipse', { cx: '50', cy: '50', rx: '10', ry: '10' });
  assert.deepEqual(write(BND, ell, 'ry', '70'), { ok: true, value: '50' });
  assert.deepEqual(write(BND, ell, 'rx', '30'), { ok: true });
  const l = el('line', { x1: '0', y1: '0', x2: '10', y2: '10' });
  const r = checkWrites(BND.resolve(l), 'line', get(l), [{ attr: 'x1', nw: '-20' }, { attr: 'y1', nw: '5' }]);
  assert.deepEqual([...r.values], [['x1', '0'], ['y1', '5']]);
});

test('bounds are judged in the parent coordinate system: the shape\'s own transform counts', () => {
  const e = el('rect', { x: '10', y: '10', width: '50', height: '50', transform: 'translate(30 0)' });
  assert.deepEqual(write(BND, e, 'width', '200'), { ok: true, value: '60' });             // 30 + 10 + 60 = 100
  const r = el('rect', { x: '10', y: '10', width: '20', height: '20', transform: 'rotate(45)' });
  const first = checkWrites(BND.resolve(r), 'rect', get(r), [{ attr: 'width', nw: '400' }]);
  const w1 = first.values.get('width');
  assert.ok(+w1 < 400 && +w1 > 20);
  const again = checkWrites(BND.resolve(r), 'rect', k => (k === 'width' ? w1 : get(r)(k)), [{ attr: 'width', nw: w1 }]);
  assert.equal(again.values.get('width'), w1);                                              // already fits: nothing more to clamp
});

test('bounds: scale, rotate and skew that would leave the box are refused; ones that stay in are fine', () => {
  const e = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  assert.deepEqual(write(BND, e, 'transform', 'scale(3)', 'transform.scale'), { ok: false, cap: 'bounds', reason: 'bounds' });
  assert.deepEqual(write(BND, e, 'transform', 'scale(1.5)', 'transform.scale'), { ok: true });
  assert.equal(write(BND, e, 'transform', 'rotate(45 85 85)', 'transform.rotate').reason, 'bounds');
});

test('bounds: elements the module cannot measure use env.bbox, and are refused without it', () => {
  const t = el('text');
  const bbox = () => [0, 0, 20, 10];
  assert.deepEqual(write(BND, t, 'transform', 'translate(200 0)', 'transform.move') .ok, false);                       // no env: can't tell
  const r = checkWrite(BND.resolve(t), 'text', get(t), 'transform', 'translate(200 0)', 'transform.move', { bbox });
  assert.deepEqual(r, { ok: true, value: 'matrix(1 0 0 1 80 0)' });
  assert.deepEqual(checkWrite(BND.resolve(t), 'text', get(t), 'transform', 'translate(40 40)', 'transform.move', { bbox }), { ok: true });
  assert.equal(checkWrite(BND.resolve(t), 'text', get(t), 'transform', 'scale(9)', 'transform.scale', { bbox }).reason, 'bounds');
});

test('bounds only judge geometry: other attributes pass, and writes that do not move the shape pass', () => {
  const e = el('rect', { x: '90', y: '10', width: '50', height: '50' });     // already sticks out the right
  assert.deepEqual(write(BND, e, 'fill', 'red'), { ok: true });
  assert.deepEqual(write(BND, e, 'rx', '5'), { ok: true });
  assert.deepEqual(write(BND, e, 'y', '20'), { ok: true });
});

test('bounds: a refusal names the attribute; a later rule can lift the bounds', () => {
  const e = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  const r = checkWrites(BND.resolve(e), 'rect', get(e), [{ attr: 'fill', nw: 'red' }, { attr: 'transform', nw: 'scale(3)', hint: 'transform.scale' }]);
  assert.deepEqual([r.ok, r.attr, r.reason], [false, 'transform', 'bounds']);
  const free = el('rect', { x: '10', y: '10', width: '50', height: '50' }, 'free');
  const pol = compilePolicy([{ can: 'all', bounds: BOX }, { select: '.free', bounds: null }]);
  assert.equal(checkWrite(pol.resolve(free), 'rect', get(free), 'width', '900').ok, true);
});

test('checkWrites: all-or-nothing, and later writes to one attribute win in the caller (the group sees them in order)', () => {
  const e = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  const pol = compilePolicy([{ can: ['geometry.edit'], ranges: { width: [20, 40] } }]);
  const r = checkWrites(pol.resolve(e), 'rect', get(e), [{ attr: 'x', nw: '15' }, { attr: 'width', nw: '90' }]);
  assert.deepEqual([...r.values], [['x', '15'], ['width', '40']]);
  const bad = checkWrites(pol.resolve(e), 'rect', get(e), [{ attr: 'x', nw: '15' }, { attr: 'fill', nw: 'red' }]);
  assert.deepEqual([bad.ok, bad.attr, bad.cap], [false, 'fill', 'attrs.edit']);
});

/* ---- markup: data-sable-policy ---- */
/* a stand-in with a parent chain, like an SVG element */
const node = (tag, attrs = {}, parent = null, cls = '') => ({ tagName: tag, id: attrs.id || '', parentNode: parent, getAttribute: k => (k in attrs ? attrs[k] : null), matches: q => q === '.' + cls || q === tag });
const quiet = fn => { const orig = console.error, seen = []; console.error = m => seen.push(m); try { return [fn(), seen]; } finally { console.error = orig; } };

test('parseMarkup: every clause, in the same shape a policy rule takes', () => {
  assert.deepEqual(parseMarkup('geometry.edit, nodes.*; -nodes.delete; attrs-deny: stroke*, style; attrs-allow: ; pin: endpoints, 0, -1; bounds: 0 0 600 400; range: r=5..50; range: stroke-width=1..; range: opacity=..1'), {
    can: ['geometry.edit', 'nodes.*'], cannot: ['nodes.delete'], attrs: { deny: ['stroke*', 'style'], allow: null },
    pin: ['endpoints', 0, -1], bounds: [0, 0, 600, 400], ranges: { r: [5, 50], 'stroke-width': [1, null], opacity: [null, 1] } });
  assert.deepEqual(parseMarkup('can: transform.*; cannot: transform.skew'), { can: ['transform.*'], cannot: ['transform.skew'] });
  assert.deepEqual(parseMarkup('  ;; all ;'), { can: ['all'] });
  assert.deepEqual(parseMarkup(''), {});
  assert.deepEqual(parseMarkup('pin:; bounds: none; range: none'), { pin: [], bounds: null, ranges: {} });
  assert.deepEqual(parseMarkup('range: r=0.5..1.5'), { ranges: { r: [0.5, 1.5] } });
  assert.deepEqual(parseMarkup('BOUNDS: 1,2,3,4'), { bounds: [1, 2, 3, 4] });
});

test('parseMarkup: anything it does not understand throws', () => {
  assert.throws(() => parseMarkup('bogus: 1'), /unknown clause "bogus"/);
  assert.throws(() => parseMarkup('bounds: 1 2 3'), /four numbers/);
  assert.throws(() => parseMarkup('range: r'), /name=min\.\.max/);
  assert.throws(() => parseMarkup('range: r=5'), /name=min\.\.max/);
  assert.throws(() => compilePolicy(['markup']).validate(node('svg', { [MARKUP_ATTR]: 'geometry.edti' })), /unknown capability "geometry.edti"/);
  assert.throws(() => compilePolicy(['markup']).validate(node('svg', { [MARKUP_ATTR]: 'pin: endpoint' })), /bad pin "endpoint"/);
  assert.throws(() => compilePolicy(['markup']).validate(node('svg', { [MARKUP_ATTR]: 'range: r=9..1' })), /bad range for "r"/);
  assert.throws(() => compilePolicy(['markup']).validate(node('svg', { [MARKUP_ATTR]: 'bounds: 0 0 -5 5' })), /bounds needs/);
});

test('markup is read only when the policy says so: content cannot grant itself powers', () => {
  const e = node('path', { [MARKUP_ATTR]: 'all' }, null, 'a');
  assert.deepEqual(caps(compilePolicy([{ select: '.a', can: 'transform.move' }]).resolve(e)), ['transform.move']);
  assert.deepEqual(caps(compilePolicy([{ select: '.a', can: 'transform.move' }, 'markup']).resolve(e)), [...CAPS].sort());
  assert.deepEqual(caps(compilePolicy('markup').resolve(e)), [...CAPS].sort());          // the short form
  assert.deepEqual(caps(compilePolicy('markup').resolve(node('path'))), []);              // no attribute, default-deny
  assert.throws(() => compilePolicy('nope'), /a rule is an object/);
  assert.throws(() => compilePolicy(['markp']), /a rule is an object/);
});

test('markup: where "markup" sits in the list decides who wins', () => {
  const e = node('path', { [MARKUP_ATTR]: '-transform.move; attrs-deny: fill' }, null, 'a');
  const after = compilePolicy([{ select: '.a', can: 'all' }, 'markup']).resolve(e);       // markup overrides the rule
  assert.equal(after.can('transform.move'), false);
  assert.equal(after.can('transform.scale'), true);
  assert.equal(after.propOk('fill'), false);
  const before = compilePolicy(['markup', { select: '.a', can: 'transform.move', attrs: { deny: [] } }]).resolve(e);   // the rule overrides the markup
  assert.equal(before.can('transform.move'), true);
  assert.equal(before.propOk('fill'), true);
});

test('markup: ancestors apply outermost first, the root <svg> is the default, and the editor root is the limit', () => {
  const outer = node('div', { [MARKUP_ATTR]: 'all' });
  const svg = node('svg', { [MARKUP_ATTR]: 'transform.*' }, outer);
  const g = node('g', { [MARKUP_ATTR]: 'geometry.edit; -transform.skew' }, svg);
  const a = node('path', {}, g), b = node('path', { [MARKUP_ATTR]: 'cannot: transform.move; attrs.edit' }, g), plain = node('path', {}, svg);
  const pol = compilePolicy('markup', { root: svg });
  assert.deepEqual(caps(pol.resolve(plain)), ['transform.move', 'transform.rotate', 'transform.scale', 'transform.skew']);
  assert.deepEqual(caps(pol.resolve(a)), ['geometry.edit', 'transform.move', 'transform.rotate', 'transform.scale']);
  assert.deepEqual(caps(pol.resolve(b)), ['attrs.edit', 'geometry.edit', 'transform.rotate', 'transform.scale']);
  assert.deepEqual(caps(compilePolicy('markup').resolve(plain)), [...CAPS].sort());       // with no root given the walk goes all the way up
});

test('markup gives the same permissions as the equivalent rule', () => {
  const m = node('path', { [MARKUP_ATTR]: 'geometry.edit, nodes.*, attrs.edit; attrs-deny: stroke*; attrs-allow: fill, stroke*; pin: endpoints, -1; bounds: 0 0 100 50; range: r=5..50' });
  const a = compilePolicy('markup').resolve(m);
  const b = compilePolicy([{ can: ['geometry.edit', 'nodes.*', 'attrs.edit'], attrs: { deny: ['stroke*'], allow: ['fill', 'stroke*'] }, pin: ['endpoints', -1], bounds: [0, 0, 100, 50], ranges: { r: [5, 50] } }]).resolve(node('path'));
  assert.deepEqual(caps(a), caps(b));
  assert.deepEqual([a.pin, a.bounds, a.range('r'), a.propOk('fill'), a.propOk('stroke'), a.propOk('x')], [b.pin, b.bounds, b.range('r'), b.propOk('fill'), b.propOk('stroke'), b.propOk('x')]);
});

test('markup: a changed attribute is picked up on the next resolve', () => {
  const attrs = { [MARKUP_ATTR]: 'all' }, e = node('path', attrs), pol = compilePolicy('markup');
  assert.equal(pol.resolve(e).can('geometry.edit'), true);
  attrs[MARKUP_ATTR] = 'transform.move';
  assert.deepEqual(caps(pol.resolve(e)), ['transform.move']);
});

test('markup that appears later and does not parse fails closed, once, loudly; an inner declaration can grant again', () => {
  const g = node('g', { [MARKUP_ATTR]: 'all' }), bad = node('path', { [MARKUP_ATTR]: 'bogus: 1' }, g), fixed = node('path', { [MARKUP_ATTR]: 'bogus: 1; geometry.edit' }, g);
  const pol = compilePolicy('markup');
  const [p, seen] = quiet(() => { const r = pol.resolve(bad); pol.resolve(bad); pol.resolve(bad); return r; });
  assert.deepEqual(caps(p), []);
  assert.equal(p.selectable, false);
  assert.equal(seen.length, 1);                       // reported once, not on every pointer move
  assert.match(seen[0], /unknown clause "bogus".*switched off/);
  const inner = node('path', { [MARKUP_ATTR]: 'geometry.edit' }, bad);                      // a valid declaration deeper down still applies
  assert.deepEqual(caps(quiet(() => pol.resolve(inner))[0]), ['geometry.edit']);
  assert.deepEqual(caps(quiet(() => pol.resolve(fixed))[0]), []);                           // the whole declaration is rejected, not half of it
});

test('validate: finds a bad declaration anywhere under the root and names the element; fine markup and non-markup policies pass', () => {
  const bad = node('rect', { id: 'oops', [MARKUP_ATTR]: 'can: nope' });
  const root = { tagName: 'svg', getAttribute: () => null, querySelectorAll: () => [node('path', { [MARKUP_ATTR]: 'all' }), bad] };
  assert.throws(() => compilePolicy(['markup']).validate(root), /unknown capability "nope".*<rect id="oops">/);
  assert.doesNotThrow(() => compilePolicy([{ can: 'all' }]).validate(root));                // markup isn't enabled: not looked at
  assert.doesNotThrow(() => compilePolicy('markup').validate({ tagName: 'svg', getAttribute: () => null, querySelectorAll: () => [] }));
});

test('the policy attribute cannot be written through the editor, even by a shape that can do everything', () => {
  const e = node('path', {}, null, 'a'), pol = compilePolicy([{ can: 'all' }, 'markup']);
  assert.deepEqual(checkWrite(pol.resolve(e), 'path', k => e.getAttribute(k), MARKUP_ATTR, 'all'), { ok: false, cap: 'attrs.edit', reason: 'attribute' });
  assert.equal(checkWrite(pol.resolve(e), 'path', k => e.getAttribute(k), MARKUP_ATTR, null).ok, false);
  assert.equal(canSet(pol.resolve(e), 'path', MARKUP_ATTR), false);
  assert.equal(canSet(pol.resolve(e), 'path', 'fill'), true);
});

/* ---- snap ---- */
const SN = compilePolicy([{ can: 'all', snap: 10 }]);
const ws = (pol, e, tag, changes, env) => checkWrites(pol.resolve(e), tag, get(e), changes, env);
const vals = r => [...r.values];

test('snap: number, pair and object forms; null clears; nonsense throws', () => {
  const e = node('rect', {}, null, 'free');
  assert.deepEqual(compilePolicy([{ can: 'all', snap: 10 }]).resolve(e).snap, [10, 10]);
  assert.deepEqual(compilePolicy([{ can: 'all', snap: [10, 5] }]).resolve(e).snap, [10, 5]);
  assert.deepEqual(compilePolicy([{ can: 'all', snap: { x: 10, y: 5 } }]).resolve(e).snap, [10, 5]);
  assert.deepEqual(compilePolicy([{ can: 'all', snap: { x: 10 } }]).resolve(e).snap, [10, 10]);
  assert.equal(compilePolicy([{ can: 'all', snap: 10 }, { select: '.free', snap: null }]).resolve(e).snap, null);
  assert.equal(compilePolicy([{ can: 'all' }]).resolve(e).snap, null);
  for (const bad of [0, -5, 'ten', [10, 0], NaN, {}]) assert.throws(() => compilePolicy([{ snap: bad }]), /snap needs a positive number/);
});

test('snap: a moved rect lands on the grid and keeps its size', () => {
  const e = el('rect', { x: '13', y: '27', width: '50', height: '33' });
  const r = ws(SN, e, 'rect', [{ attr: 'x', nw: '44', hint: 'transform.move' }, { attr: 'y', nw: '61', hint: 'transform.move' }]);
  assert.deepEqual(vals(r), [['x', '40'], ['y', '60']]);
  assert.deepEqual(write(SN, el('rect', { x: '0', y: '0', width: '20', height: '20' }), 'x', '47'), { ok: true, value: '50' });   // ed.set too
});

test('snap: resizing moves only the edge you drag; the other edge and untouched sizes stay exactly as they were', () => {
  const e = el('rect', { x: '13', y: '10', width: '50', height: '33' });
  let r = ws(SN, e, 'rect', [{ attr: 'x', nw: '8' }, { attr: 'y', nw: '10' }, { attr: 'width', nw: '55' }, { attr: 'height', nw: '33' }]);   // left edge dragged left
  assert.deepEqual(vals(r), [['x', '10'], ['y', '10'], ['width', '53'], ['height', '33']]);        // right edge still 63, height still 33
  r = ws(SN, e, 'rect', [{ attr: 'width', nw: '78' }]);                                            // right edge dragged
  assert.deepEqual(vals(r), [['width', '77']]);                                                    // 13 + 77 = 90
  const t = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  assert.deepEqual(vals(ws(SN, t, 'rect', [{ attr: 'width', nw: '12' }])), [['width', '10']]);
  assert.deepEqual(vals(ws(SN, t, 'rect', [{ attr: 'width', nw: '3' }])), [['width', '10']]);      // never collapses to nothing
});

test('snap: circle and ellipse centres, and the edge a radius handle drags', () => {
  const c = el('circle', { cx: '25', cy: '25', r: '10' });
  assert.deepEqual(vals(ws(SN, c, 'circle', [{ attr: 'r', nw: '18' }])), [['r', '15']]);          // centre + r = 40, on the grid, though the centre is not
  assert.deepEqual(vals(ws(SN, c, 'circle', [{ attr: 'cx', nw: '38', hint: 'transform.move' }, { attr: 'cy', nw: '52', hint: 'transform.move' }])), [['cx', '40'], ['cy', '50']]);
  const xy = compilePolicy([{ can: 'all', snap: [10, 5] }]), e = el('ellipse', { cx: '20', cy: '20', rx: '10', ry: '10' });
  assert.deepEqual(vals(ws(xy, e, 'ellipse', [{ attr: 'ry', nw: '17' }])), [['ry', '15']]);        // y step 5
  assert.deepEqual(vals(ws(xy, e, 'ellipse', [{ attr: 'rx', nw: '13' }])), [['rx', '10']]);        // x step 10
});

test('snap: a dragged line end snaps alone, a moved line shifts as one', () => {
  const l = el('line', { x1: '0', y1: '0', x2: '30', y2: '30' });
  assert.deepEqual(vals(ws(SN, l, 'line', [{ attr: 'x2', nw: '43' }, { attr: 'y2', nw: '17' }])), [['x2', '40'], ['y2', '20']]);
  const mv = (a, b, c, d) => vals(ws(SN, l, 'line', [{ attr: 'x1', nw: a, hint: 'transform.move' }, { attr: 'y1', nw: b, hint: 'transform.move' }, { attr: 'x2', nw: c, hint: 'transform.move' }, { attr: 'y2', nw: d, hint: 'transform.move' }]));
  assert.deepEqual(mv('3', '4', '33', '34'), [['x1', '0'], ['y1', '0'], ['x2', '30'], ['y2', '30']]);
  assert.deepEqual(mv('12', '4', '42', '34'), [['x1', '10'], ['y1', '0'], ['x2', '40'], ['y2', '30']]);   // length 30 kept
});

test('snap: polygon vertices; a move is rigid; points that did not move stay exactly where they were', () => {
  const e = el('polygon', { points: '10,10 50,10 50,50 10,50' });
  assert.deepEqual(write(SN, e, 'points', '13,16 50,10 50,50 10,50'), { ok: true, value: '10,20 50,10 50,50 10,50' });
  assert.deepEqual(write(SN, e, 'points', '13,16 53,16 53,56 13,56', 'transform.move'), { ok: true, value: '10,20 50,20 50,60 10,60' });
  const odd = el('polygon', { points: '11,11 52,12 53,53' });                                       // off the grid to begin with
  assert.deepEqual(write(SN, odd, 'points', '11,11 52,12 55,57'), { ok: true, value: '11,11 52,12 60,60' });   // only the touched vertex snaps... 55,57 -> 60,60
});

test('snap: a path node and the bezier handles that travel with it snap together and keep their offsets', () => {
  const e = el('path', { d: 'M0 0 C 10 0 20 0 30 0 C 40 0 50 0 60 0' });
  assert.deepEqual(write(SN, e, 'd', 'M0 0 C 10 0 23.2 1.4 33.2 1.4 C 43.2 1.4 50 0 60 0'), { ok: true, value: 'M0 0 C10 0 20 0 30 0 C40 0 50 0 60 0' });   // snaps back where it was
  assert.deepEqual(write(SN, e, 'd', 'M0 0 C 10 0 26 7 36 7 C 46 7 50 0 60 0'), { ok: true, value: 'M0 0 C10 0 30 10 40 10 C50 10 50 0 60 0' });
  assert.deepEqual(write(SN, e, 'd', 'M0 0 C 10 0 27 6 30 0 C 40 0 50 0 60 0'), { ok: true, value: 'M0 0 C10 0 30 10 30 0 C40 0 50 0 60 0' });   // a handle on its own
  assert.deepEqual(write(SN, e, 'd', 'M3 6 C 13 6 23 6 33 6 C 43 6 53 6 63 6', 'transform.move'), { ok: true, value: 'M0 10 C10 10 20 10 30 10 C40 10 50 10 60 10' });   // whole path: rigid
});

test('snap: adding or deleting a node is not snapped; arc parameters are not touched', () => {
  const e = el('path', { d: 'M0 0 L 30 33 L 60 0' });
  assert.deepEqual(write(SN, e, 'd', 'M0 0 L 15 16.5 L 30 33 L 60 0'), { ok: true });             // the new node sits on the line, where it was put
  assert.deepEqual(write(SN, e, 'd', 'M0 0 L 60 0'), { ok: true });
  const a = el('path', { d: 'M10 50 A 20 20 0 0 1 50 50' });
  const r = write(SN, a, 'd', 'M10 50 A 20 20 0 0 1 53 52');
  assert.match(r.value, /^M10 50 A20 20 0 0 1 50 50$/);
});

test('snap: moving text or a group through its transform puts the corner of its box on the grid', () => {
  const t = el('text');
  const bbox = () => [3, 4, 20, 14];
  assert.deepEqual(checkWrite(SN.resolve(t), 'text', get(t), 'transform', 'translate(12.4 7.7)', 'transform.move', { bbox }), { ok: true, value: 'matrix(1 0 0 1 17 6)' });   // (3,4) + (17,6) = (20,10)
  assert.deepEqual(checkWrite(SN.resolve(t), 'text', get(t), 'transform', 'translate(12.4 7.7)', 'transform.move'), { ok: true, value: 'matrix(1 0 0 1 10 10)' });   // no box: the translation itself
  const placed = el('text', { transform: 'translate(13 17)' });
  assert.deepEqual(checkWrite(SN.resolve(placed), 'text', get(placed), 'transform', 'translate(13 17)', 'transform.move', { bbox }), { ok: true });   // not moved: not snapped
  assert.deepEqual(checkWrite(SN.resolve(t), 'text', get(t), 'transform', 'scale(1.37)', 'transform.scale', { bbox }), { ok: true });                  // scale is left alone
});

test('snap comes first: a range or a wall that is off the grid wins over it', () => {
  const c = el('circle', { cx: '50', cy: '50', r: '20' });
  const rg = compilePolicy([{ can: 'all', snap: 10, ranges: { r: [12, 50] } }]);
  assert.deepEqual(write(rg, c, 'r', '14'), { ok: true, value: '12' });                              // 14 -> edge 64 -> 60 -> r 10 -> range lifts it to 12
  const r = el('rect', { x: '10', y: '10', width: '50', height: '50' });
  const bd = compilePolicy([{ can: 'all', snap: 10, bounds: { x: 0, y: 0, width: 95, height: 95 } }]);
  assert.deepEqual(write(bd, r, 'width', '90'), { ok: true, value: '85' });                          // snap says 90, the wall at 95 says 85 in the end
  assert.deepEqual(write(bd, r, 'width', '77'), { ok: true, value: '80' });                          // on the grid and inside: snap's answer stands
});

test('snap works with pins: pinned nodes are untouched, the others snap', () => {
  const pol = compilePolicy([{ can: 'all', snap: 10, pin: ['endpoints'] }]);
  const e = el('path', { d: 'M3 4 L 40 40 L 57 9' });                                                // endpoints off the grid, and pinned
  assert.deepEqual(write(pol, e, 'd', 'M3 4 L 43 47 L 57 9'), { ok: true, value: 'M3 4 L40 50 L57 9' });
});

test('snap: markup clauses', () => {
  assert.deepEqual(parseMarkup('snap: 10'), { snap: 10 });
  assert.deepEqual(parseMarkup('snap: 10 5'), { snap: [10, 5] });
  assert.deepEqual(parseMarkup('snap: 10, 5'), { snap: [10, 5] });
  assert.deepEqual(parseMarkup('snap: none'), { snap: null });
  assert.throws(() => parseMarkup('snap: 1 2 3'), /one number or two/);
  assert.throws(() => compilePolicy('markup').validate(node('svg', { [MARKUP_ATTR]: 'snap: 0' })), /snap needs a positive number/);
  assert.throws(() => compilePolicy('markup').validate(node('svg', { [MARKUP_ATTR]: 'snap: ten' })), /snap needs a positive number/);
  assert.deepEqual(compilePolicy('markup').resolve(node('rect', { [MARKUP_ATTR]: 'all; snap: 25 5' })).snap, [25, 5]);
});
