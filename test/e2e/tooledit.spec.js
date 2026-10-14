import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* helpers: a point of the free-drawing area, and shapes drawn in their own coordinates (moved into the canvas by a transform) */
const at = async (page, fx, fy) => {
  const c = page.locator('#canvas');
  await c.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await c.boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
};
const addPath = async (page, d, extra = {}) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(({ d, extra }) => {
    const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.id = 'tp'; e.setAttribute('class', 'edit'); e.setAttribute('fill', extra.fill ?? '#d6eaf8'); e.setAttribute('stroke', '#2874a6'); e.setAttribute('stroke-width', 3);
    e.setAttribute('transform', `translate(${c.x} ${c.y + 20})`); e.setAttribute('d', d); document.querySelector('#sketch').append(e);
  }, { d, extra });
  return (x, y) => page.evaluate(({ x, y }) => { const m = document.getElementById('tp').getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }, { x, y });
};
const sketchPaths = page => page.locator('#sketch path');

test('rect tool: a new rect is selected for editing; a press on an existing rect edits it instead of drawing over it', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .3, .3);
  await page.evaluate(() => ed.tool = 'rect');
  await drag(page, p, 80, 50);
  const rects = page.locator('#sketch rect');
  await expect(rects).toHaveCount(1);
  expect(await page.evaluate(() => [ed.selected === document.querySelector('#sketch rect'), ed.mode])).toEqual([true, 'edit']);
  const q = await at(page, .7, .6);
  await drag(page, q, 80, 50);                                          // a second one, away from the first
  await expect(rects).toHaveCount(2);
  const x0 = +await rects.first().getAttribute('x');
  await drag(page, { x: p.x + 40, y: p.y + 25 }, 30, 0);              // the middle of the first: it is moved, not drawn over
  await expect(rects).toHaveCount(2);
  expect(+await rects.first().getAttribute('x')).toBeGreaterThan(x0);
  expect(await page.evaluate(() => ed.selected === document.querySelector('#sketch rect'))).toBe(true);
  await page.keyboard.press('Control+z');                               // that move was one undo step
  expect(+await rects.first().getAttribute('x')).toBeCloseTo(x0, 3);
});

test('ellipse and line tools edit their own kind too', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .3, .3), q = await at(page, .6, .6);
  await page.evaluate(() => ed.tool = 'ellipse');
  await drag(page, p, 100, 60);
  await expect(page.locator('#sketch ellipse')).toHaveCount(1);
  const cx = +await page.locator('#sketch ellipse').getAttribute('cx');
  await drag(page, { x: p.x + 50, y: p.y + 30 }, 40, 0);              // inside it: a move
  await expect(page.locator('#sketch ellipse')).toHaveCount(1);
  expect(+await page.locator('#sketch ellipse').getAttribute('cx')).toBeGreaterThan(cx);
  await page.evaluate(() => ed.tool = 'line');                         // another tool: the ellipse is not its kind, so it is deselected and the line draws over it
  await drag(page, { x: p.x + 50, y: p.y + 30 }, 60, 40);
  await expect(page.locator('#sketch line')).toHaveCount(1);
  await expect(page.locator('#sketch ellipse')).toHaveCount(1);
  await drag(page, q, 80, 0);
  await expect(page.locator('#sketch line')).toHaveCount(2);
});

test('path tool: the stroke of a path edits it, its fill is where a new path starts, Alt starts one on a stroke too', async ({ page }) => {
  const pt = await addPath(page, 'M20 20 L120 20 L70 100 Z');
  await page.evaluate(() => ed.tool = 'path');
  const fill = await pt(70, 50), stroke = await pt(70, 20);
  await page.mouse.click(fill.x, fill.y);                              // inside the triangle: a new path begins
  await expect(sketchPaths(page)).toHaveCount(2);
  expect(await page.evaluate(() => ed.selected.id)).not.toBe('tp');
  await page.keyboard.press('Escape');                                  // leaving the pen throws away the path that is only its first node
  await expect(sketchPaths(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => ed.tool = 'path');
  await page.mouse.click(stroke.x, stroke.y);                          // on the stroke: that path is edited
  await expect(sketchPaths(page)).toHaveCount(1);
  expect(await page.evaluate(() => [ed.selected.id, ed.mode])).toEqual(['tp', 'edit']);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(() => ed.tool = 'path');
  await page.keyboard.down('Alt'); await page.mouse.click(stroke.x, stroke.y); await page.keyboard.up('Alt');   // Alt: a new path right there
  await expect(sketchPaths(page)).toHaveCount(2);
  expect(await page.evaluate(() => ed.selected.id)).not.toBe('tp');
});

test('without the create permission a pen can still extend a path (edit) but not start one', async ({ page }) => {
  const pt = await addPath(page, 'M20 100 L60 100 L100 60', { fill: 'none' });
  await page.evaluate(() => { ed.policy = { rules: [{ select: '.edit', can: 'all' }], create: false }; window.__denied = []; ed.on('denied', d => window.__denied.push(d.cap)); });
  const end = await pt(100, 60), next = await pt(140, 60);
  await page.evaluate(() => { ed.select(document.getElementById('tp')); ed.edit(); });   // the path, in edit mode ...
  await page.mouse.click(end.x, end.y);                                // ... and its end node selected
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [2] });
  await page.evaluate(() => ed.tool = 'path');
  expect(await page.evaluate(() => ed.tool)).toBe('path');             // arms: the path is there to edit
  await page.mouse.click(next.x, next.y);                              // continues from the selected end
  await expect(sketchPaths(page)).toHaveCount(1);
  expect((await page.locator('#tp').getAttribute('d')).match(/[MLHV]/g).length).toBe(4);
  await page.keyboard.press('Enter');                                   // finished: no endpoint selected any more
  const away = await pt(200, 150);
  await page.mouse.click(away.x, away.y);                              // ... so this would start a new path: not allowed
  await expect(sketchPaths(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.__denied)).toContain('create');
});

/* ---- part 2: the tool is the edit mode ---- */
const toScreen = (page, p) => page.evaluate(({ x, y }) => { const m = document.querySelector('#art').getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }, p);
const state = page => page.evaluate(() => [ed.tool, ed.mode, ed.selected && ed.selected.tagName]);

test('a double-click arms the shape\'s own tool: edit mode and the tool are one state, whichever way it is entered or left', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('rect.edit').first().scrollIntoViewIfNeeded();
  const b = await page.locator('rect.edit').first().boundingBox(), c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.dblclick(c.x, c.y);
  expect(await state(page)).toEqual(['rect', 'edit', 'rect']);
  await page.keyboard.press('Escape');                                  // the tool is left: the shape stays selected, out of edit mode
  expect(await state(page)).toEqual(['pointer', 'scale', 'rect']);
  expect(await page.evaluate(() => ed.edit())).toBe(true);              // the API way in arms the tool too
  expect(await state(page)).toEqual(['rect', 'edit', 'rect']);
  await page.evaluate(() => { ed.mode = 'rotate'; });                    // leaving edit mode is leaving the tool, and lands where it is told to
  expect(await state(page)).toEqual(['pointer', 'rotate', 'rect']);
  await page.evaluate(() => { ed.mode = 'edit'; });
  expect(await state(page)).toEqual(['rect', 'edit', 'rect']);
  await page.evaluate(() => { ed.mode = 'scale'; });
  expect(await state(page)).toEqual(['pointer', 'scale', 'rect']);
  const events = await page.evaluate(() => { const log = []; ed.on('tool', t => log.push('tool:' + t)); ed.on('mode', m => log.push('mode:' + m)); ed.edit(); return log; });
  expect(events).toContain('tool:rect'); expect(events).toContain('mode:edit');
});

test('with a tool armed, a click on a shape of another kind selects it and leaves the tool; a click on empty canvas deselects but keeps the tool', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('circle.edit').first().scrollIntoViewIfNeeded();
  const cb = await page.locator('circle.edit').first().boundingBox();
  await page.mouse.dblclick(...await page.locator('rect.edit').first().boundingBox().then(b => [b.x + b.width / 2, b.y + b.height / 2]));
  expect((await state(page))[0]).toBe('rect');
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);    // a circle: not this tool's kind
  expect(await state(page)).toEqual(['pointer', 'scale', 'circle']);
  await page.evaluate(() => { ed.edit(); });                             // (circle tool, circle selected)
  expect((await state(page))[0]).toBe('circle');
  const p = await at(page, .5, .5);
  await page.mouse.click(p.x, p.y);                                      // empty canvas: the selection goes, the tool stays
  expect(await page.evaluate(() => [ed.tool, ed.selected])).toEqual(['circle', null]);
});

test('while editing a path (no node added yet) Escape clears the node selection first, then leaves the tool, then deselects', async ({ page }) => {
  const pt = await addPath(page, 'M20 100 C20 60 100 60 100 100 C100 140 160 140 180 100');
  await page.evaluate(() => { ed.select(document.getElementById('tp')); ed.edit(); });
  expect(await state(page)).toEqual(['path', 'edit', 'path']);
  const n = await pt(100, 100), e = await pt(180, 100);
  await page.mouse.click(n.x, n.y);
  expect((await page.evaluate(() => ed.selection)).items).toEqual([1]);
  await page.keyboard.down('Shift'); await page.mouse.click(e.x, e.y); await page.keyboard.up('Shift');   // an end node of the path: plain editing, so no closing
  expect((await page.evaluate(() => ed.selection)).items).toEqual([1, 2]);
  expect(await page.locator('#tp').getAttribute('d')).not.toMatch(/Z/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ed.selection)).toBeNull();
  expect((await state(page))[0]).toBe('path');
  await page.keyboard.press('Escape');
  expect(await state(page)).toEqual(['pointer', 'scale', 'path']);
  await page.keyboard.press('Escape');
  expect((await state(page))[2]).toBeNull();
});

test('the one-gesture tools put their points on the policy grid and inside its walls, like the pens', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  const W = await page.evaluate(() => {
    const c = document.querySelector('#canvas').getBBox(), x0 = Math.ceil(c.x / 10) * 10 + 20, y0 = Math.ceil(c.y / 10) * 10 + 20;
    ed.policy = { rules: [{ select: '.edit', can: 'all', snap: 10, bounds: [x0, y0, 200, 120] }] };   // [x, y, width, height]
    return { x0, y0, x1: x0 + 200, y1: y0 + 120 };
  });
  await page.evaluate(() => ed.tool = 'rect');
  const a = await toScreen(page, { x: W.x0 + 13, y: W.y0 + 17 }), far = await toScreen(page, { x: W.x1 + 30, y: W.y1 + 30 });
  await drag(page, a, far.x - a.x, far.y - a.y);
  const r = page.locator('#sketch rect');
  await expect(r).toHaveCount(1);
  expect([+await r.getAttribute('x'), +await r.getAttribute('y'), +await r.getAttribute('width'), +await r.getAttribute('height')].map(v => Math.round(v * 10) / 10))
    .toEqual([W.x0 + 10, W.y0 + 20, W.x1 - W.x0 - 10, W.y1 - W.y0 - 20]);          // snapped at the start, stopped at the wall at the far corner
  await page.evaluate(() => ed.tool = 'circle');
  const c0 = await toScreen(page, { x: W.x0 + 60, y: W.y0 + 60 });
  await drag(page, c0, 150, 0);                                                      // far out to the right: the circle stops at the nearest wall
  const circ = page.locator('#sketch circle');
  await expect(circ).toHaveCount(1);
  expect([+await circ.getAttribute('cx'), +await circ.getAttribute('cy'), +await circ.getAttribute('r')].map(v => Math.round(v * 10) / 10)).toEqual([W.x0 + 60, W.y0 + 60, 60]);
  await page.evaluate(() => ed.tool = 'line');
  const l0 = await toScreen(page, { x: W.x0 + 13, y: W.y1 - 22 }), l1 = await toScreen(page, { x: W.x1 + 30, y: W.y1 - 44 });
  await drag(page, l0, l1.x - l0.x, l1.y - l0.y);
  const ln = page.locator('#sketch line');
  await expect(ln).toHaveCount(1);
  expect([+await ln.getAttribute('x1'), +await ln.getAttribute('y1'), +await ln.getAttribute('x2'), +await ln.getAttribute('y2')].map(v => Math.round(v * 10) / 10)).toEqual([W.x0 + 10, W.y1 - 20, W.x1, W.y1 - 40]);
});
