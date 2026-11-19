import { expect, test } from '@playwright/test';

test.use({
  launchOptions: {
    executablePath: process.env.ELASTIC_CHROME,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar'],
  },
});

for (const fallback of [false, true]) {
  test(`fit-width stays stable through scrolling and resizing (${fallback ? 'legacy scrollbar' : 'stable gutter'})`, async ({
    page,
  }) => {
    await page.route('**/src/main.tsx', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
      });
    });
    await page.goto('/');
    // Force space-consuming scrollbars even on hosts configured for overlay bars.
    // This height lies between the fitted page heights with/without the vertical bar.
    await page.addStyleTag({
      content: `
    .pdf-viewport { flex: none; width: 520px; height: 650px; }
    .pdf-viewport::-webkit-scrollbar { width: 16px; height: 16px; }
    .pdf-viewport::-webkit-scrollbar-thumb { background: #888; }
  `,
    });
    if (fallback) {
      await page.addStyleTag({
        content: '.pdf-viewport { scrollbar-gutter: auto; overflow-y: scroll; }',
      });
    }
    await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
    await page.getByRole('button', { name: '▷ Compile' }).click();
    await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
    await page.waitForTimeout(750); // Allow the initial resize debounce/render to settle.
    const samples = await page.evaluate(async () => {
      const viewport = document.querySelector<HTMLElement>('.pdf-viewport')!;
      const values = [];
      for (let i = 0; i < 50; i++) {
        values.push({
          width: viewport.clientWidth,
          overflow: viewport.scrollHeight > viewport.clientHeight,
          horizontal: viewport.scrollWidth > viewport.clientWidth,
          renders: performance.getEntriesByName('elastic:pdf-visible').length,
        });
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return values;
    });
    expect(new Set(samples.map((sample) => sample.width)).size, JSON.stringify(samples)).toBe(1);
    expect(samples.at(-1)!.renders).toBe(samples[0].renders);
    expect(samples.every((sample) => !sample.horizontal)).toBe(true);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('button', { name: '125%', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.pdf-page').evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeGreaterThan(700);
    await page.waitForTimeout(300);
    const renders = await page.evaluate(
      () => performance.getEntriesByName('elastic:pdf-visible').length,
    );
    await page.locator('.pdf-viewport').evaluate((element) => {
      element.scrollTop = 100;
      element.scrollLeft = 50;
    });
    await page.waitForTimeout(500);
    expect(
      await page
        .locator('.pdf-viewport')
        .evaluate((element) => [element.scrollTop, element.scrollLeft]),
    ).toEqual([100, 50]);
    expect(
      await page.evaluate(() => performance.getEntriesByName('elastic:pdf-visible').length),
    ).toBe(renders);

    // Return to fit width, then resize across the vertical overflow threshold.
    await page.getByRole('button', { name: '125%', exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('.pdf-page')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(456);
    await page.locator('.pdf-viewport').evaluate((element) => {
      (element as HTMLElement).style.width = '540px';
    });
    await expect
      .poll(() =>
        page
          .locator('.pdf-page')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(476);
    await page.waitForTimeout(300);
    const afterResize = await page.evaluate(
      () => performance.getEntriesByName('elastic:pdf-visible').length,
    );
    await page.waitForTimeout(750);
    expect(
      await page.evaluate(() => performance.getEntriesByName('elastic:pdf-visible').length),
    ).toBe(afterResize);
    expect(
      await page
        .locator('.pdf-viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
  });
}
