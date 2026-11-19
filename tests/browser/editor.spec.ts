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
  const divider = page.getByRole('separator');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.preview-pane')).not.toBeVisible();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.preview-pane')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
