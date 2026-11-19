import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  backend,
  desktop,
  type Backend,
  type Project,
  type Toolchain,
  recentProjects,
  type RecentProject,
} from '../shared/contracts/backend';
import { loadSettings, darkTheme, darkPdfTheme } from '../features/settings/preferences';
import type { Documents } from '../features/editor/documents';

const Settings = lazy(() => import('../features/settings/Settings'));
const Workspace = lazy(() => import('./Workspace'));
const CloneDialog = lazy(() => import('../features/git/CloneDialog'));

export default function App() {
  const [api, setApi] = useState<Backend>(backend);
  const [project, setProject] = useState<Project>();
  const [documents, setDocuments] = useState<Documents>();
  const [toolchain, setToolchain] = useState<Toolchain>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemTheme, setSystemTheme] = useState(0);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme((value) => value + 1);
    const keys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    media.addEventListener('change', update);
    window.addEventListener('keydown', keys);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('keydown', keys);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = darkTheme(settings) ? 'dark' : 'light';
    document.documentElement.dataset.pdfTheme = darkPdfTheme(settings) ? 'dark' : 'light';
    try {
      localStorage.setItem('elastic.settings', JSON.stringify(settings));
    } catch {
      setError('Settings could not be persisted. They still apply to this session.');
    }
  }, [settings, systemTheme]);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [initialRoot, setInitialRoot] = useState('main.tex');
  const [session, setSession] = useState(0);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [cloning, setCloning] = useState(false);
  const cloneBusy = useRef(false);
  const onCloneBusy = useCallback((busy: boolean) => {
    cloneBusy.current = busy;
  }, []);
  const workspace = useRef<{ save: () => Promise<void>; busy: () => boolean }>(null);
  useEffect(() => {
    let current = true;
    if (!desktop) {
      void import('./demo').then(async ({ demo }) => {
        const { Documents } = await import('../features/editor/documents');
        const project = await demo.openProject('');
        const docs = new Documents(project.id, demo);
        await docs.open('main.tex');
        if (current) {
          setApi(demo);
          setProject(project);
          setDocuments(docs);
          setToolchain(await demo.toolchain());
        } else docs.dispose();
      });
    } else {
      void recentProjects()
        .then((items) => {
          if (current) setRecent(items);
        })
        .catch((reason) => setError(String(reason)));
      void backend
        .toolchain()
        .then((status) => {
          if (current) setToolchain(status);
        })
        .catch((reason) => setError(String(reason)));
    }
    return () => {
      current = false;
    };
  }, []);
  const openProject = useCallback(
    async (selectedPath?: string) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setOpening(true);
      try {
        if (workspace.current?.busy() || cloneBusy.current)
          throw new Error('Wait for the active operation before switching projects.');
        await workspace.current?.save();
        const path =
          selectedPath ??
          (await open({ directory: true, multiple: false, title: 'Open working folder' }));
        if (!path) return;
        await workspace.current?.save();
        const [{ Documents }, next] = await Promise.all([
          import('../features/editor/documents'),
          api.openProject(path),
          import('./Workspace'),
        ]);
        const docs = new Documents(next.id, api);
        let warning = '';
        const entries = await api.listEntries(next.id, '').catch((reason) => {
          warning = String(reason);
          return [];
        });
        const candidates = entries.filter(
          (entry) => !entry.directory && entry.path.endsWith('.tex'),
        );
        const root =
          entries.find((entry) => entry.path === 'main.tex') ??
          (candidates.length === 1 ? candidates[0] : undefined);
        documents?.dispose();
        setInitialRoot(root?.path ?? '');
        setProject(next);
        setDocuments(docs);
        setSession((value) => value + 1);
        setError(warning);
        if (root) await docs.open(root.path);
        if (desktop) setRecent(await recentProjects());
      } catch (reason) {
        setError(String(reason));
      } finally {
        setOpening(false);
        openingRef.current = false;
      }
    },
    [api, documents],
  );
  const showClone = useCallback(async () => {
    try {
      if (workspace.current?.busy() || openingRef.current)
        throw new Error('Wait for the active operation before cloning.');
      await workspace.current?.save();
      setCloning(true);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);
  const closeFolder = useCallback(async () => {
    try {
      if (workspace.current?.busy() || cloneBusy.current || openingRef.current)
        throw new Error('Wait for the active operation before closing the folder.');
      await workspace.current?.save();
      documents?.dispose();
      setDocuments(undefined);
      setProject(undefined);
    } catch (reason) {
      setError(String(reason));
    }
  }, [documents]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o' && desktop) {
        event.preventDefault();
        void openProject();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [openProject]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          if (workspace.current?.busy() || cloneBusy.current || openingRef.current)
            throw new Error('Stop the active operation before closing Elastic.');
          await workspace.current?.save();
          await getCurrentWindow().destroy();
        } catch (reason) {
          setError(String(reason));
        }
      })
      .then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return (
    <main className="app">
      {documents && project ? (
        <Suspense fallback={<div className="empty-state">Opening your workspace…</div>}>
          <Workspace
            key={`${project.id}:${session}`}
            api={api}
            project={project}
            documents={documents}
            initialRoot={initialRoot}
            toolchain={toolchain}
            onOpen={openProject}
            onClone={showClone}
            onCloseFolder={closeFolder}
            onError={setError}
            control={workspace}
            settings={settings}
            onSettings={() => setSettingsOpen(true)}
          />
        </Suspense>
      ) : (
        <>
          <header className="app-header">
            <div className="brand">
              <span className="brand-mark">e</span>
              <strong>Elastic</strong>
            </div>
            <button
              aria-label="Settings"
              title="Settings (⌘,)"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          </header>
          <section className="welcome">
            <div className="welcome-actions">
              <button className="primary" onClick={() => void openProject()} disabled={opening}>
                {opening ? 'Opening…' : 'Open Folder…'}
              </button>
              <button className="secondary" onClick={() => void showClone()} disabled={opening}>
                Clone from GitHub…
              </button>
            </div>
            {!!recent.length && (
              <div className="recent-projects">
                <h2>Recent folders</h2>
                {recent.slice(0, 5).map((item) => (
                  <button
                    key={item.path}
                    disabled={opening}
                    onClick={() => void openProject(item.path)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.path}</span>
                  </button>
                ))}
              </div>
            )}
            {toolchain && !toolchain.available && (
              <p className="toolchain-message">{toolchain.message}</p>
            )}
          </section>
        </>
      )}
      <Suspense fallback={null}>
        {settingsOpen && (
          <Settings
            value={settings}
            onChange={setSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </Suspense>
      {cloning && (
        <Suspense fallback={null}>
          <CloneDialog
            onClose={() => setCloning(false)}
            onCloned={(path) => openProject(path)}
            onBusy={onCloneBusy}
          />
        </Suspense>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
    </main>
  );
}
