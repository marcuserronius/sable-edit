import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* The demo attaches with a policy: `.edit` shapes are unrestricted, and the last two cells are held back.
     #pinned       path  : edit mode only (pinned endpoints switch transforms off), interior nodes add/delete, stroke* locked
     #nodes-fixed  polygon: transform.* + geometry.edit, no nodes.insert / nodes.delete, attrs.edit only for stroke-width (clamped
                   to 1-6), and fenced into its cell: bounds {x:8, y:30, width:164, height:182} (its parent's coordinates) */
const load = async (page, id) => {
  await page.goto('/demo/');
  await page.locator('#' + id).scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};
/* the screen position of the point (x, y) in shape `id`'s own coordinates */
const at = (page, id, x, y) => page.evaluate(({ id, x, y }) => {
  const m = document.getElementById(id).getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}, { id, x, y });
const onPath = (page, id, f) => page.evaluate(({ id, f }) => {
  const e = document.getElementById(id), q = e.getPointAtLength(e.getTotalLength() * f), m = e.getScreenCTM();
  return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
}, { id, f });
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
};
const attr = (page, id, a) => page.locator('#' + id).getAttribute(a);

test('pinned path offers only edit mode; endpoints are locked, interior nodes still drag', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);                 // an interior anchor, also a point on the stroke
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#readout')).toHaveText('<path> selected');
  expect(await page.evaluate(() => ed.modes)).toEqual(['edit']);
  await expect(page.locator('#mode')).toHaveText('mode: edit');

  const d0 = await attr(page, 'pinned', 'd');
  await drag(page, await at(page, 'pinned', 20, 150), 30, 30);   // start endpoint
  await drag(page, await at(page, 'pinned', 160, 70), -30, 30);  // end endpoint
  expect(await attr(page, 'pinned', 'd')).toBe(d0);

  await drag(page, p, 25, 25);                                   // interior node
  const d1 = await attr(page, 'pinned', 'd');
  expect(d1).not.toBe(d0);
  expect(d1).toMatch(/^M20 150 /);
  expect(d1).toMatch(/ 160 70$/);
});

test('pinned path: dragging the stroke does not move it, and a click has no mode to switch to', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);
  await page.mouse.click(p.x, p.y);
  const d0 = await attr(page, 'pinned', 'd'), s = await onPath(page, 'pinned', 0.2);
  await drag(page, s, 40, 40);
  expect(await attr(page, 'pinned', 'd')).toBe(d0);
  expect(await attr(page, 'pinned', 'transform')).toBeNull();
  await page.mouse.click(s.x, s.y);
  await expect(page.locator('#mode')).toHaveText('mode: edit');
});

test('pinned path: double-clicking the stroke still adds an interior node; the pinned endpoint cannot be deleted', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);
  await page.mouse.click(p.x, p.y);
  const count = () => page.evaluate(() => document.getElementById('pinned').getAttribute('d').split(/[MLC]/).length - 1);
  expect(await count()).toBe(3);
  const s = await onPath(page, 'pinned', 0.1);
  await page.mouse.dblclick(s.x, s.y);
  expect(await count()).toBe(4);
  const d1 = await attr(page, 'pinned', 'd');
  await page.mouse.dblclick((await at(page, 'pinned', 20, 150)).x, (await at(page, 'pinned', 20, 150)).y);
  expect(await attr(page, 'pinned', 'd')).toBe(d1);
});

test('nodes.insert / nodes.delete off: double-clicking an edge or a vertex changes nothing; dragging a vertex still works', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { ed.mode = 'edit'; });
  const pts0 = await attr(page, 'nodes-fixed', 'points');
  const edge = await at(page, 'nodes-fixed', 120, 77.5), v = await at(page, 'nodes-fixed', 90, 55);
  await page.mouse.dblclick(edge.x, edge.y);
  await page.mouse.dblclick(v.x, v.y);
  expect(await attr(page, 'nodes-fixed', 'points')).toBe(pts0);
  await drag(page, await at(page, 'nodes-fixed', 30, 100), -12, 0);
  const pts1 = await attr(page, 'nodes-fixed', 'points');
  expect(pts1).not.toBe(pts0);
  expect(pts1.trim().split(/\s+/).length).toBe(5);
});

test('polygon with transform.* keeps all three modes and can be moved', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  expect(await page.evaluate(() => ed.modes)).toEqual(['scale', 'rotate', 'edit']);
  const pts0 = await attr(page, 'nodes-fixed', 'points');
  await drag(page, c, 30, 20);
  expect(await attr(page, 'nodes-fixed', 'points')).not.toBe(pts0);
});

test('ed.set follows the attribute rules, refusals emit "denied", and force bypasses the policy', async ({ page }) => {
  await load(page, 'pinned');
  const r = await page.evaluate(() => {
    const ev = [], p = document.getElementById('pinned'), n = document.getElementById('nodes-fixed');
    ed.on('denied', d => ev.push([d.el.id, d.attr, d.cap, d.reason]));
    const out = {
      fillPinned: ed.set(p, 'fill', '#e74c3c'),
      strokePinned: ed.set(p, 'stroke', '#e74c3c'),
      widthPinned: ed.set(p, 'stroke-width', '9'),
      endpointPinned: ed.set(p, 'd', p.getAttribute('d').replace('M20 150', 'M27 150')),   // snaps to 30, not back to the pinned 20 (a nudge to 21 would snap back and be fine)
      fillNodes: ed.set(n, 'fill', '#e74c3c'),
      forced: ed.set(n, 'fill', '#2ecc71', undefined, { force: true }),
      can: [ed.can(p, 'transform.move'), ed.can(p, 'nodes.insert'), ed.can(n, 'nodes.insert'), ed.can(n, 'transform.scale')],
      canSet: [ed.canSet(p, 'fill'), ed.canSet(p, 'stroke'), ed.canSet(p, 'style:stroke-linecap'), ed.canSet(p, 'style:fill'), ed.canSet(n, 'fill')],
      pStroke: p.getAttribute('stroke'), pFill: p.getAttribute('fill'), nFill: n.getAttribute('fill'), ev,
    };
    return out;
  });
  expect(r.fillPinned).toBe(true);
  expect(r.strokePinned).toBe(false);
  expect(r.widthPinned).toBe(false);
  expect(r.endpointPinned).toBe(false);
  expect(r.fillNodes).toBe(false);
  expect(r.forced).toBe(true);
  expect(r.can).toEqual([false, true, false, true]);
  expect(r.canSet).toEqual([true, false, false, true, false]);
  expect(r.pStroke).toBe('#1a5276');
  expect(r.pFill).toBe('#e74c3c');
  expect(r.nFill).toBe('#2ecc71');
  expect(r.ev).toEqual([['pinned', 'stroke', 'attrs.edit', 'attribute'], ['pinned', 'stroke-width', 'attrs.edit', 'attribute'],
    ['pinned', 'd', 'pin', 'pinned'], ['nodes-fixed', 'fill', 'attrs.edit', 'attribute']]);
});

test('the Set fill / Set stroke buttons show what the policy refused', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);
  await page.mouse.click(p.x, p.y);
  await page.locator('#stroke').click();
  await expect(page.locator('#readout')).toContainText('refused: attrs.edit (stroke is locked)');
  await page.locator('#fill').click();
  await expect(page.locator('#readout')).toContainText('fill="#e74c3c"');
  await page.keyboard.press('Control+z');
  expect(await attr(page, 'pinned', 'fill')).toBe('none');
});

test('shapes no rule grants anything to are not selectable; swapping the policy at runtime takes effect', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { ed.policy = [{ select: '#plain-rect', can: 'all' }]; });
  await page.locator('circle.edit').click();
  await expect(page.locator('#readout')).toHaveText('nothing selected');
  await page.locator('#plain-rect').click();
  await expect(page.locator('#readout')).toHaveText('<rect> selected');
  await page.evaluate(() => { ed.policy = [{ select: '.edit', can: 'all' }]; });   // plain-rect is `.edit`: still fine
  expect(await page.evaluate(() => ed.selected && ed.selected.id)).toBe('plain-rect');
  await page.evaluate(() => { ed.policy = [{ select: 'circle', can: 'all' }]; });  // the selection loses its grant
  expect(await page.evaluate(() => ed.selected)).toBeNull();
  await page.evaluate(() => { ed.policy = null; });                                 // no policy: everything allowed again
  await page.locator('circle.edit').click();
  await expect(page.locator('#readout')).toHaveText('<circle> selected');
});

test('move-only grant: the shape drags but has no modes; scale-only offers just scale', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('#plain-rect').scrollIntoViewIfNeeded();
  await page.evaluate(() => { ed.policy = [{ select: '#plain-rect', can: 'transform.move' }]; });
  const c = await page.evaluate(() => { const r = document.getElementById('plain-rect').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y);
  expect(await page.evaluate(() => ed.selected.id)).toBe('plain-rect');
  expect(await page.evaluate(() => ed.modes)).toEqual([]);
  const x0 = parseFloat(await attr(page, 'plain-rect', 'x'));
  await drag(page, c, 40, 0);
  expect(parseFloat(await attr(page, 'plain-rect', 'x'))).toBeGreaterThan(x0 + 10);
  await page.evaluate(() => { ed.policy = [{ select: '#plain-rect', can: 'transform.scale' }]; });
  expect(await page.evaluate(() => ed.modes)).toEqual(['scale']);
  const x1 = await attr(page, 'plain-rect', 'x');
  await drag(page, c, 40, 0);                                                        // can't move any more
  expect(await attr(page, 'plain-rect', 'x')).toBe(x1);
});

test('create restricts the tools the menu and the API offer', async ({ page }) => {
  await page.goto('/demo/');
  expect(await page.evaluate(() => ed.tools.map(t => t.id))).toEqual(['circle', 'rect', 'ellipse', 'line']);
  await page.evaluate(() => { ed.policy = { rules: [{ select: '.edit', can: 'all' }], create: ['circle'] }; });
  expect(await page.evaluate(() => ed.tools.map(t => t.id))).toEqual(['circle']);
  await page.evaluate(() => { ed.tool = 'rect'; });
  expect(await page.evaluate(() => ed.tool)).toBe('pointer');
  await page.evaluate(() => { ed.policy = { rules: [], create: false }; });
  expect(await page.evaluate(() => ed.tools)).toEqual([]);
  expect(await page.evaluate(() => ed.openMenu(100, 100))).toBe(false);              // nothing to put in the menu
});

test('a policy typo is an error at attach time, not a silent hole', async ({ page }) => {
  await page.goto('/demo/');
  const msg = await page.evaluate(() => { try { SableEdit.attach(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { policy: [{ can: 'geometry.edti' }] }); return 'no error'; } catch (e) { return e.message; } });
  expect(msg).toMatch(/unknown capability "geometry.edti"/);
});

/* ---- bounds and ranges ---- */
/* [x0, y0, x1, y1] of an element in its parent's coordinates (its own transform applied) */
const extent = (page, sel) => page.evaluate(sel => {
  const e = document.querySelector(sel), bb = e.getBBox(), l = e.transform.baseVal, m = l.numberOfItems ? l.consolidate().matrix : new DOMMatrix();
  const c = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  return [Math.min(...c.map(p => p[0])), Math.min(...c.map(p => p[1])), Math.max(...c.map(p => p[0])), Math.max(...c.map(p => p[1]))];
}, sel);
const within = (b, [x0, y0, x1, y1], tol = 0.01) => b[0] >= x0 - tol && b[1] >= y0 - tol && b[2] <= x1 + tol && b[3] <= y1 + tol;
const CELL = [8, 30, 172, 212];
const handles = page => page.evaluate(() => [...[...document.querySelector('#art').lastElementChild.children].find(c => c.getAttribute('data-sable') !== 'halo').children]
  .filter(c => c.tagName !== 'polygon').map(c => { const r = (c.querySelector('circle') || c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));

test('bounds: dragging a polygon against its cell wall stops there, and the whole shape arrives intact', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  const before = await extent(page, '#nodes-fixed'), w0 = before[2] - before[0];
  await drag(page, c, 300, 0);                                            // far past the right wall
  const b = await extent(page, '#nodes-fixed');
  expect(within(b, CELL)).toBe(true);
  expect(b[2]).toBeGreaterThan(CELL[2] - 0.01);                           // it went all the way to the wall...
  expect(b[2] - b[0]).toBeCloseTo(w0, 2);                                 // ...without being squashed
  await drag(page, await at(page, 'nodes-fixed', b[2] - 10, 120), -20, 200);   // back off the wall and down: slides along it
  const b2 = await extent(page, '#nodes-fixed');
  expect(within(b2, CELL)).toBe(true);
  expect(b2[3]).toBeGreaterThan(b[3] + 5);
});

test('bounds: a dragged vertex stops at the wall and keeps sliding along it', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { ed.mode = 'edit'; });
  await drag(page, await at(page, 'nodes-fixed', 150, 100), 300, 12);     // vertex 1 far right and a little down
  const pts = (await attr(page, 'nodes-fixed', 'points')).trim().split(/\s+/).map(q => q.split(',').map(Number));
  expect(pts[1][0]).toBeCloseTo(172, 2);
  expect(pts[1][1]).toBeGreaterThan(104);                                 // the downward part of the drag still counted
  expect(pts[0]).toEqual([90, 55]);                                       // the others did not move
});

test('bounds: a scale or rotation that would cross the wall is refused, the pointer just stops', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  expect(await page.evaluate(() => ed.mode)).toBe('scale');
  const H = await handles(page);
  await drag(page, H[4], 400, 0);                                         // right edge handle, far right
  expect(within(await extent(page, '#nodes-fixed'), CELL)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('readout').textContent)).toContain('would leave the box');
  await page.evaluate(() => { ed.mode = 'rotate'; });
  const R = await handles(page);
  await drag(page, R[0], 200, -300);                                      // swing a corner handle round
  expect(within(await extent(page, '#nodes-fixed'), CELL)).toBe(true);
});

test('ranges: stroke-width is clamped to 1-6 on the polygon, free on other shapes, refused on the path', async ({ page }) => {
  await load(page, 'nodes-fixed');
  const c = await at(page, 'nodes-fixed', 90, 120);
  await page.mouse.click(c.x, c.y);
  await page.locator('#thick').click();
  expect(await attr(page, 'nodes-fixed', 'stroke-width')).toBe('6');
  const r = await page.evaluate(() => { const n = document.getElementById('nodes-fixed'); return [ed.set(n, 'stroke-width', '0.2'), n.getAttribute('stroke-width'), ed.set(n, 'stroke-width', 'thick'), n.getAttribute('stroke-width'), ed.set(n, 'stroke-width', '3'), n.getAttribute('stroke-width')]; });
  expect(r).toEqual([true, '1', false, '1', true, '3']);
  await page.locator('#pinned').scrollIntoViewIfNeeded();
  const p = await at(page, 'pinned', 100, 110);
  await page.mouse.click(p.x, p.y);
  await page.locator('#thick').click();
  expect(await attr(page, 'pinned', 'stroke-width')).toBe('4');
  await expect(page.locator('#readout')).toContainText('refused');
});

test('ranges: ed.range and ed.bounds tell a host UI the limits; ed.setMany writes several attributes as one step', async ({ page }) => {
  await page.goto('/demo/');
  const r = await page.evaluate(() => {
    const n = document.getElementById('nodes-fixed'), p = document.getElementById('plain-rect');
    ed.policy = [{ select: '#plain-rect', can: 'all', bounds: { x: 10, y: 50, width: 200, height: 150 }, ranges: { width: [20, null], rx: [0, 15] } }];
    const out = { range: [ed.range(p, 'width'), ed.range(p, 'rx'), ed.range(p, 'height')], bounds: ed.bounds(p), none: ed.bounds(n) };
    out.many = ed.setMany(p, { x: '500', width: '5', rx: '99' });
    out.attrs = ['x', 'width', 'rx'].map(a => p.getAttribute(a));
    ed.undo();
    out.undone = ['x', 'width', 'rx'].map(a => p.getAttribute(a));
    return out;
  });
  expect(r.range).toEqual([[20, null], [0, 15], null]);
  expect(r.bounds).toEqual({ x: 10, y: 50, width: 200, height: 150 });
  expect(r.none).toBeNull();
  expect(r.many).toBe(true);
  const [x, w, rx] = r.attrs.map(parseFloat);          // x 500 and width 5 (-> 20 by the range) are one step: it travels toward them until the right edge meets the wall
  expect(x + w).toBeCloseTo(210, 2);
  expect(x).toBeGreaterThan(30);
  expect(w).toBeGreaterThanOrEqual(20);
  expect(rx).toBe(15);                                 // 99 -> 15 by the range
  expect(r.undone).toEqual(['30', '120', null]);       // one undo step puts all three back
});

test('bounds on a rect: a corner drag stops at the wall, keeps the far edges, and a move stops at the wall', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { ed.policy = [{ select: '#plain-rect', can: 'all', bounds: { x: 10, y: 50, width: 200, height: 150 } }]; });
  await page.locator('#plain-rect').scrollIntoViewIfNeeded();
  const c = await at(page, 'plain-rect', 90, 110);
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { ed.mode = 'edit'; });
  const g = a => attr(page, 'plain-rect', a).then(parseFloat);
  await drag(page, await at(page, 'plain-rect', 150, 150), 500, 20);        // bottom-right corner, far to the right and a little down
  expect(await g('x')).toBeCloseTo(30, 2);                                  // the opposite corner did not move
  expect(await g('y')).toBeCloseTo(70, 2);
  expect((await g('x')) + (await g('width'))).toBeCloseTo(210, 2);          // right edge at the wall
  expect(await g('height')).toBeGreaterThan(80);                            // the downward part of the drag still counted
  await drag(page, await at(page, 'plain-rect', 30, 70), -600, -600);       // top-left corner way out past the top-left wall
  expect(await g('x')).toBeCloseTo(10, 2);
  expect(await g('y')).toBeCloseTo(50, 2);
  expect((await g('x')) + (await g('width'))).toBeCloseTo(210, 2);          // far edges kept
  await page.evaluate(() => { ed.mode = 'scale'; });
  const e0 = await extent(page, '#plain-rect');
  await drag(page, await at(page, 'plain-rect', 110, 120), 800, 700);       // move far right and down
  const e1 = await extent(page, '#plain-rect');
  expect(within(e1, [10, 50, 210, 200])).toBe(true);
  expect(e1[2] - e1[0]).toBeCloseTo(e0[2] - e0[0], 2);
});

test('bounds on a text (moved through its transform): the host-side bbox is used, and the move stops at the wall', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { ed.policy = [{ select: 'text.edit', can: 'all', bounds: { x: 0, y: 0, width: 400, height: 400 } }]; });
  const t = page.locator('text.edit').first();
  await t.scrollIntoViewIfNeeded();
  const r = await t.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  expect(await page.evaluate(() => ed.selected && ed.selected.tagName)).toBe('text');
  await drag(page, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, 900, 600);
  const e = await page.evaluate(() => { const el = ed.selected, bb = el.getBBox(), m = el.transform.baseVal.numberOfItems ? el.transform.baseVal.consolidate().matrix : new DOMMatrix(); return [bb.x + m.e, bb.y + m.f, bb.x + bb.width + m.e, bb.y + bb.height + m.f]; });
  expect(within(e, [0, 0, 400, 400], 0.02)).toBe(true);
  expect(e[2]).toBeGreaterThan(399);                                         // it did travel to the wall
});

test('ranges and bounds typos are errors at attach time', async ({ page }) => {
  await page.goto('/demo/');
  const msgs = await page.evaluate(() => ['{ ranges: { r: [9, 1] } }', '{ bounds: { x: 0, y: 0, width: -5, height: 5 } }', '{ range: {} }'].map(src => {
    const rule = eval('(' + src + ')'); try { ed.policy = [rule]; return 'no error'; } catch (e) { return e.message; } }));
  expect(msgs[0]).toMatch(/bad range for "r"/);
  expect(msgs[1]).toMatch(/bounds needs/);
  expect(msgs[2]).toMatch(/unknown rule key "range"/);
});

/* ---- markup: data-sable-policy (the demo's policy is [{ select: '.edit', can: 'all' }, 'markup']) ---- */
test('markup: an attribute on a shape changes what it may do from the next check, and the attribute itself is protected', async ({ page }) => {
  await page.goto('/demo/');
  const r = await page.evaluate(() => {
    const p = document.getElementById('plain-rect'), out = { before: ed.can(p, 'transform.move') };
    p.setAttribute('data-sable-policy', '-transform.move; attrs-deny: fill');
    out.after = [ed.can(p, 'transform.move'), ed.can(p, 'transform.scale'), ed.canSet(p, 'fill'), ed.canSet(p, 'stroke')];
    out.write = ed.set(p, 'data-sable-policy', 'all');
    out.attr = p.getAttribute('data-sable-policy');
    out.canSet = ed.canSet(p, 'data-sable-policy');
    out.forced = ed.set(p, 'data-sable-policy', 'all', undefined, { force: true });   // host code is outside the policy
    out.after2 = ed.can(p, 'transform.move');
    return out;
  });
  expect(r.before).toBe(true);
  expect(r.after).toEqual([false, true, false, true]);
  expect(r.write).toBe(false);
  expect(r.attr).toBe('-transform.move; attrs-deny: fill');
  expect(r.canSet).toBe(false);
  expect(r.forced).toBe(true);
  expect(r.after2).toBe(true);
});

test('markup: a declaration on a group covers the shapes in it, and the move really stops working', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('#plain-rect').scrollIntoViewIfNeeded();
  await page.evaluate(() => { document.getElementById('plain-rect').parentNode.setAttribute('data-sable-policy', 'cannot: transform.move, geometry.edit'); });
  const c = await page.evaluate(() => { const r = document.getElementById('plain-rect').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y);                                   // still selectable: scale and rotate are left
  expect(await page.evaluate(() => ed.modes)).toEqual(['scale', 'rotate']);
  const x0 = await attr(page, 'plain-rect', 'x');
  await drag(page, c, 60, 0);
  expect(await attr(page, 'plain-rect', 'x')).toBe(x0);
  expect(await attr(page, 'plain-rect', 'transform')).toBeNull();
});

test('markup is ignored unless the policy lists it', async ({ page }) => {
  await page.goto('/demo/');
  const r = await page.evaluate(() => {
    const p = document.getElementById('plain-rect');
    ed.policy = [{ select: '.edit', can: 'transform.move' }];
    p.setAttribute('data-sable-policy', 'all');
    const out = [ed.can(p, 'geometry.edit'), ed.can(p, 'transform.move')];
    ed.policy = ['markup'];                                          // now it counts, and default-deny applies to everything without it
    out.push(ed.can(p, 'geometry.edit'), ed.can(document.querySelector('circle.edit'), 'transform.move'));
    return out;
  });
  expect(r).toEqual([false, true, true, false]);
});

test('markup: a typo throws when the editor attaches and names the element', async ({ page }) => {
  await page.goto('/demo/');
  const msgs = await page.evaluate(() => ['pin: endpoint', 'bogus: 1; all', 'can: geometry.edti', 'bounds: 0 0 5'].map(v => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), r = document.createElementNS(ns, 'rect');
    r.id = 'oops'; r.setAttribute('data-sable-policy', v); svg.append(r);
    try { SableEdit.attach(svg, { policy: 'markup' }); return 'no error'; } catch (e) { return e.message; }
  }));
  expect(msgs[0]).toMatch(/bad pin "endpoint".*<rect id="oops">/);
  expect(msgs[1]).toMatch(/unknown clause "bogus".*<rect id="oops">/);
  expect(msgs[2]).toMatch(/unknown capability "geometry.edti"/);
  expect(msgs[3]).toMatch(/four numbers/);
});

test('markup that is broken after attach switches the shape off and says so once in the console', async ({ page }) => {
  const logs = [];
  page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await page.goto('/demo/');
  const r = await page.evaluate(() => {
    const p = document.getElementById('plain-rect');
    p.setAttribute('data-sable-policy', 'pin: endpoint');
    return [ed.can(p, 'transform.move'), ed.can(p, 'geometry.edit'), ed.can(p, 'transform.move')];
  });
  expect(r).toEqual([false, false, false]);
  expect(logs.filter(l => l.includes('switched off'))).toHaveLength(1);
});

/* ---- snap ---- (the demo's #pinned path carries `snap: 10`, with the grid drawn behind it) */
const nums = d => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

test('snap: a dragged node lands on the grid and its bezier handles go with it, so the curve keeps its shape', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);                        // the interior anchor; its handles are (80,50) and (120,170)
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(() => ed.snap(document.getElementById('pinned')))).toEqual({ x: 10, y: 10 });
  await drag(page, p, 23, 31);                                         // an arbitrary pointer move
  const n = nums(await attr(page, 'pinned', 'd'));                     // M x y  C c1 c2 anchor  C c1 c2 anchor
  const anchor = [n[6], n[7]], h1 = [n[4], n[5]], h2 = [n[8], n[9]];
  expect(anchor[0] % 10).toBeCloseTo(0, 6);
  expect(anchor[1] % 10).toBeCloseTo(0, 6);
  expect(anchor).not.toEqual([100, 110]);                              // it did move
  expect([h1[0] - anchor[0], h1[1] - anchor[1]]).toEqual([-20, -60]);  // handles keep their offsets from the node
  expect([h2[0] - anchor[0], h2[1] - anchor[1]]).toEqual([20, 60]);
  expect([n[0], n[1], n[12], n[13]]).toEqual([20, 150, 160, 70]);      // pinned endpoints untouched
});

test('snap: a bezier handle dragged on its own snaps by itself; the node it belongs to stays', async ({ page }) => {
  await load(page, 'pinned');
  const p = await at(page, 'pinned', 100, 110);
  await page.mouse.click(p.x, p.y);
  await drag(page, await at(page, 'pinned', 80, 50), 13, 9);           // the handle before the anchor
  const n = nums(await attr(page, 'pinned', 'd'));
  expect([n[6], n[7]]).toEqual([100, 110]);                            // the anchor did not move
  expect([n[4] % 10, n[5] % 10]).toEqual([0, 0]);
  expect([n[4], n[5]]).not.toEqual([80, 50]);
});

test('snap: ed.set is snapped too, a rect resize keeps its far edge, and force skips the grid', async ({ page }) => {
  await page.goto('/demo/');
  const r = await page.evaluate(() => {
    const p = document.getElementById('plain-rect');                    // x 30, y 70, width 120, height 80
    ed.policy = [{ select: '#plain-rect', can: 'all', snap: [10, 5] }];
    const out = { snap: ed.snap(p), none: ed.snap(document.querySelector('circle.edit')) };
    ed.set(p, 'x', '47');                                               // moves the whole rect: x snaps, width stays
    out.x = [p.getAttribute('x'), p.getAttribute('width')];
    ed.setMany(p, { x: '52', width: '98' });                            // left edge dragged to 52 (right edge 150 stays)
    out.edges = [parseFloat(p.getAttribute('x')), parseFloat(p.getAttribute('x')) + parseFloat(p.getAttribute('width'))];
    ed.set(p, 'height', '83');                                          // bottom edge 70 + 83 = 153 -> 155
    out.h = p.getAttribute('height');
    ed.set(p, 'y', '71', undefined, { force: true });
    out.forced = p.getAttribute('y');
    return out;
  });
  expect(r.snap).toEqual({ x: 10, y: 5 });
  expect(r.none).toBeNull();
  expect(r.x).toEqual(['50', '120']);
  expect(r.edges).toEqual([50, 150]);
  expect(r.h).toBe('85');
  expect(r.forced).toBe('71');
});

test('snap: dragging a rect corner puts the corner on the grid and leaves the opposite corner alone', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { ed.policy = [{ select: '#plain-rect', can: 'all', snap: [10, 5] }]; });
  await page.locator('#plain-rect').scrollIntoViewIfNeeded();
  const c = await at(page, 'plain-rect', 90, 110);
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { ed.mode = 'edit'; });
  await drag(page, await at(page, 'plain-rect', 150, 150), 37, 23);       // bottom-right corner, somewhere off the grid
  const g = a => attr(page, 'plain-rect', a).then(parseFloat);
  expect(await g('x')).toBe(30);
  expect(await g('y')).toBe(70);
  expect(((await g('x')) + (await g('width'))) % 10).toBeCloseTo(0, 6);
  expect(((await g('y')) + (await g('height'))) % 5).toBeCloseTo(0, 6);
  expect(await g('width')).toBeGreaterThan(120);
});

test('snap: markup typos throw at attach', async ({ page }) => {
  await page.goto('/demo/');
  const msgs = await page.evaluate(() => ['snap: 0', 'snap: 1 2 3', 'snap: big'].map(v => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), r = document.createElementNS(ns, 'rect');
    r.setAttribute('data-sable-policy', v); svg.append(r);
    try { SableEdit.attach(svg, { policy: 'markup' }); return 'no error'; } catch (e) { return e.message; }
  }));
  expect(msgs[0]).toMatch(/snap needs a positive number/);
  expect(msgs[1]).toMatch(/one number or two/);
  expect(msgs[2]).toMatch(/snap needs a positive number/);
});
