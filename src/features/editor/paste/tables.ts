interface Table {
  rows: string[][];
  columns: string;
  header: boolean;
}
const MAX_CELLS = 10_000;

export function escapeLatex(text: string): string {
  const escapes: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    $: '\\$',
    '#': '\\#',
    _: '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  };
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\\&%$#_{}~^]/g, (char) => escapes[char]));
  return lines.length > 1 ? `\\shortstack[l]{${lines.join(' \\\\ ')}}` : lines[0];
}

function rectangular(rows: string[][]): boolean {
  return (
    !!rows.length &&
    !!rows[0].length &&
    rows.length * rows[0].length <= MAX_CELLS &&
    rows.every((row) => row.length === rows[0].length)
  );
}

export function markdownTable(text: string): Table | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0].includes('|')) return null;
  const split = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const alignment = split(lines[1]);
  if (!alignment.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const rows = [split(lines[0]), ...lines.slice(2).map(split)];
  if (!rectangular(rows) || alignment.length !== rows[0].length) return null;
  const columns = alignment
    .map((cell) =>
      cell.startsWith(':') && cell.endsWith(':') ? 'c' : cell.endsWith(':') ? 'r' : 'l',
    )
    .join('');
  return { rows, columns, header: true };
}

export function spreadsheetTable(text: string): Table | null {
  if (!text.includes('\t')) return null;
  // Sheets quotes cells containing tabs/newlines and doubles embedded quotes.
  const rows: string[][] = [[]];
  let cell = '',
    quoted = false;
  const input = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && (quoted || cell === '')) {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === '\t' || char === '\n')) {
      rows[rows.length - 1].push(cell);
      cell = '';
      if (char === '\n') rows.push([]);
      if (rows.length > MAX_CELLS) return null;
    } else cell += char;
  }
  rows[rows.length - 1].push(cell);
  if (quoted || !rectangular(rows) || rows[0].length < 2) return null;
  return { rows, columns: 'l'.repeat(rows[0].length), header: false };
}

export function htmlTable(html: string): Table | null {
  if (!/<table[\s>]/i.test(html)) return null;
  // Detached DOM only: never insert clipboard HTML into the app.
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table || table.querySelector('table')) return null;
  const rows: string[][] = [];
  const sourceRows = [...table.rows];
  if (sourceRows.length > MAX_CELLS) return null;
  for (const [rowIndex, row] of sourceRows.entries()) {
    rows[rowIndex] ??= [];
    let column = 0;
    for (const cell of row.cells) {
      while (rows[rowIndex][column] !== undefined) column++;
      const height = cell.rowSpan === 0 ? sourceRows.length - rowIndex : cell.rowSpan;
      if ((rowIndex + height) * (column + cell.colSpan) > MAX_CELLS) return null;
      for (const br of cell.querySelectorAll('br')) br.replaceWith('\n');
      for (const unsafe of cell.querySelectorAll('script, style')) unsafe.remove();
      for (let y = 0; y < height; y++) {
        rows[rowIndex + y] ??= [];
        for (let x = 0; x < cell.colSpan; x++)
          rows[rowIndex + y][column + x] =
            x === 0 && y === 0 ? (cell.textContent ?? '').trim() : '';
      }
      column += cell.colSpan;
    }
  }
  const width = Math.max(0, ...rows.map((row) => row.length));
  const padded = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));
  if (!rectangular(padded)) return null;
  return { rows: padded, columns: 'l'.repeat(width), header: !!sourceRows[0]?.querySelector('th') };
}

export function clipboardTable(text: string, html = ''): string | null {
  if (text.length > 1_000_000 || html.length > 2_000_000) return null;
  const table = (html && htmlTable(html)) || markdownTable(text) || spreadsheetTable(text);
  if (!table) return null;
  const lines = table.rows.map(
    (row, index) =>
      `${row.map(escapeLatex).join(' & ')} \\\\${table.header && index === 0 ? '\n\\hline' : ''}`,
  );
  return `\n\\begin{tabular}{${table.columns}}\n\\hline\n${lines.join('\n')}\n\\hline\n\\end{tabular}\n`;
}
