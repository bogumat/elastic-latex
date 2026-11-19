import { expect, test } from '@playwright/test';

test('real PDF worker renders locally, replacements stay bounded, and failure retains the previous page', async ({
  page,
}) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1420/'))
      remote.push(request.url());
  });
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/?perf=1');
  await page.getByRole('button', { name: 'Open Folder…' }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
  for (let build = 0; build < 30; build++) {
    await page.getByRole('button', { name: '▷ Compile' }).click();
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('elastic:pdf-visible').length))
      .toBeGreaterThan(build);
    await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
    expect(await page.locator('.pdf-page canvas').count()).toBe(1);
    await expect.poll(() => page.workers().length).toBeLessThanOrEqual(1);
  }
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('broken');
  await expect(page.getByText('PDF out of date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.getByText('Earlier successful build')).toBeVisible();
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  await page.getByRole('button', { name: /main.tex:3/ }).click();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.getByText('No preview yet', { exact: true })).toBeVisible();
  await expect(page.locator('.pdf-page canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('ambiguous root candidates require an explicit selection', async ({ page }) => {
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/?multiple=1');
  await page.getByRole('button', { name: 'Open Folder…' }).click();
  await page.getByRole('button', { name: '≡ article.tex' }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
  await expect(page.getByRole('button', { name: '▷ Compile' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Root document' }).selectOption('article.tex');
  await expect(page.getByRole('button', { name: '▷ Compile' })).toBeEnabled();
});
