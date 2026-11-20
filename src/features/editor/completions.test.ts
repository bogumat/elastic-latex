import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { latexCompletions } from './completions';

function complete(marked: string) {
  const pos = marked.indexOf('|');
  const state = EditorState.create({ doc: marked.replace('|', '') });
  return latexCompletions(new CompletionContext(state, pos, false));
}
const labels = (marked: string) => complete(marked)?.options.map(({ label }) => label) ?? [];

describe('LaTeX completions', () => {
  it('replaces an entire command when completing in the middle of it', () => {
    const result = complete('\\sec|tion{Introduction}')!;
    expect(result.options.some(({ label }) => label === '\\section')).toBe(true);
    expect(result.from).toBe(0);
    expect(result.to).toBe('\\section'.length);
  });

  it('offers float placement choices and appends unused flags', () => {
    expect(labels('\\begin{figure}[|]')).toContain('htbp');
    expect(labels('\\begin{table*}[h|]')).toEqual(['ht', 'hb', 'hp', 'h!']);
    expect(labels('\\begin{figure}[H|]')).toEqual([]);
    expect(labels('\\begin{figure}[invalid|]')).toEqual([]);
    expect(labels('\\begin{minipage}[|]{4cm}')).toEqual(['t', 'c', 'b']);
  });

  it('suggests graphic keys and values without repeating existing keys', () => {
    expect(labels('\\includegraphics[|]{image.png}')).toContain('width=');
    expect(labels('\\includegraphics[width=5cm, |]{image.png}')).not.toContain('width=');
    expect(labels('\\includegraphics[width=|]{image.png}')).toContain('\\linewidth');
    expect(labels('\\includegraphics[angle=|]{image.png}')).toContain('90');
    const result = complete('\\includegraphics[wid|th=5cm]')!;
    expect(result.to).toBe('\\includegraphics[width='.length);
  });

  it('uses the package following the brackets, including multiline options', () => {
    expect(labels('\\usepackage[|]{geometry}')).toContain('margin=');
    expect(labels('\\usepackage[|]{hyperref}')).toContain('hidelinks');
    expect(labels('\\usepackage[|]{hyperref}')).not.toContain('margin=');
    expect(labels('\\usepackage[|]{fontenc}')).toContain('T1');
    expect(labels('\\usepackage[|]{fontenc, fontenc}').filter((x) => x === 'T1')).toHaveLength(1);
    expect(labels('\\usepackage % page layout\n[\n  margin=2cm,\n  |\n]{geometry}')).toContain(
      'showframe',
    );
    expect(labels('\\usepackage[pdftitle={One, two}, |]{hyperref}')).not.toContain('pdftitle=');
    expect(labels('\\documentclass[|]{article}')).toContain('11pt');
  });

  it('leaves titles, unknown packages, math brackets, and normal text alone', () => {
    for (const source of [
      '\\section[Short |]{Long}',
      '\\cite[|]{paper}',
      '\\usepackage[|]{unknown}',
      'Text [|]',
      '\\[ x + y |',
    ]) {
      expect(labels(source)).toEqual([]);
    }
  });

  it('ignores comments and literal examples while respecting escaped percent signs', () => {
    for (const source of [
      '% \\sec|',
      '100\\% % \\sec|',
      '\\\\% \\sec|',
      '\\verb!\\sec|!',
      '\\begin{verbatim}\n\\sec|\n\\end{verbatim}',
    ]) {
      expect(labels(source)).toEqual([]);
    }
    expect(labels('100\\% \\sec|')).toContain('\\section');
    expect(labels('% \\usepackage[draft]\n\\includegraphics[|]')).toContain('width=');
    expect(labels('\\verb!example! \\sec|')).toContain('\\section');
    expect(labels('\\\\includegraphics[|]')).toEqual([]);
  });
});
