import { describe, expect, it } from 'vitest';
import { clipboardTable, escapeLatex, markdownTable, spreadsheetTable } from './tables';
import { graphicxInsertion } from './images';

describe('clipboard table conversion', () => {
  it('preserves Markdown alignment, empty cells and escaped pipes', () => {
    expect(
      markdownTable('| Name | Amount | Note |\n| :--- | ---: | :---: |\n| A\\|B | 20% | |'),
    ).toEqual({
      rows: [
        ['Name', 'Amount', 'Note'],
        ['A|B', '20%', ''],
      ],
      columns: 'lrc',
      header: true,
    });
    expect(clipboardTable('| X | Y |\n| --- | --- |\n| a_b | 10% |')).toContain('a\\_b & 10\\%');
  });
  it('reads quoted Sheets cells, embedded tabs/newlines and trailing blank cells', () => {
    expect(spreadsheetTable('Name\tValue\tNote\n"Two\nlines"\t"a\tb"\t\n')).toEqual({
      rows: [
        ['Name', 'Value', 'Note'],
        ['Two\nlines', 'a\tb', ''],
      ],
      columns: 'lll',
      header: false,
    });
    expect(spreadsheetTable('"a ""quote"""\tb')).toMatchObject({ rows: [['a "quote"', 'b']] });
  });
  it('escapes commands and special characters rather than injecting LaTeX', () => {
    expect(escapeLatex('\\input{secret} & $5 #1_2 20% ~^')).toBe(
      '\\textbackslash{}input\\{secret\\} \\& \\$5 \\#1\\_2 20\\% \\textasciitilde{}\\textasciicircum{}',
    );
    expect(escapeLatex('one\ntwo')).toBe('\\shortstack[l]{one \\\\ two}');
  });
  it('leaves prose, ordinary LaTeX and malformed tables alone', () => {
    for (const text of [
      'ordinary text',
      '\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}',
      'a | b\nprose | prose',
      'a\tb\nc',
      '| a | b |\n| --- | --- |\n| c |',
    ]) {
      expect(clipboardTable(text)).toBeNull();
    }
  });
});

describe('graphicx setup', () => {
  it('adds after a multiline document class and ignores commented packages', () => {
    const source = '% \\usepackage{graphicx}\n\\documentclass\n[11pt]{article}\n\\begin{document}';
    expect(graphicxInsertion(source)).toBe(source.indexOf('\n\\begin'));
  });
  it('recognizes graphicx in a package list without duplicating it', () => {
    expect(
      graphicxInsertion('\\documentclass{article}\n\\usepackage[demo]{amsmath, graphicx}'),
    ).toBeNull();
    expect(() => graphicxInsertion('a chapter')).toThrow('root document');
  });
});
