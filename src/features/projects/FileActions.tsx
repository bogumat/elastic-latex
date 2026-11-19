import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Backend, Entry, FileAction } from '../../shared/contracts/backend';

export const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export function useFileActions({
  api,
  projectId,
  projectPath,
  disabled,
  onAction,
  onRefresh,
  onOpen,
  onCreate,
  onError,
}: {
  api: Backend;
  projectId: string;
  projectPath?: string;
  disabled: boolean;
  onAction: (action: FileAction, path: string, destination?: string) => Promise<void>;
  onRefresh: (reveal?: string) => Promise<void>;
  onOpen: (path: string) => void;
  onCreate: (kind: 'file' | 'folder', folder: string) => void;
  onError: (message: string) => void;
}) {
  const [clipboard, setClipboard] = useState<{ path: string; cut: boolean }>();
  const [menu, setMenu] = useState<{ row?: Entry; x: number; y: number }>();
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
  async function perform(action: FileAction, path: string, destination = '') {
    if (blocked || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      await onAction(action, path, destination);
      if (action === 'move' || action === 'trash')
        setClipboard((previous) => {
          if (!previous || (previous.path !== path && !previous.path.startsWith(`${path}/`)))
            return previous;
          return action === 'trash'
            ? undefined
            : { ...previous, path: destination + previous.path.slice(path.length) };
        });
      if (action === 'move' || action === 'copy' || action === 'trash')
        await onRefresh(destination || undefined);
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
  async function availableName(path: string, folder: string) {
    const entries = await api.listEntries(projectId, folder);
    const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
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
      if (clipboard.cut && parentPath(clipboard.path) === folder) {
        setClipboard(undefined);
        return;
      }
      const destination = clipboard.cut
        ? join(folder, clipboard.path.split('/').pop()!)
        : await availableName(clipboard.path, folder);
      if (await perform(clipboard.cut ? 'move' : 'copy', clipboard.path, destination)) {
        if (clipboard.cut) setClipboard(undefined);
      }
    } catch (reason) {
      onError(String(reason));
    }
  }
  function rename(row: Entry) {
    setRenameError('');
    setRenaming(row);
    setName(row.name);
  }
  async function duplicate(row: Entry) {
    try {
      await perform('copy', row.path, await availableName(row.path, parentPath(row.path)));
    } catch (reason) {
      onError(String(reason));
    }
  }
  function keyDown(event: KeyboardEvent, row?: Entry) {
    if ((event.target as HTMLElement).closest('input, textarea') || blocked) return;
    const modifier = event.metaKey || event.ctrlKey;
    const folder = row?.directory ? row.path : parentPath(row?.path ?? '');
    let handled = true;
    if (modifier && event.key.toLowerCase() === 'c' && row)
      setClipboard({ path: row.path, cut: false });
    else if (modifier && event.key.toLowerCase() === 'x' && row)
      setClipboard({ path: row.path, cut: true });
    else if (modifier && event.key.toLowerCase() === 'v') void paste(folder);
    else if (modifier && event.key.toLowerCase() === 'd' && row) void duplicate(row);
    else if ((event.key === 'F2' || (!modifier && event.key === 'Enter')) && row) rename(row);
    else if ((event.key === 'Delete' || (event.metaKey && event.key === 'Backspace')) && row)
      void perform('trash', row.path);
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
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - 230)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - 410)),
    });
  }
  const row = menu?.row;
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
            {row && item('Open', () => onOpen(row.path))}
            {item('Reveal in Finder', () => void perform('reveal', row?.path ?? ''))}
            <hr />
            {item('New File…', () => onCreate('file', folder))}
            {item('New Folder…', () => onCreate('folder', folder))}
            <hr />
            {row && item('Cut', () => setClipboard({ path: row.path, cut: true }))}
            {row && item('Copy', () => setClipboard({ path: row.path, cut: false }))}
            {item('Paste', () => void paste(folder), !clipboard)}
            {row && item('Duplicate', () => void duplicate(row))}
            {row && item('Rename…', () => rename(row))}
            {row && item('Copy Relative Path', () => void perform('copy-relative-path', row.path))}
            {row && projectPath && item('Copy Path', () => void perform('copy-path', row.path))}
            {row && <hr />}
            {row && item('Move to Trash', () => void perform('trash', row.path))}
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
    cutPath: clipboard?.cut ? clipboard.path : undefined,
    move: (source: string, target: string) =>
      perform('move', source, join(target, source.split('/').pop()!)),
  };
}
