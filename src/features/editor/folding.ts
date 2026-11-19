import { foldService } from '@codemirror/language';
import type { Text } from '@codemirror/state';

interface Range {
  from: number;
  to: number;
}
const cache = new WeakMap<Text, Map<number, Range>>();
const levels: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

export function latexFolds(doc: Text): Map<number, Range> {
  const previous = cache.get(doc);
  if (previous) return previous;
  const ranges = new Map<number, Range>();
  const source = doc.toString();
  const environments: { name: string; start: number }[] = [];
  const braces: number[] = [];
  const sections: { level: number; start: number }[] = [];
  function add(start: number, end: number, brace = false) {
    const first = doc.lineAt(start),
      last = doc.lineAt(end);
    const from = brace ? start + 1 : first.to;
    const to = brace ? end : last.from - 1;
    if (last.number <= first.number || to <= from) return;
    const existing = ranges.get(first.from);
    if (!existing || existing.to < to) ranges.set(first.from, { from, to });
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '%') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline;
    } else if (char === '\\') {
      const command = /^\\([a-zA-Z]+)\*?/.exec(source.slice(index));
      if (!command) {
        index++;
        continue;
      } // Escaped %, braces and backslashes.
      const name = command[1];
      if (name === 'verb') {
        const delimiter = source[index + command[0].length];
        const end = source.indexOf(delimiter, index + command[0].length + 1);
        if (end >= 0) index = end;
        continue;
      }
      if (name === 'begin' || name === 'end') {
        const environment = /^\\(?:begin|end)\s*\{([^}]+)\}/.exec(source.slice(index));
        if (environment) {
          const environmentName = environment[1].trim();
          if (name === 'end' && environmentName === 'document') {
            while (sections.length) add(sections.pop()!.start, index);
          }
          if (name === 'begin') {
            if (/^(?:verbatim\*?|Verbatim|lstlisting|minted)$/.test(environmentName)) {
              const end = source.indexOf(
                `\\end{${environmentName}}`,
                index + environment[0].length,
              );
              if (end >= 0) {
                add(index, end);
                index = end + `\\end{${environmentName}}`.length - 1;
                continue;
              }
            }
            environments.push({ name: environmentName, start: index });
          } else if (environments.at(-1)?.name === environmentName) {
            add(environments.pop()!.start, index);
          }
          index += environment[0].length - 1;
          continue;
        }
      }
      if (name in levels) {
        const level = levels[name];
        while (sections.length && sections.at(-1)!.level >= level)
          add(sections.pop()!.start, index);
        sections.push({ level, start: index });
      }
      index += command[0].length - 1;
    } else if (char === '{') braces.push(index);
    else if (char === '}' && braces.length) add(braces.pop()!, index, true);
  }
  for (const section of sections) {
    const first = doc.lineAt(section.start);
    if (doc.length > first.to) {
      const existing = ranges.get(first.from);
      if (!existing || existing.to < doc.length)
        ranges.set(first.from, { from: first.to, to: doc.length });
    }
  }
  cache.set(doc, ranges);
  return ranges;
}

export const latexFolding = foldService.of(
  (state, start) => latexFolds(state.doc).get(start) ?? null,
);
