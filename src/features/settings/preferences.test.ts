import { afterEach, expect, it, vi } from 'vitest';
import { darkPdfTheme, defaultSettings, normalizeSettings } from './preferences';
import { settingsCatalog } from './catalog';

afterEach(() => vi.unstubAllGlobals());

it('migrates previous settings without changing the existing editor preferences', () => {
  const value = normalizeSettings({ theme: 'dark', fontSize: 18, wrap: false, autosave: false });
  expect(value).toMatchObject({
    theme: 'dark',
    fontSize: 18,
    wrap: false,
    autosave: false,
    pdfTheme: 'light',
    pdfZoom: 0,
    lineNumbers: true,
    autosaveDelay: 750,
  });
});
it('keeps app and PDF themes independent, and follows app/system when requested', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  expect(darkPdfTheme({ ...defaultSettings, theme: 'dark', pdfTheme: 'light' })).toBe(false);
  expect(darkPdfTheme({ ...defaultSettings, theme: 'light', pdfTheme: 'dark' })).toBe(true);
  expect(darkPdfTheme({ ...defaultSettings, theme: 'dark', pdfTheme: 'app' })).toBe(true);
  expect(darkPdfTheme({ ...defaultSettings, theme: 'light', pdfTheme: 'system' })).toBe(true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  expect(darkPdfTheme({ ...defaultSettings, pdfTheme: 'system' })).toBe(false);
});
it('validates persisted values and gives every setting one catalog entry', () => {
  expect(
    normalizeSettings({ fontSize: Infinity, pdfZoom: 999, autosaveDelay: -1, tabSize: 0 }),
  ).toEqual(defaultSettings);
  expect(settingsCatalog.map((item) => item.key).sort()).toEqual(
    Object.keys(defaultSettings).sort(),
  );
});
