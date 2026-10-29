import {
  type DocumentLocation,
  DocumentsError,
  type FolderEntry,
  type LocationKind,
  type RecentDocument,
  documentLocations,
  listFolder,
  pickFolder,
  recentDocuments,
  removeFolder,
  removeRecent,
} from '../../bridge/ipc/documents';
import { confirmDialog, errorDialog } from '../../bridge/ipc/files';
import { MARKDOWN_EXTENSIONS } from '../../features/attachment-policy';
import { i18next } from '../../i18n';
import { ensureStyle } from '../../style/register';
import { forInputMethod } from '../ime';
import { animationsSettled, openModal } from '../modal';
import { requireElement } from '../require-element';
import libraryStyles from './library.css?inline';

export interface LibraryHost {
  /** Path of the document open behind the library; null when none. */
  currentPath(): string | null;
  open(path: string): Promise<void>;
  createIn(folder: string): Promise<void>;
  /** Resolves with the new path. Throws DocumentsError (code 'exists' | 'invalid-name' | …). */
  rename(path: string, stem: string): Promise<string>;
  remove(path: string): Promise<void>;
  pickDocument(): Promise<void>;
  /** Hide the library and return to the open document. */
  close(): void;
}

interface Page {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
}

interface SheetAction {
  label: string;
  run: () => unknown;
  destructive?: boolean;
}

interface RowSpec {
  icon: string;
  name: string;
  detail?: string;
  current?: boolean;
  unavailable?: boolean;
  disclosure?: boolean;
  tap?: () => unknown;
  actions?: SheetAction[];
}

function svg(paths: string) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const FOLDER_PATH =
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';

const ICONS = {
  document: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  folder: svg(FOLDER_PATH),
  folderPlus: svg(`${FOLDER_PATH}<path d="M12 10v5M9.5 12.5h5"/>`),
  cloud: svg(
    '<path d="M7.5 18.5a4 4 0 0 1-.4-7.98 5.5 5.5 0 0 1 10.6 1.3 3.35 3.35 0 0 1-.7 6.68z"/>'
  ),
  phone: svg(
    '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'
  ),
  openOther: svg(
    '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  ),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg(
    '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>'
  ),
  back: svg('<path d="m15 5-7 7 7 7"/>'),
  disclosure: svg('<path d="m9 5 7 7-7 7"/>'),
};

const LOCATION_ICONS: Record<LocationKind, string> = {
  icloud: ICONS.cloud,
  local: ICONS.phone,
  folder: ICONS.folder,
};

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string, onClick: () => unknown) {
  const node = make('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => void onClick());
  return node;
}

function iconButton(
  className: string,
  icon: string,
  label: string,
  onClick: () => unknown
) {
  const node = button(className, '', onClick);
  node.innerHTML = icon;
  node.setAttribute('aria-label', label);
  return node;
}

function stemOf(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return fileName;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(extension)
    ? fileName.slice(0, dot)
    : fileName;
}

function documentName(fileName: string) {
  return stemOf(fileName) || i18next.t('library.untitled');
}

function formatDate(time: number) {
  const date = new Date(time);
  const today = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(
    i18next.language,
    today ? { timeStyle: 'short' } : { dateStyle: 'medium' }
  ).format(date);
}

function compareNames(a: string, b: string) {
  return a.localeCompare(b, i18next.language, { numeric: true });
}

function sortEntries(entries: FolderEntry[]) {
  const folders = entries
    .filter((entry) => entry.kind === 'folder')
    .sort((a, b) => compareNames(a.name, b.name));
  const documents = entries
    .filter((entry) => entry.kind === 'document')
    .sort(
      (a, b) =>
        (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) ||
        compareNames(a.name, b.name)
    );
  return [...folders, ...documents];
}

function locationLabel(location: DocumentLocation) {
  switch (location.kind) {
    case 'icloud':
      return i18next.t('library.icloud');
    case 'local':
      return i18next.t('library.onMyDevice', { device: location.name });
    case 'folder':
      return location.name;
  }
}

/** A document at the top of a location is labelled with the location, not its folder's name. */
function folderLabel(
  path: string,
  folder: string,
  locations: DocumentLocation[]
) {
  const parent = path.slice(0, path.lastIndexOf('/'));
  const root = locations.find((location) => location.path === parent);
  return root ? locationLabel(root) : folder;
}

function isValidName(name: string) {
  return name !== '' && !name.includes('/') && !name.includes(':');
}

function failure(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  return i18next.t('library.errors.failed', { reason });
}

function paragraph(text: string) {
  return make('p', 'ny-library__empty', text);
}

function group(title: string, content: HTMLElement) {
  const node = make('section', 'ny-library__group');
  node.append(make('h2', '', title), content);
  return node;
}

function list(rows: HTMLElement[]) {
  const node = make('ul', 'ny-library__list');
  node.append(...rows);
  return node;
}

/** Puts `dialog` over the page in a modal; `closed` settles when it closes. */
function present(
  dialog: HTMLElement,
  kind: 'sheet' | 'dialog',
  initialFocus: HTMLElement = dialog
) {
  const overlay = make('div', `ny-library-overlay ny-library-overlay--${kind}`);
  overlay.append(dialog);
  document.body.append(overlay);
  let finish = () => {};
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const close = () => {
    modal.release();
    overlay.remove();
    finish();
  };
  const modal = openModal({ overlay, dialog, initialFocus, onDismiss: close });
  return { close, closed };
}

export class Library {
  private readonly app = requireElement(document, '#ny-app');
  private readonly section = make('section', 'ny-library');
  private readonly home: Page;
  private readonly pages: Page[];
  private locations: DocumentLocation[] = [];
  private locked: Element[] = [];

  private readonly onVisibility = () => {
    if (this.isOpen() && document.visibilityState === 'visible') {
      void this.refresh();
    }
  };

  constructor(private readonly host: LibraryHost) {
    ensureStyle('app-library', libraryStyles);
    this.section.id = 'ny-library';
    this.section.hidden = true;
    this.section.setAttribute('aria-label', i18next.t('library.title'));
    this.home = this.homePage();
    this.pages = [this.home];
    this.section.append(this.home.element);
    this.app.append(this.section);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Shows the home view, refreshed. */
  async show() {
    for (const page of this.pages.splice(1)) page.element.remove();
    this.home.element.removeAttribute('inert');
    this.section.hidden = false;
    for (const child of Array.from(this.app.children)) {
      if (child === this.section || child.hasAttribute('inert')) continue;
      child.setAttribute('inert', '');
      this.locked.push(child);
    }
    await this.reload(this.home);
  }

  hide() {
    this.section.hidden = true;
    for (const child of this.locked) child.removeAttribute('inert');
    this.locked = [];
  }

  isOpen() {
    return !this.section.hidden;
  }

  /** Re-reads what the visible view shows. */
  refresh() {
    return this.reload(this.pages[this.pages.length - 1]);
  }

  private async reload(page: Page) {
    try {
      await page.refresh();
    } catch (error) {
      console.error(error);
    }
  }

  private push(page: Page) {
    this.pages[this.pages.length - 1].element.setAttribute('inert', '');
    this.pages.push(page);
    this.section.append(page.element);
  }

  private pop() {
    const leaving = this.pages.pop() as Page;
    const below = this.pages[this.pages.length - 1];
    leaving.element.setAttribute('inert', '');
    leaving.element.classList.add('is-leaving');
    below.element.removeAttribute('inert');
    void animationsSettled(leaving.element).then(() =>
      leaving.element.remove()
    );
    void this.reload(below);
  }

  private async attempt(action: () => Promise<unknown>) {
    try {
      await action();
      return true;
    } catch (error) {
      await errorDialog(failure(error));
      return false;
    }
  }

  private async attemptThenRefresh(action: () => Promise<unknown>) {
    if (await this.attempt(action)) await this.refresh();
  }

  private pageFrame(kind: 'home' | 'folder', onCreate: () => unknown) {
    const page = make('div', `ny-library__page ny-library__page--${kind}`);
    const header = make('header', 'ny-library__header');
    const leading = make('div', 'ny-library__leading');
    const title = make('h1', '');
    const create = iconButton(
      'ny-library__icon-button ny-library__create',
      ICONS.plus,
      i18next.t('library.new'),
      onCreate
    );
    const scroll = make('div', 'ny-library__scroll');
    header.append(leading, title, create);
    page.append(header, scroll);
    return { page, leading, title, create, scroll };
  }

  private homePage(): Page {
    const { page, leading, title, create, scroll } = this.pageFrame(
      'home',
      () => {
        const folder = this.defaultFolder();
        if (folder) return this.attempt(() => this.host.createIn(folder));
      }
    );

    const renderChrome = () => {
      const heading = i18next.t('library.title');
      title.textContent = heading;
      this.section.setAttribute('aria-label', heading);
      create.setAttribute('aria-label', i18next.t('library.new'));
      leading.replaceChildren();
      if (this.host.currentPath() === null) return;
      leading.append(
        button('ny-library__text-button', i18next.t('library.done'), () =>
          this.host.close()
        )
      );
    };

    const renderContent = (
      recents: RecentDocument[],
      locations: DocumentLocation[]
    ) => {
      const current = this.host.currentPath();
      const recentRows = recents.map((recent) =>
        this.recentRow(recent, current, locations)
      );
      const locationRows = [
        ...locations.map((location) => this.locationRow(location)),
        this.row({
          icon: ICONS.folderPlus,
          name: i18next.t('library.addFolder'),
          tap: () => this.attemptThenRefresh(pickFolder),
        }),
        this.row({
          icon: ICONS.openOther,
          name: i18next.t('library.openOther'),
          tap: () => this.attempt(() => this.host.pickDocument()),
        }),
      ];
      scroll.replaceChildren(
        group(
          i18next.t('library.recents'),
          recentRows.length
            ? list(recentRows)
            : paragraph(i18next.t('library.recentsEmpty'))
        ),
        group(i18next.t('library.locations'), list(locationRows))
      );
    };

    return {
      element: page,
      refresh: async () => {
        renderChrome();
        const [recents, locations] = await Promise.all([
          recentDocuments(),
          documentLocations(),
        ]);
        this.locations = locations;
        create.disabled = this.defaultFolder() === null;
        renderContent(recents, locations);
      },
    };
  }

  private folderPage(title: string, path: string): Page {
    const frame = this.pageFrame('folder', () =>
      this.attempt(() => this.host.createIn(path))
    );
    frame.title.textContent = title;
    frame.leading.append(
      iconButton(
        'ny-library__icon-button ny-library__back',
        ICONS.back,
        i18next.t('library.back'),
        () => this.pop()
      )
    );

    const search = make('input', 'ny-library__search');
    const searchLabel = i18next.t('library.search');
    search.type = 'search';
    search.placeholder = searchLabel;
    search.setAttribute('aria-label', searchLabel);
    const results = make('div', 'ny-library__results');
    frame.scroll.append(search, results);

    let entries: FolderEntry[] | null = null;
    const render = () => {
      if (!entries) return;
      const query = search.value.trim();
      const needle = query.toLocaleLowerCase();
      const rows = entries
        .filter((entry) =>
          this.entryName(entry).toLocaleLowerCase().includes(needle)
        )
        .map((entry) => this.entryRow(entry));
      const content = rows.length
        ? list(rows)
        : paragraph(
            entries.length
              ? i18next.t('library.noMatches', { query })
              : i18next.t('library.folderEmpty')
          );
      results.replaceChildren(content);
    };
    search.addEventListener('input', render);

    return {
      element: frame.page,
      refresh: async () => {
        entries = sortEntries(await listFolder(path, MARKDOWN_EXTENSIONS));
        render();
      },
    };
  }

  private openFolder(title: string, path: string) {
    const page = this.folderPage(title, path);
    this.push(page);
    void this.reload(page);
  }

  private defaultFolder() {
    const pathOf = (kind: LocationKind) =>
      this.locations.find(
        (location) => location.kind === kind && location.available
      )?.path ?? null;
    return pathOf('icloud') ?? pathOf('local');
  }

  private row(spec: RowSpec) {
    const item = make('li', 'ny-library__item');
    const main = button('ny-library__row', '', () => spec.tap?.());
    const text = make('span', 'ny-library__text');
    const icon = make('span', 'ny-library__icon');
    icon.innerHTML = spec.icon;
    text.append(make('span', 'ny-library__name', spec.name));
    if (spec.detail) {
      text.append(make('span', 'ny-library__detail', spec.detail));
    }
    main.append(icon, text);
    if (spec.disclosure) {
      const disclosure = make('span', 'ny-library__disclosure');
      disclosure.innerHTML = ICONS.disclosure;
      main.append(disclosure);
    }
    if (spec.unavailable) main.setAttribute('aria-disabled', 'true');
    if (spec.current) main.setAttribute('aria-current', 'true');
    item.append(main);
    const actions = spec.actions ?? [];
    if (actions.length > 0) {
      item.append(
        iconButton(
          'ny-library__more',
          ICONS.more,
          i18next.t('library.more'),
          () => this.openSheet(spec.name, actions)
        )
      );
    }
    return item;
  }

  private recentRow(
    recent: RecentDocument,
    current: string | null,
    locations: DocumentLocation[]
  ) {
    const path = recent.available ? recent.path : null;
    const name = documentName(recent.name);
    const date = formatDate(recent.openedAt);
    const removal: SheetAction = {
      label: i18next.t('library.removeRecent'),
      run: () => this.attemptThenRefresh(() => removeRecent(recent.id)),
    };
    if (path === null) {
      return this.row({
        icon: ICONS.document,
        name,
        detail: i18next.t('library.documentUnavailable'),
        unavailable: true,
        tap: () => this.openSheet(name, [removal]),
        actions: [removal],
      });
    }
    return this.row({
      icon: ICONS.document,
      name,
      detail: recent.folder
        ? i18next.t('library.detail', {
            folder: folderLabel(path, recent.folder, locations),
            date,
          })
        : date,
      current: path === current,
      tap: () => this.attempt(() => this.host.open(path)),
      actions: [...this.itemActions(path, stemOf(recent.name), name), removal],
    });
  }

  private locationRow(location: DocumentLocation) {
    const label = locationLabel(location);
    const path = location.available ? location.path : null;
    const removal: SheetAction = {
      label: i18next.t('library.removeLocation'),
      run: () => this.attemptThenRefresh(() => removeFolder(location.id)),
    };
    return this.row({
      icon: LOCATION_ICONS[location.kind],
      name: label,
      detail:
        path === null
          ? i18next.t(
              location.kind === 'icloud'
                ? 'library.icloudUnavailable'
                : 'library.folderUnavailable'
            )
          : undefined,
      unavailable: path === null,
      disclosure: path !== null,
      tap: path === null ? undefined : () => this.openFolder(label, path),
      actions: location.kind === 'folder' ? [removal] : [],
    });
  }

  private entryName(entry: FolderEntry) {
    return entry.kind === 'folder' ? entry.name : documentName(entry.name);
  }

  private entryRow(entry: FolderEntry) {
    const name = this.entryName(entry);
    const actions = this.itemActions(
      entry.path,
      entry.kind === 'folder' ? entry.name : stemOf(entry.name),
      name
    );
    if (entry.kind === 'folder') {
      return this.row({
        icon: ICONS.folder,
        name,
        disclosure: true,
        tap: () => this.openFolder(name, entry.path),
        actions,
      });
    }
    const detail = [
      entry.modifiedAt === null ? '' : formatDate(entry.modifiedAt),
      entry.downloaded ? '' : i18next.t('library.notDownloaded'),
    ]
      .filter(Boolean)
      .join(' · ');
    return this.row({
      icon: ICONS.document,
      name,
      detail: detail || undefined,
      current: entry.path === this.host.currentPath(),
      tap: () => this.attempt(() => this.host.open(entry.path)),
      actions,
    });
  }

  private itemActions(path: string, stem: string, name: string): SheetAction[] {
    return [
      {
        label: i18next.t('library.rename'),
        run: () => this.openRename(path, stem),
      },
      {
        label: i18next.t('library.delete'),
        run: () => this.confirmDelete(path, name),
        destructive: true,
      },
    ];
  }

  private openSheet(name: string, actions: SheetAction[]) {
    const sheet = make('div', 'ny-library-sheet');
    sheet.setAttribute('aria-label', name);
    const { close } = present(sheet, 'sheet');
    for (const action of actions) {
      sheet.append(
        button(
          `ny-library-sheet__action${action.destructive ? ' ny-library-sheet__action--destructive' : ''}`,
          action.label,
          () => {
            close();
            return action.run();
          }
        )
      );
    }
    sheet.append(
      button(
        'ny-library-sheet__action ny-library-sheet__action--cancel',
        i18next.t('library.cancel'),
        close
      )
    );
  }

  /** Opens the rename dialog for the file at `path`, also while the library is hidden. */
  promptRename(path: string) {
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    return this.openRename(path, stemOf(fileName));
  }

  private openRename(path: string, stem: string) {
    const dialog = make('div', 'ny-library-dialog');
    const field = make('label', 'ny-library-dialog__field');
    const input = make('input', 'ny-library-dialog__input');
    const error = make('p', 'ny-library-dialog__error');
    input.type = 'text';
    input.value = stem;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    field.append(
      make(
        'span',
        'ny-library-dialog__label',
        i18next.t('library.renameLabel')
      ),
      input
    );
    const showError = (text: string) => {
      error.textContent = text;
      error.hidden = false;
    };
    input.addEventListener('input', () => {
      error.hidden = true;
    });

    const submit = async () => {
      const value = input.value.trim();
      if (!isValidName(value)) {
        showError(i18next.t('library.errors.invalidName'));
        return;
      }
      confirmButton.disabled = true;
      try {
        await this.host.rename(path, value);
      } catch (failed) {
        confirmButton.disabled = false;
        if (failed instanceof DocumentsError && failed.code === 'exists') {
          showError(i18next.t('library.errors.exists', { name: value }));
          return;
        }
        close();
        await errorDialog(failure(failed));
        return;
      }
      close();
      if (this.isOpen()) await this.refresh();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !forInputMethod(event)) void submit();
    });

    const confirmButton = button(
      'ny-library-dialog__button ny-library-dialog__button--primary',
      i18next.t('library.renameConfirm'),
      submit
    );
    const buttons = make('div', 'ny-library-dialog__buttons');
    buttons.append(
      button('ny-library-dialog__button', i18next.t('library.cancel'), () =>
        close()
      ),
      confirmButton
    );
    dialog.append(
      make('h2', '', i18next.t('library.renameTitle')),
      field,
      error,
      buttons
    );
    const { close, closed } = present(dialog, 'dialog', input);
    return closed;
  }

  private async confirmDelete(path: string, name: string) {
    const confirmed = await confirmDialog(i18next.t('library.deleteBody'), {
      title: i18next.t('library.deleteTitle', { name }),
      okLabel: i18next.t('library.deleteConfirm'),
      cancelLabel: i18next.t('library.cancel'),
    });
    if (confirmed) await this.attemptThenRefresh(() => this.host.remove(path));
  }
}
