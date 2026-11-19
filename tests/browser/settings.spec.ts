import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/?editorui=1');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});

test('independent PDF dark mode changes no artifacts, rendering, or scroll position', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pdf-page canvas')!;
    canvas.dataset.testIdentity = 'retained';
    const viewport = document.querySelector('.pdf-viewport')!;
    viewport.scrollTop = 50;
    return {
      scroll: viewport.scrollTop,
      renders: performance.getEntriesByName('elastic:pdf-visible').length,
    };
  });
  await page.keyboard.press('Meta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByLabel('App theme', { exact: true }).selectOption('dark');
  await dialog.getByLabel('PDF theme', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'light');
  await expect(page.locator('.pdf-page canvas')).toHaveCSS('filter', 'none');
  await dialog.getByLabel('App theme', { exact: true }).selectOption('light');
  await dialog.getByLabel('PDF theme', { exact: true }).selectOption('dark');
  await dialog.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'dark');
  await expect(page.locator('.pdf-page canvas')).not.toHaveCSS('filter', 'none');
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-test-identity', 'retained');
  expect(await page.locator('.pdf-viewport').evaluate((element) => element.scrollTop)).toBe(
    before.scroll,
  );
  expect(
    await page.evaluate(() => performance.getEntriesByName('elastic:pdf-visible').length),
  ).toBe(before.renders);
  const reads = await page.evaluate(
    () =>
      (
        window as unknown as { elasticTest: { calls: { command: string }[] } }
      ).elasticTest.calls.filter((call) => call.command === 'read_artifact').length,
  );
  expect(reads).toBe(1);
  await page.screenshot({ path: '/private/tmp/elastic-independent-pdf-dark.png' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'dark');
});

test('settings are searchable and available before a project opens', async ({ page }) => {
  await page.keyboard.press('Meta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Search settings' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Search settings' }).fill('PDF');
  await expect(dialog.getByLabel('PDF theme', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Font size', { exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Search settings' }).fill('dark');
  await expect(dialog.getByLabel('App theme', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('PDF theme', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search settings' }).fill('');
  await dialog.getByLabel('App theme', { exact: true }).selectOption('dark');
  await dialog.getByLabel('PDF theme', { exact: true }).selectOption('app');
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'dark');
  await dialog.getByLabel('PDF theme', { exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-pdf-theme', 'light');
  await dialog
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Editor', exact: true })
    .click();
  await expect(dialog.getByLabel('Font size', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('PDF theme', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/elastic-settings-categories-dark.png' });
});

test('reviewed editor, tab, zoom and workspace settings take effect and persist', async ({
  page,
}) => {
  await page.keyboard.press('Meta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByLabel('Line numbers', { exact: true }).uncheck();
  await dialog.getByLabel('Highlight current line', { exact: true }).uncheck();
  await dialog.getByLabel('Preview tabs', { exact: true }).uncheck();
  await dialog.getByLabel('Reveal active file', { exact: true }).uncheck();
  await dialog.getByLabel('Default workspace view', { exact: true }).selectOption('source');
  await dialog.getByLabel('Default PDF zoom', { exact: true }).selectOption('1.25');
  await dialog.getByLabel('Autosave delay', { exact: true }).selectOption('1500');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await expect(page.locator('.cm-activeLine')).toHaveCount(0);
  await expect(page.locator('.preview-pane')).not.toBeVisible();
  await page.locator('.tree-row[title="notes.tex"]').click();
  await expect(page.getByRole('tab', { name: 'notes.tex', exact: true })).toBeVisible();
  await expect(page.locator('.preview-tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.getByRole('button', { name: '125%', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+p');
  await page.getByRole('combobox', { name: 'Search filenames' }).fill('introduction');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toContainText('searchable introduction');
  await expect(page.locator('.tree-row[title="chapters/introduction.tex"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+,');
  await expect(dialog.getByLabel('Autosave delay', { exact: true })).toHaveValue('1500');
  await expect(dialog.getByLabel('Default PDF zoom', { exact: true })).toHaveValue('1.25');
  await dialog.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await expect(dialog.getByLabel('Line numbers', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('PDF theme', { exact: true })).toHaveValue('light');
});
