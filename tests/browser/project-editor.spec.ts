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
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
});

test('preview tabs can be pinned, reordered and safely closed', async ({ page }) => {
  await page.locator('.tree-row[title="notes.tex"]').click();
  await expect(page.locator('.preview-tab')).toContainText('notes.tex');
  await page.locator('.tree-row[title="chapters"]').click();
  await page.locator('.tree-row[title="chapters/introduction.tex"]').click();
  await expect(page.getByRole('tab', { name: 'notes.tex', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'introduction.tex', exact: true }).dblclick();
  await expect(page.locator('.preview-tab')).toHaveCount(0);
  await page.locator('.tree-row[title="notes.tex"]').click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Keep this edit ');
  await expect(page.locator('.preview-tab')).toHaveCount(0);
  await page
    .getByRole('tab', { name: /notes.tex/ })
    .dragTo(page.getByRole('tab', { name: 'main.tex', exact: true }));
  await expect(page.getByRole('tab').first()).toContainText('notes.tex');
  await page.getByRole('button', { name: 'Close notes.tex', exact: true }).click();
  await expect(page.getByRole('tab', { name: /notes.tex/ })).toHaveCount(0);
  await page
    .getByRole('tab', { name: 'introduction.tex', exact: true })
    .click({ button: 'middle' });
  await expect(page.getByRole('tab', { name: 'introduction.tex', exact: true })).toHaveCount(0);
  await page.locator('.tree-row[title="notes.tex"]').click();
  await expect(page.locator('.cm-content')).toContainText('Keep this edit');
});

test('Command-P fuzzy-matches nested filenames and opens the keyboard selection', async ({
  page,
}) => {
  await page.keyboard.press('Meta+p');
  const dialog = page.getByRole('dialog', { name: 'Quick Open', exact: true });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('chintro');
  await expect(dialog.getByRole('option')).toHaveText('chapters/introduction.tex');
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('A searchable introduction.');
  await page.keyboard.press('Meta+p');
  await page.getByRole('combobox', { name: 'Search filenames' }).fill('does-not-exist');
  await expect(dialog).toContainText('No matching files');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('project search opens nested matches and replaces literals across files', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+f');
  const dialog = page.getByRole('dialog', { name: 'Search project', exact: true });
  await dialog.getByLabel('Find', { exact: true }).fill('searchable');
  await expect(dialog).toContainText('2 matching lines in 2 files');
  await dialog.getByLabel('Replace with', { exact: true }).fill('Replaced $value');
  await dialog.getByRole('button', { name: 'Replace All in 2 files' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Replaced 2 occurrences' }),
  ).toBeVisible();
  await dialog.getByLabel('Find', { exact: true }).fill('Replaced $value');
  await expect(dialog).toContainText('2 matching lines in 2 files');
  await dialog.getByRole('button', { name: /A Replaced \$value introduction/ }).click();
  await expect(page.locator('.cm-activeLine')).toContainText('Replaced $value');
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('sidebar resizes, collapses, and reveals files opened from Quick Open', async ({ page }) => {
  const divider = page.getByRole('separator', { name: 'Sidebar width', exact: true });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '260');
  await page.keyboard.press('Meta+b');
  await expect(page.getByRole('complementary', { name: 'Project files' })).not.toBeVisible();
  await page.keyboard.press('Meta+b');
  await expect(divider).toHaveAttribute('aria-valuenow', '260');
  await page.keyboard.press('Meta+p');
  await page.getByRole('combobox', { name: 'Search filenames' }).fill('introduction');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tree-row[title="chapters/introduction.tex"]')).toBeVisible();
});

test('multiple files can be selected, dragged together, and copied together', async ({ page }) => {
  const main = page.locator('.tree-row[title="main.tex"]'),
    notes = page.locator('.tree-row[title="notes.tex"]');
  await main.click();
  await notes.click({ modifiers: ['Meta'] });
  await expect(page.locator('.tree-row[aria-selected=true]')).toHaveCount(2);
  await main.dragTo(page.locator('.tree-row[title="chapters"]'));
  await expect(page.locator('.tree-row[title="chapters/main.tex"]')).toBeVisible();
  await expect(page.locator('.tree-row[title="chapters/notes.tex"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Root document' })).toHaveValue(
    'chapters/main.tex',
  );
  await page.locator('.tree-row[title="chapters/main.tex"]').click();
  await page.locator('.tree-row[title="chapters/notes.tex"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('.tree-row[aria-selected=true]')).toHaveCount(2);
  await page.locator('.tree-row[title="chapters/main.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await page.locator('.tree-root-drop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(main).toBeVisible();
  await expect(notes).toBeVisible();
});

test('breadcrumbs show the current section and browse sibling files', async ({ page }) => {
  await page.keyboard.press('Meta+p');
  await page.getByRole('combobox', { name: 'Search filenames' }).fill('introduction');
  await page.keyboard.press('Enter');
  const crumbs = page.getByRole('navigation', { name: 'Source breadcrumbs' });
  await expect(crumbs).toContainText('chapters');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await expect(crumbs.getByRole('button', { name: 'Introduction', exact: true })).toBeVisible();
  await crumbs.getByRole('button', { name: 'Test article', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Files in Test article' })
    .getByRole('menuitem', { name: 'notes.tex', exact: true })
    .click();
  await expect(page.locator('.cm-content')).toContainText('Searchable project notes');
});

test('settings apply to open editors, preserve undo and persist across reloads', async ({
  page,
}) => {
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Retain undo ');
  await page.keyboard.press('Meta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByLabel('Theme', { exact: true }).selectOption('dark');
  await dialog.getByLabel('Font size', { exact: true }).selectOption('18');
  await dialog.getByLabel('Tab width', { exact: true }).selectOption('4');
  await dialog.getByLabel('Wrap lines', { exact: true }).uncheck();
  await dialog.getByLabel('Autosave', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px');
  await page.screenshot({ path: '/private/tmp/elastic-editor-settings.png' });
  await expect(page.locator('.cm-content')).not.toHaveCSS('white-space', 'pre-wrap');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.cm-content')).not.toContainText('Retain undo');
  await page.reload();
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('Meta+,');
  await expect(dialog.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await expect(dialog.getByLabel('Font size', { exact: true })).toHaveValue('18');
  await expect(dialog.getByLabel('Autosave', { exact: true })).not.toBeChecked();
});
