import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* The body grab: press = select (and start moving), drag = move, click on the selected shape = next mode.
   Shapes are added to the free-drawing group so each test controls its own geometry. Coordinates are relative to the canvas corner. */
const X = new Set(['x', 'cx', 'x1', 'x2']), Y = new Set(['y', 'cy', 'y1', 'y2']);
const setup = async (page, shapes) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(({ shapes, X, Y }) => {
    const c = document.querySelector('#canvas').getBBox(), g = document.querySelector('#sketch'), ns = 'http://www.w3.org/2000/svg';
    for (const s of shapes) {
      const e = document.createElementNS(ns, s.tag); e.setAttribute('class', 'edit');
      for (const [k, v] of Object.entries(s.attrs)) e.setAttribute(k, X.includes(k) ? v + c.x : Y.includes(k) ? v + c.y : k === 'd' ? v.replace(/(-?[\d.]+) (-?[\d.]+)/g, (m, a, b) => `${+a + c.x} ${+b + c.y}`) : v);
      e.id = s.id; g.append(e);
    }
  }, { shapes, X: [...X], Y: [...Y] });
};
/* a point on shape `id`, as fractions of its screen box, plus an offset in px */
const pt = (page, id, fx = .5, fy = .5, dx = 0, dy = 0) => page.evaluate(({ id, fx, fy, dx, dy }) => {
  const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width * fx + dx, y: r.y + r.height * fy + dy };
}, { id, fx, fy, dx, dy });
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
};
const rect = (id, x, y, w, h, extra = {}) => ({ tag: 'rect', id, attrs: { x, y, width: w, height: h, fill: '#d6eaf8', stroke: '#2874a6', 'stroke-width': 2, ...extra } });
const mode = page => page.locator('#mode');

test('the first press selects without switching mode; each later click toggles scale and rotate; a double-click enters edit mode', async ({ page }) => {
  await setup(page, [rect('r', 30, 30, 120, 80)]);
  const p = await pt(page, 'r');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#readout')).toHaveText('<rect> selected');
  await expect(mode(page)).toHaveText('mode: scale');
  await page.mouse.click(p.x, p.y);
  await expect(mode(page)).toHaveText('mode: rotate');
  await page.mouse.click(p.x, p.y);
  await expect(mode(page)).toHaveText('mode: scale');     // edit is not part of the cycle
  await page.mouse.dblclick(p.x, p.y);
  await expect(mode(page)).toHaveText('mode: edit');
  await page.mouse.click(p.x, p.y);
  await expect(mode(page)).toHaveText('mode: edit');      // a click does not leave it either: Escape does
  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveText('mode: scale');
  expect(await page.evaluate(() => ed.selected && ed.selected.id)).toBe('r');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ed.selected)).toBeNull();
});

test('pressing and dragging an unselected shape selects and moves it in one gesture; undo is one step', async ({ page }) => {
  await setup(page, [rect('r', 30, 30, 120, 80)]);
  const x0 = await page.locator('#r').getAttribute('x'), p = await pt(page, 'r');
  await drag(page, p, 40, 15);
  expect(await page.evaluate(() => ed.selected && ed.selected.id)).toBe('r');
  expect(await page.locator('#r').getAttribute('transform')).toBeNull();
  expect(parseFloat(await page.locator('#r').getAttribute('x'))).toBeGreaterThan(parseFloat(x0) + 10);
  await expect(mode(page)).toHaveText('mode: scale');       // the release of a drag does not switch mode
  await page.keyboard.press('Control+z');
  expect(await page.locator('#r').getAttribute('x')).toBe(x0);
});

test('a drag on the selected shape never switches mode; a sub-threshold jitter moves nothing and counts as a click', async ({ page }) => {
  await setup(page, [rect('r', 30, 30, 120, 80)]);
  const p = await pt(page, 'r'); await page.mouse.click(p.x, p.y);
  await drag(page, p, 30, 0);
  await expect(mode(page)).toHaveText('mode: scale');
  const q = await pt(page, 'r'), x1 = await page.locator('#r').getAttribute('x');
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 1, q.y + 1); await page.mouse.up();
  expect(await page.locator('#r').getAttribute('x')).toBe(x1);
  await expect(mode(page)).toHaveText('mode: rotate');
});

test('text moves by a translate() in transform', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('text.edit').scrollIntoViewIfNeeded();
  const p = await page.evaluate(() => { const r = document.querySelector('text.edit').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(page, p, 30, 10);
  expect(await page.locator('text.edit').getAttribute('transform')).toMatch(/^translate\(/);
});

test('a thin line is grabbed by its halo, a few pixels off the stroke', async ({ page }) => {
  await setup(page, [{ tag: 'line', id: 'ln', attrs: { x1: 30, y1: 60, x2: 170, y2: 60, stroke: '#333', 'stroke-width': 2 } }]);
  const on = await pt(page, 'ln'); await page.mouse.click(on.x, on.y);
  await expect(page.locator('#readout')).toHaveText('<line> selected');
  const y1 = parseFloat(await page.locator('#ln').getAttribute('y1')), off = await pt(page, 'ln', .5, .5, 0, 5);
  await drag(page, off, 0, 30);
  expect(parseFloat(await page.locator('#ln').getAttribute('y1'))).toBeGreaterThan(y1 + 10);
  await expect(mode(page)).toHaveText('mode: scale');
});

test('a tiny shape stays grabbable: its handles fan out so the middle is clear', async ({ page }) => {
  await setup(page, [rect('t', 80, 60, 6, 6)]);
  const p = await pt(page, 't'); await page.mouse.click(p.x, p.y);
  await expect(page.locator('#readout')).toHaveText('<rect> selected');
  await drag(page, p, 25, 0);
  expect(await page.locator('#t').getAttribute('width')).toBe('6');        // moved, not scaled
  expect(parseFloat(await page.locator('#t').getAttribute('x'))).toBeGreaterThan(90);
});

test('a shape drawn above the selection wins a press inside its own area', async ({ page }) => {
  await setup(page, [rect('a', 20, 20, 100, 100), rect('b', 70, 70, 100, 100)]);
  const pa = await pt(page, 'a', .15, .15); await page.mouse.click(pa.x, pa.y);
  expect(await page.evaluate(() => ed.selected.id)).toBe('a');
  const overlap = await pt(page, 'b', .15, .15);
  await page.mouse.click(overlap.x, overlap.y);
  expect(await page.evaluate(() => ed.selected.id)).toBe('b');
});

test('handles still resize; they do not move the body or switch mode', async ({ page }) => {
  await setup(page, [rect('r', 30, 30, 120, 80)]);
  const p = await pt(page, 'r'); await page.mouse.click(p.x, p.y);
  const h = await page.evaluate(() => { const l = [...document.querySelector('#art').lastElementChild.children].find(c => c.getAttribute('data-sable') !== 'halo'); const r = (l.children[4].querySelector('circle') || l.children[4]).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(page, h, 30, 0);
  expect(await page.locator('#r').getAttribute('x')).toBe(String(await page.evaluate(() => +document.querySelector('#canvas').getBBox().x + 30)));
  expect(await page.locator('#r').getAttribute('transform')).toMatch(/\S/);
  await expect(mode(page)).toHaveText('mode: scale');
});

test('the cursor says the selected body moves, and goes back off it', async ({ page }) => {
  await setup(page, [rect('r', 30, 30, 120, 80)]);
  const p = await pt(page, 'r'), out = await pt(page, 'r', 1.6, .5);
  const cur = () => page.evaluate(() => document.querySelector('#art').style.cursor);
  await page.mouse.move(p.x, p.y); expect(await cur()).not.toBe('move');   // not selected yet
  await page.mouse.click(p.x, p.y); await page.mouse.move(p.x + 3, p.y + 3);
  await expect.poll(cur).toBe('move');
  await page.mouse.move(out.x, out.y);
  await expect.poll(cur).not.toBe('move');
});

test('path edit mode: dragging the stroke moves the path; a click selects a segment at once and a later click on it clears it; a double-click adds a node', async ({ page }) => {
  await setup(page, [{ tag: 'path', id: 'pa', attrs: { d: 'M30 60 L170 60', fill: 'none', stroke: '#c0392b', 'stroke-width': 3 } }]);
  const p = await pt(page, 'pa'); await page.mouse.click(p.x, p.y);
  await expect(page.locator('#readout')).toHaveText('<path> selected');
  await page.evaluate(() => { ed.mode = 'edit'; });
  const d0 = await page.locator('#pa').getAttribute('d');
  // drag along the stroke: moves the whole path and stays in edit mode
  await drag(page, p, 0, 25);
  expect(await page.locator('#pa').getAttribute('d')).not.toBe(d0);
  await expect(mode(page)).toHaveText('mode: edit');
  await page.keyboard.press('Control+z');
  expect(await page.locator('#pa').getAttribute('d')).toBe(d0);
  // a double-click adds a node and does not leave edit mode, not even after the click-wait has passed
  const nodes = d => (d.match(/[MLHVCQAZ]/g) || []).length, n0 = nodes(await page.locator('#pa').getAttribute('d'));
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(500);
  expect(nodes(await page.locator('#pa').getAttribute('d'))).toBeGreaterThan(n0);
  await expect(mode(page)).toHaveText('mode: edit');
  // a single click on the stroke selects the segment under it straight away (nothing waits for a possible double-click)
  await page.mouse.click(p.x + 40, p.y);   // elsewhere on the stroke: the new node now sits under the first spot
  expect(await page.evaluate(() => ed.selection?.kind)).toBe('segment');
  // clicking that one selected segment again clears it, and the mode stays edit
  await page.waitForTimeout(600);
  await page.mouse.click(p.x + 40, p.y);
  expect(await page.evaluate(() => ed.selection)).toBeNull();
  await expect(mode(page)).toHaveText('mode: edit');
});
