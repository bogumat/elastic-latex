import { CompletionContext } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { latexCompletions } from './completions';
import { openEnvironments } from './latex-syntax';

function apply(marked: string, label: string) {
  const pos = marked.indexOf('|');
  let state = EditorState.create({
    doc: marked.replace('|', ''),
    selection: { anchor: pos },
    extensions: [indentUnit.of('  ')],
  });
  const result = latexCompletions(new CompletionContext(state, pos, false))!;
  const completion = result.options.find((entry) => entry.label === label)!;
  expect(completion, label).toBeDefined();
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      state = spec instanceof Transaction ? spec.state : state.update(spec).state;
    },
  } as EditorView;
  expect(typeof completion.apply).toBe('function');
  if (typeof completion.apply === 'function')
    completion.apply(view, completion, result.from, result.to ?? pos);
  return state;
}

describe('environment completion', () => {
  it('inserts a complete list with the caret after its first item', () => {
    for (const name of ['itemize', 'enumerate']) {
      const state = apply('\\begin{it|}', name);
      expect(state.sliceDoc()).toBe(`\\begin{${name}}\n  \\item \n\\end{${name}}\n`);
      expect(state.selection.main.from).toBe(state.doc.line(2).to);
      expect(state.selection.main.empty).toBe(true);
    }
  });

  it('expands a manually completed opening and respects surrounding indentation', () => {
    const state = apply('  \\begin{itemize}|', '\\begin{itemize}');
    expect(state.sliceDoc()).toBe('  \\begin{itemize}\n    \\item \n  \\end{itemize}\n  ');
    expect(apply('\\begin{}|', '\\begin{itemize}').sliceDoc()).toContain(
      '\\begin{itemize}\n  \\item ',
    );
  });

  it('keeps existing content and closing tags when finishing an opening name', () => {
    const state = apply('\\begin{it|}\n  \\item Existing\n\\end{itemize}', 'itemize');
    expect(state.sliceDoc()).toBe('\\begin{itemize}\n  \\item Existing\n\\end{itemize}');
    const inline = apply('\\begin{it|} Existing content', 'itemize');
    expect(inline.sliceDoc()).toBe('\\begin{itemize} Existing content');
    expect(apply('\\begin % keep this comment\n{it|}', 'itemize').sliceDoc()).toBe(
      '\\begin % keep this comment\n{itemize}',
    );
  });

  it('closes the innermost environment, including when an incorrect argument exists', () => {
    const prefix = '\\begin{itemize}\n  \\item One\n  \\begin{enumerate}\n';
    expect(apply(prefix + '\\en|', '\\end{enumerate}').sliceDoc()).toBe(
      prefix + '\\end{enumerate}',
    );
    expect(apply(prefix + '\\en|{itemize}', '\\end{enumerate}').sliceDoc()).toBe(
      prefix + '\\end{enumerate}',
    );
    expect(apply(prefix + '\\end{enu|}', 'enumerate').sliceDoc()).toBe(prefix + '\\end{enumerate}');
    const state = EditorState.create({ doc: prefix + '\\end{' });
    const result = latexCompletions(new CompletionContext(state, state.doc.length, false));
    expect(result?.options.map(({ label }) => label)).toEqual(['enumerate']);
  });

  it('ignores commented, escaped, and literal environments and finds distant openings', () => {
    const text =
      '\\begin{document}\n\\begin{itemize}\n' +
      'Long item text. '.repeat(1500) +
      '\n% \\begin{fake}\n\\\\begin{fake}\n\\verb!\\begin{fake}!\n\\begin{verbatim}\n\\begin{fake}\n\\end{verbatim}\n';
    const doc = EditorState.create({ doc: text }).doc;
    expect(openEnvironments(doc, doc.length)).toEqual(['document', 'itemize']);
    expect(apply(text + '\\en|', '\\end{itemize}').sliceDoc()).toBe(text + '\\end{itemize}');
  });

  it('includes required arguments in table and minipage templates', () => {
    expect(apply('\\begin{tab|}', 'tabular').sliceDoc()).toBe(
      '\\begin{tabular}{ll}\n   &  \\\\\n\\end{tabular}\n',
    );
    expect(apply('\\begin{mini|}', 'minipage').sliceDoc()).toContain(
      '\\begin{minipage}{0.5\\linewidth}',
    );
    const description = apply('\\begin{desc|}', 'description');
    expect(
      description.sliceDoc(description.selection.main.from, description.selection.main.to),
    ).toBe('Label');
  });
});
