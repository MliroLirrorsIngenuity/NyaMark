import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import * as realAttachments from '../src/bridge/ipc/attachments';
import * as realFiles from '../src/bridge/ipc/files';
import * as realWindows from '../src/bridge/ipc/windows';
import type { EditorAttachment } from '../src/editor/editor';
import { basenamePath } from '../src/features/attachment-paths';
import en from '../src/i18n/locales/en.json';
import type { PastedImagePolicyChoice } from '../src/ui/image-policy-dialog';

// Settings subscriptions listen on `window`; Bun's global scope is an
// EventTarget, which is all they need.
const hadWindow = 'window' in globalThis;
if (!hadWindow) Object.assign(globalThis, { window: globalThis });

// Bun has no FileReader; Base64 embedding reads through this one.
const hadFileReader = 'FileReader' in globalThis;
if (!hadFileReader) {
  Object.assign(globalThis, {
    FileReader: class {
      result: string | null = null;
      error: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File) {
        void file.arrayBuffer().then((bytes) => {
          this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
          this.onload?.();
        });
      }
    },
  });
}

type DropHandler = (event: {
  payload: { type: string; paths: string[] };
}) => void;

// The controller reaches the disk and the user only through the bridge and
// the image policy dialog; these stand in for both.
const bridge = {
  errors: [] as string[],
  copyTargetPrompts: 0,
  allowCopyTarget: true,
  unreadable: new Set<string>(),
  copies: [] as Array<{ sourcePath: string; targetDir: string }>,
  stored: [] as string[],
  pastedImageChoice: null as PastedImagePolicyChoice | null,
  drop: null as DropHandler | null,
  /** What the files were dropped on. */
  dropTarget: null as Element | null,
};

mock.module('../src/bridge/ipc/attachments', () => ({
  ...realAttachments,
  formatMarkdownReference: async (
    _documentPath: string | null,
    path: string
  ) => {
    if (bridge.unreadable.has(path)) throw new Error('permission denied');
    return path;
  },
  copyLocalAttachment: async (
    _documentPath: string,
    sourcePath: string,
    targetDir: string
  ) => {
    bridge.copies.push({ sourcePath, targetDir });
    const markdownPath = `${targetDir}/${basenamePath(sourcePath)}`;
    return { markdownPath, absolutePath: markdownPath };
  },
  storeAttachmentInDirectory: async (
    _documentPath: string,
    targetDir: string,
    fileName: string
  ) => {
    bridge.stored.push(fileName);
    const markdownPath = `${targetDir}/${fileName}`;
    return { markdownPath, absolutePath: markdownPath };
  },
}));

mock.module('../src/bridge/ipc/files', () => ({
  ...realFiles,
  errorDialog: async (text: string) => {
    bridge.errors.push(text);
  },
  confirmDialog: async () => {
    bridge.copyTargetPrompts += 1;
    return bridge.allowCopyTarget;
  },
  openDirectoryDialog: async () => null,
}));

mock.module('../src/bridge/ipc/windows', () => ({
  ...realWindows,
  listenWindowFileDrop: async (handler: DropHandler) => {
    bridge.drop = handler;
    return () => {};
  },
  dragDropTarget: () => bridge.dropTarget,
}));

mock.module('../src/ui/image-policy-dialog', () => ({
  ImagePolicyDialog: class {
    async choosePastedImagePolicy() {
      return bridge.pastedImageChoice;
    }
    async chooseUnsavedPastedImageAction() {
      return 'cancel';
    }
  },
}));

const { i18next } = await import('../src/i18n');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const { AttachmentController } = await import(
  '../src/features/attachment-controller'
);

/** Let every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const controllers: Array<InstanceType<typeof AttachmentController>> = [];

async function setup({ markdown = '', documentPath = '/notes/doc.md' } = {}) {
  const inserted: EditorAttachment[][] = [];
  const controller = new AttachmentController({
    getMarkdown: () => markdown,
    getDocumentPath: () => documentPath,
    saveDocumentAs: async () => null,
    insertAttachments: (attachments) => inserted.push(attachments),
    onAttachmentsInserted: () => {},
  });
  controllers.push(controller);

  let onPaste: ((event: ClipboardEvent) => void) | null = null;
  controller.bindPaste({
    addEventListener: (_type: string, listener: typeof onPaste) => {
      onPaste = listener;
    },
  } as unknown as HTMLElement);
  await controller.bindWindowFileDrop();

  const paste = async (paths: string[], files: File[] = []) => {
    onPaste?.({
      clipboardData: {
        files,
        getData: (type: string) =>
          type === 'text/uri-list'
            ? paths.map((path) => `file://${path}`).join('\n')
            : '',
      },
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as ClipboardEvent);
    await settle();
  };
  const drop = async (paths: string[]) => {
    bridge.drop?.({ payload: { type: 'drop', paths } });
    await settle();
  };

  return { controller, inserted, paste, drop };
}

let consoleError: ReturnType<typeof spyOn>;

beforeEach(() => {
  // Failed inserts are logged on purpose; keep them out of the test output.
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
  bridge.errors = [];
  bridge.copyTargetPrompts = 0;
  bridge.allowCopyTarget = true;
  bridge.unreadable = new Set();
  bridge.copies = [];
  bridge.stored = [];
  bridge.pastedImageChoice = null;
  bridge.drop = null;
  bridge.dropTarget = null;
});

afterEach(() => {
  consoleError.mockRestore();
  for (const controller of controllers.splice(0)) controller.dispose();
});

afterAll(() => {
  if (!hadWindow) Reflect.deleteProperty(globalThis, 'window');
  if (!hadFileReader) Reflect.deleteProperty(globalThis, 'FileReader');
});

describe('inserting files', () => {
  test('a file copied in the file manager is inserted once', async () => {
    const { paste, inserted } = await setup();
    bridge.pastedImageChoice = {
      policy: 'copy-assets',
      customDirectory: null,
      remember: false,
    };
    const contents = new File([new Uint8Array(4)], 'cat.png', {
      type: 'image/png',
    });

    await paste(['/pictures/cat.png'], [contents]);

    expect(inserted).toEqual([
      [{ kind: 'image', href: '/pictures/cat.png', label: 'cat.png' }],
    ]);
    expect(bridge.stored).toEqual([]);
  });

  test('an unreadable file does not hold back the others', async () => {
    const { drop, inserted } = await setup();
    bridge.unreadable.add('/inbox/locked.pdf');

    await drop(['/inbox/locked.pdf', '/inbox/notes.pdf']);

    expect(inserted).toEqual([
      [{ kind: 'file', href: '/inbox/notes.pdf', label: 'notes.pdf' }],
    ]);
    expect(bridge.errors).toEqual([
      '"locked.pdf" could not be inserted: permission denied',
    ]);
  });

  test('files dropped on the assistant are left to it', async () => {
    const { drop, inserted } = await setup();
    bridge.dropTarget = {
      closest: (selector: string) => (selector === '.ny-ai' ? {} : null),
    } as unknown as Element;

    await drop(['/inbox/chart.png']);

    expect(inserted).toEqual([]);
  });

  test('an image too large for Base64 is refused with a reason', async () => {
    const { controller, inserted } = await setup();
    bridge.pastedImageChoice = {
      policy: 'base64',
      customDirectory: null,
      remember: false,
    };
    const image = new File([new Uint8Array(6 * 1024 * 1024)], 'scan.png', {
      type: 'image/png',
    });

    expect(await controller.upload(image)).toBe('');
    expect(inserted).toEqual([]);
    expect(bridge.errors).toHaveLength(1);
    expect(bridge.errors[0]).toContain('"scan.png" could not be inserted');
    expect(bridge.errors[0]).toContain(
      'exceeds the 5 MB limit for Base64 embedding'
    );
  });

  test('an image that would grow the document past the open limit is refused', async () => {
    const { controller } = await setup({
      markdown: 'x'.repeat(18 * 1024 * 1024),
    });
    bridge.pastedImageChoice = {
      policy: 'base64',
      customDirectory: null,
      remember: false,
    };
    const image = new File([new Uint8Array(1024 * 1024)], 'scan.png', {
      type: 'image/png',
    });

    expect(await controller.upload(image)).toBe('');
    expect(bridge.errors).toHaveLength(1);
    expect(bridge.errors[0]).toContain('NyaMark could no longer open it');
  });

  test('images pasted together count toward the open limit together', async () => {
    const { paste, inserted } = await setup();
    bridge.pastedImageChoice = {
      policy: 'base64',
      customDirectory: null,
      remember: false,
    };
    const images = ['a', 'b', 'c', 'd'].map(
      (name) =>
        new File([new Uint8Array(4.5 * 1024 * 1024)], `${name}.png`, {
          type: 'image/png',
        })
    );

    await paste([], images);
    await settle();

    expect(inserted.map((batch) => batch.map((image) => image.label))).toEqual([
      ['a.png', 'b.png', 'c.png'],
    ]);
    expect(bridge.errors).toHaveLength(1);
    expect(bridge.errors[0]).toContain('"d.png" could not be inserted');
  });
});

describe('front matter copy folder', () => {
  const pointingAt = (folder: string) =>
    `---\ntypora-copy-images-to: ${folder}\n---\n\n# Notes\n`;

  test('a folder inside the document folder is used without asking', async () => {
    const { drop } = await setup({ markdown: pointingAt('assets') });

    await drop(['/pictures/cat.png']);

    expect(bridge.copyTargetPrompts).toBe(0);
    expect(bridge.copies).toEqual([
      { sourcePath: '/pictures/cat.png', targetDir: 'assets' },
    ]);
  });

  test('a folder elsewhere is used once the user allows it', async () => {
    const { drop } = await setup({ markdown: pointingAt('../shared') });

    await drop(['/pictures/cat.png']);
    await drop(['/pictures/dog.png']);

    expect(bridge.copyTargetPrompts).toBe(1);
    expect(bridge.copies.map((copy) => copy.targetDir)).toEqual([
      '../shared',
      '../shared',
    ]);
  });

  test('a refused folder leaves the attachment settings in charge', async () => {
    const { drop, inserted } = await setup({ markdown: pointingAt('/tmp') });
    bridge.allowCopyTarget = false;

    await drop(['/pictures/cat.png']);
    await drop(['/pictures/dog.png']);

    expect(bridge.copyTargetPrompts).toBe(1);
    expect(bridge.copies).toEqual([]);
    expect(inserted.flat().map((attachment) => attachment.href)).toEqual([
      '/pictures/cat.png',
      '/pictures/dog.png',
    ]);
  });
});
