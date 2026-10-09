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
