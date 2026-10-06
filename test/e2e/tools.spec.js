import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* a point inside the free-drawing area, as fractions of its box (the area is scrolled into view first) */
const at = async (page, fx, fy) => {
  const c = page.locator('#canvas');
  await c.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the scroll event fire (an open menu closes on scroll)
  const b = await c.boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
/* screen point -> svg user units, and screen px per svg unit, from the svg's own transform (its border makes bounding-box maths a little off) */
const toUnits = (page, p) => page.evaluate(({ x, y }) => { const m = document.querySelector('#art').getScreenCTM(), q = new DOMPoint(x, y).matrixTransform(m.inverse()); return { x: q.x, y: q.y, k: Math.hypot(m.a, m.b) }; }, p);
const menu = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name) });
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
};
const pick = async (page, p, submenu, item) => {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu(page, submenu).hover();
  await menu(page, item).click();
};

test('right-click opens the tool menu with both submenus; Esc closes it', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(menu(page, 'Use Once')).toBeVisible();
  await expect(menu(page, 'Switch Tool')).toBeVisible();
  await menu(page, 'Switch Tool').hover();
  await expect(page.getByRole('menu')).toHaveCount(2);
  await expect(menu(page, 'Pointer')).toContainText('\u2713');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('menu closes on an outside click', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.mouse.click(p.x + 300, p.y + 100);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('Switch Tool > Circle is sticky: each drag draws a circle (centre = press, r = drag distance); Esc returns to pointer', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .3, .4), u = await toUnits(page, p);
  await pick(page, p, 'Switch Tool', 'Circle');
  await expect(page.locator('#tool')).toHaveText('tool: circle');
  await drag(page, p, 60, 0);
  const circles = page.locator('#sketch circle');
  await expect(circles).toHaveCount(1);
  const r = +await circles.first().getAttribute('r'), cx = +await circles.first().getAttribute('cx'), cy = +await circles.first().getAttribute('cy');
  expect(Math.abs(r - 60 / u.k)).toBeLessThan(.05);
  expect(Math.abs(cx - u.x)).toBeLessThan(.05);
  expect(Math.abs(cy - u.y)).toBeLessThan(.05);
  await expect(circles.first()).toHaveClass('edit');
  await expect(page.locator('#tool')).toHaveText('tool: circle'); // still armed
  await drag(page, await at(page, .7, .6), 0, -40);
  await expect(circles).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
});

test('Use Once > Circle draws one circle, selects it, then reverts to the pointer; undo/redo the creation', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await pick(page, p, 'Use Once', 'Circle');
  await expect(page.locator('#tool')).toHaveText('tool: circle');
  await drag(page, p, 50, 30);
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
  await expect(page.locator('#sketch circle')).toHaveCount(1);
  await expect(page.locator('#readout')).toHaveText('<circle> selected');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sketch circle')).toHaveCount(0);
  await expect(page.locator('#readout')).toHaveText('nothing selected');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#sketch circle')).toHaveCount(1);
  // the new shape is a normal editable shape: its radius is one more undo step on top of the creation
  await page.evaluate(() => ed.set(document.querySelector('#sketch circle'), 'r', '5'));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sketch circle')).toHaveCount(0);
});

test('a click without a drag creates nothing and does not use up Use Once; Esc mid-drag cancels', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await pick(page, p, 'Use Once', 'Circle');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#sketch circle')).toHaveCount(0);
  await expect(page.locator('#tool')).toHaveText('tool: circle');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 10, { steps: 3 });
  await expect(page.locator('#sketch circle')).toHaveCount(1); // live preview
  await page.keyboard.press('Escape');
  await page.mouse.move(p.x + 60, p.y + 10); await page.mouse.up();
  await expect(page.locator('#sketch circle')).toHaveCount(0);
  await expect(page.locator('#tool')).toHaveText('tool: circle'); // cancelled gestures do not consume the one-shot
});

test('with a tool armed, pressing on an existing shape draws instead of selecting or moving it', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('circle.edit').first().click();
  const before = await page.locator('circle.edit').first().getAttribute('cx');
  const b = await page.locator('circle.edit').first().boundingBox();
  await page.evaluate(() => ed.tool = 'circle');
  await expect(page.locator('#readout')).toHaveText('nothing selected');
  await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 30, 0);
  await expect(page.locator('#sketch circle')).toHaveCount(1);
  expect(await page.locator('circle.edit').first().getAttribute('cx')).toBe(before);
});

test('right-click on a selected shape opens the menu and does not trigger the hub', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('rect.edit').first().click();
  const mode = await page.locator('#mode').textContent();
  const h = await page.evaluate(() => { const r = document.querySelector('#art').lastElementChild.children[1].querySelector('circle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(h.x, h.y, { button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.locator('#mode')).toHaveText(mode);
});

test('Switch Tool > Rectangle: press = one corner, release = the opposite corner, in any direction; undo removes it', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await pick(page, p, 'Switch Tool', 'Rectangle');
  await expect(page.locator('#tool')).toHaveText('tool: rect');
  const q = { x: p.x + 80, y: p.y + 50 }, a = await toUnits(page, p), b = await toUnits(page, q);
  const near = async (el, want) => { for (const k in want) expect(Math.abs(+await el.getAttribute(k) - want[k])).toBeLessThan(.05); };
  await drag(page, p, 80, 50); // down-right
  const rects = page.locator('#sketch rect');
  await expect(rects).toHaveCount(1);
  await near(rects.first(), { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
  await drag(page, q, -80, -50); // up-left, the same two corners
  await expect(rects).toHaveCount(2);
  await near(rects.nth(1), { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
  await expect(rects.first()).toHaveClass('edit');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(rects).toHaveCount(1);
});

test('rect tool: a flat drag (no height) makes nothing', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .5, .5);
  await pick(page, p, 'Use Once', 'Rectangle');
  await drag(page, p, 80, 0);
  await expect(page.locator('#sketch rect')).toHaveCount(0);
  await expect(page.locator('#tool')).toHaveText('tool: rect');
  await drag(page, p, 80, 40);
  await expect(page.locator('#sketch rect')).toHaveCount(1);
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
});

test('Switch Tool > Ellipse: the drag is its bounding box, in any direction', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .4, .4);
  await pick(page, p, 'Switch Tool', 'Ellipse');
  await expect(page.locator('#tool')).toHaveText('tool: ellipse');
  const q = { x: p.x + 100, y: p.y + 60 }, a = await toUnits(page, p), b = await toUnits(page, q);
  const want = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: (b.x - a.x) / 2, ry: (b.y - a.y) / 2 };
  const els = page.locator('#sketch ellipse');
  await drag(page, p, 100, 60);
  await drag(page, q, -100, -60);
  await expect(els).toHaveCount(2);
  for (const i of [0, 1]) for (const k in want) expect(Math.abs(+await els.nth(i).getAttribute(k) - want[k])).toBeLessThan(.05);
  await expect(els.first()).toHaveClass('edit');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(els).toHaveCount(1);
});

test('Use Once > Line: press = start, release = end; a click makes nothing; the new line is selected', async ({ page }) => {
  await page.goto('/demo/');
  const p = await at(page, .4, .6);
  await pick(page, p, 'Use Once', 'Line');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#sketch line')).toHaveCount(0);
  await expect(page.locator('#tool')).toHaveText('tool: line');
  const q = { x: p.x - 70, y: p.y + 40 }, a = await toUnits(page, p), b = await toUnits(page, q);
  await drag(page, p, -70, 40);
  const line = page.locator('#sketch line');
  await expect(line).toHaveCount(1);
  for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) expect(Math.abs(+await line.getAttribute(k) - v)).toBeLessThan(.05);
  await expect(page.locator('#tool')).toHaveText('tool: pointer');
  await expect(page.locator('#readout')).toHaveText('<line> selected');
});
