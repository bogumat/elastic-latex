import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { latexFolds } from './folding';

it('matches nested environments and leaves the closing command visible', () => {
  const doc = EditorState.create({
    doc: '\\begin{figure}\n\\begin{center}\nimage\n\\end{center}\n\\end{figure}',
  }).doc;
  const ranges = latexFolds(doc);
  expect(ranges.get(0)).toEqual({ from: doc.line(1).to, to: doc.line(5).from - 1 });
  expect(ranges.get(doc.line(2).from)).toEqual({ from: doc.line(2).to, to: doc.line(4).from - 1 });
});

it('ignores commented and escaped commands, unmatched blocks, and verbatim contents', () => {
  for (const source of [
    '% \\begin{figure}\nx\n\\end{figure}',
    '\\\\begin{figure}\nx\n\\end{figure}',
    '\\begin{figure}\nx\n\\end{table}',
  ])
    expect(latexFolds(EditorState.create({ doc: source }).doc).size).toBe(0);
  const doc = EditorState.create({
    doc: '\\begin{verbatim}\n\\begin{fake}\n{\n\\end{verbatim}',
  }).doc;
  expect(latexFolds(doc).size).toBe(1);
});

it('folds multiline arguments and sections until the next matching heading', () => {
  const doc = EditorState.create({
    doc: '\\section{One}\n\\textbf{\nhello\n}\n\\subsection{Child}\nchild\n\\section{Two}\nmore',
  }).doc;
  const ranges = latexFolds(doc);
  expect(ranges.get(0)?.to).toBe(doc.line(7).from - 1);
  expect(ranges.get(doc.line(2).from)).toEqual({ from: doc.line(2).to, to: doc.line(4).from });
  expect(ranges.get(doc.line(7).from)?.to).toBe(doc.length);
});
