import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
});

test('open working folder, review changes, commit, pull, fork and select push target', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Source control' });
  await expect(panel.getByText('main', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /Mmain.tex|M main.tex/ }).click();
  await expect(panel.locator('.git-diff')).toContainText('Updated paper');
  await panel.getByLabel('Commit message').fill('Update paper');
  await panel.getByRole('button', { name: 'Commit all changes' }).click();
  await expect(panel.getByText('Working folder is clean.')).toBeVisible();
  await panel.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Pulled from origin');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await panel.getByRole('button', { name: 'Fork on GitHub' }).click();
  await expect(panel.getByRole('combobox', { name: 'Git remote' })).toHaveValue('fork');
  await panel.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(panel.getByText('push completed', { exact: true })).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          elasticTest: { calls: { command: string; args: Record<string, string> }[] };
        }
      ).elasticTest.calls,
  );
  expect(
    calls.find((call) => call.command === 'git_action' && call.args.action === 'push')?.args.remote,
  ).toBe('fork');
  await page.getByRole('button', { name: 'Close working folder' }).click();
  await expect(page.getByRole('heading', { name: 'Recent folders' })).toBeVisible();
  await page.getByRole('button', { name: 'Test article /test/project' }).click();
  await expect(page.locator('.cm-content')).toContainText('Pulled from origin');
  expect(errors).toEqual([]);
});

test('a failed pull still refreshes changed disk contents', async ({ page }) => {
  await page.goto('/?pullerror=1');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pull interrupted');
  await expect(page.locator('.cm-content')).toContainText('Pulled from origin');
});

test('paste a GitHub URL, select a parent folder, fork and clone into the workspace', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clone from GitHub…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clone from GitHub' });
  await dialog.getByLabel('Repository URL').fill('https://github.com/owner/paper');
  await dialog.getByRole('button', { name: 'Choose folder…' }).click();
  await dialog.getByLabel('Create my fork on GitHub first').check();
  await dialog.getByRole('button', { name: 'Fork, clone & open' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
  const calls = await page.evaluate(
    () =>
      (window as unknown as { elasticTest: { calls: { command: string; args: unknown }[] } })
        .elasticTest.calls,
  );
  expect(calls.find((call) => call.command === 'clone_repository')?.args).toEqual({
    url: 'https://github.com/owner/paper',
    parent: '/test/project',
    name: 'paper',
    fork: true,
  });
});
