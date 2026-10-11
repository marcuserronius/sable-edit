import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* helpers as in pen.spec.js */
const at = async (page, fx, fy) => {
  const c = page.locator('#canvas');
  await c.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await c.boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
const toUnits = (page, p) => page.evaluate(({ x, y }) => { const m = document.querySelector('#art').getScreenCTM(), q = new DOMPoint(x, y).matrixTransform(m.inverse()); return [q.x, q.y]; }, p);
const menu = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name) });
const pick = async (page, p, submenu, item) => {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu(page, submenu).hover();
  await menu(page, item).click();
};
const arm = async (page, name) => { const p = await at(page, .05, .1); await pick(page, p, 'Switch Tool', name); await expect(page.locator('#tool')).toHaveText('tool: ' + name.toLowerCase()); };
const pts = async (page, tag) => (await page.locator('#sketch ' + tag).last().getAttribute('points')).trim().split(/\s+/).map(s => s.split(',').map(Number));
const closeTo = async (page, got, screen) => { const u = await toUnits(page, screen); expect(Math.abs(got[0] - u[0])).toBeLessThan(.05); expect(Math.abs(got[1] - u[1])).toBeLessThan(.05); };

test('Switch Tool > Polygon: each click adds a vertex, the shape counts as created with the third, Enter finishes, the tool stays armed', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polygon');
  const a = await at(page, .2, .3), b = await at(page, .4, .3), c = await at(page, .3, .6);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('#readout')).not.toHaveText('<polygon> created');
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#readout')).toHaveText('<polygon> created');
  const P = await pts(page, 'polygon');
  expect(P.length).toBe(3);
  await closeTo(page, P[0], a); await closeTo(page, P[1], b); await closeTo(page, P[2], c);
  await page.keyboard.press('Enter');
  await expect(page.locator('#tool')).toHaveText('tool: polygon');
  const d = await at(page, .7, .7);
  await page.mouse.click(d.x, d.y);                       // no vertex selected: a second polygon
  await expect(page.locator('#sketch polygon')).toHaveCount(2);
});

test('Esc leaves the pen, the polygon stays selected in scale mode; a polygon with fewer than three vertices is thrown away', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polygon');
  const a = await at(page, .2, .3), b = await at(page, .4, .3), c = await at(page, .3, .6);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
  await expect(page.locator('#mode')).toHaveText('mode: scale');
  expect(await page.evaluate(() => ed.selected?.tagName)).toBe('polygon');
  await page.keyboard.press('Escape');
  await arm(page, 'Polygon');
  const d = await at(page, .6, .3), e = await at(page, .8, .3);
  await page.mouse.click(d.x, d.y); await page.mouse.click(e.x, e.y);
  await expect(page.locator('#sketch polygon')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#sketch polygon')).toHaveCount(1);     // two vertices are no polygon
});

test('a polygon has no ends: the pen adds the new vertex right after the selected one', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polygon');
  const a = await at(page, .2, .3), b = await at(page, .4, .3), c = await at(page, .3, .6), e = await at(page, .3, .15);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');
  await page.mouse.click(a.x, a.y);                         // select the first vertex: that is where the pen continues
  await page.mouse.click(e.x, e.y);
  await expect(page.locator('#sketch polygon')).toHaveCount(1);
  const P = await pts(page, 'polygon');
  expect(P.length).toBe(4);
  await closeTo(page, P[0], a); await closeTo(page, P[1], e); await closeTo(page, P[2], b); await closeTo(page, P[3], c);
});

test('a polyline grows at the end its selected vertex is on: from its first vertex it grows in front', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polyline');
  const a = await at(page, .2, .3), b = await at(page, .4, .3), c = await at(page, .4, .6), d = await at(page, .15, .6);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await expect(page.locator('#readout')).toHaveText('<polyline> created');   // two vertices are a polyline
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');
  await page.mouse.click(a.x, a.y);                         // the first vertex is an end
  await page.mouse.click(d.x, d.y);
  await expect(page.locator('#sketch polyline')).toHaveCount(1);
  const P = await pts(page, 'polyline');
  expect(P.length).toBe(4);
  await closeTo(page, P[0], d); await closeTo(page, P[1], a); await closeTo(page, P[2], b); await closeTo(page, P[3], c);
  const m = await at(page, .45, .45);                        // a vertex in the middle is not an end: selected, then a press starts a new polyline
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(m.x, m.y);
  await expect(page.locator('#sketch polyline')).toHaveCount(2);
});

test('press-drag places the vertex where you let go; undo takes one vertex at a time and the pen stays on the last one', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polyline');
  const a = await at(page, .2, .5), b = await at(page, .4, .5), c = await at(page, .6, .5);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 10, b.y + 20, { steps: 3 }); await page.mouse.move(b.x + 20, b.y + 40, { steps: 3 }); await page.mouse.up();
  let P = await pts(page, 'polyline');
  expect(P.length).toBe(2);
  await closeTo(page, P[1], { x: b.x + 20, y: b.y + 40 });
  await page.mouse.click(c.x, c.y);
  expect((await pts(page, 'polyline')).length).toBe(3);
  await page.keyboard.press('Control+z');
  expect((await pts(page, 'polyline')).length).toBe(2);
  await page.keyboard.press('Control+Shift+z');
  expect((await pts(page, 'polyline')).length).toBe(3);
  await page.keyboard.press('Control+z');
  await page.mouse.click(c.x, c.y);                          // the pen is back on the second vertex: this continues the same polyline
  await expect(page.locator('#sketch polyline')).toHaveCount(1);
  expect((await pts(page, 'polyline')).length).toBe(3);
});

test('clicking the vertex the pen is on finishes; hovering shows the rubber band; the menu offers Finish but no segment kinds', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polygon');
  const a = await at(page, .2, .3), b = await at(page, .4, .3), m = await at(page, .5, .6);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await page.mouse.move(m.x, m.y);
  await expect(page.locator('#art polyline[stroke-dasharray="5 4"]')).toBeVisible();
  await page.mouse.click(b.x, b.y);                          // the vertex just placed: finish
  expect(await page.evaluate(() => ed.selection)).toBeNull();
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(menu(page, 'Finish polygon')).toBeVisible();
  await expect(menu(page, 'Next segment')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('Esc during a press-drag undoes just that vertex and keeps the pen armed', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page, 'Polyline');
  const a = await at(page, .2, .3), b = await at(page, .4, .3);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await page.mouse.move(b.x + 80, b.y); await page.mouse.down(); await page.mouse.move(b.x + 100, b.y + 30, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await pts(page, 'polyline')).length).toBe(2);
  await expect(page.locator('#tool')).toHaveText('tool: polyline');
});

test('policy: every vertex is put on the snap grid, and a pinned polyline is not extended (denied, reason pinned)', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { ed.policy = { rules: [{ select: '.edit', can: 'all', snap: 10 }] }; });
  await arm(page, 'Polyline');
  const a = await at(page, .2, .3), b = await at(page, .4, .35);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  const P = await pts(page, 'polyline');
  for (const q of P.flat()) expect(Math.abs(q / 10 - Math.round(q / 10))).toBeLessThan(1e-6);
  await page.evaluate(() => { window.__denied = []; ed.on('denied', d => window.__denied.push(d.reason)); ed.policy = { rules: [{ select: '.edit', can: 'all', pin: ['endpoints'] }] }; });
  const before = await page.locator('#sketch polyline').last().getAttribute('points');
  const c = await at(page, .6, .5);
  await page.mouse.click(c.x, c.y);
  expect(await page.locator('#sketch polyline').last().getAttribute('points')).toBe(before);
  await expect(page.locator('#sketch polyline')).toHaveCount(1);
  expect(await page.evaluate(() => window.__denied)).toContain('pinned');
});

test('policy: without nodes.insert no polygon is started, and the host hears why', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { window.__denied = []; ed.on('denied', d => window.__denied.push(d.cap)); ed.policy = { rules: [{ select: '.edit', can: 'all', cannot: ['nodes.insert'] }] }; });
  await arm(page, 'Polygon');
  const a = await at(page, .2, .3);
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('#sketch polygon')).toHaveCount(0);
  expect(await page.evaluate(() => window.__denied)).toContain('nodes.insert');
});
