import { memo, useEffect, useRef, useState } from 'react';
import type { Backend, Entry } from '../../shared/contracts/backend';

interface Row extends Entry {
  depth: number;
}
export const FileTree = memo(function FileTree({
  api,
  projectId,
  active,
  onOpen,
  onError,
  disabled = false,
}: {
  api: Backend;
  projectId: string;
  active?: string;
  onOpen: (path: string) => void;
  onError: (message: string) => void;
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
  function startCreating(kind: 'file' | 'folder') {
    setCreating(kind);
    setPath('');
    setCreateError('');
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
    if (creating === 'file') onOpen(name);
    setCreating(null);
    setPending(false);
    submitting.current = false;
  }
  useEffect(() => {
    let current = true;
    api
      .listEntries(projectId, '')
      .then((entries) => {
        if (current) {
          setRows(entries.map((entry) => ({ ...entry, depth: 0 })));
          setExpanded(new Set());
        }
      })
      .catch((error) => {
        if (current) onError(String(error));
      });
    return () => {
      current = false;
    };
  }, [api, projectId, onError, revision]);
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
        const children = await api.listEntries(projectId, row.path);
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
    <aside className="explorer" aria-label="Project files">
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
        <button disabled={disabled || pending} onClick={() => startCreating('file')}>
          Add file
        </button>
        <button disabled={disabled || pending} onClick={() => startCreating('folder')}>
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
        ref={tree}
        className="tree-scroll"
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * 32, position: 'relative' }}>
          {rows.slice(start, start + 60).map((row, index) => (
            <button
              key={row.path}
              className={`tree-row ${active === row.path ? 'selected' : ''}`}
              style={{ top: (start + index) * 32, paddingLeft: 16 + row.depth * 16 }}
              onClick={() => void toggle(row)}
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
    </aside>
  );
});
