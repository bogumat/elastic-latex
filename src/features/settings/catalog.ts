import type { EditorSettings } from './preferences';

export const categories = [
  'Appearance',
  'Editor',
  'Files & Saving',
  'Workspace',
  'PDF Viewer',
] as const;
export interface SettingDefinition {
  key: keyof EditorSettings;
  category: (typeof categories)[number];
  label: string;
  description: string;
  options?: { value: string | number; label: string }[];
}
const themes = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
export const settingsCatalog: SettingDefinition[] = [
  {
    key: 'theme',
    category: 'Appearance',
    label: 'App theme',
    description: 'Color mode for the editor, sidebar and settings.',
    options: themes,
  },
  {
    key: 'fontSize',
    category: 'Editor',
    label: 'Font size',
    description: 'Source editor text size.',
    options: Array.from({ length: 19 }, (_, i) => ({ value: i + 10, label: `${i + 10} px` })),
  },
  {
    key: 'tabSize',
    category: 'Editor',
    label: 'Tab width',
    description: 'Indentation size used by the Tab key.',
    options: [2, 4, 8].map((value) => ({ value, label: `${value} spaces` })),
  },
  {
    key: 'wrap',
    category: 'Editor',
    label: 'Wrap lines',
    description: 'Wrap long source lines to fit the editor pane.',
  },
  {
    key: 'lineNumbers',
    category: 'Editor',
    label: 'Line numbers',
    description: 'Show source line numbers beside the folding controls.',
  },
  {
    key: 'highlightLine',
    category: 'Editor',
    label: 'Highlight current line',
    description: 'Highlight the source line containing the cursor.',
  },
  {
    key: 'autosave',
    category: 'Files & Saving',
    label: 'Autosave',
    description: 'Save edits after a short pause. ⌘S always saves all edited files and compiles.',
  },
  {
    key: 'autosaveDelay',
    category: 'Files & Saving',
    label: 'Autosave delay',
    description:
      'Pause before saving. Continuous typing is still saved at least every five seconds.',
    options: [250, 750, 1500, 3000].map((value) => ({ value, label: `${value / 1000} seconds` })),
  },
  {
    key: 'previewTabs',
    category: 'Files & Saving',
    label: 'Preview tabs',
    description: 'Single-click files into a temporary tab; edit or double-click to keep them.',
  },
  {
    key: 'revealActive',
    category: 'Workspace',
    label: 'Reveal active file',
    description: 'Expand folders and scroll to the file opened in the source editor.',
  },
  {
    key: 'defaultView',
    category: 'Workspace',
    label: 'Default workspace view',
    description: 'Layout used when opening a project.',
    options: [
      { value: 'split', label: 'Split' },
      { value: 'source', label: 'Source' },
      { value: 'pdf', label: 'PDF' },
    ],
  },
  {
    key: 'pdfTheme',
    category: 'PDF Viewer',
    label: 'PDF theme',
    description:
      'Independent of the app theme. Dark mode inverts page colors, including images, for viewing; exported PDFs keep their original colors.',
    options: [...themes, { value: 'app', label: 'Follow app' }],
  },
  {
    key: 'pdfZoom',
    category: 'PDF Viewer',
    label: 'Default PDF zoom',
    description: 'Initial zoom for the preview. Changing this also applies to the current PDF.',
    options: [
      { value: 0, label: 'Fit width' },
      ...[0.75, 1, 1.25, 1.5].map((value) => ({ value, label: `${value * 100}%` })),
    ],
  },
];
