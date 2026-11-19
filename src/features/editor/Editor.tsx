import { memo, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import type { Document, Documents } from './documents';
import { measure } from '../../performance/probes';
import { clipboardTable } from './paste/tables';

export const Editor = memo(function Editor({
  documents,
  file,
  line,
  navigation = 0,
  readOnly = false,
  onPasteImage,
  onError,
}: {
  documents: Documents;
  file: Document;
  line?: number;
  navigation?: number;
  readOnly?: boolean;
  onPasteImage: (image: Blob) => Promise<string>;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const active = useRef(file);
  const editable = useRef(new Compartment());
  const callbacks = useRef({ onPasteImage, onError });
  callbacks.current = { onPasteImage, onError };
  const plainPaste = useRef(0);
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: active.current.state,
      dispatch: (transaction) => {
        measure('editor-transaction', () => {
          editor.update([transaction]);
          documents.update(active.current, transaction);
        });
      },
    });
    editor.dispatch({ effects: StateEffect.appendConfig.of(editable.current.of([])) });
    view.current = editor;
    performance.mark('elastic:editor-ready');
    return () => {
      active.current.scrollTop = editor.scrollDOM.scrollTop;
      editor.destroy();
      view.current = null;
    };
  }, [documents]);
  useEffect(() => {
    const editor = view.current!;
    if (active.current !== file) {
      active.current.scrollTop = editor.scrollDOM.scrollTop;
      active.current = file;
      editor.setState(file.state);
      editor.scrollDOM.scrollTop = file.scrollTop;
    }
    if (line) {
      const position = file.state.doc.line(Math.min(Math.max(1, line), file.state.doc.lines)).from;
      editor.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      });
    }
    editor.focus();
    return documents.bindEditor(file, (spec) => editor.dispatch(spec));
  }, [documents, file, line, navigation]);
  useEffect(() => {
    const editor = view.current!;
    if (editable.current.get(editor.state) === undefined)
      editor.dispatch({ effects: StateEffect.appendConfig.of(editable.current.of([])) });
    editor.dispatch({
      effects: editable.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.domEventHandlers({
          keydown(event) {
            if (
              event.key.toLowerCase() === 'v' &&
              event.shiftKey &&
              (event.metaKey || event.ctrlKey)
            )
              plainPaste.current = Date.now();
          },
          paste(event, editor) {
            if (
              readOnly ||
              !file.path.endsWith('.tex') ||
              !event.clipboardData ||
              Date.now() - plainPaste.current < 1000
            )
              return false;
            const clipboard = event.clipboardData;
            const table = clipboardTable(
              clipboard.getData('text/plain'),
              clipboard.getData('text/html'),
            );
            if (table) {
              event.preventDefault();
              editor.dispatch({
                ...editor.state.replaceSelection(table),
                userEvent: 'input.paste',
                scrollIntoView: true,
              });
              return true;
            }
            const images = [...clipboard.files].filter((image) => image.type.startsWith('image/'));
            if (!images.length) return false;
            event.preventDefault();
            void documents
              .paste(file, async () => {
                const snippets = [];
                for (const image of images)
                  snippets.push(await callbacks.current.onPasteImage(image));
                return snippets.join('\n');
              })
              .catch((reason) => callbacks.current.onError(String(reason)));
            return true;
          },
        }),
      ]),
    });
  }, [documents, file, readOnly]);
  return <div className="editor-host" ref={host} aria-label={`Source editor: ${file.path}`} />;
});
