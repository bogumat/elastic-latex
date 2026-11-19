import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/browser/bridge.ts';\n${await response.text()}`,
    });
  });
});

async function open(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello Elastic');
}
async function calls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          elasticTest: { calls: { command: string; args: Record<string, string> }[] };
        }
      ).elasticTest.calls,
  );
}
async function imagePaste(page: Page) {
  await page.locator('.cm-content').evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (char) =>
      char.charCodeAt(0),
    );
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
  });
}

test('create a folder and file, reject a duplicate, then save all tabs before compiling with Command-S', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Add folder', exact: true }).click();
  await page.getByLabel('Folder path', { exact: true }).fill('chapters');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.tree-row[title="chapters"]')).toBeVisible();
  await page.getByRole('button', { name: 'Add file', exact: true }).click();
  await page.getByLabel('File path', { exact: true }).fill('main.tex');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await page.getByLabel('File path', { exact: true }).fill('chapters/intro.tex');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'intro.tex', exact: true })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('New chapter');
  await page.getByRole('tab', { name: 'main.tex', exact: true }).click();
  await page.keyboard.insertText('% Main edit\n');
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  const history = await calls(page);
  const compile = history.findIndex((call) => call.command === 'compile');
  expect(compile).toBeGreaterThan(0);
  const saved = history.slice(0, compile).filter((call) => call.command === 'save_file');
  expect(saved.find((call) => call.args.path === 'chapters/intro.tex')?.args.text).toBe(
    'New chapter',
  );
  expect(saved.find((call) => call.args.path === 'main.tex')?.args.text).toContain('Main edit');
});

test('Command-S keeps edits and does not compile when saving fails', async ({ page }) => {
  await open(page, '?saveerror=1');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Retained change');
  await page.keyboard.press('Meta+s');
  await expect(page.getByRole('alert')).toContainText('File changed on disk');
  expect((await calls(page)).some((call) => call.command === 'compile')).toBe(false);
  await expect(page.locator('.cm-content')).toContainText('Retained change');
});

test('Command-S still saves when TeX is unavailable', async ({ page }) => {
  await open(page, '?notex=1');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Saved without TeX');
  await page.keyboard.press('Meta+s');
  await expect(page.getByRole('alert')).toContainText('Changes saved');
  const history = await calls(page);
  expect(
    history.some(
      (call) => call.command === 'save_file' && call.args.text.includes('Saved without TeX'),
    ),
  ).toBe(true);
  expect(history.some((call) => call.command === 'compile')).toBe(false);
});

test('pasted image is imported before Command-S builds, with graphicx and a figure', async ({
  page,
}) => {
  await open(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await imagePaste(page);
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.textLayer')).toContainText('Elastic PDF test');
  const history = await calls(page);
  const save = history.find((call) => call.command === 'save_file')!;
  expect(save.args.text).toContain('\\usepackage{graphicx}');
  expect(save.args.text).toContain('\\includegraphics[width=\\linewidth]{images/pasted-1.png}');
  expect(history.findIndex((call) => call.command === 'save_image')).toBeLessThan(
    history.findIndex((call) => call.command === 'save_file'),
  );
  expect(history.findIndex((call) => call.command === 'save_file')).toBeLessThan(
    history.findIndex((call) => call.command === 'compile'),
  );
  await imagePaste(page);
  await expect(page.locator('.cm-content')).toContainText('images/pasted-2.png');
  expect(
    (await page.locator('.cm-content').innerText()).match(/\\usepackage\{graphicx\}/g),
  ).toHaveLength(1);
});

test('failed image import leaves source unchanged and blocks the waiting build', async ({
  page,
}) => {
  await open(page, '?imageerror=1');
  const original = await page.locator('.cm-content').innerText();
  await imagePaste(page);
  await page.keyboard.press('Meta+s');
  await expect(page.getByRole('alert')).toContainText('Could not save clipboard image');
  expect(await page.locator('.cm-content').innerText()).toBe(original);
  expect((await calls(page)).some((call) => call.command === 'compile')).toBe(false);
});

test('Sheets HTML and Markdown tables paste as editable, escaped LaTeX', async ({ page }) => {
  await open(page);
  for (const data of [
    {
      text: 'Name\tCost\nR&D\t$5',
      html: '<google-sheets-html-origin><table><tr><td>Name</td><td>Cost</td></tr><tr><td>R&amp;D</td><td>$5</td></tr></table></google-sheets-html-origin>',
    },
    { text: '| Item | Value |\n| --- | ---: |\n| tax_rate | 20% |', html: '' },
  ]) {
    await page.locator('.cm-content').evaluate((element, data) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', data.text);
      clipboardData.setData('text/html', data.html);
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      );
    }, data);
  }
  await expect(page.locator('.cm-content')).toContainText('R\\&D & \\$5');
  await expect(page.locator('.cm-content')).toContainText('tax\\_rate & 20\\%');
  await expect(page.locator('.cm-content')).toContainText('\\begin{tabular}{lr}');
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.cm-content')).not.toContainText('tax\\_rate');
});
