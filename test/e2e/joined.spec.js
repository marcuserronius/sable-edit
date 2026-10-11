import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* a path drawn in its own coordinates (moved into the canvas by a transform), selected and in edit mode; `pt(x, y)` is where a point of it is on screen */
const LEAF = 'M50 100 C50 50 150 50 150 100 C150 150 50 150 50 100';
const setup = async (page, d) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(d => {
    const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.id = 'jp'; e.setAttribute('class', 'edit'); e.setAttribute('fill', '#d6eaf8'); e.setAttribute('stroke', '#2874a6'); e.setAttribute('stroke-width', 2);
    e.setAttribute('transform', `translate(${c.x} ${c.y + 20})`); e.setAttribute('d', d); document.querySelector('#sketch').append(e);
    ed.select(e); ed.mode = 'edit';
  }, d);
  return (x, y) => page.evaluate(({ x, y }) => { const m = document.getElementById('jp').getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }, { x, y });
};
const D = page => page.locator('#jp').getAttribute('d');
const nums = d => d.match(/-?[\d.]+/g).map(Number);
const drag = async (page, from, dx, dy) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
};

for (const [name, d] of [['closed with a Z that draws nothing', LEAF + ' Z'], ['never closed, ends on the start', LEAF]]) {
  test('joined node (' + name + '): dragging it moves both halves and their handles together; the joint stays one point', async ({ page }) => {
    const pt = await setup(page, d);
    const k = (await page.evaluate(() => document.getElementById('jp').getScreenCTM().a)); // screen px per unit
    await drag(page, await pt(50, 100), 20 * k, 10 * k);
    const n = nums(await D(page));
    expect(n.slice(0, 2).map(Math.round)).toEqual([70, 110]);                       // M moved
    expect(n.slice(-2).map(Math.round)).toEqual([70, 110]);                         // and so did the last point: no gap
    expect(n.slice(2, 4).map(Math.round)).toEqual([70, 60]);                        // the first segment's handle went along
    expect(n.slice(-4, -2).map(Math.round)).toEqual([70, 160]);                     // and the last segment's
    expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [0] });
  });

  test('joined node (' + name + '): dragging a handle at the joint mirrors the one across it, as one symmetric node', async ({ page }) => {
    const pt = await setup(page, d);
    const k = (await page.evaluate(() => document.getElementById('jp').getScreenCTM().a));
    await page.mouse.click((await pt(50, 100)).x, (await pt(50, 100)).y);           // select the node: both its handles show
    await drag(page, await pt(50, 50), 30 * k, 0);                                  // the first segment's handle: (50,50) -> (80,50)
    const n = nums(await D(page));
    expect(n.slice(2, 4).map(Math.round)).toEqual([80, 50]);
    expect(n.slice(-4, -2).map(Math.round)).toEqual([20, 150]);                     // the last segment's handle is its mirror about (50,100)
    await drag(page, await pt(20, 150), 0, 20 * k);                                 // and from the other side
    const m = nums(await D(page));
    expect(m.slice(-4, -2).map(Math.round)).toEqual([20, 170]);
    expect(m.slice(2, 4).map(Math.round)).toEqual([80, 30]);
  });
}

test('a Z that draws a line is its own segment: the nodes at its two ends move independently', async ({ page }) => {
  const pt = await setup(page, 'M50 100 L150 100 L100 160 Z');
  const k = (await page.evaluate(() => document.getElementById('jp').getScreenCTM().a));
  await drag(page, await pt(50, 100), 0, -30 * k);
  expect(nums(await D(page)).map(Math.round)).toEqual([50, 70, 150, 100, 100, 160]);  // only the first node went (the line back to it is the Z's)
  await drag(page, await pt(100, 160), 0, 20 * k);
  expect(nums(await D(page)).map(Math.round)).toEqual([50, 70, 150, 100, 100, 180]);
});

test('double-clicking a joined node deletes both halves; Undo puts them back together', async ({ page }) => {
  const pt = await setup(page, 'M50 100 C50 50 150 50 150 100 C150 150 100 170 100 160 C60 150 50 150 50 100 Z');
  const before = await D(page);
  const p = await pt(50, 100);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(450);
  await page.mouse.dblclick(p.x, p.y);
  expect(await D(page)).toBe('M150 100 C150 150 100 170 100 160 Z');
  await page.keyboard.press('Control+z');
  expect(await D(page)).toBe(before);
});
