import { useEffect, useState } from 'react';
import type { Backend, SearchResults } from '../../shared/contracts/backend';
import type { Documents } from '../editor/documents';
import { Modal } from '../../shared/Modal';

export default function ProjectSearch({
  api,
  documents,
  blocked,
  onOpen,
  onReplace,
  onClose,
}: {
  api: Backend;
  documents: Documents;
  blocked: boolean;
  onOpen: (path: string, line: number) => void;
  onReplace: (
    paths: string[],
    query: string,
    replacement: string,
    sensitive: boolean,
  ) => Promise<number>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [replacement, setReplacement] = useState(''),
    [sensitive, setSensitive] = useState(false);
  const [result, setResult] = useState<SearchResults>(),
    [loading, setLoading] = useState(false),
    [working, setWorking] = useState(false),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setResult(undefined);
    setError('');
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const overlays = Object.fromEntries(
        [...documents.files.values()].map((file) => [file.path, file.state.sliceDoc()]),
      );
      void api
        .searchProject(documents.projectId, query, sensitive, overlays)
        .then((result) => {
          if (current) setResult(result);
        })
        .catch((reason) => {
          if (current) setError(String(reason));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, documents, query, sensitive, refresh]);
  const groups = new Map<string, SearchResults['hits']>();
  for (const hit of result?.hits ?? [])
    groups.set(hit.path, [...(groups.get(hit.path) ?? []), hit]);
  return (
    <Modal
      title="Search project"
      onClose={() => {
        if (!working) onClose();
      }}
    >
      <label>
        Find
        <input
          autoFocus
          data-autofocus
          value={query}
          disabled={working}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage('');
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={sensitive}
          disabled={working}
          onChange={(event) => setSensitive(event.target.checked)}
        />{' '}
        Match case
      </label>
      <label>
        Replace with
        <input
          value={replacement}
          disabled={working}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </label>
      <button
        disabled={
          blocked || loading || working || !groups.size || result?.limited || !!result?.skipped
        }
        onClick={() => {
          setWorking(true);
          setError('');
          void onReplace([...groups.keys()], query, replacement, sensitive)
            .then((count) => {
              setMessage(`Replaced ${count} occurrences in ${groups.size} files.`);
              setRefresh((value) => value + 1);
            })
            .catch((reason) => setError(String(reason)))
            .finally(() => setWorking(false));
        }}
      >
        Replace All in {groups.size} files
      </button>
      {loading && <p role="status">Searching…</p>}
      {result && (
        <p>
          {result.hits.length} matching lines in {groups.size} files
        </p>
      )}
      {result?.limited && (
        <p role="alert">Search reached its limit. Narrow the query before replacing.</p>
      )}
      {!!result?.skipped && (
        <p role="alert">{result.skipped} files could not be read. Replace All is disabled.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="project-search-results">
        {[...groups].map(([path, hits]) => (
          <section key={path}>
            <h3>{path}</h3>
            {hits.map((hit) => (
              <button
                key={hit.line}
                onClick={() => {
                  onOpen(path, hit.line);
                  onClose();
                }}
              >
                <strong>{hit.line}</strong> {hit.text}
              </button>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
