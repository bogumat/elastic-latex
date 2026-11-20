import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
});

async function source(page: Page, before: string, after = '') {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(before + after);
  for (let index = 0; index < after.length; index++) await page.keyboard.press('ArrowLeft');
}
const menu = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const label = (page: Page, text: string) =>
  menu(page)
    .locator('.cm-completionLabel')
    .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
const selected = (page: Page) => menu(page).locator('[aria-selected=true] .cm-completionLabel');

test('Tab accepts commands, Enter inserts a newline, and Tab still indents without a menu', async ({
  page,
}) => {
  await source(page, '\\sect');
  await expect(label(page, '\\section')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\section');
  await expect(menu(page)).not.toBeVisible();

  await source(page, '\\sect');
  await expect(label(page, '\\section')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-line')).toHaveCount(2);
  await expect(page.locator('.cm-line').first()).toHaveText('\\sect');

  await source(page, 'Plain text');
  await expect(menu(page)).not.toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText(/^ {2}Plain text$/);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.cm-content')).toHaveText('Plain text');
});

test('arrow keys choose float placement and Tab accepts the selected flag', async ({ page }) => {
  await source(page, '\\begin{figure}');
  await page.keyboard.insertText('[');
  await expect(selected(page)).toHaveText('htbp');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toHaveText('h');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toHaveText('t');
  await page.keyboard.press('ArrowUp');
  await expect(selected(page)).toHaveText('h');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\begin{figure}[h');
  await page.keyboard.insertText('t');
  await expect(label(page, 'b')).toBeVisible();
  await expect(label(page, 'h')).not.toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.insertText(']');
  await expect(page.locator('.cm-content')).toHaveText('\\begin{figure}[htb]');
  await expect(menu(page)).not.toBeVisible();
});

test('image options complete keys and values, preserve earlier options, and allow custom values', async ({
  page,
}) => {
  await source(page, '\\includegraphics');
  await page.keyboard.insertText('[wid');
  await expect(label(page, 'width=')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(label(page, '\\linewidth')).toBeVisible();
  await page.keyboard.insertText('5');
  await expect(selected(page)).toHaveText('5cm');
  await page.keyboard.press('Tab');
  await page.keyboard.insertText(',');
  await expect(label(page, 'height=')).toBeVisible();
  await expect(label(page, 'width=')).not.toBeVisible();
  await page.keyboard.insertText('hei');
  await page.keyboard.press('Tab');
  await expect(label(page, '\\textheight')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.insertText('3cm]{image.png}');
  await expect(page.locator('.cm-content')).toHaveText(
    '\\includegraphics[width=5cm,height=3cm]{image.png}',
  );
});

test('document class and package suggestions use their own option lists', async ({ page }) => {
  await source(page, '\\documentclass', ']{article}');
  await page.keyboard.insertText('[11');
  await expect(selected(page)).toHaveText('11pt');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\documentclass[11pt]{article}');

  await source(page, '\\usepackage', ']{geometry}');
  await page.keyboard.insertText('[mar');
  await expect(selected(page)).toHaveText('margin=');
  await expect(label(page, 'hidelinks')).not.toBeVisible();
  await page.keyboard.press('Tab');
  await expect(label(page, '2.5cm')).toBeVisible();
  await page.keyboard.insertText('2.5');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\usepackage[margin=2.5cm]{geometry}');
});

test('editing existing commands and option names preserves the remaining source', async ({
  page,
}) => {
  await source(page, '\\se', 'tion{Introduction}');
  await page.keyboard.insertText('c');
  await expect(label(page, '\\section')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\section{Introduction}');

  await source(page, '\\includegraphics[wi', 'th=3cm]{image.png}');
  await page.keyboard.insertText('d');
  await expect(label(page, 'width=')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toHaveText('\\includegraphics[width=3cm]{image.png}');
});
