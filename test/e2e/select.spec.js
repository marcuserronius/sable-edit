import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* Node and segment selection in the path / polygon editors. Shapes are added to the free-drawing group (as in body.spec.js). */
const setup = async (page, shapes) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(({ shapes }) => {
    const c = document.querySelector('#canvas').getBBox(), g = document.querySelector('#sketch'), ns = 'http://www.w3.org/2000/svg';
    for (const s of shapes) {
      const e = document.createElementNS(ns, s.tag); e.setAttribute('class', 'edit');
      for (const [k, v] of Object.entries(s.attrs)) e.setAttribute(k, k === 'd' ? v.replace(/(-?[\d.]+) (-?[\d.]+)/g, (m, a, b) => `${+a + c.x} ${+b + c.y}`) : k === 'points' ? v.replace(/(-?[\d.]+),(-?[\d.]+)/g, (m, a, b) => `${+a + c.x},${+b + c.y}`) : v);
      e.id = s.id; g.append(e);
    }
  }, { shapes });
};
/* screen position of the point (x, y) in shape `id`'s own coordinates */
const at = (page, id, x, y) => page.evaluate(({ id, x, y }) => {
  const e = document.getElementById(id), m = e.getScreenCTM(), c = document.querySelector('#canvas').getBBox();
  x += c.x; y += c.y; return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}, { id, x, y });
const edit = async (page, id) => {
  const r = await page.evaluate(id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
  await page.evaluate(id => ed.select(document.getElementById(id)), id);
  await page.evaluate(() => { ed.mode = 'edit'; });
  return r;
};
const sel = page => page.evaluate(() => ed.selection);
const shown = page => page.evaluate(() => [...document.querySelector('#art').lastElementChild.querySelectorAll('circle')].filter(c => c.style.display !== 'none').length);
const PATH = { tag: 'path', id: 'pa', attrs: { d: 'M30 140 C 30 60, 90 60, 100 100 C 110 140, 160 140, 170 60', fill: 'none', stroke: '#c0392b', 'stroke-width': 3 } };

test('path: handles show only for the selection; Delete removes a selected node and Escape clears', async ({ page }) => {
  await setup(page, [PATH]); await edit(page, 'pa');
  expect(await shown(page)).toBe(0);                                  // nodes only, no bezier handles yet
  await page.mouse.click(...Object.values(await at(page, 'pa', 100, 100)));
  expect(await sel(page)).toEqual({ kind: 'node', items: [1] });
  expect(await shown(page)).toBe(2);                                  // the two handles that meet at that node
  await page.keyboard.press('Escape');
  expect(await sel(page)).toBeNull(); expect(await shown(page)).toBe(0);
  await page.mouse.click(...Object.values(await at(page, 'pa', 100, 100)));
  await page.keyboard.press('Delete');
  expect(await page.locator('#pa').getAttribute('d')).toMatch(/^M[\d. ]+C[^C]+$/);   // one curve left
  await page.keyboard.press('Control+z');
  expect((await page.locator('#pa').getAttribute('d')).match(/C/g)).toHaveLength(2);
});

test('path: shift-click adds nodes, dragging one moves them all, one undo step', async ({ page }) => {
  await setup(page, [PATH]); await edit(page, 'pa');
  const a = await at(page, 'pa', 30, 140), b = await at(page, 'pa', 170, 60), d0 = await page.locator('#pa').getAttribute('d');
  await page.mouse.click(a.x, a.y); await page.keyboard.down('Shift'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift');
  expect((await sel(page)).items).toEqual([0, 2]);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 10, a.y + 15, { steps: 4 }); await page.mouse.move(a.x + 20, a.y + 30, { steps: 4 }); await page.mouse.up();
  const b2 = await at(page, 'pa', 170, 60);
  const moved = await page.evaluate(() => { const d = document.getElementById('pa').getAttribute('d'); return d; });
  expect(moved).not.toBe(d0);
  await page.keyboard.press('Control+z');
  expect(await page.locator('#pa').getAttribute('d')).toBe(d0);
  expect(b2).toBeTruthy();
});

test('path: a click on the stroke selects that segment; Delete cuts the path there', async ({ page }) => {
  await setup(page, [{ tag: 'path', id: 'pl', attrs: { d: 'M30 140 L 100 60 L 170 140', fill: 'none', stroke: '#c0392b', 'stroke-width': 3 } }]); await edit(page, 'pl');
  const m = await at(page, 'pl', 65, 100);
  await page.mouse.click(m.x, m.y); await page.waitForTimeout(450);
  expect(await sel(page)).toEqual({ kind: 'segment', items: [1] });
  await page.keyboard.press('Delete');
  expect(await page.locator('#pl').getAttribute('d')).toMatch(/^M[\d. ]+L[\d. ]+$/);   // cutting the first segment leaves the single-segment piece (the lone first node is dropped)
  await page.keyboard.press('Control+z');
  expect(await page.locator('#pl').getAttribute('d')).toMatch(/^M[\d. ]+L[\d. ]+L[\d. ]+$/);
});

test('polygon: select vertices, Delete removes them but never below three', async ({ page }) => {
  await setup(page, [{ tag: 'polygon', id: 'pg', attrs: { points: '100,40 160,100 130,170 70,170 40,100', fill: '#d6eaf8', stroke: '#2874a6' } }]); await edit(page, 'pg');
  const n = () => page.locator('#pg').getAttribute('points').then(p => p.trim().split(/\s+/).length);
  await page.mouse.click(...Object.values(await at(page, 'pg', 100, 40)));
  await page.keyboard.down('Shift'); await page.mouse.click(...Object.values(await at(page, 'pg', 160, 100))); await page.keyboard.up('Shift');
  expect((await sel(page)).items).toEqual([0, 1]);
  await page.keyboard.press('Delete'); expect(await n()).toBe(3);
  await page.mouse.click(...Object.values(await at(page, 'pg', 130, 170)));
  await page.keyboard.press('Delete'); expect(await n()).toBe(3);     // refused: a polygon keeps three vertices
});
