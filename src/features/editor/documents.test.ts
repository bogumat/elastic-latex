import { afterEach, describe, expect, it, vi } from 'vitest';
import { Documents, type Document } from './documents';

const content = { text: 'hello\r\nworld', version: 'v1', lineEnding: '\r\n' };
const edit = (documents: Documents, file: Document, text: string) =>
  documents.update(file, file.state.update({ changes: { from: 0, insert: text } }));
afterEach(() => vi.useRealTimers());

describe('document save coordination', () => {
  it('waits for an asynchronous paste and maps its position through intervening edits', async () => {
    const saveFile = vi.fn().mockResolvedValue('v2');
    const documents = new Documents('project', { saveFile, readFile: vi.fn() });
    const file = documents.add('main.tex', { ...content, text: 'before after', lineEnding: '\n' });
    documents.edit(file, { selection: { anchor: 7 } });
    let finish!: (text: string) => void;
    const prepared = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const paste = documents.paste(file, () => prepared);
    edit(documents, file, 'prefix ');
    const saving = documents.saveAll();
    expect(saveFile).not.toHaveBeenCalled();
    finish('IMAGE ');
    await paste;
    await saving;
    expect(file.state.doc.toString()).toBe('prefix before IMAGE after');
    expect(saveFile.mock.calls[0][2]).toBe('prefix before IMAGE after');
    documents.dispose();
  });

  it('does not insert a late paste into a disposed project', async () => {
    const documents = new Documents('project', { saveFile: vi.fn(), readFile: vi.fn() });
    const file = documents.add('main.tex', content);
    let finish!: (text: string) => void;
    const prepared = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const paste = documents.paste(file, () => prepared);
    documents.dispose();
    finish('late');
    await paste;
    expect(file.state.sliceDoc()).toBe(content.text);
  });

  it('refreshes changed clean buffers after a pull and closes deleted files', async () => {
    const documents = new Documents('project', { saveFile: vi.fn(), readFile: vi.fn() });
    const before = documents.add('main.tex', content);
    documents.add('deleted.tex', content);
    await documents.reloadSaved(async () => ({
      'main.tex': { text: 'pulled', version: 'v2', lineEnding: '\n' },
      'deleted.tex': null,
    }));
    expect(documents.files.get('main.tex')).not.toBe(before);
    expect(documents.files.get('main.tex')?.state.sliceDoc()).toBe('pulled');
    expect(documents.files.has('deleted.tex')).toBe(false);
    expect(documents.dirty).toBe(false);
    documents.dispose();
  });
  it('does not overwrite a buffer edited during a disk refresh', async () => {
    const documents = new Documents('project', { saveFile: vi.fn(), readFile: vi.fn() });
    const file = documents.add('main.tex', content);
    await expect(
      documents.reloadSaved(async () => {
        edit(documents, file, 'keep me');
        return { 'main.tex': { ...content, text: 'external', version: 'v2' } };
      }),
    ).rejects.toThrow('buffer changed');
    expect(file.state.sliceDoc()).toContain('keep me');
    documents.dispose();
  });
  it('retains edits made during a save and uses the returned disk version for the next write', async () => {
    let finish!: (version: string) => void;
    const saveFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue('v3');
    const documents = new Documents('project', { saveFile, readFile: vi.fn() });
    const file = documents.add('main.tex', content);
    edit(documents, file, 'first');
    const saving = documents.save(file);
    edit(documents, file, 'second');
    finish('v2');
    await saving;
    expect(file.status).toBe('unsaved');
    expect(file.savedRevision).toBe(1);
    await documents.save(file);
    expect(saveFile.mock.calls[1][3]).toBe('v2');
    expect(saveFile.mock.calls[1][2]).toBe('secondfirsthello\r\nworld');
    expect(file.status).toBe('saved');
    documents.dispose();
  });

  it('never clears dirty text after a failed write', async () => {
    const documents = new Documents('project', {
      saveFile: vi.fn().mockRejectedValue('external change'),
      readFile: vi.fn(),
    });
    const file = documents.add('main.tex', content);
    edit(documents, file, 'new');
    await expect(documents.saveAll()).rejects.toThrow('main.tex: external change');
    expect(documents.dirty).toBe(true);
    expect(file.version).toBe('v1');
    expect(file.status).toBe('error');
    expect(file.state.sliceDoc()).toContain('new');
    documents.dispose();
  });

  it('attempts every edited file even when an earlier file cannot be saved', async () => {
    const disk = new Map<string, string>();
    const saveFile = vi.fn(async (_project, path: string, text: string) => {
      if (path === 'main.tex') throw new Error('External change');
      disk.set(path, text);
      return 'v2';
    });
    const documents = new Documents('project', { saveFile, readFile: vi.fn() });
    const main = documents.add('main.tex', content);
    const chapter = documents.add('chapters/introduction.tex', content);
    edit(documents, main, 'Retain main ');
    edit(documents, chapter, 'Save chapter ');
    await expect(documents.saveAll()).rejects.toThrow('main.tex: Error: External change');
    expect(disk.get(chapter.path)).toBe('Save chapter hello\r\nworld');
    expect(chapter.status).toBe('saved');
    expect(main.status).toBe('error');
    expect(main.state.sliceDoc()).toContain('Retain main');
    documents.dispose();
  });

  it('coalesces typing and enforces the maximum autosave interval', async () => {
    vi.useFakeTimers();
    const saveFile = vi.fn().mockResolvedValue('v2');
    const documents = new Documents('project', { saveFile, readFile: vi.fn() });
    const file = documents.add('main.tex', content);
    for (let i = 0; i < 10; i++) {
      edit(documents, file, '.');
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(saveFile).toHaveBeenCalledTimes(1);
    documents.dispose();
  });

  it('defers autosave during compilation and resumes with the latest text', async () => {
    vi.useFakeTimers();
    const saveFile = vi.fn().mockResolvedValue('v2');
    const documents = new Documents('project', { saveFile, readFile: vi.fn() });
    const file = documents.add('main.tex', content);
    documents.holdAutosave(true);
    edit(documents, file, 'during build');
    await vi.advanceTimersByTimeAsync(6000);
    expect(saveFile).not.toHaveBeenCalled();
    documents.holdAutosave(false);
    await vi.advanceTimersByTimeAsync(750);
    expect(saveFile).toHaveBeenCalledTimes(1);
    documents.dispose();
  });

  it('deduplicates concurrent file opens and does not change the edit revision', async () => {
    const readFile = vi.fn().mockResolvedValue(content);
    const documents = new Documents('project', { saveFile: vi.fn(), readFile });
    const [a, b] = await Promise.all([documents.open('main.tex'), documents.open('main.tex')]);
    expect(a).toBe(b);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(documents.revisions()).toBe('0');
    documents.dispose();
  });
});
