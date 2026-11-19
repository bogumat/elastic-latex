import { expect, test } from '@playwright/test';

test('editor starts without PDF.js and retains edits and undo across tabs', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?perf=1');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('A little room to think');
  expect(requests.filter((url) => /pdfjs|pdf\.worker|\/preview\/Preview/.test(url))).toEqual([]);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.insertText('% Retained edit\n');
  await page.getByRole('button', { name: '≡ references.bib' }).click();
  await expect(editor).toContainText('@article');
  await page.getByRole('tab', { name: /main.tex/ }).click();
  await expect(editor).toContainText('Retained edit');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('Retained edit');
  await expect(page.getByRole('button', { name: '▷ Compile' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('source mode and keyboard pane resizing work at laptop sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Source and PDF divider' });
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.preview-pane')).not.toBeVisible();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.preview-pane')).toBeVisible();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  const longLine = 'A long source paragraph that wraps within the pane. '.repeat(20);
  await page.keyboard.insertText(`${longLine}\n`);
  const firstLine = page.locator('.cm-line').first();
  await expect(firstLine).toHaveText(longLine);
  expect(
    await firstLine.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThan(46);
  expect(
    await page
      .locator('.cm-scroller')
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('folds and restores environments without changing their text', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('A little room to think');
  const before = await editor.innerText();
  const marker = page.locator('.cm-foldGutter .cm-gutterElement').filter({ hasText: '⌄' }).first();
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
  await expect(editor).not.toContainText('Good ideas begin');
  await page.locator('.cm-foldPlaceholder').click();
  await expect(editor).toContainText('Good ideas begin');
  expect(await editor.innerText()).toBe(before);
});
