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
} from '../shared/contracts/backend';
import type { Documents, Document } from '../features/editor/documents';
import { Editor } from '../features/editor/Editor';
import { FileTree } from '../features/projects/FileTree';
import type { Artifact } from '../features/preview/Preview';
const Preview = lazy(() => import('../features/preview/Preview'));
const GitPanel = lazy(() => import('../features/git/GitPanel'));
import type { GitAction } from '../features/git/api';
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
}: WorkspaceProps) {
  useSyncExternalStore(documents.subscribe, documents.snapshot);
  const [active, setActive] = useState<string>();
  const [root, setRoot] = useState(initialRoot);
  const [line, setLine] = useState<number>();
  const [navigation, setNavigation] = useState(0);
  const [building, setBuilding] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitBusy, setGitBusy] = useState<GitAction | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [reloadFailed, setReloadFailed] = useState(false);
  const busy = useRef(false);
  const [result, setResult] = useState<BuildResult>();
  const [artifact, setArtifact] = useState<Artifact>();
  const [builtRevision, setBuiltRevision] = useState('');
  const [log, setLog] = useState('');
  const [panel, setPanel] = useState<'problems' | 'log' | null>(null);
  const [mode, setMode] = useState<'split' | 'source' | 'pdf'>('split');
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
    (path: string, targetLine?: number) => {
      void documents
        .open(path)
        .then(() => {
          setActive(path);
          setLine(targetLine);
          setNavigation((value) => value + 1);
        })
        .catch((reason) => onError(String(reason)));
    },
    [documents, onError],
  );
  const compile = useCallback(async () => {
    if (busy.current || reloadFailed) {
      onError('Wait for the active operation or reload files before saving and compiling.');
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
          <button onClick={() => void onOpen()} disabled={!desktop || building || !!gitBusy}>
            Open Folder…
          </button>
          <button onClick={() => void onClone()} disabled={!desktop || building || !!gitBusy}>
            Clone…
          </button>
          <button
            onClick={() => setGitOpen((value) => !value)}
            aria-pressed={gitOpen}
            disabled={!desktop || !!gitBusy}
          >
            Git
          </button>
          <button
            className="close-folder"
            onClick={() => void onCloseFolder()}
            disabled={!desktop || building || !!gitBusy}
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
              disabled={building || !!gitBusy}
              onChange={(event) => setRoot(event.target.value)}
            >
              <option value="" disabled>
                Select a root
              </option>
              {files
                .filter((file) => file.path.endsWith('.tex'))
                .map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
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
        {!gitOpen && (
          <FileTree
            key={`${project.id}:${treeVersion}`}
            api={api}
            projectId={project.id}
            active={file?.path}
            onOpen={openFile}
            onError={onError}
            disabled={building || !!gitBusy || reloadFailed}
          />
        )}
        {gitOpen && (
          <Suspense fallback={<aside className="git-panel">Loading source control…</aside>}>
            <GitPanel
              projectId={project.id}
              busy={gitBusy}
              blocked={building || reloadFailed}
              onAction={runGit}
              onClose={() => setGitOpen(false)}
            />
          </Suspense>
        )}
        <div className="workspace-main">
          <div className="workspace-toolbar">
            <span className="muted small">{file?.path ?? 'Select a source file'}</span>
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
              <div className="tabs" role="tablist">
                {files.map((tab) => (
                  <button
                    key={tab.path}
                    role="tab"
                    aria-selected={file === tab}
                    onClick={() => {
                      setActive(tab.path);
                      setLine(undefined);
                    }}
                  >
                    {tab.path.split('/').pop()}
                    {tab.revision !== tab.savedRevision && <span aria-label="unsaved"> •</span>}
                  </button>
                ))}
              </div>
              {file ? (
                <Editor
                  documents={documents}
                  file={file}
                  line={line}
                  navigation={navigation}
                  readOnly={gitBusy === 'pull' || reloadFailed}
                  onPasteImage={importImage}
                  onError={onError}
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
