import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import * as realDocuments from '../src/bridge/ipc/documents';
import type {
  DocumentLocation,
  FolderEntry,
  RecentDocument,
} from '../src/bridge/ipc/documents';
import * as realFiles from '../src/bridge/ipc/files';
import en from '../src/i18n/locales/en.json';
import type { LibraryHost } from '../src/ui/library/library';

const state = {
  recents: [] as RecentDocument[],
  locations: [] as DocumentLocation[],
  folders: new Map<string, FolderEntry[]>(),
  listed: [] as Array<[string, readonly string[]]>,
  removedRecents: [] as string[],
  errors: [] as string[],
  current: null as string | null,
  opened: [] as string[],
  created: [] as string[],
  renamed: [] as Array<[string, string]>,
  renameFailure: null as Error | null,
  closed: 0,
};

mock.module('../src/bridge/ipc/documents', () => ({
  ...realDocuments,
  documentLocations: async () => state.locations,
  recentDocuments: async () => state.recents,
  removeRecent: async (id: string) => {
    state.removedRecents.push(id);
  },
  listFolder: async (path: string, extensions: readonly string[]) => {
    state.listed.push([path, extensions]);
    return state.folders.get(path) ?? [];
  },
}));

mock.module('../src/bridge/ipc/files', () => ({
  ...realFiles,
  errorDialog: async (text: string) => {
    state.errors.push(text);
  },
  confirmDialog: async () => true,
}));

const { i18next } = await import('../src/i18n');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const { Library } = await import('../src/ui/library/library');

const host: LibraryHost = {
  currentPath: () => state.current,
  open: async (path) => {
    state.opened.push(path);
  },
  createIn: async (folder) => {
    state.created.push(folder);
  },
  rename: async (path, stem) => {
    state.renamed.push([path, stem]);
    if (state.renameFailure) throw state.renameFailure;
    return path;
  },
  remove: async () => {},
  pickDocument: async () => {},
  close: () => {
    state.closed += 1;
  },
};

let DomEvent: typeof Event;

beforeEach(() => {
  const page = parseHTML(
    '<html><head></head><body><main id="ny-app"><div id="titlebar"></div><div id="body"></div></main></body></html>'
  );
  DomEvent = page.window.Event;
  Object.assign(globalThis, {
    window: new EventTarget(),
    document: page.document,
    HTMLElement: page.window.HTMLElement,
    getComputedStyle: () => ({ zIndex: '' }),
  });
  page.window.HTMLElement.prototype.focus = () => {};
  state.recents = [];
  state.locations = [];
  state.folders.clear();
  state.listed = [];
  state.removedRecents = [];
  state.errors = [];
  state.current = null;
  state.opened = [];
  state.created = [];
  state.renamed = [];
  state.renameFailure = null;
  state.closed = 0;
});

afterEach(() => {
  for (const cancel of document.querySelectorAll<HTMLElement>(
    '.ny-library-overlay button'
  )) {
    if (cancel.textContent === 'Cancel') cancel.click();
  }
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function recent(name: string, overrides: Partial<RecentDocument> = {}) {
  return {
    id: name,
    name,
    path: `/docs/${name}`,
    folder: 'Docs',
    openedAt: Date.now(),
    available: true,
    ...overrides,
  } satisfies RecentDocument;
}

function location(
  kind: DocumentLocation['kind'],
  overrides: Partial<DocumentLocation> = {}
) {
  return {
    id: kind,
    kind,
    name: '',
    path: `/${kind}`,
    available: true,
    ...overrides,
  } satisfies DocumentLocation;
}

function entry(
  name: string,
  kind: FolderEntry['kind'],
  modifiedAt: number | null = null
) {
  return {
    name,
    path: `/local/${name}`,
    kind,
    modifiedAt,
    downloaded: true,
  } satisfies FolderEntry;
}

async function openLibrary() {
  const library = new Library(host);
  await library.show();
  return library;
}

function button(label: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>('button')
  ).find(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? candidate.textContent) === label
  );
  if (!found) throw new Error(`No button named ${label}`);
  return found;
}

function names(scope = '') {
  return Array.from(
    document.querySelectorAll(`${scope} .ny-library__name`)
  ).map((name) => name.textContent);
}

function row(name: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>('.ny-library__row')
  ).find((candidate) => {
    return candidate.querySelector('.ny-library__name')?.textContent === name;
  });
  if (!found) throw new Error(`No row named ${name}`);
  return found;
}

function sheetActions() {
  return Array.from(document.querySelectorAll('.ny-library-sheet button')).map(
    (action) => action.textContent
  );
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new DomEvent('input'));
}

describe('the home view', () => {
  test('lists recents without their extension, then the locations', async () => {
    state.recents = [recent('Notes.md'), recent('Ideas.MARKDOWN')];
    state.locations = [
      location('icloud', { available: false, path: null }),
      location('local', { name: 'iPhone' }),
      location('folder', { name: 'Projects' }),
    ];
    await openLibrary();
    expect(names()).toEqual([
      'Notes',
      'Ideas',
      'iCloud Drive',
      'On My iPhone',
      'Projects',
      'Add Folder…',
      'Open Other Document…',
    ]);
    const hints = Array.from(
      document.querySelectorAll('.ny-library__detail')
    ).map((detail) => detail.textContent);
    expect(hints).toContain(
      'To use this location, sign in to iCloud and turn on iCloud Drive in Settings.'
    );
  });

  test('names a recent at the top of a location after the location', async () => {
    state.locations = [location('local', { name: 'iPhone' })];
    state.recents = [
      recent('Plan.md', { path: '/local/Plan.md', folder: 'Documents' }),
      recent('Notes.md', { path: '/local/Work/Notes.md', folder: 'Work' }),
    ];
    await openLibrary();
    const detail = (name: string) =>
      row(name).querySelector('.ny-library__detail')?.textContent ?? '';
    expect(detail('Plan')).toStartWith('On My iPhone · ');
    expect(detail('Notes')).toStartWith('Work · ');
  });

  test('opens an available recent and offers only removal for an unavailable one', async () => {
    state.recents = [
      recent('Notes.md'),
      recent('Gone.md', { available: false }),
    ];
    await openLibrary();
    row('Notes').click();
    expect(state.opened).toEqual(['/docs/Notes.md']);

    row('Gone').click();
    expect(sheetActions()).toEqual(['Remove from Recent', 'Cancel']);
    button('Remove from Recent').click();
    await settle();
    expect(state.removedRecents).toEqual(['Gone.md']);
    expect(state.opened).toEqual(['/docs/Notes.md']);
  });

  test('creates in iCloud when it is available, on the device otherwise', async () => {
    state.locations = [
      location('icloud', { path: '/icloud' }),
      location('local', { name: 'iPhone', path: '/local' }),
    ];
    const library = await openLibrary();
    button('New Document').click();
    await settle();
    expect(state.created).toEqual(['/icloud']);

    state.locations = [
      location('icloud', { available: false, path: null }),
      location('local', { name: 'iPhone', path: '/local' }),
    ];
    await library.show();
    button('New Document').click();
    await settle();
    expect(state.created).toEqual(['/icloud', '/local']);
  });

  test('offers Done only with a document open, and blocks the page behind', async () => {
    const library = await openLibrary();
    const behind = [
      document.getElementById('titlebar'),
      document.getElementById('body'),
    ];
    expect(() => button('Done')).toThrow();
    expect(behind.map((node) => node?.hasAttribute('inert'))).toEqual([
      true,
      true,
    ]);

    state.current = '/docs/Notes.md';
    state.recents = [recent('Notes.md'), recent('Other.md')];
    await library.show();
    expect(row('Notes').getAttribute('aria-current')).toBe('true');
    expect(row('Other').hasAttribute('aria-current')).toBe(false);
    button('Done').click();
    expect(state.closed).toBe(1);

    library.hide();
    expect(behind.map((node) => node?.hasAttribute('inert'))).toEqual([
      false,
      false,
    ]);
  });
});

describe('a folder', () => {
  test('lists folders first, documents newest first, and filters by name', async () => {
    state.locations = [location('local', { name: 'iPhone', path: '/local' })];
    state.folders.set('/local', [
      entry('Old.md', 'document', 1_000),
      entry('Undated.md', 'document'),
      entry('Fresh.markdown', 'document', 3_000),
      entry('beta', 'folder'),
      entry('Alpha', 'folder'),
    ]);
    await openLibrary();
    row('On My iPhone').click();
    await settle();
    expect(state.listed).toEqual([
      ['/local', ['md', 'markdown', 'mdown', 'mkdn', 'mdwn', 'mdtxt']],
    ]);
    const folder = '.ny-library__page--folder';
    expect(names(folder)).toEqual(['Alpha', 'beta', 'Fresh', 'Old', 'Undated']);

    const search = document.querySelector(
      `${folder} input[type="search"]`
    ) as HTMLInputElement;
    type(search, 'FRE');
    expect(names(folder)).toEqual(['Fresh']);
    type(search, 'zz');
    expect(names(folder)).toEqual([]);
    expect(
      document.querySelector(`${folder} .ny-library__empty`)?.textContent
    ).toBe('No documents match “zz”.');
  });
});

describe('renaming', () => {
  async function openRename() {
    state.recents = [recent('Notes.md')];
    await openLibrary();
    button('More Actions').click();
    expect(sheetActions()).toEqual([
      'Rename…',
      'Delete',
      'Remove from Recent',
      'Cancel',
    ]);
    button('Rename…').click();
    const dialog = document.querySelector('.ny-library-dialog') as HTMLElement;
    const input = dialog.querySelector('input') as HTMLInputElement;
    const error = dialog.querySelector('[role="alert"]') as HTMLElement;
    return { input, error };
  }

  test('refuses a name with a slash and keeps the dialog open', async () => {
    const { input, error } = await openRename();
    expect(input.value).toBe('Notes');
    type(input, 'a/b');
    button('Rename').click();
    await settle();
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(
      'A name cannot be empty or contain “/” or “:”.'
    );
    expect(state.renamed).toEqual([]);
    expect(document.querySelector('.ny-library-dialog')).not.toBeNull();
  });

  test('reports a name that is taken inside the dialog', async () => {
    const { input, error } = await openRename();
    state.renameFailure = new realDocuments.DocumentsError('exists', 'exists');
    type(input, 'Taken');
    button('Rename').click();
    await settle();
    expect(state.renamed).toEqual([['/docs/Notes.md', 'Taken']]);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(
      'An item named “Taken” already exists in this folder.'
    );
    expect(state.errors).toEqual([]);
  });
});

describe('renaming the open document', () => {
  test('prompts from a hidden library and renames the given path', async () => {
    const library = new Library(host);
    const closed = library.promptRename('/docs/Notes/Plan.md');
    const input = document.querySelector(
      '.ny-library-dialog input'
    ) as HTMLInputElement;
    expect(input.value).toBe('Plan');
    type(input, 'Roadmap');
    button('Rename').click();
    await closed;
    expect(state.renamed).toEqual([['/docs/Notes/Plan.md', 'Roadmap']]);
    expect(document.querySelector('.ny-library-dialog')).toBeNull();
  });
});
