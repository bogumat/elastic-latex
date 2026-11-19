import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import {
  desktop,
  type Backend,
  type BuildResult,
  type Project,
  type Toolchain,
  type FileOperation,
  type FileBatchResult,
} from '../shared/contracts/backend';
import type { Documents, Document } from '../features/editor/documents';
import { Editor } from '../features/editor/Editor';
import { EditorTabs } from '../features/editor/EditorTabs';
import { FileTree } from '../features/projects/FileTree';
import { Sidebar } from '../features/projects/Sidebar';
import { Breadcrumbs } from '../features/projects/Breadcrumbs';
import type { SourceLocation } from '../features/editor/outline';
import type { Artifact } from '../features/preview/Preview';
const Preview = lazy(() => import('../features/preview/Preview'));
const ProjectSearch = lazy(() => import('../features/projects/ProjectSearch'));
const QuickOpen = lazy(() => import('../features/projects/QuickOpen'));
const GitPanel = lazy(() => import('../features/git/GitPanel'));
import type { GitAction } from '../features/git/api';
import { darkTheme, type EditorSettings } from '../features/settings/preferences';
import { literalChanges } from '../features/projects/replace';
import { pasteImage } from '../features/editor/paste/images';

interface WorkspaceProps {
  api: Backend;
  project: Project;
  documents: Documents;
  initialRoot: string;
  toolchain?: Toolchain;
  onOpen: () => Promise<void>;
  onClone: () => Promise<void>;
  onCloseFolder: () => Promise<void>;
  onError: (message: string) => void;
  settings: EditorSettings;
  onSettings: () => void;
  control: React.RefObject<{ save: () => Promise<void>; busy: () => boolean } | null>;
}
export default function Workspace({
  api,
  project,
  documents,
  initialRoot,
  toolchain,
  onOpen,
  onClone,
  onCloseFolder,
  onError,
  control,
  settings,
  onSettings,
}: WorkspaceProps) {
  useSyncExternalStore(documents.subscribe, documents.snapshot);
  const [active, setActive] = useState<string>();
  const [root, setRoot] = useState(initialRoot);
  const [line, setLine] = useState<number>();
  const [navigation, setNavigation] = useState(0);
  const [location, setLocation] = useState<SourceLocation>({ line: 1 });
  const updateLocation = useCallback(
    (next: SourceLocation) =>
      setLocation((previous) =>
        previous.line === next.line &&
        previous.section?.title === next.section?.title &&
        previous.section?.line === next.section?.line
          ? previous
          : next,
      ),
    [],
  );
  const [building, setBuilding] = useState(false);
  const effectiveTheme = darkTheme(settings);
  useEffect(() => documents.configure(settings), [documents, settings, effectiveTheme]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitBusy, setGitBusy] = useState<GitAction | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);
  const [reloadFailed, setReloadFailed] = useState(false);
  const busy = useRef(false);
  const pendingCompile = useRef(false);
  const openSequence = useRef(0);
  const [result, setResult] = useState<BuildResult>();
  const [artifact, setArtifact] = useState<Artifact>();
  const [builtRevision, setBuiltRevision] = useState('');
  const [log, setLog] = useState('');
  const [panel, setPanel] = useState<'problems' | 'log' | null>(null);
  const [mode, setMode] = useState<'split' | 'source' | 'pdf'>(settings.defaultView);
  const files = [...documents.files.values()];
  const importImage = useCallback(
    async (image: Blob) => {
      const snippet = await pasteImage(api, documents, root, image);
      setTreeVersion((value) => value + 1);
      return snippet;
    },
    [api, documents, root],
  );
  const file = files.find((file) => file.path === active) ?? files[0];
  const saveAll = useCallback(async () => {
    if (busy.current)
      throw new Error(
        'Wait for the active build or Git operation. Your edits remain in the editor.',
      );
    await documents.saveAll();
  }, [documents]);
  useEffect(() => {
    control.current = { save: saveAll, busy: () => busy.current };
    return () => {
      control.current = null;
    };
  }, [control, saveAll]);
  const openFile = useCallback(
    (path: string, targetLine?: number, preview = false) => {
      const request = ++openSequence.current;
      void documents
        .open(path, preview)
        .then(() => {
          if (request !== openSequence.current) return;
          setActive(path);
          setLine(targetLine);
          setNavigation((value) => value + 1);
        })
        .catch((reason) => {
          if (request === openSequence.current) onError(String(reason));
        });
    },
    [documents, onError],
  );
  const compile = useCallback(async () => {
    if (reloadFailed) {
      onError('Reload files before saving and compiling. Your edits remain in the editor.');
      return;
    }
    if (busy.current) {
      pendingCompile.current = true;
      return;
    }
    busy.current = true;
    setBuilding(true);
    setLog('');
    onError('');
    documents.holdAutosave(true);
    try {
      await documents.saveAll();
      if (!root) {
        onError('Changes saved. Select a root document to compile.');
        return;
      }
      if (!toolchain?.available) {
        onError(`Changes saved. ${toolchain?.message ?? 'TeX tools are still being checked.'}`);
        return;
      }
      const revision = `${root}:${documents.revisions()}`;
      // Fetch the PDF engine while TeX is busy, never on the editor startup path.
      void import('../features/preview/Preview');
      const next = await api.compile(project.id, root, (chunk) =>
        setLog((previous) => (previous + chunk).slice(-64 * 1024)),
      );
      setResult(next);
      setLog(next.log);
      if (next.status === 'succeeded') {
        setArtifact({ projectId: project.id, buildId: next.buildId });
        setBuiltRevision(revision);
      } else if (next.status === 'failed') setPanel(next.diagnostics.length ? 'problems' : 'log');
    } catch (reason) {
      setResult(undefined);
      onError(String(reason));
    } finally {
      busy.current = false;
      setBuilding(false);
      documents.holdAutosave(false);
    }
  }, [api, documents, onError, project.id, root, toolchain, reloadFailed]);
  useEffect(() => {
    if (!building && !gitBusy && !fileBusy && !busy.current && pendingCompile.current) {
      pendingCompile.current = false;
      void compile();
    }
  }, [building, gitBusy, fileBusy, compile]);
  const runFileBatch = useCallback(
    async (operations: FileOperation[]): Promise<FileBatchResult> => {
      if (busy.current || reloadFailed)
        throw new Error('Finish the active operation before changing files.');
      busy.current = true;
      setFileBusy(true);
      documents.holdAutosave(true);
      const completed: FileOperation[] = [],
        errors: string[] = [];
      try {
        await documents.saveAll();
        for (const operation of operations) {
          const { action, path, destination = '' } = operation;
          try {
            await api.fileAction(project.id, action, path, destination);
          } catch (reason) {
            errors.push(`${path}: ${String(reason)}`);
            continue;
          }
          completed.push(operation);
          if (action === 'move' || action === 'trash') {
            const target = action === 'trash' ? null : destination;
            const remap = (value: string) =>
              value === path || value.startsWith(`${path}/`)
                ? target === null
                  ? ''
                  : target + value.slice(path.length)
                : value;
            documents.relocate(path, target);
            setRoot(remap);
            setActive((value) => (value ? remap(value) || undefined : undefined));
            setNavigation((value) => value + 1);
          }
          if (action === 'move' || action === 'copy' || action === 'trash') {
            setArtifact(undefined);
            setResult(undefined);
            setBuiltRevision('');
          }
        }
        return { completed, errors };
      } finally {
        documents.holdAutosave(false);
        busy.current = false;
        setFileBusy(false);
      }
    },
    [api, documents, project.id, reloadFailed],
  );
  async function replaceProject(
    paths: string[],
    query: string,
    replacement: string,
    sensitive: boolean,
  ) {
    if (busy.current || reloadFailed)
      throw new Error('Finish the active operation before replacing text.');
    busy.current = true;
    setFileBusy(true);
    documents.holdAutosave(true);
    try {
      const plans = [];
      for (const path of paths) {
        const file = await documents.open(path);
        plans.push({
          file,
          changes: literalChanges(file.state.sliceDoc(), query, replacement, sensitive),
        });
      }
      let count = 0;
      for (const { file, changes } of plans)
        if (changes.length) {
          count += changes.length;
          documents.edit(file, { changes, userEvent: 'input.replace.all' });
        }
      await documents.saveAll();
      return count;
    } finally {
      documents.holdAutosave(false);
      busy.current = false;
      setFileBusy(false);
    }
  }
  const refreshBuffers = useCallback(async () => {
    try {
      await documents.reloadSaved((paths) => api.reloadFiles(project.id, paths));
      setRoot((previous) => (documents.files.has(previous) ? previous : ''));
      setReloadFailed(false);
      setTreeVersion((value) => value + 1);
      documents.holdAutosave(false);
      setArtifact(undefined);
      setResult(undefined);
      setBuiltRevision('');
    } catch (reason) {
      setReloadFailed(true);
      throw reason;
    }
  }, [api, documents, project.id]);
  const runGit = useCallback(
    async (action: GitAction, remote: string, message: string) => {
      if (busy.current || reloadFailed)
        throw new Error('Finish the active operation or reload files before using Git.');
      busy.current = true;
      setGitBusy(action);
      documents.holdAutosave(true);
      let attempted = false;
      try {
        await documents.saveAll();
        const { git } = await import('../features/git/api');
        attempted = true;
        return await git.action(project.id, action, remote, message);
      } finally {
        let reloaded = true;
        try {
          // Cancellation/failure can occur after Git changes files. Always reconcile a pull.
          if (action === 'pull' && attempted) await refreshBuffers();
        } catch (reason) {
          reloaded = false;
          throw reason;
        } finally {
          busy.current = false;
          setGitBusy(null);
          documents.holdAutosave(!reloaded);
        }
      }
    },
    [documents, project.id, refreshBuffers, reloadFailed],
  );
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarHidden((value) => !value);
        return;
      }
      if (event.key.toLowerCase() === 'f' && event.shiftKey) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!event.repeat) void compile();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void compile();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [compile]);
  const freshness = !artifact
    ? 'No preview yet'
    : result?.status !== 'succeeded'
      ? 'Earlier successful build'
      : builtRevision !== `${root}:${documents.revisions()}`
        ? 'PDF out of date'
        : 'Last build succeeded';
  async function exportPdf() {
    if (!artifact) return;
    try {
      const destination = await save({
        defaultPath: `${root
          .replace(/\.tex$/, '')
          .split('/')
          .pop()}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (destination) await api.exportPdf(project.id, artifact.buildId, destination);
    } catch (reason) {
      onError(String(reason));
    }
  }
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">e</span>
          <strong>Elastic</strong>
          <span className="header-divider" />
          <span title={project.path}>{project.name}</span>
        </div>
        <div className="header-actions">
          <button
            onClick={() => void onOpen()}
            disabled={!desktop || building || !!gitBusy || fileBusy}
          >
            Open Folder…
          </button>
          <button
            onClick={() => void onClone()}
            disabled={!desktop || building || !!gitBusy || fileBusy}
          >
            Clone…
          </button>
          <button
            onClick={() => setGitOpen((value) => !value)}
            aria-pressed={gitOpen}
            disabled={!desktop || !!gitBusy || fileBusy}
          >
            Git
          </button>
          <button aria-label="Settings" title="Settings (⌘,)" onClick={onSettings}>
            ⚙
          </button>
          <button
            className="close-folder"
            onClick={() => void onCloseFolder()}
            disabled={!desktop || building || !!gitBusy || fileBusy}
            title="Close working folder"
            aria-label="Close working folder"
          >
            ×
          </button>
          <label className="root-picker">
            Root{' '}
            <select
              aria-label="Root document"
              value={root}
              disabled={building || !!gitBusy || fileBusy}
              onChange={(event) => setRoot(event.target.value)}
            >
              <option value="" disabled>
                Select a root
              </option>
              {[...new Set([root, ...files.map((file) => file.path)])]
                .filter(Boolean)
                .filter((path) => path.endsWith('.tex'))
                .map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="primary compile"
            disabled={!!gitBusy || reloadFailed || (!building && (!toolchain?.available || !root))}
            title={toolchain?.message}
            onClick={() =>
              building
                ? void api.cancel().catch((reason) => onError(String(reason)))
                : void compile()
            }
          >
            {building ? '■ Stop build' : '▷ Compile'}
          </button>
          <button disabled={!artifact} onClick={() => void exportPdf()}>
            Export PDF
          </button>
        </div>
      </header>
      {!desktop && <div className="demo-banner">{toolchain?.message}</div>}
      {desktop && toolchain && !toolchain.available && (
        <div className="demo-banner">{toolchain.message}</div>
      )}
      {reloadFailed && (
        <div className="demo-banner error" role="alert">
          Files could not be refreshed after Git changed the folder. Editing and builds are paused
          to protect your buffers.{' '}
          <button onClick={() => void refreshBuffers().catch((reason) => onError(String(reason)))}>
            Retry reload
          </button>
        </div>
      )}
      <div className="workspace">
        <Sidebar hidden={sidebarHidden}>
          {!gitOpen && (
            <FileTree
              key={`${project.id}:${treeVersion}`}
              api={api}
              projectId={project.id}
              projectPath={project.path}
              active={file?.path}
              onOpen={(path, pin) => openFile(path, undefined, settings.previewTabs && !pin)}
              revealActive={settings.revealActive}
              onError={onError}
              onBatch={runFileBatch}
              disabled={building || !!gitBusy || fileBusy || reloadFailed}
            />
          )}
          {gitOpen && (
            <Suspense fallback={<aside className="git-panel">Loading source control…</aside>}>
              <GitPanel
                projectId={project.id}
                busy={gitBusy}
                blocked={building || fileBusy || reloadFailed}
                onAction={runGit}
                onClose={() => setGitOpen(false)}
              />
            </Suspense>
          )}
        </Sidebar>
        <div className="workspace-main">
          <div className="workspace-toolbar">
            <button
              aria-label="Toggle sidebar"
              aria-pressed={!sidebarHidden}
              title="Toggle sidebar (⌘B)"
              onClick={() => setSidebarHidden((value) => !value)}
            >
              ☰
            </button>
            <Breadcrumbs
              api={api}
              project={project}
              path={file?.path}
              location={location}
              onOpen={openFile}
            />
            <button onClick={() => setSearchOpen(true)} title="Search project (⌘⇧F)">
              Search
            </button>
            <button onClick={() => setQuickOpen(true)} title="Quick Open (⌘P)">
              Quick Open
            </button>
            <div className="view-switch" aria-label="Workspace view">
              {(['source', 'split', 'pdf'] as const).map((view) => (
                <button key={view} aria-pressed={mode === view} onClick={() => setMode(view)}>
                  {view === 'pdf' ? 'PDF' : view[0].toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={`panes mode-${mode}`}>
            <section className="source-pane" aria-label="Source">
              <EditorTabs
                documents={documents}
                active={file}
                disabled={building || !!gitBusy || fileBusy || reloadFailed}
                onSelect={(path) => {
                  setActive(path || undefined);
                  setLine(undefined);
                  setNavigation((value) => value + 1);
                }}
                onError={onError}
              />
              {file ? (
                <Editor
                  documents={documents}
                  file={file}
                  line={line}
                  navigation={navigation}
                  readOnly={gitBusy === 'pull' || fileBusy || reloadFailed}
                  onPasteImage={importImage}
                  onError={onError}
                  onLocation={updateLocation}
                />
              ) : (
                <div className="empty-state">
                  <h2>Your project is open.</h2>
                  <p>Select a source file to begin.</p>
                </div>
              )}
            </section>
            <Divider />
            <div className="preview-pane">
              {artifact ? (
                <Suspense fallback={<div className="empty-state">Loading PDF tools…</div>}>
                  <Preview
                    api={api}
                    artifact={artifact}
                    active={mode !== 'source'}
                    defaultZoom={settings.pdfZoom}
                    onSource={(path, line) => {
                      if (mode === 'pdf') setMode('split');
                      if (builtRevision !== `${root}:${documents.revisions()}`)
                        onError(
                          'Source changed since this PDF was built. Compile again for accurate navigation.',
                        );
                      openFile(path, line);
                    }}
                  />
                </Suspense>
              ) : (
                <>
                  <div className="pane-toolbar">
                    <span>PDF PREVIEW</span>
                    <span className="muted">{building ? 'Compiling…' : 'Waiting for a build'}</span>
                  </div>
                  <div className="empty-state">
                    <div className="paper-outline">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <h2>Your words, on paper.</h2>
                    <p>
                      {building
                        ? 'TeX is preparing your document. Keep writing.'
                        : 'Compile your root document to see it here.'}
                    </p>
                    <span className="key-hint">⌘ ↵</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="build-panel">
            <div className="panel-tabs">
              <button
                aria-expanded={panel === 'problems'}
                onClick={() => setPanel(panel === 'problems' ? null : 'problems')}
              >
                Problems <span className="count">{result?.diagnostics.length ?? 0}</span>
              </button>
              <button
                aria-expanded={panel === 'log'}
                onClick={() => setPanel(panel === 'log' ? null : 'log')}
              >
                Build log
              </button>
              <span className="panel-status">
                {building
                  ? 'Building locally…'
                  : result
                    ? `${result.status} · ${(result.elapsedMs / 1000).toFixed(2)} s`
                    : 'Ready when you are'}
              </span>
            </div>
            {panel === 'log' && (
              <pre className="build-log" tabIndex={0}>
                {log || 'Compiler output will appear here.'}
              </pre>
            )}
            {panel === 'problems' && (
              <div className="problems">
                {result?.diagnostics.length ? (
                  result.diagnostics.map((diagnostic, index) => (
                    <button key={index} onClick={() => openFile(diagnostic.path, diagnostic.line)}>
                      <span>
                        {diagnostic.path}:{diagnostic.line}
                      </span>
                      {diagnostic.message}
                    </button>
                  ))
                ) : (
                  <p>No compiler diagnostics.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        {searchOpen && (
          <ProjectSearch
            api={api}
            documents={documents}
            blocked={building || !!gitBusy || fileBusy || reloadFailed}
            onOpen={openFile}
            onReplace={replaceProject}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {quickOpen && (
          <QuickOpen
            api={api}
            projectId={project.id}
            onOpen={openFile}
            onClose={() => setQuickOpen(false)}
          />
        )}
      </Suspense>
      <footer className="status-bar">
        <SaveIndicator file={file} building={building || !!gitBusy} />
        <span>{freshness}</span>
        <span className="muted">
          {desktop ? 'Local · pdfLaTeX' : 'Browser sample'}
          <span className="status-divider">|</span>UTF-8
        </span>
      </footer>
    </>
  );
}

function SaveIndicator({ file, building }: { file?: Document; building: boolean }) {
  const status = file?.status ?? 'saved';
  return (
    <span className={status === 'error' ? 'error' : ''} role="status" title={file?.error}>
      <span className={`status-dot ${status}`} />
      {status === 'error'
        ? `Save failed: ${file?.error}`
        : status === 'saving'
          ? 'Saving…'
          : status === 'unsaved'
            ? building
              ? 'Unsaved · saves after build'
              : 'Unsaved'
            : 'Saved'}
    </span>
  );
}

function Divider() {
  const frame = useRef(0);
  const position = useRef(50);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  function update(element: HTMLElement, clientX: number) {
    const parent = element.parentElement!;
    const bounds = parent.getBoundingClientRect();
    position.current = Math.min(75, Math.max(25, ((clientX - bounds.left) / bounds.width) * 100));
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      parent.style.setProperty('--split', `${position.current}%`);
      element.setAttribute('aria-valuenow', String(Math.round(position.current)));
    });
  }
  return (
    <div
      className="divider"
      role="separator"
      aria-label="Source and PDF divider"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={50}
      tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          update(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        update(
          event.currentTarget,
          bounds.left +
            (bounds.width * (position.current + (event.key === 'ArrowLeft' ? -2 : 2))) / 100,
        );
      }}
    />
  );
}
