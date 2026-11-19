import type { EditorState, Text } from '@codemirror/state';
export interface SourceLocation {
  line: number;
  section?: { title: string; line: number };
}
const cache = new WeakMap<Text, { title: string; line: number }[]>();
export function sourceLocation(state: EditorState): SourceLocation {
  let sections = cache.get(state.doc);
  if (!sections) {
    sections = [];
    let verbatim = false;
    for (let number = 1; number <= state.doc.lines; number++) {
      const text = state.doc.line(number).text;
      if (/^\s*\\begin\{(?:verbatim|Verbatim|lstlisting|minted)\}/.test(text)) verbatim = true;
      if (verbatim) {
        if (/^\s*\\end\{(?:verbatim|Verbatim|lstlisting|minted)\}/.test(text)) verbatim = false;
        continue;
      }
      const heading =
        /^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{(.+)\}/.exec(
          text,
        );
      if (heading) sections.push({ title: heading[1], line: number });
    }
    cache.set(state.doc, sections);
  }
  const line = state.doc.lineAt(state.selection.main.head).number;
  return { line, section: [...sections].reverse().find((section) => section.line <= line) };
}
