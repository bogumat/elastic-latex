import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { topPaths } from './selection';
import { createPortal } from 'react-dom';
import type {
  Backend,
  Entry,
  FileAction,
  FileOperation,
  FileBatchResult,
} from '../../shared/contracts/backend';

export const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export function useFileActions({
  api,
  projectId,
  projectPath,
  disabled,
  onBatch,
  selection,
  onRefresh,
  onOpen,
  onCreate,
  onError,
}: {
  api: Backend;
  projectId: string;
  projectPath?: string;
  disabled: boolean;
  onBatch: (operations: FileOperation[]) => Promise<FileBatchResult>;
  selection: Entry[];
  onRefresh: (reveal?: string) => Promise<void>;
  onOpen: (path: string) => void;
  onCreate: (kind: 'file' | 'folder', folder: string) => void;
  onError: (message: string) => void;
}) {
  const [clipboard, setClipboard] = useState<{ paths: string[]; cut: boolean }>();
  const [menu, setMenu] = useState<{ row?: Entry; targets: Entry[]; x: number; y: number }>();
  const [renaming, setRenaming] = useState<Entry>();
  const [name, setName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const menuHost = useRef<HTMLDivElement>(null);
  const lastTarget = useRef<HTMLElement | null>(null);
  const blocked = disabled || pending;
  function closeMenu() {
    setMenu(undefined);
    lastTarget.current?.focus();
  }
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: globalThis.MouseEvent) => {
      if (!menuHost.current?.contains(event.target as Node)) setMenu(undefined);
    };
    menuHost.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    document.addEventListener('mousedown', dismiss);
    const scroll = () => setMenu(undefined);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      window.removeEventListener('resize', scroll);
    };
  }, [menu]);
  async function performMany(operations: FileOperation[]) {
    if (blocked || lock.current) return false;
    lock.current = true;
    setPending(true);
    try {
      const result = await onBatch(operations);
      for (const { action, path, destination = '' } of result.completed) {
        if (action === 'move' || action === 'trash')
          setClipboard((previous) =>
            previous
              ? {
                  ...previous,
                  paths: previous.paths.flatMap((value) => {
                    if (value !== path && !value.startsWith(`${path}/`)) return [value];
                    return action === 'trash' ? [] : [destination + value.slice(path.length)];
                  }),
                }
              : undefined,
          );
      }
      const changed = result.completed.filter((item) =>
        ['move', 'copy', 'trash'].includes(item.action),
      );
      if (changed.length) await onRefresh(changed.at(-1)?.destination);
      if (result.errors.length) throw new Error(result.errors.join('\n'));
      return true;
    } catch (reason) {
      if (renaming) setRenameError(String(reason));
      else onError(String(reason));
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const perform = (action: FileAction, path: string, destination = '') =>
    performMany([{ action, path, destination }]);
  async function availableName(path: string, folder: string, reserved = new Set<string>()) {
    const entries = await api.listEntries(projectId, folder);
    const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
    for (const value of reserved)
      if (parentPath(value) === folder) names.add(value.split('/').pop()!.toLocaleLowerCase());
    const original = path.split('/').pop()!;
    if (!names.has(original.toLocaleLowerCase())) return join(folder, original);
    const source = await api.listEntries(projectId, parentPath(path));
    const directory = source.find((entry) => entry.path === path)?.directory;
    const dot = directory ? -1 : original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const extension = dot > 0 ? original.slice(dot) : '';
    let number = 1;
    while (
      names.has(`${stem} copy${number === 1 ? '' : ` ${number}`}${extension}`.toLocaleLowerCase())
    )
      number++;
    return join(folder, `${stem} copy${number === 1 ? '' : ` ${number}`}${extension}`);
  }
  async function paste(folder: string) {
    if (!clipboard || blocked) return;
    try {
      const operations: FileOperation[] = [],
        reserved = new Set<string>();
      for (const path of topPaths(clipboard.paths)) {
        if (clipboard.cut && parentPath(path) === folder) continue;
        const destination = clipboard.cut
          ? join(folder, path.split('/').pop()!)
          : await availableName(path, folder, reserved);
        reserved.add(destination);
        operations.push({ action: clipboard.cut ? 'move' : 'copy', path, destination });
      }
      if (await performMany(operations)) {
        if (clipboard.cut) setClipboard(undefined);
      }
    } catch (reason) {
      onError(String(reason));
    }
  }
  async function duplicateMany(paths: string[]) {
    try {
      const operations: FileOperation[] = [];
      for (const path of topPaths(paths))
        operations.push({
          action: 'copy',
          path,
          destination: await availableName(path, parentPath(path)),
        });
      await performMany(operations);
    } catch (reason) {
      onError(String(reason));
    }
  }
  function rename(row: Entry) {
    setRenameError('');
    setRenaming(row);
    setName(row.name);
  }
  function keyDown(event: KeyboardEvent, row?: Entry) {
    if ((event.target as HTMLElement).closest('input, textarea') || blocked) return;
    const modifier = event.metaKey || event.ctrlKey;
    const folder = row?.directory ? row.path : parentPath(row?.path ?? '');
    const targets = row
      ? topPaths(selection.length ? selection.map((item) => item.path) : [row.path])
      : [];
    let handled = true;
    if (modifier && event.key.toLowerCase() === 'c' && row)
      setClipboard({ paths: targets, cut: false });
    else if (modifier && event.key.toLowerCase() === 'x' && row)
      setClipboard({ paths: targets, cut: true });
    else if (modifier && event.key.toLowerCase() === 'v') void paste(folder);
    else if (modifier && event.key.toLowerCase() === 'd' && row) void duplicateMany(targets);
    else if (
      (event.key === 'F2' || (!modifier && event.key === 'Enter')) &&
      row &&
      targets.length === 1
    )
      rename(row);
    else if ((event.key === 'Delete' || (event.metaKey && event.key === 'Backspace')) && row)
      void performMany(targets.map((path) => ({ action: 'trash', path })));
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function contextMenu(event: MouseEvent, row?: Entry) {
    event.preventDefault();
    event.stopPropagation();
    if (blocked) return;
    lastTarget.current = event.currentTarget as HTMLElement;
    setMenu({
      row,
      targets: row ? (selection.some((item) => item.path === row.path) ? selection : [row]) : [],
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - 230)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - 410)),
    });
  }
  const row = menu?.row;
  const targets = topPaths((menu?.targets ?? []).map((item) => item.path));
  const folder = row?.directory ? row.path : parentPath(row?.path ?? '');
  const item = (label: string, action: () => void, unavailable = false) => (
    <button
      role="menuitem"
      disabled={unavailable || blocked}
      onClick={() => {
        closeMenu();
        action();
      }}
    >
      {label}
    </button>
  );
  const overlay = (
    <>
      {menu &&
        createPortal(
          <div
            className="file-context-menu"
            role="menu"
            aria-label="File actions"
            ref={menuHost}
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              event.stopPropagation();
              const buttons = [
                ...menuHost.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                buttons[
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                ]?.focus();
              }
            }}
          >
            {row && item('Open', () => onOpen(row.path), targets.length !== 1)}
            {item(
              'Reveal in Finder',
              () => void perform('reveal', row?.path ?? ''),
              targets.length > 1,
            )}
            <hr />
            {item('New File…', () => onCreate('file', folder))}
            {item('New Folder…', () => onCreate('folder', folder))}
            <hr />
            {row && item('Cut', () => setClipboard({ paths: targets, cut: true }))}
            {row && item('Copy', () => setClipboard({ paths: targets, cut: false }))}
            {item('Paste', () => void paste(folder), !clipboard)}
            {row && item('Duplicate', () => void duplicateMany(targets))}
            {row && item('Rename…', () => rename(row), targets.length !== 1)}
            {row &&
              item(
                'Copy Relative Path',
                () => void perform('copy-relative-path', row.path),
                targets.length !== 1,
              )}
            {row &&
              projectPath &&
              item('Copy Path', () => void perform('copy-path', row.path), targets.length !== 1)}
            {row && <hr />}
            {row &&
              item(
                'Move to Trash',
                () => void performMany(targets.map((path) => ({ action: 'trash', path }))),
              )}
          </div>,
          document.body,
        )}
      {renaming &&
        createPortal(
          <div className="file-dialog-backdrop">
            <form
              role="dialog"
              aria-modal="true"
              aria-label="Rename item"
              className="file-rename-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || /[/\\]/.test(name) || name.startsWith('.')) return;
                const destination = join(parentPath(renaming.path), name.trim());
                if (destination === renaming.path) {
                  setRenaming(undefined);
                  return;
                }
                void perform('move', renaming.path, destination).then((ok) => {
                  if (ok) setRenaming(undefined);
                });
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape' && !pending) setRenaming(undefined);
              }}
            >
              <label>
                New name
                <input
                  autoFocus
                  value={name}
                  disabled={blocked}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="file-actions">
                <button
                  type="submit"
                  disabled={blocked || !name.trim() || /[/\\]/.test(name) || name.startsWith('.')}
                >
                  Rename
                </button>
                <button type="button" disabled={pending} onClick={() => setRenaming(undefined)}>
                  Cancel
                </button>
              </div>
              {renameError && (
                <p className="error" role="alert">
                  {renameError}
                </p>
              )}
            </form>
          </div>,
          document.body,
        )}
    </>
  );
  return {
    contextMenu,
    keyDown,
    overlay,
    pending,
    cutPaths: clipboard?.cut ? clipboard.paths : [],
    move: (sources: string[], target: string) =>
      performMany(
        topPaths(sources)
          .filter((path) => parentPath(path) !== target)
          .map((path) => ({
            action: 'move',
            path,
            destination: join(target, path.split('/').pop()!),
          })),
      ),
  };
}
