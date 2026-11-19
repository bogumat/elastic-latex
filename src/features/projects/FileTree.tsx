import { memo, useEffect, useRef, useState } from 'react';
import type {
  Backend,
  Entry,
  FileOperation,
  FileBatchResult,
} from '../../shared/contracts/backend';
import { parentPath, useFileActions } from './FileActions';

interface Row extends Entry {
  depth: number;
}
export const FileTree = memo(function FileTree({
  api,
  projectId,
  projectPath,
  active,
  revealActive = true,
  onOpen,
  onError,
  onBatch,
  disabled = false,
}: {
  api: Backend;
  projectId: string;
  projectPath?: string;
  active?: string;
  revealActive?: boolean;
  onOpen: (path: string, pin?: boolean) => void;
  onError: (message: string) => void;
  onBatch: (operations: FileOperation[]) => Promise<FileBatchResult>;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [scroll, setScroll] = useState(0);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [path, setPath] = useState('');
  const [createError, setCreateError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const tree = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Row>();
  const [selectedPaths, setSelectedPaths] = useState(new Set<string>());
  const anchor = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string>();
  const dragging = useRef<string[] | undefined>(undefined);
  const epoch = useRef(0);
  async function refresh(reveal?: string) {
    const current = ++epoch.current;
    const opened = new Set(expanded);
    if (reveal) {
      const parts = reveal.split('/').slice(0, -1);
      for (let index = 1; index <= parts.length; index++)
        opened.add(parts.slice(0, index).join('/'));
    }
    const next = (await api.listEntries(projectId, '')).map((entry) => ({ ...entry, depth: 0 }));
    for (const folder of [...opened].sort((a, b) => a.split('/').length - b.split('/').length)) {
      const index = next.findIndex((entry) => entry.path === folder && entry.directory);
      if (index < 0) {
        opened.delete(folder);
        continue;
      }
      const children = await api.listEntries(projectId, folder);
      next.splice(
        index + 1,
        0,
        ...children.map((entry) => ({ ...entry, depth: next[index].depth + 1 })),
      );
    }
    if (current !== epoch.current) return;
    setRows(next);
    setSelectedPaths(
      (previous) => new Set([...previous].filter((path) => next.some((row) => row.path === path))),
    );
    setExpanded(opened);
    setSelected((previous) => next.find((entry) => entry.path === (reveal ?? previous?.path)));
    if (reveal) {
      const offset = Math.max(0, next.findIndex((entry) => entry.path === reveal) * 32 - 32);
      if (tree.current) tree.current.scrollTop = offset;
      setScroll(offset);
    }
  }
  function startCreating(kind: 'file' | 'folder', folder = '') {
    setCreating(kind);
    setPath(folder ? `${folder}/` : '');
    setCreateError('');
  }
  const actions = useFileActions({
    api,
    projectId,
    projectPath,
    disabled,
    onBatch,
    selection: rows.filter((row) => selectedPaths.has(row.path)),
    onRefresh: refresh,
    onOpen: (path) => {
      const row = rows.find((entry) => entry.path === path);
      if (row?.directory) void toggle(row);
      else onOpen(path);
    },
    onCreate: startCreating,
    onError,
  });
  function dragOver(event: React.DragEvent, folder: string) {
    if (!dragging.current?.length || disabled || actions.pending) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(folder);
  }
  function drop(event: React.DragEvent, folder: string) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(undefined);
    if (disabled || actions.pending) return;
    try {
      const data = JSON.parse(event.dataTransfer.getData('application/x-elastic-file')) as {
        projectId: string;
        paths: string[];
      };
      if (
        data.projectId !== projectId ||
        JSON.stringify(data.paths) !== JSON.stringify(dragging.current)
      )
        return;
      void actions.move(data.paths, folder);
    } catch {
      /* External drags are not file imports. */
    }
    dragging.current = undefined;
  }
  async function create() {
    if (!creating || disabled || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setCreateError('');
    const name = path.trim();
    try {
      await api.createEntry(projectId, name, creating === 'folder');
    } catch (reason) {
      setCreateError(String(reason));
      setPending(false);
      submitting.current = false;
      return;
    }
    try {
      // Reveal the new entry, including ancestors supplied in a relative path.
      const next = (await api.listEntries(projectId, '')).map((entry) => ({ ...entry, depth: 0 }));
      const ancestors = name.split('/').slice(0, -1);
      const opened = new Set<string>();
      for (let depth = 0; depth < ancestors.length; depth++) {
        const parent = ancestors.slice(0, depth + 1).join('/');
        const index = next.findIndex((entry) => entry.path === parent);
        const children = await api.listEntries(projectId, parent);
        if (index >= 0)
          next.splice(index + 1, 0, ...children.map((entry) => ({ ...entry, depth: depth + 1 })));
        opened.add(parent);
      }
      setRows(next);
      setExpanded(opened);
      const offset = Math.max(0, next.findIndex((entry) => entry.path === name) * 32 - 32);
      if (tree.current) tree.current.scrollTop = offset;
      setScroll(offset);
    } catch (reason) {
      onError(`Created ${name}, but could not refresh files: ${String(reason)}`);
    }
    if (creating === 'file') onOpen(name, true);
    setCreating(null);
    setPending(false);
    submitting.current = false;
  }
  useEffect(() => {
    void refresh(revealActive ? active : undefined).catch((reason) => onError(String(reason)));
    return () => {
      epoch.current++;
    };
  }, [api, projectId, onError, revision, active, revealActive]);
  async function toggle(row: Row) {
    if (!row.directory) return onOpen(row.path);
    if (expanded.has(row.path)) {
      setRows((previous) => previous.filter((entry) => !entry.path.startsWith(`${row.path}/`)));
      setExpanded(
        (previous) =>
          new Set(
            [...previous].filter((path) => path !== row.path && !path.startsWith(`${row.path}/`)),
          ),
      );
    } else {
      try {
        const current = epoch.current;
        const children = await api.listEntries(projectId, row.path);
        if (current !== epoch.current) return;
        setExpanded((previous) => new Set(previous).add(row.path));
        setRows((previous) => {
          // Ignore duplicate expansion requests and responses after a refresh.
          const index = previous.findIndex((entry) => entry.path === row.path);
          if (index < 0 || previous[index + 1]?.path.startsWith(`${row.path}/`)) return previous;
          return [
            ...previous.slice(0, index + 1),
            ...children.map((entry) => ({ ...entry, depth: row.depth + 1 })),
            ...previous.slice(index + 1),
          ];
        });
      } catch (error) {
        onError(String(error));
      }
    }
  }
  const start = Math.max(0, Math.floor(scroll / 32) - 5);
  return (
    <aside
      className="explorer"
      aria-label="Project files"
      onKeyDown={(event) => {
        if (!(event.target as HTMLElement).closest('.tree-row')) {
          actions.keyDown(event, selected);
          return;
        }
        const index = rows.findIndex((row) => row.path === selected?.path);
        const focus = (row: Row | undefined) => {
          if (!row) return;
          setSelected(row);
          const offset = rows.indexOf(row) * 32;
          if (
            tree.current &&
            (offset < tree.current.scrollTop ||
              offset + 32 > tree.current.scrollTop + tree.current.clientHeight)
          )
            tree.current.scrollTop = offset;
          requestAnimationFrame(() =>
            tree.current
              ?.querySelector<HTMLButtonElement>(`[title="${CSS.escape(row.path)}"]`)
              ?.focus(),
          );
        };
        if (event.key === 'ArrowDown') focus(rows[Math.min(rows.length - 1, index + 1)]);
        else if (event.key === 'ArrowUp') focus(rows[Math.max(0, index - 1)]);
        else if (event.key === 'ArrowRight' && selected?.directory && !expanded.has(selected.path))
          void toggle(selected);
        else if (event.key === 'ArrowLeft' && selected) {
          if (selected.directory && expanded.has(selected.path)) void toggle(selected);
          else focus(rows.find((row) => row.path === parentPath(selected.path)));
        } else {
          actions.keyDown(event, selected);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="pane-toolbar">
        <span>FILES</span>
        <button
          onClick={() => {
            setScroll(0);
            setRevision((r) => r + 1);
          }}
          title="Refresh files"
          aria-label="Refresh files"
        >
          ↻
        </button>
      </div>
      <div className="file-actions">
        <button
          disabled={disabled || pending || actions.pending}
          onClick={() => startCreating('file')}
        >
          Add file
        </button>
        <button
          disabled={disabled || pending || actions.pending}
          onClick={() => startCreating('folder')}
        >
          Add folder
        </button>
      </div>
      {creating && (
        <form
          className="create-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            {creating === 'file' ? 'File path' : 'Folder path'}
            <input
              key={creating}
              autoFocus
              value={path}
              disabled={pending || disabled}
              placeholder={creating === 'file' ? 'chapters/intro.tex' : 'chapters'}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !pending) setCreating(null);
              }}
            />
          </label>
          <span className="muted small">Relative to the project folder</span>
          {createError && (
            <p className="error" role="alert">
              {createError}
            </p>
          )}
          <div className="file-actions">
            <button type="submit" disabled={!path.trim() || pending || disabled}>
              {pending ? 'Creating…' : 'Create'}
            </button>
            <button type="button" disabled={pending} onClick={() => setCreating(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div
        className={`tree-root-drop ${dropTarget === '' ? 'drop-target' : ''}`}
        tabIndex={0}
        onFocus={() => {
          setSelected(undefined);
          setSelectedPaths(new Set());
        }}
        onContextMenu={(event) => actions.contextMenu(event)}
        onDragOver={(event) => dragOver(event, '')}
        onDrop={(event) => drop(event, '')}
      >
        Project folder
      </div>
      <div
        ref={tree}
        className="tree-scroll"
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
        onContextMenu={(event) => actions.contextMenu(event)}
        onDragOver={(event) => dragOver(event, '')}
        onDrop={(event) => drop(event, '')}
      >
        <div style={{ height: rows.length * 32, position: 'relative' }}>
          {rows.slice(start, start + 60).map((row, index) => (
            <button
              key={row.path}
              className={`tree-row ${selectedPaths.has(row.path) || (!selectedPaths.size && active === row.path) ? 'selected' : ''} ${actions.cutPaths?.includes(row.path) ? 'cut' : ''} ${dropTarget === row.path ? 'drop-target' : ''}`}
              style={{ top: (start + index) * 32, paddingLeft: 16 + row.depth * 16 }}
              aria-selected={selectedPaths.has(row.path)}
              onClick={(event) => {
                setSelected(row);
                if (event.shiftKey && anchor.current) {
                  const first = rows.findIndex((item) => item.path === anchor.current),
                    last = rows.indexOf(row);
                  setSelectedPaths(
                    new Set(
                      rows
                        .slice(Math.min(Math.max(0, first), last), Math.max(first, last) + 1)
                        .map((item) => item.path),
                    ),
                  );
                } else if (event.metaKey || event.ctrlKey) {
                  setSelectedPaths((previous) => {
                    const next = new Set(previous);
                    if (next.has(row.path)) next.delete(row.path);
                    else next.add(row.path);
                    return next;
                  });
                  anchor.current = row.path;
                } else {
                  setSelectedPaths(new Set([row.path]));
                  anchor.current = row.path;
                  if (!disabled && !actions.pending) void toggle(row);
                }
              }}
              onDoubleClick={() => {
                if (!row.directory) onOpen(row.path, true);
              }}
              onFocus={() => setSelected(row)}
              onContextMenu={(event) => {
                setSelected(row);
                if (!selectedPaths.has(row.path)) setSelectedPaths(new Set([row.path]));
                actions.contextMenu(event, row);
              }}
              draggable={!disabled && !pending && !actions.pending}
              onDragStart={(event) => {
                dragging.current = selectedPaths.has(row.path) ? [...selectedPaths] : [row.path];
                setSelectedPaths(new Set(dragging.current));
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(
                  'application/x-elastic-file',
                  JSON.stringify({ projectId, paths: dragging.current }),
                );
              }}
              onDragEnd={() => {
                dragging.current = undefined;
                setDropTarget(undefined);
              }}
              onDragOver={(event) =>
                dragOver(event, row.directory ? row.path : parentPath(row.path))
              }
              onDrop={(event) => drop(event, row.directory ? row.path : parentPath(row.path))}
              title={row.path}
              aria-expanded={row.directory ? expanded.has(row.path) : undefined}
            >
              <span className="file-symbol">
                {row.directory ? (expanded.has(row.path) ? '▾' : '▸') : '≡'}
              </span>
              <span>{row.name}</span>
            </button>
          ))}
        </div>
        {!rows.length && <p className="muted small tree-empty">No source files in this folder.</p>}
      </div>
      <div className="explorer-footer">LOCAL PROJECT</div>
      {actions.overlay}
    </aside>
  );
});
