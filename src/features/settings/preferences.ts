export interface EditorSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  tabSize: number;
  wrap: boolean;
  autosave: boolean;
  pdfTheme: 'light' | 'dark' | 'app' | 'system';
  pdfZoom: number;
  lineNumbers: boolean;
  highlightLine: boolean;
  autosaveDelay: number;
  previewTabs: boolean;
  revealActive: boolean;
  defaultView: 'split' | 'source' | 'pdf';
}
export const defaultSettings: EditorSettings = {
  theme: 'light',
  fontSize: 14,
  tabSize: 2,
  wrap: true,
  autosave: true,
  pdfTheme: 'light',
  pdfZoom: 0,
  lineNumbers: true,
  highlightLine: true,
  autosaveDelay: 750,
  previewTabs: true,
  revealActive: true,
  defaultView: 'split',
};
export function normalizeSettings(value: Partial<EditorSettings>): EditorSettings {
  return {
    theme: ['light', 'dark', 'system'].includes(value.theme ?? '') ? value.theme! : 'light',
    fontSize:
      typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)
        ? Math.max(10, Math.min(28, Math.round(value.fontSize)))
        : 14,
    tabSize: [2, 4, 8].includes(value.tabSize ?? 0) ? value.tabSize! : 2,
    wrap: typeof value.wrap === 'boolean' ? value.wrap : true,
    autosave: typeof value.autosave === 'boolean' ? value.autosave : true,
    pdfTheme: ['light', 'dark', 'app', 'system'].includes(value.pdfTheme ?? '')
      ? value.pdfTheme!
      : 'light',
    pdfZoom: [0, 0.75, 1, 1.25, 1.5].includes(value.pdfZoom ?? -1) ? value.pdfZoom! : 0,
    lineNumbers: typeof value.lineNumbers === 'boolean' ? value.lineNumbers : true,
    highlightLine: typeof value.highlightLine === 'boolean' ? value.highlightLine : true,
    autosaveDelay: [250, 750, 1500, 3000].includes(value.autosaveDelay ?? 0)
      ? value.autosaveDelay!
      : 750,
    previewTabs: typeof value.previewTabs === 'boolean' ? value.previewTabs : true,
    revealActive: typeof value.revealActive === 'boolean' ? value.revealActive : true,
    defaultView: ['split', 'source', 'pdf'].includes(value.defaultView ?? '')
      ? value.defaultView!
      : 'split',
  };
}
export function loadSettings(): EditorSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem('elastic.settings') ?? '{}') ?? {});
  } catch {
    return { ...defaultSettings };
  }
}
export function darkTheme(settings: EditorSettings) {
  return (
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  );
}

export function darkPdfTheme(settings: EditorSettings) {
  if (settings.pdfTheme === 'app') return darkTheme(settings);
  return (
    settings.pdfTheme === 'dark' ||
    (settings.pdfTheme === 'system' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  );
}
