import { useRef } from 'react';
import type { Document, Documents } from './documents';

export function EditorTabs({
  documents,
  active,
  disabled,
  onSelect,
  onError,
}: {
  documents: Documents;
  active?: Document;
  disabled: boolean;
  onSelect: (path: string) => void;
  onError: (message: string) => void;
}) {
  const dragging = useRef<string | null>(null);
  const closing = useRef(new Set<string>());
  async function close(path: string) {
    if (disabled || closing.current.has(path)) return;
    closing.current.add(path);
    const paths = [...documents.files.keys()],
      index = paths.indexOf(path);
    try {
      await documents.close(path);
      if (active?.path === path) onSelect(paths[index + 1] ?? paths[index - 1] ?? '');
    } catch (reason) {
      onError(String(reason));
    } finally {
      closing.current.delete(path);
    }
  }
  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {[...documents.files.values()].map((file) => (
        <div
          key={file.path}
          className={`editor-tab ${active === file ? 'active' : ''} ${file.preview ? 'preview-tab' : ''}`}
          draggable={!disabled}
          onDragStart={(event) => {
            dragging.current = file.path;
            event.dataTransfer.setData('application/x-elastic-tab', file.path);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (dragging.current && !disabled) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (!disabled && dragging.current) documents.reorder(dragging.current, file.path);
            dragging.current = null;
          }}
          onDragEnd={() => {
            dragging.current = null;
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              void close(file.path);
            }
          }}
        >
          <button
            role="tab"
            title={file.path}
            aria-selected={active === file}
            onClick={() => onSelect(file.path)}
            onDoubleClick={() => documents.pin(file)}
          >
            {file.path.split('/').pop()}
            {file.revision !== file.savedRevision && <span aria-label="unsaved"> •</span>}
          </button>
          <button
            className="tab-close"
            aria-label={`Close ${file.path}`}
            disabled={disabled}
            onClick={() => void close(file.path)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
