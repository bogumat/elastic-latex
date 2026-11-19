import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
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
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  StreamLanguage.define(stex),
  syntaxHighlighting(defaultHighlightStyle),
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
    ...historyKeymap,
    ...searchKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
  EditorState.tabSize.of(2),
  EditorView.theme({
    '&': { height: '100%', fontSize: '14px', backgroundColor: '#fff' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.65',
    },
    '.cm-content': { padding: '18px 0' },
    '.cm-line': { padding: '0 20px 0 10px' },
    '.cm-gutters': {
      backgroundColor: '#fff',
      color: '#788797',
      border: 'none',
      paddingLeft: '12px',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#f3f6f9' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: '#486581' },
  }),
];
