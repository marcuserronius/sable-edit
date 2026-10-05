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
