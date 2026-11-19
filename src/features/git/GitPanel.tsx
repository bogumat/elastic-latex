import { useCallback, useEffect, useRef, useState } from 'react';
import { git, type GitAction, type GitStatus } from './api';

export default function GitPanel({
  projectId,
  busy,
  blocked,
  onAction,
  onClose,
}: {
  projectId: string;
  busy: GitAction | null;
  blocked: boolean;
  onAction: (action: GitAction, remote: string, message: string) => Promise<string>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<GitStatus>();
  const [remote, setRemote] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState('');
  const [diff, setDiff] = useState('');
  const [page, setPage] = useState(0);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await git.status(projectId);
      setStatus(next);
      setRemote((previous) =>
        next.remotes.some((item) => item.name === previous)
          ? previous
          : (next.remotes[0]?.name ?? ''),
      );
      setPage(0);
      setError('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [refresh]);
  async function run(action: GitAction) {
    setNotice('');
    setError('');
    request.current++;
    setDiff('');
    setSelected('');
    try {
      const output = await onAction(action, remote, message);
      setNotice(output || `${action[0].toUpperCase() + action.slice(1)} completed.`);
      if (action === 'commit') setMessage('');
      await refresh();
      if (action === 'fork') setRemote('fork');
    } catch (reason) {
      await refresh();
      setError(String(reason));
    }
  }
  const disabled = blocked || busy !== null || refreshing;
  const selectedRemote = status?.remotes.find((item) => item.name === remote);
  return (
    <aside className="git-panel" aria-label="Source control">
      <header className="pane-toolbar">
        <strong>SOURCE CONTROL</strong>
        <div>
          <button
            disabled={disabled}
            onClick={() => void refresh()}
            aria-label="Refresh Git status"
          >
            ↻
          </button>
          <button disabled={!!busy} onClick={onClose} aria-label="Close source control">
            ×
          </button>
        </div>
      </header>
      <div className="git-content">
        {status?.repository ? (
          <>
            <div className="git-branch">
              <strong>{status.branch ?? 'Detached HEAD'}</strong>
              <span>
                {status.ahead} ↑ · {status.behind} ↓
              </span>
            </div>
            <p className="muted small">
              {status.upstream
                ? `Tracking ${status.upstream} · counts from last fetch`
                : 'No tracking branch yet'}
            </p>
            {(status.conflicted || status.merging) && (
              <p className="error">
                A merge or rebase needs attention. Resolve it in a Git client or terminal, then
                refresh.
              </p>
            )}
            <label>
              Remote
              <select
                aria-label="Git remote"
                value={remote}
                onChange={(event) => setRemote(event.target.value)}
                disabled={disabled}
              >
                <option value="" disabled>
                  Select a remote
                </option>
                {status.remotes.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedRemote && (
              <div className="remote-detail">
                <span>
                  Pull: {selectedRemote.url} · {status.branch}
                </span>
                <span>
                  Push: {selectedRemote.push_url} · {status.branch}
                </span>
              </div>
            )}
            <div className="git-actions">
              <button disabled={disabled || !remote} onClick={() => void run('fetch')}>
                Fetch
              </button>
              <button
                disabled={disabled || !remote || !status.branch}
                onClick={() => void run('pull')}
              >
                Pull
              </button>
              <button
                disabled={disabled || !remote || !status.branch}
                onClick={() => void run('push')}
              >
                Push
              </button>
            </div>
            <button
              className="fork-button"
              disabled={disabled || !remote}
              onClick={() => void run('fork')}
            >
              Fork on GitHub
            </button>
            <p className="muted small">
              Pull fast-forwards this branch from the selected remote. Fork adds a separate{' '}
              <code>fork</code> remote.
            </p>
            <h3>
              Changes <span className="count">{status.changes.length}</span>
            </h3>
            <div className="git-changes">
              {status.changes.slice(page * 100, page * 100 + 100).map((change) => (
                <button
                  key={`${change.index}${change.worktree}:${change.path}`}
                  disabled={disabled}
                  className={selected === change.path ? 'selected' : ''}
                  onClick={() => {
                    setSelected(change.path);
                    setDiff('Loading diff…');
                    const id = ++request.current;
                    void git
                      .diff(projectId, change.path)
                      .then((text) => {
                        if (id === request.current)
                          setDiff(
                            text ||
                              'No text diff (the file may be binary or only its metadata changed).',
                          );
                      })
                      .catch((reason) => {
                        if (id === request.current) setDiff(String(reason));
                      });
                  }}
                >
                  <code>
                    {change.index}
                    {change.worktree}
                  </code>
                  <span>{change.path}</span>
                </button>
              ))}
            </div>
            {!status.changes.length && <p className="muted">Working folder is clean.</p>}
            {status.changes.length > 100 && (
              <div className="git-actions">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>
                  {page + 1} / {Math.ceil(status.changes.length / 100)}
                </span>
                <button
                  disabled={(page + 1) * 100 >= status.changes.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
            {selected && (
              <details open className="diff-details">
                <summary>{selected}</summary>
                <pre tabIndex={0} className="git-diff">
                  {diff}
                </pre>
              </details>
            )}
            <label>
              Commit message
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={disabled}
                rows={2}
                placeholder="Describe your changes"
                maxLength={10000}
              />
            </label>
            <button
              className="primary"
              disabled={
                disabled ||
                !message.trim() ||
                !status.changes.length ||
                status.conflicted ||
                status.merging
              }
              onClick={() => void run('commit')}
            >
              Commit all changes
            </button>
            <p className="muted small">
              Includes staged, modified, deleted, and untracked files in the working folder. Ignored
              files are excluded. Push publishes committed changes.
            </p>
          </>
        ) : status ? (
          <>
            <h3>This folder is not using Git yet.</h3>
            <p className="muted">Create a local repository to start keeping a history.</p>
            <button className="primary" disabled={disabled} onClick={() => void run('init')}>
              Initialize repository
            </button>
          </>
        ) : (
          !error && <p>Reading repository…</p>
        )}
        {busy && (
          <div className="git-progress" role="status">
            <span>
              {busy === 'fork'
                ? 'Creating fork…'
                : `${busy[0].toUpperCase() + busy.slice(1)} in progress…`}
            </span>
            <button onClick={() => void git.cancel().catch((reason) => setError(String(reason)))}>
              Stop
            </button>
          </div>
        )}
        {notice && (
          <p className="git-message" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="git-message error" role="alert">
            {error}
          </p>
        )}
        <details className="git-auth">
          <summary>GitHub connection</summary>
          <p className="small muted">
            Elastic reuses Git credentials and GitHub CLI. Sign in once with{' '}
            <code>gh auth login --hostname github.com</code>.
          </p>
          <button
            disabled={disabled}
            onClick={() => {
              void git
                .account()
                .then((name) => setNotice(`Signed in as ${name}`))
                .catch((reason) => setError(String(reason)));
            }}
          >
            Check GitHub sign-in
          </button>
        </details>
      </div>
    </aside>
  );
}
