import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePolicy, checkConvert, CAPS, OPEN, parseMarkup } from '../../src/policy.js';
import { convertShape } from '../../src/convert.js';

/* stand-ins for elements, as in policy.test.js */
const el = (tag, attrs = {}, cls = '') => ({ tagName: tag, attrs, matches: s => s === '.' + cls || s === tag });
const get = e => a => (a in e.attrs ? e.attrs[a] : null);
/* the whole decision for converting `from` into `to` under `pol`: the geometry, then the policy */
const plan = (pol, from, to, toCls) => {
  const r = convertShape(from.tagName, get(from), to);
  const ne = el(to, { ...from.attrs }, toCls ?? '');
  return checkConvert(pol.resolve(from), pol.resolve(ne), { tagFrom: from.tagName, tagTo: to, get: get(from), attrs: r.attrs });
};
const rect = (extra = {}, cls = 'edit') => el('rect', { x: 10, y: 10, width: 40, height: 20, ...extra }, cls);

test('element.convert is a capability: in CAPS, in "all" and "element.*", off unless granted', () => {
  assert.ok(CAPS.includes('element.convert') && OPEN.can('element.convert'));
  assert.ok(compilePolicy([{ can: 'all' }]).resolve(el('rect')).can('element.convert'));
  assert.ok(compilePolicy([{ can: 'element.*' }]).resolve(el('rect')).can('element.convert'));
  assert.ok(!compilePolicy([{ can: 'geometry.edit' }]).resolve(el('rect')).can('element.convert'));
  assert.ok(compilePolicy([parseMarkup('geometry.edit, element.convert')]).resolve(el('rect')).can('element.convert'));
});

test('checkConvert: needs element.convert and geometry.edit on the shape as it is', () => {
  let r = plan(compilePolicy([{ can: ['geometry.edit', 'nodes.insert'] }]), rect(), 'path');
  assert.deepEqual([r.ok, r.cap, r.reason], [false, 'element.convert', 'capability']);
  r = plan(compilePolicy([{ can: ['element.convert', 'attrs.edit'] }]), rect(), 'path');
  assert.deepEqual([r.ok, r.cap, r.reason], [false, 'geometry.edit', 'capability']);
  r = plan(compilePolicy([{ can: 'all' }]), rect(), 'path');
  assert.equal(r.ok, true); assert.equal(r.values.get('d'), 'M10 10 H50 V30 H10 Z');
});

test('checkConvert: the new element must stay selectable and geometry-editable (rules that key on the tag can take a shape away)', () => {
  const pol = compilePolicy([{ select: 'rect', can: 'all' }]);                      // paths get nothing
  let r = plan(pol, rect(), 'path'); assert.deepEqual([r.ok, r.cap, r.reason], [false, 'select', 'capability']);
  const pol2 = compilePolicy([{ select: 'rect', can: 'all' }, { select: 'path', can: ['attrs.edit', 'transform.move'] }]);
  r = plan(pol2, rect(), 'path'); assert.deepEqual([r.ok, r.cap], [false, 'geometry.edit']);
  const pol3 = compilePolicy([{ select: '.edit', can: 'all' }]);                   // a class rule follows the shape across the change
  assert.equal(plan(pol3, rect(), 'circle', 'edit').ok, true);
});

test('checkConvert: nodes.insert is needed to make something with nodes', () => {
  const pol = compilePolicy([{ can: ['geometry.edit', 'element.convert'] }]);
  let r = plan(pol, rect(), 'path'); assert.deepEqual([r.ok, r.cap, r.reason], [false, 'nodes.insert', 'capability']);
  assert.equal(plan(pol, rect(), 'ellipse').ok, true);                             // an ellipse has no nodes to add
});

test('checkConvert: pins refuse, whichever side they are on', () => {
  const pol = compilePolicy([{ can: 'all', pin: 'endpoints' }]);
  const line = el('line', { x1: 0, y1: 0, x2: 10, y2: 10 });
  let r = plan(pol, line, 'path'); assert.deepEqual([r.ok, r.cap, r.reason], [false, 'pin', 'pinned']);   // the line's ends are pinned
  r = plan(pol, rect(), 'path'); assert.deepEqual([r.ok, r.reason], [false, 'pinned']);                    // the path it would become would be
  assert.equal(plan(pol, rect(), 'ellipse').ok, true);                                                      // pins mean nothing to a rect or an ellipse
});

test('checkConvert: ranges clamp the new shape\'s attributes', () => {
  const pol = compilePolicy([{ can: 'all', ranges: { r: [5, 12] } }]);
  const e = el('ellipse', { cx: 0, cy: 0, rx: 40, ry: 10 });                       // -> circle r = 20, clamped to 12
  const r = plan(pol, e, 'circle'); assert.equal(r.ok, true); assert.equal(r.values.get('r'), '12');
  const strict = compilePolicy([{ can: 'all', ranges: { width: [100, null] } }]);
  const q = plan(strict, el('ellipse', { cx: 0, cy: 0, rx: 40, ry: 10 }), 'rect'); assert.equal(q.values.get('width'), '100');   // the geometry is bent to fit, as for any edit
});

test('checkConvert: bounds - the new shape may not reach further out than the old one', () => {
  const pol = compilePolicy([{ can: 'all', bounds: [0, 0, 100, 100] }]);
  assert.equal(plan(pol, el('circle', { cx: 50, cy: 50, r: 30 }), 'path').ok, true);
  assert.equal(plan(pol, el('circle', { cx: 50, cy: 50, r: 30 }), 'rect').ok, true);               // same box
  let r = plan(pol, el('ellipse', { cx: 50, cy: 90, rx: 40, ry: 8 }), 'circle');                   // r = sqrt(40 * 8) = 17.9: pokes out at the bottom
  assert.deepEqual([r.ok, r.reason], [false, 'bounds']);
  assert.equal(plan(pol, el('ellipse', { cx: 50, cy: 50, rx: 40, ry: 8 }), 'circle').ok, true);    // the same conversion, in the middle
  const out = el('rect', { x: 80, y: 10, width: 40, height: 20 }, 'edit');                         // already hanging out: not made worse
  assert.equal(plan(pol, out, 'path').ok, true);
  assert.equal(plan(pol, out, 'ellipse').ok, true);                                                 // the box of an ellipse in it is the same box
});

test('checkConvert: markup policies travel with the element (the attribute is copied), and the cap can be switched off there', () => {
  const pol = compilePolicy(['markup']);
  const mk = (str) => { const e = el('rect', {}); const c = compilePolicy([parseMarkup(str)]); return c; };
  const on = mk('geometry.edit, nodes.insert, element.convert'), off = mk('geometry.edit, nodes.insert');
  assert.equal(plan(on, rect(), 'path').ok, true);
  assert.equal(plan(off, rect(), 'path').ok, false);
  assert.ok(pol);
});
