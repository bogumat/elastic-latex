import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  alignmentOptions,
  classOptions,
  commands,
  graphicOptions,
  packageOptions,
  placements,
} from './completion-options';

function escaped(text: string, at: number) {
  let count = 0;
  while (at > 0 && text[--at] === '\\') count++;
  return count % 2 === 1;
}

// Preserve offsets while hiding comments and literal examples. Lookbehind below
// is bounded, so completion does not scan an entire document on each keystroke.
function codeContext(source: string) {
  const parts: string[] = [];
  const special = /[%\\]/g;
  let copied = 0;
  let next: RegExpExecArray | null;
  while ((next = special.exec(source))) {
    const index = next.index;
    let end: number;
    if (next[0] === '%') end = source.indexOf('\n', index);
    else {
      const verb = /^\\verb\*?([^a-zA-Z\s])/.exec(source.slice(index));
      const environment = /^\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted)\}/.exec(
        source.slice(index),
      );
      if (!verb && !environment) {
        special.lastIndex = index + 2;
        continue;
      }
      const opening = (verb ?? environment)![0];
      const closing = verb ? verb[1] : `\\end{${environment![1]}}`;
      end = source.indexOf(closing, index + opening.length);
      if (end >= 0) end += closing.length;
    }
    if (end < 0) return { text: '', literal: true };
    parts.push(source.slice(copied, index), source.slice(index, end).replace(/[^\n]/g, ' '));
    copied = end;
    special.lastIndex = end;
  }
  parts.push(source.slice(copied));
  return { text: parts.join(''), literal: false };
}

function segments(text: string) {
  const starts = [0];
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '{') depth++;
    else if (text[index] === '}') depth--;
    else if (text[index] === ',' && depth === 0) starts.push(index + 1);
  }
  return starts.map((start, index) => {
    const end = starts[index + 1];
    return { start, text: text.slice(start, end === undefined ? text.length : end - 1) };
  });
}

export function latexCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const prefix = line.text.slice(0, pos - line.from);
  const start = Math.max(0, pos - 4096);
  const before = codeContext(state.sliceDoc(start, pos));
  if (codeContext(prefix).literal || before.literal) return null;
  const word = context.matchBefore(/\\[a-zA-Z]*/);
  if (word && !escaped(prefix, word.from - line.from)) {
    return {
      from: word.from,
      to: pos + (state.sliceDoc(pos, line.to).match(/^[a-zA-Z]*/)?.[0].length ?? 0),
      options: commands,
      validFor: /^\\[a-zA-Z]*$/,
    };
  }
  const match =
    /\\(documentclass|usepackage|includegraphics|begin)\*?\s*(?:\{([^{}]*)\}\s*)?\[([^\[\]]*)$/.exec(
      before.text,
    );
  if (!match || escaped(before.text, match.index)) return null;
  const [, command, environment, content] = match;
  const from = pos - content.length;
  if (command === 'begin') {
    if (/^(figure|table|algorithm)\*?$/.test(environment?.trim() ?? '')) {
      if (!/^[!htbpH]*$/.test(content)) return null;
      const options = placements
        .filter(
          ({ label }) =>
            !content.includes(label) && !content.includes('H') && (label !== 'H' || !content),
        )
        .map((entry) => ({ ...entry, label: content + entry.label, displayLabel: entry.label }));
      if (!content)
        options.unshift({
          label: 'htbp',
          displayLabel: 'htbp',
          type: 'constant',
          detail: 'Here, top, bottom, or a float page',
        });
      return { from, options, filter: false };
    }
    if (/^(tabular|array|minipage)$/.test(environment?.trim() ?? ''))
      return { from, options: alignmentOptions, validFor: /^[tcb]?$/ };
    return null;
  }
  if (environment !== undefined) return null;
  const following = state.sliceDoc(pos, Math.min(state.doc.length, pos + 1024));
  const argument = /^\s*[^\[\]]*\]\s*\{([^{}]*)\}/.exec(following)?.[1];
  const options =
    command === 'includegraphics'
      ? graphicOptions
      : command === 'documentclass'
        ? classOptions
        : (argument ?? '').split(',').flatMap((name) => packageOptions[name.trim()] ?? []);
  const parts = segments(content);
  const current = parts.at(-1)!;
  const value = /^\s*([\w-]+)\s*=\s*/.exec(current.text);
  if (value) {
    const values = options.find(({ label }) => label === `${value[1]}=`)?.values;
    if (!values?.length) return null;
    return {
      from: from + current.start + value[0].length,
      to: pos + (following.match(/^[\w.\\]*/)?.[0].length ?? 0),
      options: values.map((label) => ({ label, type: 'constant' })),
      validFor: /^[\w.\\]*$/,
    };
  }
  if (!/^\s*[\w-]*$/.test(current.text)) return null;
  const used = new Set(parts.slice(0, -1).map(({ text }) => text.trim().split('=')[0].trim()));
  const unique = new Map(options.map((entry) => [entry.label, entry]));
  return {
    from: from + current.start + (current.text.match(/^\s*/)?.[0].length ?? 0),
    to: pos + (following.match(/^[\w-]*=?/)?.[0].length ?? 0),
    options: [...unique.values()].filter(({ label }) => !used.has(label.replace(/=$/, ''))),
    validFor: /^[\w-]*$/,
  };
}

export const latexCompletion = [
  autocompletion({
    override: [latexCompletions],
    defaultKeymap: false,
    interactionDelay: 0,
    activateOnCompletion: (completion) => completion.label.endsWith('='),
  }),
  Prec.highest(
    keymap.of([
      ...completionKeymap.filter((binding) => binding.key !== 'Enter'),
      { key: 'Tab', run: acceptCompletion },
    ]),
  ),
];
