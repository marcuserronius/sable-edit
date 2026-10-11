import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

/* Edit mode is entered on purpose: a double-click, or a long press with a finger or pen. Escape steps back: edit -> scale -> nothing selected. */
const centre = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const mode = page => page.locator('#mode');
/* a touch pointer pressed on the element (held for `hold` ms), as a finger would: the page sees pointer events with pointerType 'touch' */
const touch = (page, sel, hold) => page.evaluate(async ({ sel, hold }) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect(), o = { bubbles: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  await new Promise(r => setTimeout(r, hold));
  el.dispatchEvent(new PointerEvent('pointerup', o));
}, { sel, hold });

test('double-click enters edit mode; Escape goes back to scale, then deselects', async ({ page }) => {
  await page.goto('/demo/');
  const b = await centre(page, 'rect.edit');
  await page.mouse.dblclick(b.x, b.y);
  await expect(mode(page)).toHaveText('mode: edit');
  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveText('mode: scale');
  expect(await page.evaluate(() => ed.selected && ed.selected.tagName)).toBe('rect');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ed.selected)).toBeNull();
});

test('a shape with no editor of its own ignores the double-click', async ({ page }) => {
  await page.goto('/demo/');
  const b = await centre(page, 'text.edit');
  await page.mouse.dblclick(b.x, b.y);
  await expect(mode(page)).not.toHaveText('mode: edit');
});

test('a long touch press enters edit mode; a quick tap only selects', async ({ page }) => {
  await page.goto('/demo/');
  await touch(page, 'rect.edit', 100);
  expect(await page.evaluate(() => ed.mode)).not.toBe('edit');
  await page.evaluate(() => ed.select(null));
  await touch(page, 'rect.edit', 700);
  await expect(mode(page)).toHaveText('mode: edit');
});

test('edit(): the API enters edit mode, selecting the shape first', async ({ page }) => {
  await page.goto('/demo/');
  const ok = await page.evaluate(() => ed.edit(document.querySelector('rect.edit')));
  expect(ok).toBe(true);
  await expect(mode(page)).toHaveText('mode: edit');
  expect(await page.evaluate(() => ed.edit(document.querySelector('text.edit')))).toBe(false);
});

/* a path with no fill is a thin line: its halo is rebuilt by every scale <-> rotate click, so the browser never reports a dblclick for it */
const onStroke = (page, id) => page.evaluate(id => { const e = document.getElementById(id), q = e.getPointAtLength(e.getTotalLength() / 2), m = e.getScreenCTM(); return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }; }, id);
const bare = async page => {
  await page.goto('/demo/');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => { const c = document.querySelector('#canvas').getBBox(), e = document.createElementNS('http://www.w3.org/2000/svg', 'path'); e.setAttribute('class', 'edit'); e.id = 'bp'; e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#c0392b'); e.setAttribute('stroke-width', 3); e.setAttribute('d', `M${c.x + 30} ${c.y + 60} L${c.x + 170} ${c.y + 60}`); document.querySelector('#sketch').append(e); });
};
test('double-click on the stroke of a bare path enters edit mode, selected or not; Escape goes back to the mode it was in', async ({ page }) => {
  await bare(page);
  const p = await onStroke(page, 'bp');
  await page.mouse.dblclick(p.x, p.y);                                  // unselected: the double-click selects and edits
  await expect(mode(page)).toHaveText('mode: edit');
  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveText('mode: scale');
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);                                     // one click on the selected path: toggles
  await expect(mode(page)).toHaveText('mode: rotate');
  await page.waitForTimeout(700);
  await page.mouse.dblclick(p.x, p.y);                                  // each click of the pair toggles too, and the pair still gets through to edit mode
  await expect(mode(page)).toHaveText('mode: edit');
  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveText('mode: rotate');                  // the mode it was in before the double-click's own toggles
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ed.selected)).toBeNull();
});

test('a click and then a double-click right after it on a bare path still end in edit mode', async ({ page }) => {
  await bare(page);
  const p = await onStroke(page, 'bp');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  await page.mouse.dblclick(p.x, p.y);
  await expect(mode(page)).toHaveText('mode: edit');
});
