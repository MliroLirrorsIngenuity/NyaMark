import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import * as realFiles from '../src/bridge/ipc/files';
import type { DocumentFormat, MarkdownDocument } from '../src/bridge/ipc/files';
import type { NyaEditor } from '../src/editor/editor';

// The controller reaches the disk only through the files bridge; replacing
// that module runs it against an in-memory file without Tauri.
const bridge = {
  initialFile: null as string | null,
  read: async (_path: string): Promise<MarkdownDocument> => ({
    text: '',
    format: { ...realFiles.DEFAULT_DOCUMENT_FORMAT },
  }),
  save: async (_path: string, _text: string): Promise<void> => {},
  writes: [] as Array<{ path: string; text: string; format: DocumentFormat }>,
  errors: [] as string[],
  saveDialogPath: null as string | null,
  saveDialogCalls: 0,
  keepLocalEdits: true,
  conflictPrompts: 0,
  watchers: new Map<string, () => void>(),
};

mock.module('../src/bridge/ipc/files', () => ({
  ...realFiles,
  resolveCurrentWindowFile: async () => bridge.initialFile,
  readMarkdown: (path: string) => bridge.read(path),
  saveMarkdown: (path: string, text: string, format: DocumentFormat) => {
    bridge.writes.push({ path, text, format });
    return bridge.save(path, text);
  },
  saveFileDialog: async () => {
    bridge.saveDialogCalls += 1;
    return bridge.saveDialogPath;
  },
  errorDialog: async (text: string) => {
    bridge.errors.push(text);
  },
  confirmDialog: async () => {
    bridge.conflictPrompts += 1;
    return !bridge.keepLocalEdits;
  },
  watchMarkdownFile: async (path: string, handler: () => void) => {
    bridge.watchers.set(path, handler);
    return () => {
      if (bridge.watchers.get(path) === handler) bridge.watchers.delete(path);
    };
  },
  registerWindowDocument: async (path: string) => path,
}));

const { FileController } = await import('../src/features/file-controller');
const { store } = await import('../src/state/store');

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let fileCounter = 0;

function setup(content = '') {
  const path = `/notes/doc-${++fileCounter}.md`;
  // `pending` stands for keys the source pane has yet to hand the editor.
  const editor = { markdown: content, pending: null as string | null };
  const synced: string[] = [];
  // References are the targets of `(…)`, enough for these documents.
  const relocated = (mapper: (reference: string) => string | null) =>
    editor.markdown.replace(
      /\(([^)]+)\)/g,
      (_, reference: string) => `(${mapper(reference) ?? reference})`
    );
  const fakeEditor = {
    getMarkdown: () => editor.markdown,
    getMarkdownWithReferences: relocated,
    rewriteLocalReferences: (mapper: (reference: string) => string | null) => {
      editor.markdown = relocated(mapper);
    },
  } as unknown as NyaEditor;
  const controller = new FileController(() => fakeEditor, {
    syncEditorAfterSave: (saved) => {
      synced.push(saved);
      editor.markdown = saved;
    },
    flushPendingEdits: () => {
      if (editor.pending == null) return;
      editor.markdown = editor.pending;
      editor.pending = null;
    },
  });
  const edit = (text: string) => {
    editor.markdown = text;
    store.update({ isDirty: true });
  };
  return { path, editor, synced, controller, edit };
}

let consoleError: ReturnType<typeof spyOn>;

beforeEach(() => {
  // Failed saves are logged on purpose; keep them out of the test output.
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
  store.update({ filePath: null, isDirty: false });
  bridge.initialFile = null;
  bridge.read = async () => ({
    text: '',
    format: { ...realFiles.DEFAULT_DOCUMENT_FORMAT },
  });
  bridge.save = async () => {};
  bridge.writes = [];
  bridge.errors = [];
  bridge.saveDialogPath = null;
  bridge.saveDialogCalls = 0;
  bridge.keepLocalEdits = true;
  bridge.conflictPrompts = 0;
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('saving', () => {
  test('writes the BOM and line endings the file was read with', async () => {
    const { path, controller, edit } = setup();
    const format: DocumentFormat = { bom: true, lineEnding: 'crlf' };
    bridge.initialFile = path;
    bridge.read = async () => ({ text: '# Old\n', format });

    const initial = await controller.resolveInitialDocument();
    store.update({ filePath: initial.filePath, isDirty: false });
    edit('# New\n');
    await controller.saveFile();

    expect(bridge.writes).toEqual([{ path, text: '# New\n', format }]);
    expect(store.getState().isDirty).toBe(false);
  });

  test('runs one save at a time, the later one with the later text', async () => {
    const { path, controller, edit } = setup();
    store.update({ filePath: path });
    const first = deferred();
    bridge.save = () => first.promise;

    edit('one');
    const saving = controller.saveFile();
    await settle();
    edit('two');
    const savingAgain = controller.saveFile();
    await settle();
    expect(bridge.writes.map((write) => write.text)).toEqual(['one']);

    bridge.save = async () => {};
    first.resolve();
    await Promise.all([saving, savingAgain]);
    expect(bridge.writes.map((write) => write.text)).toEqual(['one', 'two']);
    expect(store.getState().isDirty).toBe(false);
  });

  test('keeps the document dirty when it changed during the write', async () => {
    const { path, controller, edit, synced } = setup();
    store.update({ filePath: path });
    const write = deferred();
    bridge.save = () => write.promise;

    edit('typed before saving');
    const saving = controller.saveFile();
    await settle();
    edit('typed while saving');
    write.resolve();
    await saving;

    expect(store.getState().isDirty).toBe(true);
    expect(synced).toEqual([]);
  });

  test('counts keys the source pane still holds when the write ends', async () => {
    const { path, controller, edit, editor, synced } = setup();
    store.update({ filePath: path });
    const write = deferred();
    bridge.save = () => write.promise;

    edit('typed before saving');
    const saving = controller.saveFile();
    await settle();
    editor.pending = 'typed while saving';
    write.resolve();
    await saving;

    expect(editor.markdown).toBe('typed while saving');
    expect(store.getState().isDirty).toBe(true);
    expect(synced).toEqual([]);
  });

  test('moves references with the file once Save As has written it', async () => {
    const { path, controller, edit, editor } = setup();
    store.update({ filePath: path });
    edit('![](img/a.png)\n');
    bridge.saveDialogPath = '/elsewhere/doc.md';

    bridge.save = async () => {
      throw new Error('read-only folder');
    };
    await controller.saveFileAs().catch(() => {});
    expect(bridge.writes[0]?.text).toBe('![](../notes/img/a.png)\n');
    expect(editor.markdown).toBe('![](img/a.png)\n');
    expect(store.getState().filePath).toBe(path);

    bridge.save = async () => {};
    await controller.saveFileAs();
    expect(editor.markdown).toBe('![](../notes/img/a.png)\n');
    expect(store.getState()).toMatchObject({
      filePath: '/elsewhere/doc.md',
      isDirty: false,
    });
  });

  test('a failed save reports and does not block the next one', async () => {
    const { path, controller, edit } = setup();
    store.update({ filePath: path });
    bridge.save = async () => {
      throw new Error('disk full');
    };

    edit('text');
    await controller.saveFile();
    expect(bridge.errors).toHaveLength(1);
    expect(store.getState().isDirty).toBe(true);

    bridge.save = async () => {};
    await controller.saveFile();
    expect(bridge.writes).toHaveLength(2);
    expect(store.getState().isDirty).toBe(false);
  });

  test('auto-save reports a failure once per failure streak', async () => {
    const { path, controller, edit } = setup();
    store.update({ filePath: path });
    const failing = async () => {
      throw new Error('volume gone');
    };

    bridge.save = failing;
    edit('a');
    await controller.autoSaveFile();
    await controller.autoSaveFile();
    expect(bridge.errors).toHaveLength(1);

    bridge.save = async () => {};
    await controller.autoSaveFile();
    expect(store.getState().isDirty).toBe(false);

    bridge.save = failing;
    edit('b');
    await controller.autoSaveFile();
    expect(bridge.errors).toHaveLength(2);
  });

  test('auto-save leaves an untitled document alone', async () => {
    const { controller, edit } = setup();
    edit('never saved');
    await controller.autoSaveFile();

    expect(bridge.saveDialogCalls).toBe(0);
    expect(bridge.writes).toEqual([]);
  });
});

describe('changes made by other programs', () => {
  async function watched(content: string) {
    const context = setup(content);
    store.update({ filePath: context.path, isDirty: false });
    await settle();
    const fire = async (diskText: string) => {
      bridge.read = async () => ({
        text: diskText,
        format: { ...realFiles.DEFAULT_DOCUMENT_FORMAT },
      });
      bridge.watchers.get(context.path)?.();
      await settle();
    };
    return { ...context, fire };
  }

  test('load straight into a clean document', async () => {
    const { fire, synced } = await watched('old');
    await fire('changed elsewhere');

    expect(synced).toEqual(['changed elsewhere']);
    expect(bridge.conflictPrompts).toBe(0);
    expect(store.getState().isDirty).toBe(false);
  });

  test('ask before replacing unsaved edits, once per change', async () => {
    const { fire, edit, synced, editor } = await watched('old');
    edit('local edit');

    await fire('changed elsewhere');
    await fire('changed elsewhere');

    expect(bridge.conflictPrompts).toBe(1);
    expect(synced).toEqual([]);
    expect(editor.markdown).toBe('local edit');
    expect(store.getState().isDirty).toBe(true);
  });

  test('replace unsaved edits when the user picks the disk version', async () => {
    const { fire, edit, synced } = await watched('old');
    bridge.keepLocalEdits = false;
    edit('local edit');

    await fire('changed elsewhere');

    expect(synced).toEqual(['changed elsewhere']);
    expect(store.getState().isDirty).toBe(false);
  });

  test('ignore the echo of our own save', async () => {
    const { fire, edit, controller } = await watched('old');
    edit('saved here');
    await controller.saveFile();
    edit('kept typing');

    await fire('saved here');

    expect(bridge.conflictPrompts).toBe(0);
    expect(store.getState().isDirty).toBe(true);
  });
});
