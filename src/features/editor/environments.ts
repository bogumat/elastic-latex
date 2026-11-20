import {
  insertCompletionText,
  pickedCompletion,
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { commands } from './completion-options';
import { codeContext, escaped, hasFollowingEnd, openEnvironments } from './latex-syntax';

interface Environment {
  name: string;
  detail: string;
  args?: string;
  body?: string;
}
const environments: readonly Environment[] = [
  { name: 'itemize', detail: 'Bulleted list', body: '\\item ${1}' },
  { name: 'enumerate', detail: 'Numbered list', body: '\\item ${1}' },
  { name: 'description', detail: 'Labeled list', body: '\\item[${1:Label}] ${2}' },
  { name: 'figure', detail: 'Figure float', args: '[htbp]', body: '\\centering\n\t${1}' },
  { name: 'table', detail: 'Table float', args: '[htbp]', body: '\\centering\n\t${1}' },
  { name: 'equation', detail: 'Numbered equation' },
  { name: 'equation*', detail: 'Unnumbered equation · amsmath' },
  { name: 'align', detail: 'Aligned equations · amsmath' },
  { name: 'align*', detail: 'Unnumbered aligned equations · amsmath' },
  { name: 'gather', detail: 'Centered equations · amsmath' },
  { name: 'gather*', detail: 'Unnumbered centered equations · amsmath' },
  { name: 'center', detail: 'Centered content' },
  { name: 'flushleft', detail: 'Left-aligned content' },
  { name: 'flushright', detail: 'Right-aligned content' },
  { name: 'quote', detail: 'Indented quotation' },
  { name: 'abstract', detail: 'Document abstract' },
  { name: 'tabular', detail: 'Table cells', args: '{${1:ll}}', body: '${2} & ${3} \\\\' },
  { name: 'minipage', detail: 'Fixed-width content', args: '{${1:0.5\\linewidth}}', body: '${2}' },
  { name: 'document', detail: 'Document body' },
];

const commandOptions = commands.map((command) => {
  if (command.label === '\\begin' || command.label === '\\end')
    return snippetCompletion(command.label + '{${}}', command);
  if (command.label === '\\item') return snippetCompletion('\\item ${}', command);
  return command;
});

export function commandCompletions(state: EditorState, from: number, prefix: string) {
  const name = /^\\e(?:n(?:d)?)?$/.test(prefix)
    ? openEnvironments(state.doc, from).at(-1)
    : undefined;
  if (!name) return commandOptions;
  const closing: Completion = {
    label: `\\end{${name}}`,
    detail: `Close ${name}`,
    type: 'keyword',
    boost: 50,
    apply(view, completion, from, to) {
      const following = view.state.sliceDoc(to, view.state.doc.lineAt(to).to);
      const argument = /^\s*\{[\w*@-]*\}?/.exec(following);
      view.dispatch({
        ...insertCompletionText(
          view.state,
          completion.label,
          from,
          to + (argument?.[0].length ?? 0),
        ),
        annotations: pickedCompletion.of(completion),
      });
    },
  };
  return [closing, ...commandOptions.filter(({ label }) => label !== '\\end')];
}

function beginCompletion(environment: Environment, wholeOpening = false): Completion {
  const { name, detail } = environment;
  return {
    label: wholeOpening ? `\\begin{${name}}` : name,
    detail,
    type: 'keyword',
    boost: name === 'itemize' ? 5 : 0,
    apply(view, completion, from, to) {
      if (!wholeOpening && view.state.sliceDoc(to, to + 1) === '}') to++;
      const before = view.state.sliceDoc(Math.max(0, from - 4096), from);
      const opening = /\\begin\s*\{$/.exec(codeContext(before).text);
      const commandFrom = wholeOpening ? from : from - (opening?.[0].length ?? 0);
      const trailing = view.state.sliceDoc(to, view.state.doc.lineAt(to).to).trim();
      const commented = opening && before.slice(opening.index) !== opening[0];
      if (hasFollowingEnd(view.state.doc, to, name) || trailing || commented) {
        view.dispatch({
          ...insertCompletionText(
            view.state,
            wholeOpening ? `\\begin{${name}}` : name + '}',
            wholeOpening ? commandFrom : from,
            to,
          ),
          annotations: pickedCompletion.of(completion),
        });
        return;
      }
      const template =
        `\\begin{${name}}` +
        (environment.args ?? '') +
        '\n\t' +
        (environment.body ?? '${1}') +
        `\n\\end{${name}}\n` +
        '${0}';
      snippet(template)(view, completion, commandFrom, to);
    },
  };
}

export function environmentCompletions(
  context: CompletionContext,
  before: string,
): CompletionResult | null {
  const match = /\\(begin|end)\s*\{([\w*@-]*)(\})?$/.exec(before);
  if (!match || escaped(before, match.index)) return null;
  const { state, pos } = context;
  const [, kind, name, closed] = match;
  if (kind === 'end' && closed) return null;
  const commandFrom = pos - match[0].length;
  const following = state.sliceDoc(pos, state.doc.lineAt(pos).to);
  const rest = following.match(/^[\w*@-]*/)?.[0].length ?? 0;
  if (kind === 'end') {
    const nearest = openEnvironments(state.doc, commandFrom).at(-1);
    const names = nearest ? [nearest] : [];
    return {
      from: pos - name.length,
      to: pos + rest,
      validFor: /^[\w*@-]*$/,
      options: names.map((label, index) => ({
        label,
        apply(view, completion, from, to) {
          if (view.state.sliceDoc(to, to + 1) === '}') to++;
          view.dispatch({
            ...insertCompletionText(view.state, completion.label + '}', from, to),
            annotations: pickedCompletion.of(completion),
          });
        },
        detail: `Close ${label}`,
        type: 'keyword',
        boost: names.length - index,
      })),
    };
  }
  if (closed) {
    if (!name)
      return {
        from: commandFrom,
        options: environments.map((entry) => beginCompletion(entry, true)),
      };
    const environment = environments.find((entry) => entry.name === name) ?? {
      name,
      detail: 'Environment block',
    };
    if (hasFollowingEnd(state.doc, pos, name)) return null;
    return { from: commandFrom, options: [beginCompletion(environment, true)] };
  }
  return {
    from: pos - name.length,
    to: pos + rest,
    validFor: /^[\w*@-]*$/,
    options: environments.map((entry) => beginCompletion(entry)),
  };
}
