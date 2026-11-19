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
const row = (page: Page, path: string) => page.locator(`.tree-row[title="${path}"]`);
async function menu(page: Page, path: string, action: string) {
  await row(page, path).click({ button: 'right' });
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
async function folder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add folder', exact: true }).click();
  await page.getByLabel('Folder path', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(row(page, name)).toBeVisible();
}
test('drag an edited root into a folder, rename its folder and save at the new path', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await folder(page, 'chapters');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Retain this edit');
  await row(page, 'main.tex').dragTo(row(page, 'chapters'));
  await expect(row(page, 'chapters/main.tex')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Root document' })).toHaveValue(
    'chapters/main.tex',
  );
  await expect(page.locator('.cm-content')).toContainText('Retain this edit');
  await menu(page, 'chapters', 'Rename…');
  await page.getByLabel('New name', { exact: true }).fill('sections');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row(page, 'sections')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Root document' })).toHaveValue(
    'sections/main.tex',
  );
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('More edits');
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          elasticTest: { calls: { command: string; args: { path: string; text: string } }[] };
        }
      ).elasticTest.calls,
  );
  expect(
    calls.some(
      (call) =>
        call.command === 'save_file' &&
        call.args.path === 'sections/main.tex' &&
        call.args.text.includes('More edits'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test('copy, cut, paste, duplicate and reveal use the selected file or folder', async ({ page }) => {
  await folder(page, 'chapters');
  await menu(page, 'main.tex', 'Copy');
  await menu(page, 'chapters', 'Paste');
  await expect(row(page, 'chapters/main.tex')).toBeVisible();
  await menu(page, 'chapters/main.tex', 'Duplicate');
  await expect(row(page, 'chapters/main copy.tex')).toBeVisible();
  await menu(page, 'chapters/main copy.tex', 'Cut');
  await page.locator('.tree-root-drop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(row(page, 'main copy.tex')).toBeVisible();
  await expect(row(page, 'chapters/main copy.tex')).toHaveCount(0);
  await menu(page, 'chapters', 'Reveal in Finder');
  await menu(page, 'main copy.tex', 'Move to Trash');
  await expect(row(page, 'main copy.tex')).toHaveCount(0);
  await expect(row(page, 'main.tex')).toBeVisible();
  await menu(page, 'chapters', 'Duplicate');
  await expect(row(page, 'chapters copy')).toBeVisible();
  await menu(page, 'main.tex', 'Copy Relative Path');
  await row(page, 'main.tex').focus();
  await page.keyboard.press('Meta+c');
  await page.locator('.tree-root-drop').focus();
  await page.keyboard.press('Meta+v');
  await expect(row(page, 'main copy.tex')).toBeVisible();
  await row(page, 'main copy.tex').focus();
  await page.keyboard.press('Meta+Backspace');
  await expect(row(page, 'main copy.tex')).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          elasticTest: { calls: { command: string; args: { action: string; path: string } }[] };
        }
      ).elasticTest.calls,
  );
  expect(
    calls.some(
      (call) =>
        call.command === 'file_action' &&
        call.args.action === 'reveal' &&
        call.args.path === 'chapters',
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.command === 'file_action' &&
        call.args.action === 'copy-relative-path' &&
        call.args.path === 'main.tex',
    ),
  ).toBe(true);
});
test('rename collisions retain the source, and trashing an edited open file saves before closing it', async ({
  page,
}) => {
  await folder(page, 'chapters');
  await menu(page, 'main.tex', 'Rename…');
  await page.getByLabel('New name', { exact: true }).fill('chapters');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Rename item' }).getByRole('alert')).toContainText(
    'already exists',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row(page, 'main.tex')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Save before trash');
  await menu(page, 'main.tex', 'Move to Trash');
  await expect(page.getByRole('tab', { name: /main.tex/ })).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          elasticTest: { calls: { command: string; args: { action: string; text: string } }[] };
        }
      ).elasticTest.calls,
  );
  const removal = calls.findIndex(
    (call) => call.command === 'file_action' && call.args.action === 'trash',
  );
  expect(
    calls
      .slice(0, removal)
      .some((call) => call.command === 'save_file' && call.args.text.includes('Save before trash')),
  ).toBe(true);
});
