import type { Backend } from '../../../shared/contracts/backend';
import type { Documents } from '../documents';

const MAX_BYTES = 20 * 1024 * 1024;

// Normalize clipboard formats to PNG, which the local pdfLaTeX engine supports.
// Decoding also rejects malformed images before writing a project asset.
export async function imageBytes(blob: Blob): Promise<Uint8Array> {
  if (blob.size > MAX_BYTES) throw new Error('Clipboard images must be smaller than 20 MiB.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024)
      throw new Error('Clipboard images must be smaller than 32 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    try {
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('Could not convert the clipboard image.')),
          'image/png',
        ),
      );
      if (png.size > MAX_BYTES) throw new Error('Converted image exceeds 20 MiB.');
      return new Uint8Array(await png.arrayBuffer());
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function graphicxInsertion(source: string): number | null {
  // Ignore commented commands, while preserving character offsets.
  const uncommented = source.replace(/(?<!\\)%[^\n]*/g, (match) => ' '.repeat(match.length));
  const packages = uncommented.matchAll(
    /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g,
  );
  if ([...packages].some((match) => match[1].split(',').some((name) => name.trim() === 'graphicx')))
    return null;
  const declaration = /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{[^}]+\}/.exec(uncommented);
  if (!declaration)
    throw new Error('Select a root document with a documentclass before pasting images.');
  return declaration.index + declaration[0].length;
}

export async function pasteImage(
  api: Backend,
  documents: Documents,
  root: string,
  blob: Blob,
): Promise<string> {
  if (!root) throw new Error('Select a root document before pasting images.');
  const main = await documents.open(root);
  graphicxInsertion(main.state.doc.toString()); // Validate before creating an asset.
  const path = await api.saveImage(documents.projectId, await imageBytes(blob));
  // Re-read after I/O, since the user may have edited the preamble meanwhile.
  const position = graphicxInsertion(main.state.doc.toString());
  if (position !== null)
    documents.edit(main, {
      changes: { from: position, insert: '\n\\usepackage{graphicx}' },
      userEvent: 'input.paste',
    });
  return `\n\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{${path}}\n\\end{figure}\n`;
}
