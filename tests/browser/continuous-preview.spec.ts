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

test('scrolls through a long PDF, updates page controls and bounds canvas memory', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?multipage=1');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.locator('[data-page="1"] .textLayer')).toContainText('page 1');
  await expect(page.locator('.pdf-page')).toHaveCount(40);
  await page.locator('.pdf-viewport').hover();
  await page.mouse.wheel(0, 850);
  await expect(page.locator('[data-page="2"] .textLayer')).toContainText('page 2');
  await expect
    .poll(() => page.locator('.pdf-viewport').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(400);
  await page.locator('[data-page="40"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page="40"] .textLayer')).toContainText('page 40');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(page.locator('[data-page="1"] canvas')).toHaveCount(0);
  expect(await page.locator('.pdf-page canvas').count()).toBeLessThanOrEqual(4);
  expect(
    await page
      .locator('.pdf-page canvas')
      .evaluateAll((elements) =>
        elements.reduce(
          (sum, element) =>
            sum + (element as HTMLCanvasElement).width * (element as HTMLCanvasElement).height * 4,
          0,
        ),
      ),
  ).toBeLessThanOrEqual(64 * 1024 * 1024);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('[data-page="39"] .textLayer')).toContainText('page 39');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: '125%', exact: true })).toBeVisible();
  await expect(page.locator('[data-page="39"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.pdf-page canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('double-clicking PDF text or canvas opens the mapped source, including from PDF-only view', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page.locator('.textLayer span').first().dblclick();
  await expect(page.getByRole('tab', { name: 'mapped.tex', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.cm-activeLine')).toContainText('Mapped source line');
  await page.locator('.pdf-page').dblclick({ position: { x: 80, y: 200 } });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              elasticTest: {
                calls: { command: string; args: { page: number; x: number; y: number } }[];
              };
            }
          ).elasticTest.calls.filter((call) => call.command === 'source_location').length,
      ),
    )
    .toBe(2);
});

test('a missing SyncTeX map explains the problem and retains the preview', async ({ page }) => {
  await page.goto('/?nosynctex=1');
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await page.getByRole('button', { name: '▷ Compile' }).click();
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  await page.locator('.pdf-page').dblclick();
  await expect(page.getByRole('alert')).toContainText('no SyncTeX data');
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
});
