// Imported only by a Playwright route override; never included in the app bundle.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

Object.assign(globalThis, { isTauri: true });
let source = '\\documentclass{article}\n\\begin{document}\nHello Elastic\n\\end{document}';
let build = 0;
let version = '1';
let mainPath = 'main.tex';
const extraFiles = new Map<string, string>();
const folders = new Set<string>();
let imageCount = 0;
let recent: { name: string; path: string }[] = [];
let changes = [{ path: 'main.tex', originalPath: null, index: ' ', worktree: 'M' }];
let repository = !new URLSearchParams(location.search).has('notrepo');
const remotes = [
  {
    name: 'origin',
    url: 'https://github.com/owner/paper.git',
    push_url: 'https://github.com/owner/paper.git',
  },
];
const calls: { command: string; args: unknown }[] = [];
Object.assign(globalThis, { elasticTest: { calls } });

function fixturePdf() {
  const count = new URLSearchParams(location.search).has('multipage') ? 40 : 1;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${count} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let index = 0; index < count; index++) {
    const stream = `BT /F1 24 Tf 50 740 Td (Elastic PDF test${count > 1 ? ` page ${index + 1}` : ''}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(text).buffer;
}

mockIPC(
  async (command, args) => {
    calls.push({ command, args });
    switch (command) {
      case 'recent_projects':
        return recent;
      case 'toolchain_status':
        return {
          available: !new URLSearchParams(location.search).has('notex'),
          latexmk: '/test/latexmk',
          message: 'Test toolchain',
        };
      case 'plugin:dialog|open':
        return '/test/project';
      case 'open_project':
        recent = [{ name: 'Test article', path: (args as { path: string }).path }];
        return { id: 'test', ...recent[0] };
      case 'list_entries': {
        const directory = (args as { directory: string }).directory;
        const entries = [...folders, ...extraFiles.keys()]
          .filter((path) => path.split('/').slice(0, -1).join('/') === directory)
          .map((path) => ({ path, name: path.split('/').pop()!, directory: folders.has(path) }));
        if (directory)
          return [
            ...entries,
            ...(mainPath && mainPath.split('/').slice(0, -1).join('/') === directory
              ? [{ path: mainPath, name: mainPath.split('/').pop()!, directory: false }]
              : []),
          ];
        if (new URLSearchParams(location.search).has('multiple')) {
          return ['article.tex', 'notes.tex'].map((path) => ({
            path,
            name: path,
            directory: false,
          }));
        }
        return [
          ...entries,
          ...(mainPath && !mainPath.includes('/')
            ? [{ path: mainPath, name: mainPath, directory: false }]
            : []),
        ];
      }
      case 'file_action': {
        const { action, path, destination } = args as {
          action: string;
          path: string;
          destination: string;
        };
        if (action === 'reveal' || action === 'copy-path' || action === 'copy-relative-path')
          return;
        if (!folders.has(path) && !extraFiles.has(path) && mainPath !== path)
          throw new Error('Source no longer exists');
        if (
          destination &&
          (folders.has(destination) || extraFiles.has(destination) || mainPath === destination)
        )
          throw new Error('A file or folder already exists at the destination.');
        if (destination === path || destination.startsWith(`${path}/`))
          throw new Error('Choose a different destination outside the source folder.');
        const matches = (value: string) => value === path || value.startsWith(`${path}/`);
        const moved = (value: string) => destination + value.slice(path.length);
        const snapshot = [...extraFiles];
        const directories = [...folders];
        if (mainPath && matches(mainPath)) {
          if (action === 'copy') extraFiles.set(moved(mainPath), source);
          else mainPath = action === 'trash' ? '' : moved(mainPath);
        }
        for (const [key, value] of snapshot)
          if (matches(key)) {
            if (action !== 'copy') extraFiles.delete(key);
            if (action !== 'trash') extraFiles.set(moved(key), value);
          }
        for (const key of directories)
          if (matches(key)) {
            if (action !== 'copy') folders.delete(key);
            if (action !== 'trash') folders.add(moved(key));
          }
        return;
      }
      case 'create_entry': {
        const { path, directory } = args as { path: string; directory: boolean };
        if (folders.has(path) || extraFiles.has(path) || path === 'main.tex')
          throw new Error('A file or folder already exists at that path.');
        if (directory) folders.add(path);
        else extraFiles.set(path, '');
        return;
      }
      case 'save_image': {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (new URLSearchParams(location.search).has('imageerror'))
          throw new Error('Could not save clipboard image');
        folders.add('images');
        const path = `images/pasted-${++imageCount}.png`;
        extraFiles.set(path, '');
        return path;
      }
      case 'read_file': {
        const path = (args as { path: string }).path;
        return { text: extraFiles.get(path) ?? source, version, lineEnding: '\n' };
      }
      case 'reload_files':
        return { 'main.tex': { text: source, version, lineEnding: '\n' } };
      case 'save_file': {
        if (new URLSearchParams(location.search).has('saveerror'))
          throw new Error('File changed on disk');
        const { path, text } = args as { path: string; text: string };
        if (extraFiles.has(path)) extraFiles.set(path, text);
        else source = text;
        return '2';
      }
      case 'compile': {
        const failed = source.includes('broken');
        await new Promise((resolve) =>
          setTimeout(resolve, new URLSearchParams(location.search).has('slowbuild') ? 1200 : 200),
        );
        return {
          projectId: 'test',
          buildId: String(++build),
          status: failed ? 'failed' : 'succeeded',
          diagnostics: failed
            ? [{ path: 'main.tex', line: 3, message: 'Undefined control sequence' }]
            : [],
          log: failed ? 'Test error' : 'Test build complete',
          elapsedMs: 200,
        };
      }
      case 'source_location':
        if (new URLSearchParams(location.search).has('nosynctex'))
          throw new Error('This build has no SyncTeX data.');
        extraFiles.set('chapters/mapped.tex', 'First line\nSecond line\nMapped source line');
        return { path: 'chapters/mapped.tex', line: 3 };
      case 'read_artifact':
        return fixturePdf();
      case 'git_status':
        return {
          repository,
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 1,
          changes,
          remotes,
          conflicted: false,
          merging: false,
        };
      case 'git_diff':
        return '-Hello Elastic\n+Updated paper';
      case 'git_action': {
        const { action } = args as { action: string };
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (action === 'init') repository = true;
        if (action === 'commit') changes = [];
        if (action === 'pull') {
          source =
            '\\documentclass{article}\n\\begin{document}\nPulled from origin\n\\end{document}';
          version = 'pulled';
          if (new URLSearchParams(location.search).has('pullerror'))
            throw new Error('Pull interrupted after updating files');
        }
        if (action === 'fork')
          remotes.push({
            name: 'fork',
            url: 'https://github.com/me/paper.git',
            push_url: 'https://github.com/me/paper.git',
          });
        return `${action} completed`;
      }
      case 'clone_repository':
        return '/test/clones/paper';
      case 'github_account':
        return 'test-user';
      case 'cancel_git':
        return;
    }
  },
  { shouldMockEvents: true },
);
mockWindows('main');
