import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* a path drawn in its own coordinates (moved into the canvas by a transform), selected and in edit mode; `pt(x, y)` is where a point of it is on screen */
const setup = async (page, d) => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(d => {
    const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.id = 'np'; e.setAttribute('class', 'edit'); e.setAttribute('fill', '#d6eaf8'); e.setAttribute('stroke', '#2874a6'); e.setAttribute('stroke-width', 2);
    e.setAttribute('transform', `translate(${c.x} ${c.y + 20})`); e.setAttribute('d', d); document.querySelector('#sketch').append(e);
    ed.select(e); ed.mode = 'edit';
  }, d);
  return (x, y) => page.evaluate(({ x, y }) => { const m = document.getElementById('np').getScreenCTM(); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }, { x, y });
};
const D = page => page.locator('#np').getAttribute('d');
const cmds = d => (d.match(/[A-Za-z]/g) || []).join('');
const menu = (page, name) => page.getByRole('menuitem', { name: new RegExp('^\\s*\\u2713?\\s*' + name) });
const nodeType = async (page, p, type) => {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu(page, 'Node type').hover();
  await menu(page, type).click();
};

test('the Node type menu is there on every node that has a segment on each side, whatever the segments are', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 40 L100 100 A30 30 0 0 1 160 100 L160 60');
  for (const [x, y] of [[60, 40], [100, 100], [160, 100]]) {
    const p = await pt(x, y);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu(page, 'Node type')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  for (const [x, y] of [[20, 100], [160, 60]]) {                       // the two ends of the open path have only one side
    const p = await pt(x, y);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu(page, 'Node type')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('line + line: Smooth makes both cubics, Symmetric also makes the handles one length; undo is one step', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L60 40 L100 100');
  const before = await D(page);
  await nodeType(page, await pt(60, 40), 'Smooth');
  expect(cmds(await D(page))).toBe('MCC');
  await page.keyboard.press('Control+z');
  expect(await D(page)).toBe(before);
  await nodeType(page, await pt(60, 40), 'Symmetric');
  expect(cmds(await D(page))).toBe('MCS');                                // the S form: the second handle is the mirror of the first
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [1] });   // the node stays selected
  await nodeType(page, await pt(60, 40), 'Corner');
  expect(cmds(await D(page))).toBe('MCC');                                // Corner breaks the link, as before
});

test('arc + line: Smooth turns the line into a quadratic along the arc; Symmetric makes it a circular arc', async ({ page }) => {
  const pt = await setup(page, 'M20 100 A40 40 0 0 1 100 100 L160 60');
  await nodeType(page, await pt(100, 100), 'Smooth');
  expect(cmds(await D(page))).toBe('MAQ');
  await page.keyboard.press('Control+z');
  await nodeType(page, await pt(100, 100), 'Symmetric');
  expect(cmds(await D(page))).toBe('MAA');
});

test('a closing line becomes a segment of its own, so the start and the end join; a host without nodes.insert is not offered that', async ({ page }) => {
  const pt = await setup(page, 'M20 100 L100 100 L60 40 Z');
  await nodeType(page, await pt(60, 40), 'Smooth');
  expect(cmds(await D(page))).toBe('MLCCZ');                              // M L, then the two cubics, the second closing on the start, then a Z that draws nothing
  await page.keyboard.press('Control+z');
  await page.evaluate(() => { ed.policy = { rules: [{ select: '.edit', can: 'all', cannot: ['nodes.insert'] }] }; });
  const p = await pt(60, 40);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu(page, 'Node type').hover();
  await expect(menu(page, 'Smooth')).toBeDisabled();
  await expect(menu(page, 'Corner')).toBeEnabled();
});

test('a node with one cubic on both sides smooths against itself', async ({ page }) => {
  const pt = await setup(page, 'M60 100 C140 40 140 160 60 100');
  await nodeType(page, await pt(60, 100), 'Symmetric');
  const n = (await D(page)).match(/-?[\d.]+/g).map(Number);
  expect(n.slice(0, 2)).toEqual([60, 100]);
  expect(n.slice(2, 4).map((v, i) => Math.round(v + n[4 + i] - 2 * [60, 100][i]))).toEqual([0, 0]);   // the two handles are mirror images about the node
});

test('a handle pulled into its node (a curve whose end was only clicked): both handles go on the averaged tangent; Smooth gives the missing one half its segment, Symmetric the other one\'s length', async ({ page }) => {
  const d0 = 'M20 100 C20 60 100 100 100 100 C130 80 160 80 180 100';          // the first curve's second handle sits on the node at 100,100
  const pt = await setup(page, d0);
  const un = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const t = un([un([80, 40])[0] + un([30, -20])[0], un([80, 40])[1] + un([30, -20])[1]]);   // the average of the curves' two tangents at the node
  const c2 = L => [100 - t[0] * L, 100 - t[1] * L];
  const got = async () => (await D(page)).match(/-?[\d.]+/g).map(Number).slice(4, 6);
  await nodeType(page, await pt(100, 100), 'Smooth');
  for (const [g, w] of (await got()).map((g, i) => [g, c2(40)[i]])) expect(g).toBeCloseTo(w, 1);   // half the 80 long first curve
  await page.keyboard.press('Control+z');
  expect(await D(page)).toBe(d0);
  await nodeType(page, await pt(100, 100), 'Symmetric');
  for (const [g, w] of (await got()).map((g, i) => [g, c2(Math.hypot(30, 20))[i]])) expect(g).toBeCloseTo(w, 1);   // as long as the other handle
});

test('a node placed in the middle of a path by clicking (both handles retracted) gets handles to drag when it is made smooth', async ({ page }) => {
  const pt = await setup(page, 'M20 100 C20 100 100 100 100 100 C100 100 180 100 180 100');
  await nodeType(page, await pt(100, 100), 'Symmetric');
  const n = (await D(page)).match(/-?[\d.]+/g).map(Number);
  expect(n[4]).toBeCloseTo(60, 1); expect(n[5]).toBeCloseTo(100, 1);               // 40 back along the straight run (half the average of the two 80 long segments)
  expect(await page.evaluate(() => ed.selection)).toEqual({ kind: 'node', items: [1] });
});
