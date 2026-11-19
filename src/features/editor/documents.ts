import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import type { Backend, FileData } from '../../shared/contracts/backend';
import { editorExtensions } from './extensions';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export interface Document {
  path: string;
  state: EditorState;
  version: string;
  revision: number;
  savedRevision: number;
  status: SaveStatus;
  error?: string;
  scrollTop: number;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
}

// React sees metadata transitions only. CodeMirror owns persistent text and history.
export class Documents {
  readonly files = new Map<string, Document>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private held = false;
  private disposed = false;
  private opening = new Map<string, Promise<Document>>();
  private editRevision = 0;
  private editor?: { file: Document; dispatch: (spec: TransactionSpec) => void };
  private pastes = new Map<Promise<void>, { file: Document; from: number; to: number }>();
  bindEditor(file: Document, dispatch: (spec: TransactionSpec) => void) {
    const editor = { file, dispatch };
    this.editor = editor;
    return () => {
      if (this.editor === editor) this.editor = undefined;
    };
  }
  edit(file: Document, spec: TransactionSpec) {
    if (this.disposed) return;
    if (this.editor?.file === file) this.editor.dispatch(spec);
    else this.update(file, file.state.update(spec));
  }
  paste(file: Document, prepare: () => Promise<string>): Promise<void> {
    const { from, to } = file.state.selection.main;
    const bookmark = { file, from, to };
    const pending = Promise.resolve()
      .then(prepare)
      .then((text) => {
        if (this.disposed || this.files.get(file.path) !== file) return;
        this.edit(file, {
          changes: { from: bookmark.from, to: bookmark.to, insert: text },
          selection: { anchor: bookmark.from + text.length },
          userEvent: 'input.paste',
        });
      })
      .finally(() => this.pastes.delete(pending));
    this.pastes.set(pending, bookmark);
    return pending;
  }
  constructor(
    readonly projectId: string,
    private api: Pick<Backend, 'readFile' | 'saveFile'>,
  ) {}
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  snapshot = () => this.generation;
  private emit() {
    this.generation++;
    this.listeners.forEach((listener) => listener());
  }
  private status(file: Document, status: SaveStatus) {
    if (file.status !== status) {
      file.status = status;
      this.emit();
    }
  }
  async open(path: string): Promise<Document> {
    const existing = this.files.get(path);
    if (existing) return existing;
    const pending = this.opening.get(path);
    if (pending) return pending;
    const load = this.api
      .readFile(this.projectId, path)
      .then((data) => this.add(path, data))
      .finally(() => this.opening.delete(path));
    this.opening.set(path, load);
    return load;
  }
  add(path: string, data: FileData): Document {
    const file: Document = {
      path,
      state: EditorState.create({
        doc: data.text,
        extensions: [editorExtensions, EditorState.lineSeparator.of(data.lineEnding)],
      }),
      version: data.version,
      revision: 0,
      savedRevision: 0,
      status: 'saved',
      scrollTop: 0,
    };
    this.files.set(path, file);
    this.emit();
    return file;
  }
  update(file: Document, transaction: Transaction) {
    for (const bookmark of this.pastes.values()) {
      if (bookmark.file !== file) continue;
      bookmark.from = transaction.changes.mapPos(bookmark.from, 1);
      bookmark.to = Math.max(bookmark.from, transaction.changes.mapPos(bookmark.to, -1));
    }
    file.state = transaction.state;
    if (!transaction.docChanged) return;
    file.revision++;
    this.editRevision++;
    this.status(file, 'unsaved');
    this.schedule(file);
  }
  private schedule(file: Document) {
    if (this.held || this.disposed) return;
    clearTimeout(file.timer);
    const save = () => {
      void this.save(file).catch(() => {
        /* Error remains on the document. */
      });
    };
    file.timer = setTimeout(save, 750);
    file.deadline ??= setTimeout(save, 5000);
  }
  async save(file: Document): Promise<void> {
    clearTimeout(file.timer);
    clearTimeout(file.deadline);
    file.deadline = undefined;
    if (file.saving) {
      await file.saving;
      return this.save(file);
    }
    if (file.revision === file.savedRevision) return;
    const revision = file.revision;
    // Exactly one whole-document serialization, when a save is actually due.
    const text = file.state.sliceDoc();
    this.status(file, 'saving');
    file.saving = this.api
      .saveFile(this.projectId, file.path, text, file.version)
      .then((version) => {
        file.version = version;
        file.savedRevision = revision;
        file.error = undefined;
        this.status(file, file.revision === revision ? 'saved' : 'unsaved');
      })
      .catch((error) => {
        file.error = String(error);
        this.status(file, 'error');
        throw error;
      })
      .finally(() => {
        file.saving = undefined;
      });
    await file.saving;
    if (file.revision !== file.savedRevision) this.schedule(file);
  }
  async saveAll() {
    // Compilation/project switching must include assets still being imported.
    while (this.pastes.size) await Promise.all(this.pastes.keys());
    for (const file of this.files.values()) await this.save(file);
    if (this.dirty) throw new Error('The document changed while saving. Please compile again.');
  }
  holdAutosave(held: boolean) {
    this.held = held;
    for (const file of this.files.values()) {
      clearTimeout(file.timer);
      clearTimeout(file.deadline);
      file.deadline = undefined;
      if (!held && file.revision !== file.savedRevision) this.schedule(file);
    }
  }
  get dirty() {
    return [...this.files.values()].some((file) => file.revision !== file.savedRevision);
  }
  revisions() {
    return String(this.editRevision);
  }
  async reloadSaved(read: (paths: string[]) => Promise<Record<string, FileData | null>>) {
    await Promise.all(this.opening.values());
    if (this.dirty) throw new Error('Save pending edits before refreshing files from Git.');
    const data = await read([...this.files.keys()]);
    // Recheck after I/O: even a programmatic edit must not be overwritten.
    if (this.dirty)
      throw new Error('A buffer changed during refresh. Its edits have been retained.');
    for (const path of this.files.keys())
      if (!(path in data)) throw new Error(`Missing refresh result for ${path}`);
    for (const [path, file] of this.files) {
      const next = data[path];
      if (next === null) {
        this.files.delete(path);
        continue;
      }
      if (next.version === file.version) continue;
      const replacement = this.add(path, next);
      replacement.scrollTop = file.scrollTop;
      replacement.state = replacement.state.update({
        selection: {
          anchor: Math.min(file.state.selection.main.head, replacement.state.doc.length),
        },
      }).state;
    }
    this.editRevision++;
    this.emit();
  }
  dispose() {
    this.disposed = true;
    this.holdAutosave(true);
    this.listeners.clear();
  }
}
