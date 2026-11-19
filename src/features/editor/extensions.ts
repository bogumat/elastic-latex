import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { latexFolding } from './folding';
import { tags } from '@lezer/highlight';
import { darkTheme, type EditorSettings } from '../settings/preferences';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

const commands = [
  'section',
  'subsection',
  'textbf',
  'textit',
  'emph',
  'label',
  'ref',
  'cite',
  'includegraphics',
  'input',
  'begin',
  'end',
];
export const editorExtensions = [
  foldGutter(),
  latexFolding,
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  highlightSelectionMatches(),
  StreamLanguage.define(stex),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  autocompletion({
    override: [
      (context) => {
        const word = context.matchBefore(/\\[a-zA-Z]*/);
        if (!word || (word.from === word.to && !context.explicit)) return null;
        return {
          from: word.from,
          options: commands.map((command) => ({ label: `\\${command}`, type: 'keyword' })),
        };
      },
    ],
  }),
  keymap.of([
    ...defaultKeymap,
    ...foldKeymap,
    ...historyKeymap,
    ...searchKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
  EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--surface)' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.65',
    },
    '.cm-content': { padding: '18px 0' },
    '.cm-line': { padding: '0 20px 0 10px' },
    '.cm-gutters': {
      backgroundColor: 'var(--surface)',
      color: '#788797',
      border: 'none',
      paddingLeft: '12px',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--background)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: '#486581' },
  }),
];

const darkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.macroName], color: '#c9a9ff' },
  { tag: [tags.string, tags.name], color: '#8fd7a6' },
  { tag: [tags.number, tags.atom], color: '#f5c28a' },
  { tag: tags.comment, color: '#96a5b9' },
  { tag: [tags.bracket, tags.punctuation], color: '#cbd8e6' },
]);
export function settingsExtensions(settings: EditorSettings) {
  return [
    settings.lineNumbers ? lineNumbers() : [],
    settings.highlightLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    settings.wrap ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(settings.tabSize),
    indentUnit.of(' '.repeat(settings.tabSize)),
    EditorView.theme(
      { '&': { fontSize: `${settings.fontSize}px`, color: 'var(--text)' } },
      { dark: darkTheme(settings) },
    ),
    darkTheme(settings) ? syntaxHighlighting(darkHighlight) : [],
  ];
}
