import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* Node > Join with segment / Merge / Split, and paths with several subpaths. Same setup as nodetype.spec.js: a path drawn in its own
   coordinates, selected and in edit mode; `pt(x, y)` is where a point of it is on screen. */
const setup = async (page, d) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(d => {
    const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.id = 'np'; e.setAttribute('class', 'edit'); e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#2874a6'); e.setAttribute('stroke-width', 2);
    e.setAttribute('transform', `translate(${c.x} ${c.y + 20})`); e.setAttribute('d', d); document.querySelector('#sketch').append(e);
    ed.select(e); ed.mode = 'edit';
  }, d);
  return (x, y) => page.evaluate(({ x, y }) => { const m = document.getElementById('np').getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }, { x, y });
};
const D = page => page.locator('#np').getAttribute('d');
const item = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name + '\\s*\\u25B8?\\s*$') });
/* a click with Shift held (page.mouse.click has no `modifiers` option, unlike locator.click) */
const shiftClick = async (page, p) => { await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); };
/* right-click p (selecting the node under it unless it is already selected), open Node, choose `name` */
const nodeMenu = async (page, p, name) => {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await item(page, 'Node').hover();
  await item(page, name).click();
};

test('Split: a node inside the path becomes the end of one subpath and the start of the next; undo is one step', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 L100 100');
  await nodeMenu(page, await pt(60, 100), 'Split');
  expect(await D(page)).toBe('M20 100 L60 100 M60 100 L100 100');
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [2] });          // the new, independent node
  await page.keyboard.press('Control+z');
  expect(await D(page)).toBe('M20 100 L60 100 L100 100');
});

test('Split is not offered at the end of a path', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 L100 100');
  const p = await pt(20, 100);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(item(page, 'Node')).toHaveCount(0);
});

test('Join with segment and Merge are offered for two unattached nodes only', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 M100 100 L140 100');
  const a = await pt(60, 100), b = await pt(100, 100), c = await pt(20, 100);
  await page.mouse.click(a.x, a.y);
  await shiftClick(page, b);
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await item(page, 'Node').hover();
  await expect(item(page, 'Join with segment')).toBeVisible();
  await expect(item(page, 'Merge')).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');                    // the submenu, then the menu (the selection stays)
  await shiftClick(page, c);                                                                   // three nodes: no join, and nothing to split
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(item(page, 'Node')).toHaveCount(0);
});

test('Join with segment: a line between two unattached nodes of different subpaths makes them one subpath', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 M100 100 L140 100');
  const a = await pt(60, 100), b = await pt(100, 100);
  await page.mouse.click(a.x, a.y); await shiftClick(page, b);
  await nodeMenu(page, b, 'Join with segment');
  // one subpath through all four points; each line is L or H (pressing a node lets the next write pick the shortest command for the lines at it)
  expect(await D(page)).toMatch(/^M20 100 (L60 100|H60) (L100 100|H100) (L140 100|H140)$/);
  await page.keyboard.press('Control+z');
  expect(await D(page)).toBe('M20 100 L60 100 M100 100 L140 100');
});

test('Merge: two unattached nodes become one at the average of their positions', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 M100 60 L140 60');
  const a = await pt(60, 100), b = await pt(100, 60);
  await page.mouse.click(a.x, a.y); await shiftClick(page, b);
  await nodeMenu(page, b, 'Merge');
  expect(await D(page)).toBe('M20 100 L80 80 L140 60');
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [1] });
});

test('the two ends of one subpath: Join with segment closes it with a line, Merge joins them into one node', async ({ page }) => {
  let pt = await setup(page, 'M20 100 L60 40 L100 100');
  let a = await pt(20, 100), b = await pt(100, 100);
  await page.mouse.click(a.x, a.y); await shiftClick(page, b);
  await nodeMenu(page, b, 'Join with segment');
  expect(await D(page)).toBe('M20 100 L60 40 L100 100 Z');
  pt = await setup(page, 'M20 100 L60 40 L100 80');
  a = await pt(20, 100); b = await pt(100, 80);
  await page.mouse.click(a.x, a.y); await shiftClick(page, b);
  await nodeMenu(page, b, 'Merge');
  expect(await D(page)).toBe('M60 90 V40 V90 Z');
});

test('a path with several subpaths shows every node, and a node of any of them can be dragged', async ({ page }) => {
  const pt = await setup(page, 'M20 60 L60 60 L60 100 M100 60 L140 60 L140 100');
  const n = await pt(140, 60), to = await pt(150, 70);
  await page.mouse.move(n.x, n.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  expect(await D(page)).toBe('M20 60 L60 60 L60 100 M100 60 L150 70 L140 100');
});

test('a Z followed by a drawing command is read as a new subpath, which edits like any other', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 100 L60 60 Z L100 100 L140 100');
  const p = await pt(100, 100);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await item(page, 'Node').hover();
  await expect(item(page, 'Node type')).toBeVisible();
});
