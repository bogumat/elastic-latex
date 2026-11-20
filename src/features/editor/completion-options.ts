import type { Completion } from '@codemirror/autocomplete';

interface Option extends Completion {
  values?: readonly string[];
}
const lengths = ['\\linewidth', '\\textwidth', '\\columnwidth', '0.5\\linewidth', '5cm'];
const margins = ['2.5cm', '2cm', '3cm', '1in'];
const colors = ['black', 'blue', 'red', 'green', 'gray'];
const boolean = ['true', 'false'];
const option = (label: string, detail: string, values?: readonly string[]): Option => ({
  label,
  detail,
  type: label.endsWith('=') ? 'property' : 'constant',
  values,
});

export const commands: readonly Completion[] = [
  ['documentclass', 'Document class'],
  ['usepackage', 'Load a package'],
  ['begin', 'Start an environment'],
  ['end', 'End an environment'],
  ['part', 'Part heading'],
  ['chapter', 'Chapter heading'],
  ['section', 'Section heading'],
  ['subsection', 'Subsection heading'],
  ['subsubsection', 'Subsubsection heading'],
  ['paragraph', 'Paragraph heading'],
  ['textbf', 'Bold text'],
  ['textit', 'Italic text'],
  ['texttt', 'Monospace text'],
  ['emph', 'Emphasized text'],
  ['label', 'Define a reference label'],
  ['ref', 'Reference a label'],
  ['eqref', 'Reference an equation · amsmath'],
  ['cite', 'Cite a source'],
  ['includegraphics', 'Insert an image · graphicx'],
  ['input', 'Insert another source file'],
  ['include', 'Include a source file with page breaks'],
  ['caption', 'Figure or table caption'],
  ['centering', 'Center the contents'],
  ['item', 'List item'],
  ['footnote', 'Footnote'],
  ['tableofcontents', 'Table of contents'],
  ['newpage', 'Start a new page'],
  ['clearpage', 'Flush floats and start a new page'],
  ['linewidth', 'Current line width'],
  ['textwidth', 'Main text width'],
  ['columnwidth', 'Current column width'],
  ['textheight', 'Main text height'],
].map(([name, detail]) => ({ label: `\\${name}`, detail, type: 'keyword' }));

export const graphicOptions: readonly Option[] = [
  option('width=', 'Image width', lengths),
  option('height=', 'Image height', ['5cm', '0.5\\textheight', '\\textheight']),
  option('scale=', 'Scale factor', ['0.25', '0.5', '0.75', '1']),
  option('angle=', 'Rotation in degrees', ['0', '90', '180', '270']),
  option('keepaspectratio', 'Preserve proportions with width and height'),
  option('trim=', 'Crop left bottom right top', ['0pt 0pt 0pt 0pt']),
  option('clip', 'Clip cropped content'),
  option('page=', 'Page of a PDF image', ['1', '2', '3']),
  option('origin=', 'Rotation origin', ['c', 't', 'b', 'l', 'r']),
  option('draft', 'Show an image placeholder'),
];

export const classOptions: readonly Option[] = [
  ...['10pt', '11pt', '12pt'].map((size) => option(size, 'Base font size')),
  ...['a4paper', 'a5paper', 'letterpaper', 'legalpaper', 'executivepaper'].map((paper) =>
    option(paper, 'Paper size'),
  ),
  option('landscape', 'Landscape orientation'),
  option('oneside', 'Single-sided layout'),
  option('twoside', 'Facing-page layout'),
  option('onecolumn', 'One text column'),
  option('twocolumn', 'Two text columns'),
  option('draft', 'Mark layout overflows'),
  option('final', 'Final output'),
  option('titlepage', 'Separate title page'),
  option('notitlepage', 'Title on the first text page'),
  option('fleqn', 'Left-aligned equations'),
  option('leqno', 'Equation numbers on the left'),
];

// Package names are taken from the mandatory argument after the option list.
// Keep these catalogs independent so adding a package does not change parsing.
export const packageOptions: Readonly<Record<string, readonly Option[]>> = {
  geometry: [
    ...['margin', 'top', 'bottom', 'left', 'right', 'bindingoffset', 'headheight'].map((key) =>
      option(`${key}=`, key === 'margin' ? 'All page margins' : `${key} length`, margins),
    ),
    option('a4paper', 'A4 paper'),
    option('letterpaper', 'US Letter paper'),
    option('landscape', 'Landscape orientation'),
    option('includehead', 'Include header in the text area'),
    option('includefoot', 'Include footer in the text area'),
    option('showframe', 'Draw layout boundaries'),
  ],
  graphicx: [option('draft', 'Image placeholders'), option('final', 'Render images')],
  hyperref: [
    option('hidelinks', 'Hide link borders and colors'),
    option('colorlinks=', 'Color linked text', boolean),
    option('linkcolor=', 'Internal link color', colors),
    option('urlcolor=', 'URL color', colors),
    option('citecolor=', 'Citation link color', colors),
    option('bookmarks=', 'PDF bookmarks', boolean),
    option('bookmarksopen=', 'Expand PDF bookmarks', boolean),
    option('pdftitle=', 'PDF title metadata'),
    option('pdfauthor=', 'PDF author metadata'),
  ],
  xcolor: ['dvipsnames', 'svgnames', 'x11names', 'table', 'monochrome', 'rgb', 'cmyk'].map((name) =>
    option(name, 'Color configuration'),
  ),
  fontenc: ['T1', 'OT1', 'T2A', 'LY1'].map((name) => option(name, 'Font encoding')),
  inputenc: ['utf8', 'latin1', 'ascii'].map((name) => option(name, 'Input encoding')),
  babel: ['english', 'british', 'american', 'french', 'ngerman', 'spanish', 'russian'].map((name) =>
    option(name, 'Document language'),
  ),
  amsmath: [
    'fleqn',
    'leqno',
    'tbtags',
    'centertags',
    'sumlimits',
    'nosumlimits',
    'intlimits',
    'nointlimits',
  ].map((name) => option(name, 'Math layout')),
};

export const placements: readonly Completion[] = [
  option('h', 'Here, if space allows'),
  option('t', 'Top of a page'),
  option('b', 'Bottom of a page'),
  option('p', 'A page of floats'),
  option('!', 'Relax float placement restrictions'),
  option('H', 'Exactly here · requires \\usepackage{float}'),
];
export const alignmentOptions: readonly Completion[] = [
  option('t', 'Align at the top'),
  option('c', 'Align at the center'),
  option('b', 'Align at the bottom'),
];
