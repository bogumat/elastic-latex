import { useEffect, useRef, useState } from 'react';
import type { Backend, Entry, Project } from '../../shared/contracts/backend';
import type { SourceLocation } from '../editor/outline';

export function Breadcrumbs({
  api,
  project,
  path,
  location,
  onOpen,
}: {
  api: Backend;
  project: Project;
  path?: string;
  location: SourceLocation;
  onOpen: (path: string, line?: number) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>(),
    [folder, setFolder] = useState(''),
    [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null),
    sequence = useRef(0);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) {
        sequence.current++;
        setEntries(undefined);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => {
      sequence.current++;
      document.removeEventListener('mousedown', dismiss);
    };
  }, []);
  async function browse(directory: string) {
    const request = ++sequence.current;
    setError('');
    setFolder(directory);
    setEntries([]);
    try {
      const entries = await api.listEntries(project.id, directory);
      if (request === sequence.current) setEntries(entries);
    } catch (reason) {
      if (request === sequence.current) setError(String(reason));
    }
  }
  const parts = path?.split('/') ?? [];
  return (
    <div
      className="breadcrumbs"
      ref={host}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          sequence.current++;
          setEntries(undefined);
        }
      }}
    >
      <nav aria-label="Source breadcrumbs">
        <button onClick={() => void browse('')}>{project.name}</button>
        {parts.map((part, index) => (
          <span key={index}>
            <span aria-hidden="true"> › </span>
            <button
              onClick={() =>
                index === parts.length - 1
                  ? path && onOpen(path)
                  : void browse(parts.slice(0, index + 1).join('/'))
              }
            >
              {part}
            </button>
          </span>
        ))}
        {path && location.section && (
          <span>
            <span aria-hidden="true"> › </span>
            <button className="section-crumb" onClick={() => onOpen(path, location.section!.line)}>
              {location.section.title}
            </button>
          </span>
        )}
      </nav>
      {entries && (
        <div
          className="breadcrumb-menu"
          role="menu"
          aria-label={`Files in ${folder || project.name}`}
        >
          <strong>{folder || project.name}</strong>
          {folder && (
            <button
              role="menuitem"
              onClick={() => void browse(folder.split('/').slice(0, -1).join('/'))}
            >
              Parent folder
            </button>
          )}
          {entries.map((entry) => (
            <button
              role="menuitem"
              key={entry.path}
              onClick={() => {
                if (entry.directory) void browse(entry.path);
                else {
                  setEntries(undefined);
                  onOpen(entry.path);
                }
              }}
            >
              {entry.directory ? '▸ ' : ''}
              {entry.name}
            </button>
          ))}
          {!entries.length && !error && <p>No files</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
