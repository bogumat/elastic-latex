export interface EditorSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  tabSize: number;
  wrap: boolean;
  autosave: boolean;
}
export const defaultSettings: EditorSettings = {
  theme: 'light',
  fontSize: 14,
  tabSize: 2,
  wrap: true,
  autosave: true,
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
