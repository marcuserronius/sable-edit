import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* Segment types (right-click menu) and H / V / L in the path editor. Shapes go into the free-drawing group, as in select.spec.js. */
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
/* the path's d with the canvas offset taken off, rounded, so tests don't depend on where the canvas sits */
const d = page => page.evaluate(() => {
  const c = document.querySelector('#canvas').getBBox(), n = document.getElementById('pa').getAttribute('d');
  let k = 0; return n.replace(/(-?[\d.]+)/g, v => { const o = k++ % 2 === 0 ? c.x : c.y; return +(+v - o).toFixed(1) }).replace(/\s+/g, ' ');
});

test('right-click a segment: Segment type > Cubic curve turns a line into a curve that stays selected', async ({ page }) => {
  await setup(page, 'M30 140 L 100 60 L 170 140');
  const m = await at(page, 65, 100);
  await page.mouse.click(m.x, m.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Segment type/ }).hover();
  await page.getByRole('menuitem', { name: 'Cubic curve' }).click();
  expect(await d(page)).toMatch(/^M30 140 C/);
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'segment', items: [1] });
  await page.keyboard.press('Control+z');
  expect(await d(page)).toBe('M30 140 L 100 60 L 170 140');   // undo puts back the string as it was in the markup
});

test('an H segment stays H while its node slides along it, and a diagonal becomes H when a node lands level with the other end', async ({ page }) => {
  await setup(page, 'M30 140 H 100 L 170 60');
  const n = await at(page, 100, 140), to = await at(page, 120, 140);
  await page.mouse.move(n.x, n.y); await page.mouse.down(); await page.mouse.move((n.x + to.x) / 2, n.y, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 3 }); await page.mouse.up();
  expect(await d(page)).toMatch(/^M30 140 H\d+(\.\d)? L/);
});
