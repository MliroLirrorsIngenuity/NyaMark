/**
 * The assistant docks to the right of the window, beside the outline, and
 * the document makes room for it. It is loaded the first time it is opened;
 * nothing of it is on the way to the first frame.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  listWorkspace,
  pickWorkspaceRoot,
  readImageForAi,
  readWorkspaceFile,
  searchWorkspace,
  webFetch,
  webSearch,
  workspaceRoots,
  writeWorkspaceFile,
} from '../../bridge/ipc/ai';
import {
  resolveDocumentAssetPath,
  toAssetUrl,
} from '../../bridge/ipc/attachments';
import { openExternalUrl } from '../../bridge/ipc/attachments';
import { openImageFilesDialog } from '../../bridge/ipc/files';
import { dragDropTarget, listenWindowFileDrop } from '../../bridge/ipc/windows';
import type { NyaEditor } from '../../editor/editor';
import { isNetworkPath } from '../../features/attachment-paths';
import { IMAGE_EXTENSIONS } from '../../features/attachment-policy';
import { i18next } from '../../i18n';
import { translateDOM } from '../../i18n/dom';
import {
  type AiEffort,
  type AiSettings,
  modelLabel,
} from '../../state/ai-settings';
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { isModalOpen } from '../../ui/modal';
import { keepReadingPosition } from '../../ui/reading-position';
import { Approvals } from '../agent/approvals';
import type { MarkdownTree } from '../agent/document-text';
import { buildInstructions } from '../agent/instructions';
import {
  ChatFailureError,
  ChatSession,
  type SessionChange,
  type TurnSetup,
} from '../agent/session';
import { documentTools } from '../agent/tools/document';
import { editTools } from '../agent/tools/edit';
import { imageTools } from '../agent/tools/image';
import { mcpTools } from '../agent/tools/mcp';
import { type WebApi, webTools } from '../agent/tools/web';
import { type WorkspaceApi, workspaceTools } from '../agent/tools/workspace';
import { EditController } from '../edit/controller';
import proposalStyles from '../edit/proposals.css?inline';
import { ConversationKeeper } from '../history/keeper';
import { conversationTitle } from '../history/saved';
import { prepareImage } from '../images/prepare';
import { mcpHub } from '../mcp/hub';
import { CHATGPT_USAGE_URL } from '../providers/chatgpt';
import { connectModel } from '../providers/connect';
import { nativeSearchTool } from '../providers/native-search';
import { AI_PRESETS } from '../providers/presets';
import { QuickMenu, type QuickMode } from '../quick/popover';
import { Composer } from './composer';
import { EffortMenu } from './effort-menu';
import { HistoryMenu } from './history-menu';
import { ICONS } from './icons';
import { MessageList } from './messages';
import { ModeMenu } from './mode-menu';
import { ModelPicker } from './model-picker';
import panelStyles from './panel.css?inline';

export type AiPanelHost = {
  editor: NyaEditor;
  /** The source pane's selection in the editor's document, null outside it. */
  sourceSelection: () => { from: number; to: number } | null;
  /** Pushes the source pane's edits into the editor; nothing outside it. */
  flushSource: () => void;
  /** Has the source pane follow a change made to the editor from `before`. */
  followSource: (before: ProseNode) => void;
  /** The open document's path, `null` while it is unsaved. */
  documentPath: () => string | null;
  /**
   * Opens the AI section of the settings; with `service`, the service set
   * up from that preset, to fill in.
   */
  openSettings: (service?: string) => void;
};

const WIDTH_KEY = 'nyamark.ai.width';
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
/** The panel never takes more of the window than this. */
const MAX_SHARE = 0.6;

function storedWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? value : null;
  } catch {
    return null;
  }
}

function applyWidth(width: number | null) {
  const root = document.documentElement;
  if (width == null) root.style.removeProperty('--ny-ai-width');
  else {
    root.style.setProperty(
      '--ny-ai-width',
      `min(${Math.round(width)}px, ${MAX_SHARE * 100}vw)`
    );
  }
}

function hasModels(ai: AiSettings): boolean {
  return ai.providers.some((provider) => provider.models.length > 0);
}

/** The chat model and what is known of it. */
function chatModel(ai: AiSettings) {
  const ref = ai.chatModel;
  const provider = ref && ai.providers.find((p) => p.id === ref.provider);
  if (!ref || !provider) return null;
  const model = provider.models.find((m) => m.id === ref.model);
  return {
    ref,
    provider,
    label: model ? modelLabel(model) : ref.model,
    vision: model?.vision ?? false,
  };
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Four letters that set this run's edits apart from those kept before. */
const editTag = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** What an empty conversation offers to ask, each sent as it reads. */
const SUGGESTIONS = [
  { icon: ICONS.summary, key: 'ai.empty.summarize' },
  { icon: ICONS.proofread, key: 'ai.empty.proofread' },
  { icon: ICONS.pen, key: 'ai.empty.continue' },
  { icon: ICONS.heading, key: 'ai.empty.nameIt' },
];

const WORKSPACE: WorkspaceApi = {
  roots: workspaceRoots,
  pickRoot: pickWorkspaceRoot,
  list: listWorkspace,
  read: readWorkspaceFile,
  search: searchWorkspace,
  write: writeWorkspaceFile,
};

const WEB: WebApi = { search: webSearch, fetch: webFetch };

function iconButton(
  icon: string,
  key: string,
  fallback: string,
  className = 'ny-ai__icon'
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = icon;
  button.title = fallback;
  button.setAttribute('aria-label', fallback);
  button.setAttribute('data-i18n-title', key);
  button.setAttribute('data-i18n-aria-label', key);
  return button;
}

/** Keeps the user's choice to run an MCP server's tool without asking. */
function allowMcpTool(server: string, tool: string) {
  const mcpServers = getSettings().ai.mcpServers.map((entry) =>
    entry.id === server && !entry.allowed.includes(tool)
      ? { ...entry, allowed: [...entry.allowed, tool] }
      : entry
  );
  void updateSettings({ ai: { mcpServers } }).catch(console.error);
}

/** Keeps the level of thought chosen with the chat model. */
function chooseEffort(effort: AiEffort | null) {
  const ai = getSettings().ai;
  const ref = ai.chatModel;
  if (!ref) return;
  const providers = ai.providers.map((provider) =>
    provider.id === ref.provider
      ? {
          ...provider,
          models: provider.models.map((model) =>
            model.id === ref.model
              ? { ...model, effort: effort ?? undefined }
              : model
          ),
        }
      : provider
  );
  void updateSettings({ ai: { providers } }).catch(console.error);
}

export class AiPanel {
  private readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly setup: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly picker: ModelPicker;
  private readonly effort: EffortMenu;
  private readonly list: MessageList;
  private readonly composer: Composer;
  private readonly session: ChatSession;
  private readonly edits: EditController;
  private readonly keeper: ConversationKeeper;
  private readonly history: HistoryMenu;
  private readonly approvals = new Approvals();
  private quick: QuickMenu | null = null;
  private readonly review: HTMLElement;
  private readonly reviewCount: HTMLElement;
  private readonly plan: HTMLElement;
  private readonly title: HTMLElement;
  private readonly mode: ModeMenu;
  private readonly newChat: HTMLButtonElement;
  private ai: AiSettings = getSettings().ai;
  private visible = false;
  private destroyed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly host: AiPanelHost) {
    ensureStyle('ai-panel', panelStyles);
    ensureStyle('ai-proposals', proposalStyles);
    applyWidth(storedWidth());

    this.edits = new EditController({
      editor: host.editor,
      sourceSelection: host.sourceSelection,
      flushSource: host.flushSource,
      followSource: host.followSource,
      editMode: () => getSettings().ai.editMode,
      localImage: async (src) => {
        const path = await resolveDocumentAssetPath(host.documentPath(), src);
        return path && !isNetworkPath(path) ? toAssetUrl(path) : null;
      },
      editTag: editTag(),
    });
    this.session = new ChatSession(() => this.prepareTurn());
    this.keeper = new ConversationKeeper({
      session: this.session,
      edits: this.edits,
      documentPath: host.documentPath,
      enabled: () => getSettings().ai.keepHistory,
      switched: () => this.approvals.reset(),
    });

    this.root = document.createElement('aside');
    this.root.className = 'ny-dock ny-ai';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'AI assistant');
    this.root.setAttribute('data-i18n-aria-label', 'ai.title');

    const resize = document.createElement('div');
    resize.className = 'ny-ai__resize';
    resize.title = 'Drag to resize';
    resize.setAttribute('data-i18n-title', 'ai.resize');
    this.bindResize(resize);

    const header = document.createElement('div');
    header.className = 'ny-dock__header';
    this.title = document.createElement('h2');
    this.title.className = 'ny-dock__title';
    this.picker = new ModelPicker({
      choose: (ref) => {
        void updateSettings({ ai: { chatModel: ref } }).catch(console.error);
      },
      manage: () => this.host.openSettings(),
    });
    this.effort = new EffortMenu(chooseEffort);
    this.newChat = iconButton(
      ICONS.newChat,
      'ai.newChat',
      'New chat',
      'ny-dock__icon'
    );
    this.newChat.addEventListener('click', () => {
      this.keeper.startNew();
      this.composer.focus();
    });
    this.history = new HistoryMenu({
      list: () => this.keeper.list(),
      current: () => this.keeper.current,
      open: (id) => this.keeper.open(id),
      remove: (id) => this.keeper.remove(id),
    });
    this.history.element.hidden = !this.ai.keepHistory;
    this.mode = new ModeMenu((editMode) => {
      void updateSettings({ ai: { editMode } }).catch(console.error);
    });
    const close = iconButton(ICONS.close, 'ai.close', 'Close', 'ny-dock__icon');
    close.addEventListener('click', () => this.hide());
    header.append(this.title, this.history.element, this.newChat, close);

    this.scroller = document.createElement('div');
    this.scroller.className = 'ny-ai__body';

    this.setup = this.setupState();
    this.empty = this.emptyState();

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'ny-ai__jump';
    jump.hidden = true;
    jump.innerHTML = ICONS.down;
    jump.title = 'Scroll to the end';
    jump.setAttribute('aria-label', 'Scroll to the end');
    jump.setAttribute('data-i18n-title', 'ai.jump');
    jump.setAttribute('data-i18n-aria-label', 'ai.jump');

    this.list = new MessageList(this.scroller, jump, {
      retry: () => void this.session.retry(),
      openSettings: () => this.host.openSettings(),
      edits: {
        outcome: (edit) => this.edits.outcome(edit),
        accept: (edit) => this.edits.acceptEdit(edit),
        reject: (edit) => this.edits.rejectEdit(edit),
        reveal: (edit) => this.edits.revealEdit(edit),
        documentName: () => {
          const path = this.host.documentPath();
          return path ? fileName(path) : null;
        },
      },
      approvals: {
        request: (id) => this.approvals.request(id),
        answer: (id, answer) => this.approvals.answer(id, answer),
      },
    });
    this.scroller.append(this.setup, this.empty, this.list.element, jump);

    this.composer = new Composer(
      {
        send: (text, images) => void this.session.send(text, images),
        stop: () => this.session.stop(),
        leave: () => this.host.editor.focus(),
        attach: () => void this.pickImages(),
        paste: (files) => void this.attachImages(files),
      },
      [this.picker.element, this.effort.element, this.mode.element],
      [this.mode.element, this.effort.element]
    );

    this.reviewCount = document.createElement('span');
    this.reviewCount.className = 'ny-ai__review-count';
    this.review = this.reviewBar();

    this.plan = this.planNote();

    const foot = document.createElement('div');
    foot.className = 'ny-ai__foot';
    foot.append(this.review, this.plan, this.composer.element);

    this.root.append(resize, header, this.scroller, foot);
    document.body.append(this.root);
    translateDOM(this.root);

    this.cleanups.push(
      this.session.subscribe((change) => this.sessionChanged(change)),
      subscribeSettings((settings) => this.settingsChanged(settings.ai)),
      this.edits.subscribe(() => this.editsChanged()),
      this.approvals.subscribe(() => this.list.refreshCards())
    );
    const onLanguage = () => {
      this.picker.update(this.ai);
      this.effort.redraw();
      this.list.redraw(this.session.entries);
      this.composer.redraw();
      this.mode.redraw();
      this.drawTitle();
      this.drawReview();
    };
    i18next.on('languageChanged', onLanguage);
    this.cleanups.push(() => i18next.off('languageChanged', onLanguage));
    this.drawVision();
    this.drawPlan();
    void this.bindDrop();
    // The servers the user added start with the assistant.
    mcpHub();
    void this.keeper.openLatest();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get hasFocus(): boolean {
    return this.root.contains(document.activeElement);
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      keepReadingPosition(this.host.editor.getView(), () => {
        this.root.hidden = false;
        document.documentElement.classList.add('ny-ai-open');
      });
      this.setPressed(true);
    }
    this.focus();
  }

  hide() {
    if (!this.visible) return;
    const hadFocus = this.hasFocus;
    this.visible = false;
    this.picker.destroy();
    this.effort.destroy();
    this.mode.destroy();
    this.history.destroy();
    this.keeper.flush();
    keepReadingPosition(this.host.editor.getView(), () => {
      this.root.hidden = true;
      document.documentElement.classList.remove('ny-ai-open');
    });
    this.setPressed(false);
    if (hadFocus) this.host.editor.focus();
  }

  /** Puts the caret where the user writes, or on the way to set up. */
  focus() {
    if (hasModels(this.ai)) this.composer.focus();
    else this.setup.querySelector<HTMLElement>('button')?.focus();
  }

  /**
   * Opens the AI menu at the selection or the caret, or runs one of its
   * slash commands there. Its edits are this panel's, to review alike.
   */
  ask(mode: QuickMode) {
    this.quick ??= new QuickMenu({
      editor: this.host.editor,
      edits: this.edits,
      documentPath: this.host.documentPath,
      openSettings: this.host.openSettings,
      toChat: (text) => {
        this.show();
        if (hasModels(this.ai)) this.composer.write(text);
      },
    });
    void this.quick.open(mode);
  }

  destroy() {
    this.destroyed = true;
    this.keeper.destroy();
    this.quick?.destroy();
    this.composer.images.clear();
    this.approvals.reset();
    this.session.clear();
    this.hide();
    for (const cleanup of this.cleanups) cleanup();
    this.edits.destroy();
    this.list.destroy();
    this.root.remove();
  }

  private setPressed(pressed: boolean) {
    document
      .getElementById('tb-ai')
      ?.setAttribute('aria-pressed', String(pressed));
  }

  /** Before any model is set up: where to set one up, and what can be. */
  private setupState() {
    const card = document.createElement('div');
    card.className = 'ny-ai__state ny-ai__state--setup';
    const tile = document.createElement('span');
    tile.className = 'ny-ai__tile ny-ai__tile--large';
    tile.innerHTML = ICONS.mark;
    const heading = document.createElement('h3');
    heading.className = 'ny-ai__state-title';
    heading.textContent = 'Connect an AI service';
    heading.setAttribute('data-i18n', 'ai.setup.title');
    const body = document.createElement('p');
    body.className = 'ny-ai__state-text';
    body.textContent = 'Add a service and a model in Settings to start.';
    body.setAttribute('data-i18n', 'ai.setup.body');
    // Each service opens in the settings, added and waiting for its key.
    const services = document.createElement('ul');
    services.className = 'ny-ai__services';
    for (const preset of AI_PRESETS) {
      if (preset.id === 'custom') continue;
      const service = document.createElement('button');
      service.type = 'button';
      service.className = 'ny-ai-service';
      const name = document.createElement('span');
      name.className = 'ny-ai-service__name';
      name.textContent = preset.name;
      service.append(name);
      service.insertAdjacentHTML('beforeend', ICONS.plus);
      service.addEventListener('click', () =>
        this.host.openSettings(preset.id)
      );
      const item = document.createElement('li');
      item.append(service);
      services.append(item);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'ny-ai__button ny-ai__button--ink ny-ai__button--wide';
    open.textContent = 'Open AI settings';
    open.setAttribute('data-i18n', 'ai.setup.action');
    open.addEventListener('click', () => this.host.openSettings());
    const note = document.createElement('p');
    note.className = 'ny-ai__state-note';
    note.textContent =
      'Any other service with an OpenAI-compatible API works too.';
    note.setAttribute('data-i18n', 'ai.setup.more');
    card.append(tile, heading, body, services, open, note);
    return card;
  }

  /** An empty conversation: what to ask, with a few things to ask at once. */
  private emptyState() {
    const card = document.createElement('div');
    card.className = 'ny-ai__state ny-ai__state--empty';
    const tile = document.createElement('span');
    tile.className = 'ny-ai__tile';
    tile.innerHTML = ICONS.mark;
    const heading = document.createElement('h3');
    heading.className = 'ny-ai__state-title';
    heading.textContent = 'What shall we write?';
    heading.setAttribute('data-i18n', 'ai.empty.title');
    const body = document.createElement('p');
    body.className = 'ny-ai__state-text';
    body.textContent =
      'Ask about this document, or ask for a draft, a rewrite or ideas.';
    body.setAttribute('data-i18n', 'ai.empty.body');
    const list = document.createElement('div');
    list.className = 'ny-ai__suggestions';
    for (const suggestion of SUGGESTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ny-ai__suggestion';
      button.innerHTML = suggestion.icon;
      const label = document.createElement('span');
      label.setAttribute('data-i18n', suggestion.key);
      button.append(label);
      button.addEventListener('click', () => {
        if (this.session.busy) return;
        void this.session.send(i18next.t(suggestion.key), []);
      });
      list.append(button);
    }
    card.append(tile, heading, body, list);
    return card;
  }

  /** Files dropped on the panel go with the next message. */
  private async bindDrop() {
    const unlisten = await listenWindowFileDrop((event) => {
      const { payload } = event;
      const over =
        this.visible &&
        !isModalOpen() &&
        dragDropTarget(payload)?.closest('.ny-ai') === this.root;
      this.root.classList.toggle(
        'is-drop-target',
        over && payload.type !== 'drop'
      );
      if (over && payload.type === 'drop') {
        void this.attachImages(
          payload.paths.map((path) => ({ path, name: fileName(path) }))
        );
      }
    }).catch((error) => {
      console.error('Failed to listen for dropped images:', error);
      return null;
    });
    if (!unlisten) return;
    if (this.destroyed) unlisten();
    else this.cleanups.push(unlisten);
  }

  private async pickImages() {
    let paths: string[];
    try {
      paths = await openImageFilesDialog(
        i18next.t('dialog.imageFilter'),
        IMAGE_EXTENSIONS
      );
    } catch (error) {
      console.error('Failed to choose images:', error);
      return;
    }
    await this.attachImages(
      paths.map((path) => ({ path, name: fileName(path) }))
    );
    this.composer.focus();
  }

  /** Reads the images and brings them within what services take, in turn. */
  private async attachImages(
    sources: Array<File | { path: string; name: string }>
  ) {
    const tray = this.composer.images;
    for (const source of sources) {
      if (this.destroyed) return;
      if (tray.room <= 0) {
        tray.full();
        return;
      }
      const name = source.name || i18next.t('ai.image.pasted');
      try {
        const bytes =
          source instanceof File ? source : await readImageForAi(source.path);
        tray.add(await prepareImage(bytes, name));
      } catch (error) {
        console.error('Failed to attach image:', error);
        tray.failed(name, error);
      }
    }
  }

  /** Warns when the images may not reach the model chosen. */
  private drawVision() {
    const model = chatModel(this.ai);
    this.composer.images.setBlind(model && !model.vision ? model.label : null);
  }

  private async prepareTurn(): Promise<TurnSetup> {
    const ai = getSettings().ai;
    const chosen = chatModel(ai);
    if (!chosen) {
      throw new ChatFailureError({ code: 'no-model', message: '' });
    }
    const { ref, provider, label, vision } = chosen;
    // What became of the earlier edits goes before the text it changed.
    const notices = await this.edits.notices();
    const document = await this.edits.read();
    const read = () => this.edits.read();
    const tree: MarkdownTree = (text) => this.host.editor.markdownTree(text);
    const folders = await workspaceRoots().catch(() => []);
    const native = ai.search.native ? nativeSearchTool(provider) : null;
    const hub = mcpHub();
    await hub.refresh().catch(console.error);
    const servers = hub.statuses.filter(
      (status) => status.state === 'ready' && status.tools.length > 0
    );
    return {
      model: connectModel(provider, ref.model, () => getSettings().ai.proxy),
      modelLabel: label,
      instructions: buildInstructions({
        documentPath: this.host.documentPath(),
        custom: ai.instructions,
        document: { ...document, tree },
        editMode: ai.editMode,
        notices,
        folders,
        vision,
        mcpServers: servers.map((status) => status.name),
      }),
      tools: {
        ...mcpTools({
          statuses: servers,
          servers: () => getSettings().ai.mcpServers,
          call: (server, tool, args) => hub.call(server, tool, args),
          approvals: this.approvals,
          allowAlways: allowMcpTool,
          prepare: vision ? prepareImage : undefined,
          show: vision
            ? (caption, images) => this.session.showModel(caption, images)
            : undefined,
        }),
        ...documentTools(read, tree, () => this.edits.notices()),
        ...editTools(this.edits),
        ...workspaceTools({
          api: WORKSPACE,
          approvals: this.approvals,
          documentPath: this.host.documentPath,
          readDocument: read,
          edits: this.edits,
        }),
        ...webTools({
          api: WEB,
          approvals: this.approvals,
          settings: () => getSettings().ai,
        }),
        // The service's own search, where the user prefers it and it has one.
        ...(native ? { web_search: native } : {}),
        ...(vision
          ? imageTools({
              resolve: (src) =>
                resolveDocumentAssetPath(this.host.documentPath(), src),
              read: readImageForAi,
              prepare: prepareImage,
              show: (caption, images) =>
                this.session.showModel(caption, images),
            })
          : {}),
      },
    };
  }

  private sessionChanged(change: SessionChange) {
    switch (change.kind) {
      case 'reset':
        this.list.reset(this.session.entries);
        break;
      case 'added':
        this.list.add(change.entry);
        break;
      case 'updated':
        this.list.update(change.entry);
        break;
      case 'removed':
        this.list.remove(change.entry);
        break;
    }
    this.composer.setBusy(this.session.busy);
    this.drawState();
  }

  private settingsChanged(ai: AiSettings) {
    this.ai = ai;
    this.picker.update(ai);
    this.effort.update(ai);
    this.history.element.hidden = !ai.keepHistory;
    if (!ai.keepHistory) this.history.destroy();
    this.mode.update(ai.editMode);
    this.drawState();
    this.drawVision();
    this.drawPlan();
  }

  private editsChanged() {
    this.list.refreshCards();
    this.drawReview();
  }

  /** The bar over the composer for the changes still waiting. */
  private reviewBar() {
    const bar = document.createElement('div');
    bar.className = 'ny-ai__review';
    bar.hidden = true;
    const dot = document.createElement('span');
    dot.className = 'ny-ai__review-dot';
    const prev = iconButton(ICONS.chevronUp, 'ai.edit.prev', 'Previous change');
    prev.addEventListener('click', () => this.edits.step(-1));
    const next = iconButton(ICONS.chevron, 'ai.edit.next', 'Next change');
    next.addEventListener('click', () => this.edits.step(1));
    const button = (key: string, fallback: string, className: string) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = fallback;
      element.setAttribute('data-i18n', key);
      return element;
    };
    const reject = button(
      'ai.edit.rejectAll',
      'Reject all',
      'ny-ai__review-button'
    );
    reject.addEventListener('click', () => this.edits.reject());
    const accept = button(
      'ai.edit.acceptAll',
      'Accept all',
      'ny-ai__review-button ny-ai__review-button--raised'
    );
    accept.addEventListener('click', () => this.edits.accept());
    bar.append(dot, this.reviewCount, prev, next, reject, accept);
    return bar;
  }

  /** Says whose money the replies cost when they come from a ChatGPT plan. */
  private planNote() {
    const note = document.createElement('div');
    note.className = 'ny-ai__plan';
    note.hidden = true;
    const logo = document.createElement('span');
    logo.className = 'ny-ai__plan-logo';
    logo.innerHTML = ICONS.chatgpt;
    const text = document.createElement('span');
    text.className = 'ny-ai__plan-text';
    text.textContent = 'Using your ChatGPT plan';
    text.setAttribute('data-i18n', 'ai.plan.using');
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'ny-ai__plan-manage';
    manage.textContent = 'Manage usage';
    manage.setAttribute('data-i18n', 'ai.plan.manage');
    manage.addEventListener('click', () => {
      void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
    });
    note.append(logo, text, manage);
    return note;
  }

  private drawPlan() {
    this.plan.hidden = chatModel(this.ai)?.provider.auth !== 'chatgpt';
  }

  private drawReview() {
    const count = this.edits.pending().length;
    this.review.hidden = count === 0;
    if (count === 0) return;
    const at = this.edits.position();
    this.reviewCount.textContent = at
      ? i18next.t('ai.edit.pendingAt', { count, at })
      : i18next.t('ai.edit.pending', { count });
  }

  /** The conversation's title, from what the user first asked. */
  private drawTitle() {
    const title = conversationTitle(this.session.entries);
    this.title.textContent = title || i18next.t('ai.title');
    this.title.title = title;
  }

  /** Setting up, an empty conversation, or the conversation. */
  private drawState() {
    const ready = hasModels(this.ai);
    const empty = this.list.isEmpty;
    this.setup.hidden = ready || !empty;
    this.empty.hidden = !ready || !empty;
    this.composer.element.hidden = !ready && empty;
    this.newChat.disabled = empty;
    this.drawTitle();
  }

  private bindResize(handle: HTMLElement) {
    let dragging = false;
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const limit = Math.min(MAX_WIDTH, window.innerWidth * MAX_SHARE);
      // From the card's right edge, which keeps its gap to the window's.
      const right = this.root.getBoundingClientRect().right;
      const width = Math.max(MIN_WIDTH, Math.min(limit, right - event.clientX));
      applyWidth(width);
    };
    const end = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.documentElement.classList.remove('ny-ai-resizing');
      handle.releasePointerCapture(event.pointerId);
      try {
        localStorage.setItem(
          WIDTH_KEY,
          String(Math.round(this.root.getBoundingClientRect().width))
        );
      } catch {
        // The width is kept for this window alone.
      }
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.documentElement.classList.add('ny-ai-resizing');
    });
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // A double click goes back to the width the window gives it.
    handle.addEventListener('dblclick', () => {
      applyWidth(null);
      try {
        localStorage.removeItem(WIDTH_KEY);
      } catch {
        // Nothing was kept.
      }
    });
  }
}
