import { test, expect } from '@playwright/test';

test('demo loads and exposes the API', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/demo/');
  expect(await page.evaluate(() => typeof SableEdit.attach)).toBe('function');
  expect(errors).toEqual([]);
});

test('selecting a rect shows handles; undo restores edits', async ({ page }) => {
  await page.goto('/demo/');
  const rect = page.locator('rect.edit').first();
  await rect.click();
  await expect(page.locator('#readout')).toHaveText('<rect> selected');
  const before = await rect.getAttribute('width');
  await page.evaluate(() => { document.querySelector('rect.edit').setAttribute('width', '60'); });
  // programmatic attribute edits bypass history; drive an undoable edit via the instance
  await page.evaluate(() => ed.set(document.querySelector('rect.edit'), 'width', '99'));
  await expect(rect).toHaveAttribute('width', '99');
  await page.keyboard.press('Control+z');
  await expect(rect).toHaveAttribute('width', '60');
  expect(before).toBe('120');
});

test('clicking empty space deselects', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('circle.edit').click();
  await expect(page.locator('#readout')).toHaveText('<circle> selected');
  await page.locator('#art').click({ position: { x: 5, y: 870 } });
  await expect(page.locator('#readout')).toHaveText('nothing selected');
});

/* ---- edit modes: scale -> rotate/skew -> edit, cycled by clicking the selected shape ---- */
// the middle of a shape's screen box: a point on the body of the shapes these tests use
const body = (page, sel) => page.evaluate(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);
// handles of the layer under the overlay, in DOM order (scale/rotate: TL,T,TR,L,R,BL,B,BR; edit mode: the widget's handles)
const handles = page => page.evaluate(() => [...[...document.querySelector('#art').lastElementChild.children].find(c => c.getAttribute('data-sable') !== 'halo').children]
  .filter(c => c.tagName !== 'polygon').map(c => { const r = (c.querySelector('circle') || c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
const drag = async (page, from, to) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
};

test('clicking the selected shape cycles scale -> rotate -> edit -> scale', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('rect.edit').first().click();
  await expect(page.locator('#mode')).toHaveText('mode: scale');
  for (const m of ['rotate', 'edit', 'scale']) {
    const h = await body(page, 'rect.edit'); await page.mouse.click(h.x, h.y);
    await expect(page.locator('#mode')).toHaveText('mode: ' + m);
  }
});

test('shapes with no editor of their own (text) only cycle scale <-> rotate', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('text.edit').click();
  expect(await page.evaluate(() => ed.modes)).toEqual(['scale', 'rotate']);
  const h = await body(page, 'text.edit'); await page.mouse.click(h.x, h.y); await page.mouse.click(h.x, h.y);
  await expect(page.locator('#mode')).toHaveText('mode: scale');
});

test('scale: an edge handle resizes along its axis, the opposite edge stays, and undo is one step', async ({ page }) => {
  await page.goto('/demo/');
  const rect = page.locator('rect.edit').first(); await rect.click();
  const before = await rect.getAttribute('transform'), H = await handles(page);
  const to = { x: H[4].x + 35, y: H[4].y + 6 };
  await drag(page, H[4], to);
  const H2 = await handles(page);
  expect(Math.hypot(H2[4].x - to.x, H2[4].y - to.y)).toBeLessThan(1.5);   // dragged handle ends under the pointer
  expect(Math.hypot(H2[3].x - H[3].x, H2[3].y - H[3].y)).toBeLessThan(1.5); // opposite edge did not move
  expect(await rect.getAttribute('width')).toBe('120');                      // geometry untouched; the transform carries it
  await page.keyboard.press('Control+z');
  expect(await rect.getAttribute('transform')).toBe(before);
});

test('rotate mode: a corner follows the pointer angle about the centre; edge handles skew', async ({ page }) => {
  await page.goto('/demo/');
  await page.locator('rect.edit').first().click();
  await page.evaluate(() => { ed.mode = 'rotate'; });
  const C = await body(page, 'rect.edit'), H = await handles(page), ang = p => Math.atan2(p.y - C.y, p.x - C.x), r = Math.hypot(H[2].x - C.x, H[2].y - C.y);
  await drag(page, H[2], { x: C.x + Math.cos(ang(H[2]) + 0.5) * r, y: C.y + Math.sin(ang(H[2]) + 0.5) * r });
  const H2 = await handles(page);
  expect((ang(H2[2]) - ang(H[2])) * 180 / Math.PI).toBeCloseTo(28.65, 0);
  await page.keyboard.press('Control+z');
  await drag(page, H[1], { x: H[1].x + 28, y: H[1].y });
  expect(await page.locator('rect.edit').first().getAttribute('transform')).toMatch(/^matrix\(/);
});

test('dragging the body moves a rect by rewriting x/y, not transform; undo restores', async ({ page }) => {
  await page.goto('/demo/');
  const rect = page.locator('#plain-rect'); await rect.click();
  const h = await body(page, '#plain-rect');
  await drag(page, h, { x: h.x + 30, y: h.y + 12 });
  expect(await rect.getAttribute('transform')).toBeNull();
  expect(await rect.getAttribute('x')).not.toBe('30');
  await page.keyboard.press('Control+z');
  expect(await rect.getAttribute('x')).toBe('30');
});

test('rect edit mode: corner-radius handle sits on the corner at 0 and its inset offsets are rx and ry', async ({ page }) => {
  await page.goto('/demo/');
  const rect = page.locator('#plain-rect'); await rect.click();
  await page.evaluate(() => { ed.mode = 'edit'; });
  const k = await page.evaluate(() => document.querySelector('#art').getScreenCTM().a);
  const [, , dot] = await handles(page);
  const corner = await page.evaluate(() => { const e = document.querySelector('#plain-rect'), s = document.querySelector('#art'), p = s.createSVGPoint(); p.x = 150; p.y = 70; const q = p.matrixTransform(e.getScreenCTM()); return { x: q.x, y: q.y }; });
  expect(Math.hypot(dot.x - corner.x, dot.y - corner.y)).toBeLessThan(1.5);
  await drag(page, dot, { x: dot.x - 10 * k, y: dot.y + 30 * k });
  expect(parseFloat(await rect.getAttribute('rx'))).toBeCloseTo(10, 0);
  expect(parseFloat(await rect.getAttribute('ry'))).toBeCloseTo(30, 0);
});
