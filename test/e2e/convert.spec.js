import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* helpers (as in tooledit.spec.js): a point of the free-drawing area, and a drag from it */
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
const menu = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name) });
/* draw one shape with a tool, then leave the tool so the pointer is the pointer again */
const draw = async (page, tool, dx = 100, dy = 60) => {
  await page.goto('/demo/');
  const p = await at(page, .3, .3);
  await page.evaluate(t => ed.tool = t, tool);
  await drag(page, p, dx, dy);
  await page.evaluate(() => { ed.tool = 'pointer'; });
  return { x: p.x + dx / 2, y: p.y + dy / 2 };
};
const convertTo = async (page, at, name) => {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await menu(page, 'Convert to').hover();
  await menu(page, name).click();
};
const kinds = page => page.evaluate(() => [...document.querySelectorAll('#sketch > *')].map(e => e.tagName));

test('right-click > Convert to > Path: the rect becomes a path in the same place, selected; undo and redo swap it back and forth', async ({ page }) => {
  const mid = await draw(page, 'rect');
  const before = await page.evaluate(() => { const r = document.querySelector('#sketch rect'); return ['x', 'y', 'width', 'height'].map(a => +r.getAttribute(a)); });
  await convertTo(page, mid, 'Path');
  expect(await kinds(page)).toEqual(['path']);
  const d = await page.locator('#sketch path').getAttribute('d');
  expect(d).toBe(`M${before[0]} ${before[1]} H${before[0] + before[2]} V${before[1] + before[3]} H${before[0]} Z`);
  expect(await page.evaluate(() => ed.selected === document.querySelector('#sketch path'))).toBe(true);
  await page.keyboard.press('Control+z');                                  // one undo step
  expect(await kinds(page)).toEqual(['rect']);
  await page.keyboard.press('Control+Shift+z');
  expect(await kinds(page)).toEqual(['path']);
});

test('what is exact and what is approximate says so in the menu', async ({ page }) => {
  const mid = await draw(page, 'ellipse');
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await menu(page, 'Convert to').hover();
  await expect(menu(page, 'Rectangle$')).toBeVisible();                  // a fully rounded rect IS the ellipse
  await expect(menu(page, 'Circle \\(approx\\.\\)')).toBeVisible();     // the area is kept, the outline is not
  await expect(menu(page, 'Line')).toHaveCount(0);                       // nothing to offer
});

test('the other attributes come along: id, class, style, fill, stroke, transform', async ({ page }) => {
  await draw(page, 'circle', 80, 0);
  await page.evaluate(() => { const c = document.querySelector('#sketch circle'); c.id = 'keep'; c.setAttribute('data-x', '7'); c.setAttribute('transform', 'translate(3 4)'); });
  const attrs = () => page.evaluate(() => { const e = document.getElementById('keep'); return { tag: e.tagName, id: e.id, cls: e.getAttribute('class'), x: e.getAttribute('data-x'), t: e.getAttribute('transform'), fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke'), r: e.getAttribute('r'), d: e.getAttribute('d') }; });
  const a = await attrs();
  await page.evaluate(() => ed.convert(document.getElementById('keep'), 'ellipse'));
  const b = await attrs();
  expect([b.tag, b.id, b.cls, b.x, b.t, b.fill, b.stroke]).toEqual(['ellipse', 'keep', a.cls, '7', 'translate(3 4)', a.fill, a.stroke]);
  expect(b.r).toBeNull();                                               // the old geometry is gone
});

test('edit mode carries over: converting a shape in edit mode leaves its replacement in its own edit mode', async ({ page }) => {
  await page.goto('/demo/');                                            // (built by script: the shape to edit does not matter)
  await page.evaluate(() => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    e.setAttribute('class', 'edit'); e.setAttribute('x', 40); e.setAttribute('y', 40); e.setAttribute('width', 80); e.setAttribute('height', 50); e.setAttribute('fill', '#d6eaf8'); e.setAttribute('stroke', '#2874a6');
    document.querySelector('#sketch').append(e); ed.select(e); ed.edit();
  });
  expect(await page.evaluate(() => [ed.mode, ed.tool])).toEqual(['edit', 'rect']);
  await page.evaluate(() => ed.convert('path'));
  expect(await page.evaluate(() => [ed.selected.tagName, ed.mode, ed.tool])).toEqual(['path', 'edit', 'path']);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [ed.selected.tagName, ed.mode, ed.tool])).toEqual(['rect', 'edit', 'rect']);
});

test('the policy decides: a shape without element.convert has no Convert to menu, and ed.convert is refused with a denied event', async ({ page }) => {
  await page.goto('/demo/');
  await page.evaluate(() => { window.denied = []; ed.on('denied', d => window.denied.push([d.cap, d.reason])); });
  const locked = page.locator('#nodes-fixed');                           // a filled polygon whose data-sable-policy has no element.convert
  await locked.scrollIntoViewIfNeeded();
  const b = await locked.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menu(page, 'Convert to')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ed.convert(document.getElementById('nodes-fixed'), 'polyline'))).toBeNull();
  expect(await page.evaluate(() => window.denied)).toEqual([['element.convert', 'capability']]);
  expect(await page.evaluate(() => document.getElementById('nodes-fixed').tagName)).toBe('polygon');
});

test('a convert event tells the host the element it knew was replaced', async ({ page }) => {
  const mid = await draw(page, 'rect');
  await page.evaluate(() => { window.ev = []; ed.on('convert', d => window.ev.push([d.from.tagName, d.el.tagName, d.src])); });
  await convertTo(page, mid, 'Circle \\(approx\\.\\)');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.ev)).toEqual([['rect', 'circle', 'menu'], ['circle', 'rect', 'history']]);
});
