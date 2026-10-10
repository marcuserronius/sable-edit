import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* helpers as in tools.spec.js: a point in the free-drawing area as fractions of its box; screen -> svg units; the context menu */
const at = async (page, fx, fy) => {
  const c = page.locator('#canvas');
  await c.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await c.boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
const toUnits = (page, p) => page.evaluate(({ x, y }) => { const m = document.querySelector('#art').getScreenCTM(), q = new DOMPoint(x, y).matrixTransform(m.inverse()); return { x: q.x, y: q.y, k: Math.hypot(m.a, m.b) }; }, p);
const menu = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name) });
const pick = async (page, p, submenu, item) => {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu(page, submenu).hover();
  await menu(page, item).click();
};
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
};
const D = page => page.locator('#sketch path').last().getAttribute('d');
const cmds = d => (d.match(/[A-Za-z]/g) || []).join('');
const arm = async (page) => { const p = await at(page, .2, .2); await pick(page, p, 'Switch Tool', 'Path'); await expect(page.locator('#tool')).toHaveText('tool: path'); };

test('Switch Tool > Path: clicks add nodes (the first one at the press), Enter finishes, the tool stays armed', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .2), b = await at(page, .4, .2), c = await at(page, .4, .4);
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('#sketch path')).toHaveCount(1);
  expect(await page.evaluate(() => ed.selected?.tagName)).toBe('path');
  await expect(page.locator('#readout')).not.toHaveText('<path> created'); // nothing is announced until it has a segment
  const u = await toUnits(page, a), d0 = await D(page), n = d0.match(/-?[\d.]+/g).map(Number);
  expect(Math.abs(n[0] - u.x)).toBeLessThan(.05); expect(Math.abs(n[1] - u.y)).toBeLessThan(.05);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('#readout')).toHaveText('<path> created');
  await page.mouse.click(c.x, c.y);
  expect(cmds(await D(page))).toMatch(/^M[HLV][HLV]$/);
  await expect(page.locator('#sketch path')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#tool')).toHaveText('tool: path');
  const e = await at(page, .6, .5);
  await page.mouse.click(e.x, e.y);                       // no endpoint is selected any more: a second path
  await expect(page.locator('#sketch path')).toHaveCount(2);
});

test('Esc leaves the pen but keeps the path selected (scale mode); a second Esc deselects; a lone first node is thrown away', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .3), b = await at(page, .4, .3);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
  expect(await page.evaluate(() => ed.selected?.tagName)).toBe('path');
  await expect(page.locator('#mode')).toHaveText('mode: scale');
  await page.keyboard.press('Escape');
  await expect(page.locator('#readout')).toHaveText('nothing selected');
  await arm(page);
  const c = await at(page, .6, .6);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#sketch path')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#sketch path')).toHaveCount(1); // the lone M is gone
});

test('press-drag pulls handles: the node is symmetric (a curve, then S on the next click); undo takes one node at a time', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .5), b = await at(page, .4, .5), c = await at(page, .6, .5);
  await page.mouse.click(a.x, a.y);
  await drag(page, b, 40, 40);
  expect(cmds(await D(page))).toBe('MC');
  await page.mouse.click(c.x, c.y);
  expect(cmds(await D(page))).toBe('MCS');
  await page.keyboard.press('Control+z');
  expect(cmds(await D(page))).toBe('MC');
  await page.keyboard.press('Control+z');
  expect(cmds(await D(page))).toBe('M');
  await page.keyboard.press('Control+Shift+z');
  expect(cmds(await D(page))).toBe('MC');
  // the end node is selected again after an undo, so the next click still continues the same path
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#sketch path')).toHaveCount(1);
  expect(cmds(await D(page))).toBe('MCS');
});

test('pressing the other end closes the path, from two nodes on: a quadratic closes into a balloon, a plain path into a Z', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const menuAt = await at(page, .9, .2);
  const a = await at(page, .2, .6), b = await at(page, .35, .6), c = await at(page, .35, .8);
  await pick(page, menuAt, 'Next segment', 'Quadratic');
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  expect(cmds(await D(page))).toBe('MQ');
  await page.mouse.click(a.x, a.y);                      // two nodes: the first one closes it, with a quadratic back
  expect(cmds(await D(page))).toBe('MQQZ');
  await expect(page.locator('#sketch path')).toHaveCount(1);
  await pick(page, menuAt, 'Next segment', 'Auto');
  const e = await at(page, .6, .6), f = await at(page, .75, .6), g = await at(page, .75, .8);
  await page.mouse.click(e.x, e.y);                      // a closed path has no endpoint: a new path
  await page.mouse.click(f.x, f.y); await page.mouse.click(g.x, g.y);
  await page.mouse.click(e.x, e.y);
  expect(cmds(await D(page))).toMatch(/Z$/);
  await expect(page.locator('#sketch path')).toHaveCount(2);
  const h = await at(page, .5, .9);
  await page.mouse.click(h.x, h.y);                      // closed again: the next press starts a third
  await expect(page.locator('#sketch path')).toHaveCount(3);
});

test('a drag on the closing press pulls the closing segment out into a curve', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .6), b = await at(page, .4, .6);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await drag(page, a, 10, -60);
  expect(cmds(await D(page))).toBe('MHCZ');
});

test('clicking the end node again finishes; the pen can continue a path from its selected endpoint, even the first node', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .7), b = await at(page, .4, .7), c = await at(page, .6, .5);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await page.mouse.click(b.x, b.y);                      // the end node: finish
  await expect(page.locator('#sketch path')).toHaveCount(1);
  await page.mouse.click(a.x, a.y);                      // the first node: selected, it is an endpoint, so the pen continues from there
  const before = await D(page);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#sketch path')).toHaveCount(1);
  const after = await D(page);
  expect(after).not.toBe(before);
  const u = await toUnits(page, c), n = after.match(/-?[\d.]+/g).map(Number);
  expect(Math.abs(n.at(-2) - u.x)).toBeLessThan(.05); expect(Math.abs(n.at(-1) - u.y)).toBeLessThan(.05); // the new node is the end
  expect(Math.abs(n[0] - (await toUnits(page, b)).x)).toBeLessThan(.05);                                 // and the old far end is now the start (the subpath was reversed)
});

test('Next segment: Arc adds an arc segment; the rubber band shows the next segment while hovering', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .25, .4), b = await at(page, .45, .4);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(a.x, a.y, { button: 'right' }); // right-click while drawing: the pen's own entries
  await menu(page, 'Next segment').hover();
  await menu(page, 'Arc').click();
  await page.mouse.move(b.x, b.y);
  await expect(page.locator('#art path[stroke-dasharray="5 4"]')).toBeVisible();
  await page.mouse.click(b.x, b.y);
  expect(cmds(await D(page))).toBe('MA');
});

test('Esc during a press-drag undoes just that node and keeps the pen armed', async ({ page }) => {
  await page.goto('/demo/');
  await arm(page);
  const a = await at(page, .2, .3), b = await at(page, .4, .3);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  const d0 = await D(page);
  await page.mouse.move(b.x + 60, b.y); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 30, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await D(page)).toBe(d0);
  await expect(page.locator('#tool')).toHaveText('tool: path');
});
