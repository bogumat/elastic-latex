import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { git } from './api';

export default function CloneDialog({
  onClose,
  onCloned,
  onBusy,
}: {
  onClose: () => void;
  onCloned: (path: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [fork, setFork] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function clone() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const path = await git.clone(url, parent, name, fork);
      onBusy(false);
      await onCloned(path);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog"
      aria-labelledby="clone-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void clone();
        }}
      >
        <header>
          <h2 id="clone-title">Clone from GitHub</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close clone dialog">
            ×
          </button>
        </header>
        <p className="muted">Bring a repository into a local working folder.</p>
        <label>
          Repository URL
          <input
            autoFocus
            value={url}
            disabled={busy}
            placeholder="https://github.com/owner/paper"
            required
            onChange={(event) => {
              setUrl(event.target.value);
              const candidate = event.target.value
                .trim()
                .replace(/\/$/, '')
                .split(/[/:]/)
                .pop()
                ?.replace(/\.git$/, '');
              if (candidate && /^[\w.-]+$/.test(candidate)) setName(candidate);
            }}
          />
        </label>
        <label>
          Save inside
          <div className="folder-picker">
            <input value={parent} readOnly placeholder="Choose a folder on your Mac" required />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void open({
                  directory: true,
                  multiple: false,
                  title: 'Choose where to clone the repository',
                })
                  .then((path) => {
                    if (path) setParent(path);
                  })
                  .catch((reason) => setError(String(reason)));
              }}
            >
              Choose folder…
            </button>
          </div>
        </label>
        <label>
          New working folder
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            required
          />
        </label>
        {parent && name && (
          <p className="clone-destination">
            {parent}/{name}
          </p>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fork}
            disabled={busy}
            onChange={(event) => setFork(event.target.checked)}
          />
          Create my fork on GitHub first
        </label>
        <p className="muted small">
          Private repositories and forks use your Git credentials or GitHub CLI sign-in. To connect
          an account, run <code>gh auth login --hostname github.com</code> once.
        </p>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setAccount('Checking…');
            void git
              .account()
              .then((name) => setAccount(`Signed in as ${name}`))
              .catch((reason) => setAccount(String(reason)));
          }}
        >
          Check GitHub sign-in
        </button>
        {account && (
          <p className="small git-message" role="status">
            {account}
          </p>
        )}
        {error && (
          <p className="error git-message" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            onClick={() =>
              busy ? void git.cancel().catch((reason) => setError(String(reason))) : onClose()
            }
          >
            {busy ? 'Stop cloning' : 'Cancel'}
          </button>
          <button className="primary" disabled={busy || !url.trim() || !parent || !name.trim()}>
            {busy ? 'Cloning…' : fork ? 'Fork, clone & open' : 'Clone & open'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
