import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* Smooth / symmetric nodes in the path editor (shapes go into the free-drawing group, as in select.spec.js). */
const setup = async (page, d) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(d => {
    const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.setAttribute('class', 'edit'); e.id = 'pa'; e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#c0392b'); e.setAttribute('stroke-width', 3);
    e.setAttribute('d', d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (m, a, b) => `${+a + c.x} ${+b + c.y}`));
    document.querySelector('#sketch').append(e); ed.select(e); ed.mode = 'edit';
  }, d);
};
const at = (page, x, y) => page.evaluate(({ x, y }) => {
  const m = document.getElementById('pa').getScreenCTM(), c = document.querySelector('#canvas').getBBox(); x += c.x; y += c.y;
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}, { x, y });
const drag = async (page, from, to, mod) => {
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
};
const d = page => page.locator('#pa').getAttribute('d');
const D = 'M30 140 C 40 60, 80 60, 100 100 C 130 160, 160 140, 180 100';   // a smooth (not symmetric) node at 100,100: its handles (80,60) and (130,160) are on one line

test('dragging a handle of a smooth node keeps the other handle on the line; Alt breaks the link', async ({ page }) => {
  await setup(page, D);
  await page.mouse.click(...Object.values(await at(page, 100, 100)));   // select the node: its two handles appear
  await drag(page, await at(page, 80, 60), await at(page, 80, 20));
  const m = /C[\d. -]+ ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) C([\d.-]+) ([\d.-]+)/.exec(await d(page));
  const [hx, hy, nx, ny, ox, oy] = m.slice(1).map(Number);
  expect(Math.abs((hx - nx) * (oy - ny) - (hy - ny) * (ox - nx))).toBeLessThan(0.5);   // handle, node and partner stay collinear
  await page.keyboard.press('Control+z');
  const d0 = await d(page);
  await drag(page, await at(page, 80, 60), await at(page, 80, 20), 'Alt');
  const after = await d(page);
  const last6 = s => (s.match(/-?[\d.]+/g) || []).slice(-6).map(Number);
  expect(last6(after)).toEqual(last6(d0));                                              // the other segment is untouched
});

test('Shift while dragging makes the node symmetric and the path data uses S', async ({ page }) => {
  await setup(page, D);
  await page.mouse.click(...Object.values(await at(page, 100, 100)));
  await drag(page, await at(page, 80, 60), await at(page, 80, 30), 'Shift');
  expect(await d(page)).toMatch(/ S[\d. -]+$/);
});

test('right-click a node: Node type > Corner turns S back into C', async ({ page }) => {
  await setup(page, 'M30 140 C 40 60, 80 60, 100 100 S 160 140, 180 100');
  const n = await at(page, 100, 100);
  await page.mouse.click(n.x, n.y); await page.mouse.click(n.x, n.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Node type/ }).hover();
  await page.getByRole('menuitem', { name: 'Corner' }).click();
  expect(await d(page)).not.toMatch(/S/);
  await page.keyboard.press('Control+z');
  expect(await d(page)).toMatch(/ S/);
});
