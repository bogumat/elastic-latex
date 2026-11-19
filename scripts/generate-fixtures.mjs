import { mkdir, writeFile } from 'node:fs/promises';

const base = new URL('../tests/fixtures/generated/', import.meta.url);
for (const [name, pages, entries] of [
  ['ordinary', 20, 20],
  ['stress', 300, 2000],
]) {
  const folder = new URL(`${name}/`, base);
  await mkdir(new URL('sections/', folder), { recursive: true });
  let main = '\\documentclass{article}\n\\begin{document}\n';
  for (let page = 1; page <= pages; page++) {
    const section = `sections/page-${page}.tex`;
    await writeFile(
      new URL(section, folder),
      `\\section{Page ${page}}\n${'A repeatable local performance fixture. '.repeat(90)}\n`,
    );
    main += `\\input{${section}}\n${page < pages ? '\\newpage\n' : ''}`;
  }
  await writeFile(new URL('main.tex', folder), `${main}\\end{document}\n`);
  if (name === 'stress') {
    await writeFile(
      new URL('large.tex', folder),
      '% Large editable source\n' + '% source text for a line\n'.repeat(50000),
    );
    await writeFile(new URL('long-line.tex', folder), '%' + 'x'.repeat(1024 * 1024));
    await mkdir(new URL('many-files/', folder), { recursive: true });
    for (let index = 0; index < entries; index++)
      await writeFile(new URL(`many-files/file-${index}.tex`, folder), `% ${index}\n`);
  }
  console.log(`${name}: ${pages} synthetic pages at ${folder.pathname}`);
}
