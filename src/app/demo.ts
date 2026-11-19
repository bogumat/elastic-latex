import type { Backend } from '../shared/contracts/backend';

export const sample = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath}

\title{A little room to think}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Good ideas begin with a little space.
This is a simple starting point for your next paper.
\end{abstract}

\section{Introduction}
Write something worth working on.

\begin{equation}
  E = mc^2
\end{equation}

\section{What's next}
Open a local project in the desktop app, choose its
root document, and compile with your installed TeX tools.

\end{document}
`;
const files = new Map([
  ['main.tex', sample],
  [
    'references.bib',
    '@article{example,\n  title = {A new idea},\n  author = {Author, A.},\n  year = {2026}\n}\n',
  ],
]);
const folders = new Set<string>();
export const demo: Backend = {
  openProject: async () => ({ id: 'browser-sample', name: 'First thoughts' }),
  listEntries: async (_, directory) =>
    [...folders, ...files.keys()]
      .filter((path) => path.split('/').slice(0, -1).join('/') === directory)
      .map((path) => ({ path, name: path.split('/').pop()!, directory: folders.has(path) })),
  createEntry: async (_, path, directory) => {
    if (path.split('/').some((part) => !part || part.startsWith('.') || /[\\\0]/.test(part)))
      throw new Error('Use a relative path with visible file and folder names.');
    if (files.has(path) || folders.has(path))
      throw new Error('A file or folder already exists at that path.');
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent && !folders.has(parent)) throw new Error('The parent folder does not exist.');
    if (directory) folders.add(path);
    else files.set(path, '');
  },
  saveImage: async () => {
    throw new Error('Image paste requires a local project in the desktop app.');
  },
  readFile: async (_, path) => ({ text: files.get(path) ?? '', version: 'demo', lineEnding: '\n' }),
  saveFile: async (_, path, text) => {
    files.set(path, text);
    return 'demo';
  },
  toolchain: async () => ({
    available: false,
    latexmk: null,
    message:
      'Browser sample · changes stay in memory. Run the desktop app to open and compile local projects.',
  }),
  compile: async () => {
    throw new Error('Local compilation requires the desktop app.');
  },
  cancel: async () => {},
  readArtifact: async () => {
    throw new Error('No compiled PDF.');
  },
  exportPdf: async () => {},
  reloadFiles: async () =>
    Object.fromEntries(
      [...files].map(([path, text]) => [path, { text, version: 'demo', lineEnding: '\n' }]),
    ),
};
