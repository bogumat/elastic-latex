import { useEffect, useState } from 'react';
import type { Backend } from '../../shared/contracts/backend';
import { Modal } from '../../shared/Modal';

export function fuzzyScore(path: string, query: string) {
  const text = path.toLowerCase(),
    search = query.toLowerCase().trim();
  let previous = -1,
    score = 0;
  for (const char of search) {
    const index = text.indexOf(char, previous + 1);
    if (index < 0) return -Infinity;
    score += index === previous + 1 ? 8 : 1;
    if (index > text.lastIndexOf('/')) score += 3;
    previous = index;
  }
  return score - text.length / 1000;
}
export default function QuickOpen({
  api,
  projectId,
  onOpen,
  onClose,
}: {
  api: Backend;
  projectId: string;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [index, setIndex] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void api
      .indexFiles(projectId)
      .then((files) => {
        if (current) setFiles(files);
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, projectId]);
  const matches = files
    .map((path) => ({ path, score: fuzzyScore(path, query) }))
    .filter((item) => item.score > -Infinity)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 50);
  function open(path: string) {
    onOpen(path);
    onClose();
  }
  return (
    <Modal title="Quick Open" onClose={onClose}>
      <input
        autoFocus
        data-autofocus
        aria-label="Search filenames"
        placeholder="Search project files…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((value) =>
              Math.max(
                0,
                Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)),
              ),
            );
          }
          if (event.key === 'Enter' && matches[index]) {
            event.preventDefault();
            open(matches[index].path);
          }
        }}
        aria-controls="quick-open-results"
        aria-activedescendant={matches[index] ? `quick-result-${index}` : undefined}
        role="combobox"
        aria-expanded="true"
      />
      <div
        id="quick-open-results"
        role="listbox"
        aria-label="Matching files"
        className="quick-results"
      >
        {matches.map((item, number) => (
          <button
            id={`quick-result-${number}`}
            role="option"
            aria-selected={number === index}
            key={item.path}
            onClick={() => open(item.path)}
          >
            {item.path}
          </button>
        ))}
      </div>
      {loading ? <p role="status">Finding files…</p> : !matches.length && <p>No matching files.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
