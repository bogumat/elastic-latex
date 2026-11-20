import type { Text } from '@codemirror/state';

export function escaped(text: string, at: number) {
  let count = 0;
  while (at > 0 && text[--at] === '\\') count++;
  return count % 2 === 1;
}

// Mask comments and literal examples without changing source offsets.
export function codeContext(source: string) {
  const parts: string[] = [];
  const special = /[%\\]/g;
  let copied = 0;
  let literal = false;
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
    if (end < 0) {
      literal = true;
      end = source.length;
    }
    parts.push(source.slice(copied, index), source.slice(index, end).replace(/[^\n]/g, ' '));
    copied = end;
    special.lastIndex = end;
  }
  parts.push(source.slice(copied));
  return { text: parts.join(''), literal };
}

interface EnvironmentToken {
  name: string;
  from: number;
  to: number;
  closing: boolean;
}
const environmentCache = new WeakMap<Text, EnvironmentToken[]>();

// Build this index only for environment completion, not for ordinary typing.
// Keeping offsets alone avoids retaining a second copy of the source text.
function environmentTokens(doc: Text) {
  const cached = environmentCache.get(doc);
  if (cached) return cached;
  const source = codeContext(doc.toString()).text;
  const pattern = /\\(begin|end)\s*\{([^{}]+)\}/g;
  const tokens: EnvironmentToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (escaped(source, match.index)) continue;
    tokens.push({
      name: match[2].trim(),
      from: match.index,
      to: pattern.lastIndex,
      closing: match[1] === 'end',
    });
  }
  environmentCache.set(doc, tokens);
  return tokens;
}

export function openEnvironments(doc: Text, before: number) {
  const stack: string[] = [];
  for (const token of environmentTokens(doc)) {
    if (token.to > before) break;
    if (!token.closing) stack.push(token.name);
    else if (stack.at(-1) === token.name) stack.pop();
  }
  return stack;
}

export function hasFollowingEnd(doc: Text, after: number, name: string) {
  const nested: string[] = [];
  for (const token of environmentTokens(doc)) {
    if (token.from < after) continue;
    if (!token.closing) nested.push(token.name);
    else if (!nested.length) return token.name === name;
    else if (nested.at(-1) === token.name) nested.pop();
    else return false;
  }
  return false;
}
