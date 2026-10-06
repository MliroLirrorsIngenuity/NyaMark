import { openExternalUrl } from '../../bridge/ipc/attachments';
import { basenamePath } from '../../features/attachment-paths';
import { i18next } from '../../i18n';
import type { ApprovalAnswer, ApprovalRequest } from '../agent/approvals';
import type { DiffRow } from '../agent/line-diff';
import {
  type AssistantEntry,
  type ChatEntry,
  type ChatPart,
  type ToolPart,
  type UserEntry,
  replyText,
} from '../agent/session';
import type { ViewImageOutput } from '../agent/tools/image';
import { type McpOutput, isMcpToolName } from '../agent/tools/mcp';
import type { EditOutcome } from '../edit/controller';
import type { ChatImage } from '../images/image';
import { CHATGPT_USAGE_URL } from '../providers/chatgpt';
import { isOpenableLink, renderChatMarkdown } from '../render/markdown';
import { copyText } from './clipboard';
import {
  FAILURE_TEXT,
  SELF_EXPLAINED,
  SETTINGS_FIXES,
  USAGE_FIXES,
} from './failure';
import { ICONS } from './icons';
import { imageUrl } from './image-tray';
import { proposedEdit, searchSources, toolLabel } from './tool-labels';

/** Within this of the end, the list keeps following a reply as it grows. */
const NEAR_END_PX = 32;
/** A streaming reply is drawn again at most this often. */
const STREAM_RENDER_MS = 50;
/** How long a copy button says it copied. */
const COPIED_MS = 1500;

const ENDING_TEXT: Record<NonNullable<AssistantEntry['ending']>, string> = {
  'step-limit': 'ai.ending.stepLimit',
  length: 'ai.ending.length',
  filtered: 'ai.ending.filtered',
};

const TOOL_ICONS: Record<ToolPart['state'], string> = {
  running: '',
  done: ICONS.check,
  denied: ICONS.alert,
  error: ICONS.alert,
  stopped: ICONS.dash,
};

/**
 * The reasoning and tool calls between two runs of text, folded into one
 * line; the questions and edits they raise sit under it, out of the fold.
 */
/** A fold's icon, by what its steps came to; a live one spins instead. */
const STEP_ICONS: Record<string, string> = {
  done: ICONS.check,
  error: ICONS.alert,
  stopped: ICONS.dash,
  thought: ICONS.sparkle,
};

type StepGroup = {
  root: HTMLElement;
  fold: HTMLDetailsElement;
  head: HTMLElement;
  icon: HTMLElement;
  label: HTMLElement;
  list: HTMLElement;
  cards: HTMLElement;
  /** Where its parts are in the reply. */
  indexes: number[];
  shown: string;
};

type PartView = {
  type: ChatPart['type'];
  root: HTMLElement;
  body: HTMLElement;
  /** A reasoning part's label, or a tool part's state icon. */
  summary: HTMLElement | null;
  shown: string;
  /** The fold a reasoning or tool part is in. */
  group?: StepGroup;
  /** Where a tool part's question and edit go, under the fold. */
  slot?: HTMLElement;
  /** The edit a tool part proposed, and its card. */
  edit?: { id: string; card: HTMLElement; shown: string };
  /** A tool part's call id, and the question it waits on the user for. */
  toolId?: string;
  approval?: { request: ApprovalRequest; card: HTMLElement };
  /** The pages a web search found, under its line. */
  sources?: HTMLElement;
  /** The image a tool opened, under its line. */
  image?: HTMLElement;
};

type EntryView = {
  root: HTMLElement;
  content: HTMLElement;
  parts: PartView[];
  groups: StepGroup[];
  pending: HTMLElement | null;
  status: HTMLElement;
  foot: HTMLElement;
  /** What the status and foot show, to draw them only when it changes. */
  shownState: string;
};

/** What the cards of the assistant's edits show and do. */
export type EditCardActions = {
  outcome(edit: string): EditOutcome | null;
  accept(edit: string): void;
  reject(edit: string): void;
  reveal(edit: string): void;
  /** The open document's file name; null while it is unsaved. */
  documentName(): string | null;
};

export type MessageListActions = {
  retry: () => void;
  openSettings: () => void;
  edits?: EditCardActions;
  approvals?: {
    request(id: string): ApprovalRequest | null;
    answer(id: string, answer: ApprovalAnswer): void;
  };
};

const DIFF_MARKS: Record<DiffRow['kind'], string> = {
  same: ' ',
  removed: '-',
  added: '+',
  gap: '',
};

/** What became of an edit, when none of it is pending. */
function outcomeText(outcome: EditOutcome): string {
  const { total, accepted, rejected, dropped, replaced } = outcome;
  if (accepted === total) return i18next.t('ai.edit.accepted');
  if (rejected === total) return i18next.t('ai.edit.rejected');
  const parts: string[] = [];
  if (accepted)
    parts.push(i18next.t('ai.edit.someAccepted', { count: accepted }));
  if (rejected)
    parts.push(i18next.t('ai.edit.someRejected', { count: rejected }));
  if (dropped) parts.push(i18next.t('ai.edit.someDropped', { count: dropped }));
  if (replaced) {
    parts.push(i18next.t('ai.edit.someReplaced', { count: replaced }));
  }
  return parts.join(' · ');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon: string, label: string, className = '') {
  const button = el('button', `ny-ai__icon ${className}`.trim());
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

function compact(value: number): string {
  return new Intl.NumberFormat(i18next.language, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export class MessageList {
  readonly element: HTMLElement;
  /** Every message's element, by entry id. */
  private readonly roots = new Map<number, HTMLElement>();
  private readonly views = new Map<number, EntryView>();
  private readonly dirty = new Set<AssistantEntry>();
  /** The thumbnails' addresses, by entry id, to revoke with the entry. */
  private readonly urls = new Map<number, string[]>();
  private timer: number | null = null;
  private lastRender = 0;
  /** Whether the list scrolls with a reply as it grows. */
  private following = true;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly jump: HTMLButtonElement,
    private readonly actions: MessageListActions
  ) {
    this.element = el('div', 'ny-ai__messages');
    this.element.setAttribute('role', 'log');
    this.element.addEventListener('click', this.onClick);
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    jump.addEventListener('click', () => {
      this.following = true;
      this.scrollToEnd('smooth');
    });
  }

  get isEmpty(): boolean {
    return this.roots.size === 0;
  }

  reset(entries: readonly ChatEntry[]) {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
    this.views.clear();
    this.roots.clear();
    this.revoke();
    this.element.replaceChildren();
    for (const entry of entries) this.add(entry);
    this.following = true;
    this.scrollToEnd('auto');
  }

  add(entry: ChatEntry) {
    if (entry.role === 'user') {
      const root = this.userView(entry);
      this.roots.set(entry.id, root);
      this.element.append(root);
      // Sending is reading on from the bottom.
      this.following = true;
    } else {
      const view = this.assistantView();
      this.views.set(entry.id, view);
      this.roots.set(entry.id, view.root);
      this.element.append(view.root);
      this.draw(entry, view);
    }
    this.scrollToEnd('auto');
  }

  update(entry: ChatEntry) {
    if (entry.role !== 'assistant') return;
    this.dirty.add(entry);
    if (entry.status !== 'streaming') {
      this.flush();
      return;
    }
    this.schedule();
  }

  remove(entry: ChatEntry) {
    this.roots.get(entry.id)?.remove();
    this.roots.delete(entry.id);
    this.views.delete(entry.id);
    this.revoke(entry.id);
    if (entry.role === 'assistant') this.dirty.delete(entry);
  }

  /**
   * Draws again what became of each edit and what each tool asks, as after
   * one was accepted or answered.
   */
  refreshCards() {
    for (const view of this.views.values()) {
      for (const part of view.parts) {
        if (part.edit) this.drawEdit(part);
        if (part.toolId) this.drawApproval(part);
      }
    }
  }

  /** Draws every reply again, as after the language changed. */
  redraw(entries: readonly ChatEntry[]) {
    for (const entry of entries) {
      const view = this.views.get(entry.id);
      if (entry.role !== 'assistant' || !view) continue;
      view.shownState = '';
      for (const group of view.groups) group.shown = '';
      for (const part of view.parts) {
        part.shown = '\u0000';
        if (part.edit) part.edit.shown = '\u0000';
        part.approval?.card.remove();
        part.approval = undefined;
      }
      this.draw(entry, view);
    }
  }

  destroy() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.revoke();
  }

  /** Lets go of the thumbnails of one entry, or of all of them. */
  private revoke(id?: number) {
    const ids = id == null ? [...this.urls.keys()] : [id];
    for (const key of ids) {
      for (const url of this.urls.get(key) ?? []) URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }

  private thumbnail(id: number, image: ChatImage) {
    const url = imageUrl(image);
    const urls = this.urls.get(id) ?? [];
    urls.push(url);
    this.urls.set(id, urls);
    const thumb = el('img', 'ny-ai-thumb');
    thumb.src = url;
    thumb.alt = image.name;
    thumb.title = `${image.name} · ${image.width}×${image.height}`;
    return thumb;
  }

  private schedule() {
    if (this.timer != null) return;
    const wait = Math.max(
      0,
      this.lastRender + STREAM_RENDER_MS - performance.now()
    );
    this.timer = window.setTimeout(() => {
      requestAnimationFrame(() => this.flush());
    }, wait);
  }

  private flush() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    for (const entry of this.dirty) {
      const view = this.views.get(entry.id);
      if (view) this.draw(entry, view);
    }
    this.dirty.clear();
    this.lastRender = performance.now();
    if (this.following) this.scrollToEnd('auto');
    else this.updateJump();
  }

  private scrollToEnd(behavior: ScrollBehavior) {
    this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior });
    this.updateJump();
  }

  private distanceToEnd() {
    const { scrollHeight, scrollTop, clientHeight } = this.scroller;
    return scrollHeight - scrollTop - clientHeight;
  }

  private updateJump() {
    this.jump.hidden = this.following || this.distanceToEnd() <= NEAR_END_PX;
  }

  private onScroll = () => {
    this.following = this.distanceToEnd() <= NEAR_END_PX;
    this.updateJump();
  };

  private userView(entry: UserEntry) {
    const root = el('div', 'ny-ai-msg ny-ai-msg--user');
    if (entry.images.length > 0) {
      const images = el('div', 'ny-ai-msg__images');
      for (const image of entry.images) {
        images.append(this.thumbnail(entry.id, image));
      }
      root.append(images);
    }
    if (entry.text) root.append(el('div', 'ny-ai-msg__text', entry.text));
    return root;
  }

  private assistantView(): EntryView {
    const root = el('div', 'ny-ai-msg ny-ai-msg--assistant');
    const avatar = el('span', 'ny-ai-msg__avatar');
    avatar.innerHTML = ICONS.mark;
    const main = el('div', 'ny-ai-msg__main');
    const content = el('div', 'ny-ai-msg__content');
    const status = el('div', 'ny-ai-msg__status');
    const foot = el('div', 'ny-ai-msg__foot');
    main.append(content, status, foot);
    root.append(avatar, main);
    return {
      root,
      content,
      parts: [],
      groups: [],
      pending: null,
      status,
      foot,
      shownState: '',
    };
  }

  private draw(entry: AssistantEntry, view: EntryView) {
    const streaming = entry.status === 'streaming';
    // A reply's parts only grow; any other change draws it afresh.
    const changed =
      view.parts.length > entry.parts.length ||
      view.parts.some(
        (shown, index) => shown.type !== entry.parts[index]?.type
      );
    if (changed) {
      view.content.replaceChildren();
      view.parts = [];
      view.groups = [];
      view.pending = null;
    }
    for (const [index, part] of entry.parts.entries()) {
      const shown = view.parts[index] ?? this.place(view, part.type, index);
      if (part.type === 'tool') {
        this.drawTool(part, shown, entry.id);
        continue;
      }
      if (part.type === 'reasoning' && shown.summary) {
        const thinking = streaming && index === entry.parts.length - 1;
        shown.summary.textContent = i18next.t(
          thinking ? 'ai.thinkingNow' : 'ai.thinking'
        );
      }
      if (shown.shown === part.text) continue;
      shown.shown = part.text;
      if (part.type === 'reasoning') {
        shown.body.textContent = part.text;
      } else {
        shown.body.innerHTML = renderChatMarkdown(part.text);
        this.addCodeCopyButtons(shown.body);
      }
    }
    for (const group of view.groups) this.drawGroup(entry, group);

    // Waiting for the first word, or for what the model makes of a tool's
    // result.
    const last = entry.parts[entry.parts.length - 1];
    const waiting =
      streaming &&
      (!last || (last.type === 'tool' && last.state !== 'running'));
    if (waiting) {
      if (!view.pending) {
        view.pending = el('div', 'ny-ai-msg__pending');
        view.pending.setAttribute('aria-label', i18next.t('ai.waiting'));
        view.pending.append(el('span', ''), el('span', ''), el('span', ''));
      }
      view.content.append(view.pending);
    } else if (view.pending) {
      view.pending.remove();
      view.pending = null;
    }

    const state = [
      entry.status,
      entry.error?.code ?? '',
      entry.error?.message ?? '',
      entry.model,
      entry.usage?.input ?? '',
      entry.usage?.output ?? '',
      entry.ending ?? '',
      i18next.language,
    ].join('\u0000');
    if (state === view.shownState) return;
    view.shownState = state;
    this.drawStatus(entry, view.status);
    this.drawFoot(entry, view.foot);
  }

  /**
   * A new part's view, put in place: text in the reply, any other part in
   * the fold of the steps just before it, or in a new one.
   */
  private place(
    view: EntryView,
    type: ChatPart['type'],
    index: number
  ): PartView {
    const shown = this.partView(type);
    view.parts[index] = shown;
    if (type === 'text') {
      view.content.append(shown.root);
      return shown;
    }
    const group = view.parts[index - 1]?.group ?? this.stepGroup(view);
    group.list.append(shown.root);
    group.indexes.push(index);
    shown.group = group;
    if (type === 'tool') {
      shown.slot = el('div', 'ny-ai-steps__slot');
      group.cards.append(shown.slot);
    }
    return shown;
  }

  private stepGroup(view: EntryView): StepGroup {
    const root = el('div', 'ny-ai-steps');
    const fold = el('details', 'ny-ai-steps__fold');
    const head = el('summary', 'ny-ai-steps__head');
    const icon = el('span', 'ny-ai-steps__icon');
    const label = el('span', 'ny-ai-steps__label');
    const chevron = el('span', 'ny-ai-steps__chevron');
    chevron.innerHTML = ICONS.chevronRight;
    head.append(icon, label, chevron);
    // One step with nothing under it has nothing to unfold.
    head.addEventListener('click', (event) => {
      if (root.classList.contains('is-flat')) event.preventDefault();
    });
    const list = el('div', 'ny-ai-steps__list');
    fold.append(head, list);
    const cards = el('div', 'ny-ai-steps__cards');
    root.append(fold, cards);
    view.content.append(root);
    const group: StepGroup = {
      root,
      fold,
      head,
      icon,
      label,
      list,
      cards,
      indexes: [],
      shown: '',
    };
    view.groups.push(group);
    return group;
  }

  /** The fold's line: what is going on now, or what the steps came to. */
  private drawGroup(entry: AssistantEntry, group: StepGroup) {
    const parts = group.indexes.map((index) => entry.parts[index]);
    const tools = parts.filter(
      (part): part is ToolPart => part?.type === 'tool'
    );
    const lastIndex = group.indexes[group.indexes.length - 1] ?? -1;
    const streaming = entry.status === 'streaming';
    const running = streaming
      ? tools.find((tool) => tool.state === 'running')
      : undefined;
    const thinking =
      streaming &&
      lastIndex === entry.parts.length - 1 &&
      entry.parts[lastIndex]?.type === 'reasoning';
    const failed = tools.some(
      (tool) => tool.state === 'error' || tool.state === 'denied'
    );
    const stopped = tools.some((tool) => tool.state === 'stopped');

    let label: string;
    if (running) label = toolLabel(running);
    else if (thinking) label = i18next.t('ai.thinkingNow');
    else if (tools.length === 0) label = i18next.t('ai.thinking');
    else if (tools.length === 1) {
      label = toolLabel(tools[0] as ToolPart);
      if (parts.length > 1) label += ` · ${i18next.t('ai.thinking')}`;
    } else {
      label = i18next.t(failed ? 'ai.steps.failed' : 'ai.steps.done', {
        count: tools.length,
      });
    }
    let state = 'done';
    if (running || thinking) state = 'live';
    else if (failed) state = 'error';
    else if (stopped) state = 'stopped';
    else if (tools.length === 0) state = 'thought';

    const single = parts.length === 1;
    const only = single ? group.list.firstElementChild : null;
    const flat =
      single &&
      tools.length === 1 &&
      !only?.querySelector('.ny-ai-sources, .ny-ai-tool__image');
    const key = [label, state, single, flat, i18next.language].join('\u0000');
    if (group.shown === key) return;
    group.shown = key;
    group.label.textContent = label;
    group.head.title = label;
    group.root.dataset.state = state;
    group.root.classList.toggle('is-single', single);
    group.root.classList.toggle('is-flat', flat);
    group.head.tabIndex = flat ? -1 : 0;
    if (flat) group.fold.open = false;
    group.icon.innerHTML = STEP_ICONS[state] ?? '';
  }

  private partView(type: ChatPart['type']): PartView {
    if (type === 'text') {
      const body = el('div', 'ny-ai-md');
      return { type, root: body, body, summary: null, shown: '\u0000' };
    }
    if (type === 'tool') {
      const root = el('div', 'ny-ai-tool');
      const line = el('div', 'ny-ai-tool__line');
      const icon = el('span', 'ny-ai-tool__icon');
      const body = el('span', 'ny-ai-tool__label');
      line.append(icon, body);
      root.append(line);
      return { type, root, body, summary: icon, shown: '\u0000' };
    }
    const root = el('div', 'ny-ai-reasoning');
    const summary = el('div', 'ny-ai-reasoning__label');
    const body = el('div', 'ny-ai-reasoning__text');
    root.append(summary, body);
    return { type, root, body, summary, shown: '\u0000' };
  }

  private drawTool(part: ToolPart, view: PartView, entryId: number) {
    const label = toolLabel(part);
    const key = [part.state, label, part.error ?? ''].join('\u0000');
    if (view.shown === key) return;
    view.shown = key;
    view.root.dataset.state = part.state;
    view.body.textContent = label;
    view.body.title = part.error ? `${label}\n${part.error}` : label;
    view.toolId = part.id;
    this.drawApproval(view);
    this.drawSources(view, part);
    this.drawImage(view, part, entryId);
    if (view.summary) view.summary.innerHTML = TOOL_ICONS[part.state];
    const edit = this.actions.edits ? proposedEdit(part) : null;
    if (edit !== (view.edit?.id ?? null)) {
      view.edit?.card.remove();
      view.edit = undefined;
      if (edit && view.slot) {
        const card = el('div', 'ny-ai-edit');
        card.dataset.edit = edit;
        card.hidden = true;
        view.slot.append(card);
        view.edit = { id: edit, card, shown: '\u0000' };
      }
    }
    if (view.edit) this.drawEdit(view);
  }

  /** The question a tool waits on the user for, under the fold. */
  private drawApproval(view: PartView) {
    const id = view.toolId;
    const request = id ? (this.actions.approvals?.request(id) ?? null) : null;
    if (request === (view.approval?.request ?? null)) return;
    view.approval?.card.remove();
    view.approval = undefined;
    if (!id || !request || !view.slot) return;
    const card = el('div', 'ny-ai-approval');
    card.dataset.approval = id;
    card.setAttribute('role', 'group');
    const head = el('div', 'ny-ai-approval__head');
    const button = (answer: ApprovalAnswer, key: string) => {
      const element = el(
        'button',
        `ny-ai__button${answer === 'allow' ? ' ny-ai__button--primary' : ''}`,
        i18next.t(key)
      );
      element.type = 'button';
      element.dataset.approvalAnswer = answer;
      return element;
    };
    const note = (text: string) => el('div', 'ny-ai-approval__note', text);
    const actions = el('div', 'ny-ai-approval__actions');
    let box: HTMLElement | null = null;
    let title: string;
    if (request.kind === 'folder') {
      title = i18next.t('ai.approval.folder');
      head.append(note(request.reason));
      actions.append(
        button('deny', 'ai.approval.notNow'),
        button('allow', 'ai.approval.chooseFolder')
      );
    } else if (request.kind === 'page') {
      title = i18next.t('ai.approval.page');
      head.append(
        note(i18next.t('ai.approval.pageNote', { host: request.host }))
      );
      box = el('div', 'ny-ai-approval__box ny-ai-approval__url', request.url);
      box.title = request.url;
      actions.append(
        button('deny', 'ai.approval.deny'),
        button('allow', 'ai.approval.open')
      );
    } else if (request.kind === 'tool') {
      title = i18next.t('ai.approval.tool', {
        tool: request.tool,
        server: request.serverName,
      });
      head.append(note(i18next.t('ai.approval.toolNote')));
      box = el('pre', 'ny-ai-approval__box', request.input);
      actions.append(
        button('deny', 'ai.approval.deny'),
        button('always', 'ai.approval.alwaysTool'),
        button('allow', 'ai.approval.allow')
      );
    } else {
      title = i18next.t(
        request.created ? 'ai.approval.create' : 'ai.approval.change',
        { file: basenamePath(request.path) }
      );
      const { diff } = request;
      const meta = el('div', 'ny-ai-approval__meta');
      // The path is cut from its start, to keep the file in view; in its
      // own left-to-right run, its slashes stay in order under that cut.
      const path = el('span', 'ny-ai-approval__path');
      const run = el('bdi', '', request.path);
      run.dir = 'ltr';
      path.append(run);
      path.title = request.path;
      meta.append(
        path,
        el('span', 'is-added', `+${diff.added}`),
        el('span', 'is-removed', `−${diff.removed}`)
      );
      head.append(meta);
      box = el('div', 'ny-ai-approval__box ny-ai-diff');
      for (const row of diff.rows) {
        const line = el('div', `ny-ai-diff__row is-${row.kind}`);
        if (row.kind === 'gap') {
          line.textContent = i18next.t('ai.approval.gap', {
            count: Number(row.text),
          });
        } else {
          line.append(
            el('span', 'ny-ai-diff__mark', DIFF_MARKS[row.kind]),
            el('span', 'ny-ai-diff__text', row.text)
          );
        }
        box.append(line);
      }
      if (diff.truncated) {
        box.append(
          el('div', 'ny-ai-diff__row is-gap', i18next.t('ai.approval.more'))
        );
      }
      actions.append(
        button('deny', 'ai.approval.deny'),
        button('always', 'ai.approval.always'),
        button('allow', 'ai.approval.allow')
      );
    }
    head.prepend(el('div', 'ny-ai-approval__title', title));
    card.setAttribute('aria-label', title);
    card.append(head);
    if (box) card.append(box);
    card.append(actions);
    view.slot.prepend(card);
    view.approval = { request, card };
  }

  /** The images a tool opened or returned, as the model was shown them. */
  private drawImage(view: PartView, part: ToolPart, entryId: number) {
    if (view.image || part.state !== 'done') return;
    let images: ChatImage[] = [];
    if (part.name === 'view_image') {
      const image = (part.output as ViewImageOutput | undefined)?.image;
      if (image) images = [image];
    } else if (isMcpToolName(part.name)) {
      images = (part.output as McpOutput | undefined)?.images ?? [];
    }
    if (images.length === 0) return;
    const row = el('div', 'ny-ai-tool__image');
    for (const image of images) row.append(this.thumbnail(entryId, image));
    view.root.append(row);
    view.image = row;
  }

  /** The pages a finished web search found, under its line in the fold. */
  private drawSources(view: PartView, part: ToolPart) {
    view.sources?.remove();
    view.sources = undefined;
    const sources = part.state === 'done' ? searchSources(part) : [];
    if (sources.length === 0) return;
    const list = el('ol', 'ny-ai-sources');
    list.setAttribute(
      'aria-label',
      i18next.t('ai.tool.sources', { count: sources.length })
    );
    for (const source of sources) {
      let host = source.url;
      try {
        host = new URL(source.url).hostname.replace(/^www\./, '');
      } catch {
        // Shown as given.
      }
      const link = el('a', 'ny-ai-sources__link');
      link.href = source.url;
      link.title = source.url;
      link.append(
        el('span', 'ny-ai-sources__title', source.title || host),
        el('span', 'ny-ai-sources__host', host)
      );
      const item = el('li', '');
      item.append(link);
      list.append(item);
    }
    view.root.insertBefore(list, view.image ?? null);
    view.sources = list;
  }

  /**
   * The card of an edit to the document: which file, what is pending or
   * became of it, and buttons for its changes while any are pending.
   */
  private drawEdit(view: PartView) {
    const edit = view.edit;
    const edits = this.actions.edits;
    if (!edit || !edits) return;
    const outcome = edits.outcome(edit.id);
    const name = edits.documentName();
    const key = outcome
      ? [JSON.stringify(outcome), name, i18next.language].join('\u0000')
      : '';
    if (edit.shown === key) return;
    edit.shown = key;
    edit.card.replaceChildren();
    edit.card.hidden = !outcome;
    if (!outcome) return;
    const pending = outcome.pending > 0;
    edit.card.classList.toggle('is-settled', !pending);
    // While any change is pending, the card finds them in the document.
    const open = el(pending ? 'button' : 'div', 'ny-ai-edit__open');
    if (open instanceof HTMLButtonElement) {
      open.type = 'button';
      open.dataset.editAction = 'reveal';
      open.title = i18next.t('ai.edit.show');
    }
    const tile = el('span', 'ny-ai-edit__tile');
    tile.innerHTML = ICONS.file;
    const text = el('span', 'ny-ai-edit__text');
    text.append(
      el('span', 'ny-ai-edit__name', name ?? i18next.t('ai.edit.thisDocument')),
      el(
        'span',
        'ny-ai-edit__meta',
        pending
          ? i18next.t('ai.edit.pending', { count: outcome.pending })
          : outcomeText(outcome)
      )
    );
    open.append(tile, text);
    edit.card.append(open);
    if (!pending) return;
    const button = (
      action: string,
      key: string,
      title: string,
      ink = false
    ) => {
      const element = el(
        'button',
        `ny-ai__button ny-ai__button--small${ink ? ' ny-ai__button--ink' : ''}`,
        i18next.t(key)
      );
      element.type = 'button';
      element.title = i18next.t(title);
      element.dataset.editAction = action;
      return element;
    };
    edit.card.append(
      button('reject', 'ai.edit.reject', 'ai.edit.rejectAll'),
      button('accept', 'ai.edit.accept', 'ai.edit.acceptAll', true)
    );
  }

  private addCodeCopyButtons(body: HTMLElement) {
    for (const pre of body.querySelectorAll('pre')) {
      const button = el('button', 'ny-ai-md__copy', i18next.t('ai.copy'));
      button.type = 'button';
      pre.append(button);
    }
  }

  private drawStatus(entry: AssistantEntry, status: HTMLElement) {
    status.replaceChildren();
    if (entry.status === 'stopped') {
      status.append(el('div', 'ny-ai-msg__note', i18next.t('ai.stopped')));
      return;
    }
    if (entry.status === 'done' && entry.ending) {
      status.append(
        el('div', 'ny-ai-msg__note', i18next.t(ENDING_TEXT[entry.ending]))
      );
      return;
    }
    if (entry.status !== 'error' || !entry.error) return;
    const { code, message, status: httpStatus } = entry.error;
    const card = el('div', 'ny-ai-msg__error');
    card.setAttribute('role', 'alert');
    card.append(
      el('div', '', i18next.t(FAILURE_TEXT[code], { status: httpStatus }))
    );
    if (message && !SELF_EXPLAINED.has(code)) {
      card.append(el('div', 'ny-ai-msg__error-detail', message));
    }
    const actions = el('div', 'ny-ai-msg__actions');
    if (SETTINGS_FIXES.has(code)) {
      const open = el(
        'button',
        'ny-ai__button ny-ai__button--primary',
        i18next.t('ai.openSettings')
      );
      open.type = 'button';
      open.addEventListener('click', () => this.actions.openSettings());
      actions.append(open);
    }
    if (USAGE_FIXES.has(code)) {
      const usage = el(
        'button',
        'ny-ai__button ny-ai__button--primary',
        i18next.t('ai.plan.manage')
      );
      usage.type = 'button';
      usage.addEventListener('click', () => {
        void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
      });
      actions.append(usage);
    }
    const retry = el(
      'button',
      'ny-ai__button ny-ai-msg__retry',
      i18next.t('ai.retry')
    );
    retry.type = 'button';
    retry.addEventListener('click', () => this.actions.retry());
    actions.append(retry);
    card.append(actions);
    status.append(card);
  }

  private drawFoot(entry: AssistantEntry, foot: HTMLElement) {
    foot.replaceChildren();
    if (entry.status === 'streaming') return;
    const meta = [entry.model];
    if (entry.usage && (entry.usage.input || entry.usage.output)) {
      meta.push(
        i18next.t('ai.usage', {
          input: compact(entry.usage.input),
          output: compact(entry.usage.output),
        })
      );
    }
    const text = meta.filter(Boolean).join(' · ');
    const metaEl = el('span', 'ny-ai-msg__meta', text);
    metaEl.title = text;
    foot.append(metaEl);

    const reply = replyText(entry);
    if (reply) {
      const copy = iconButton(ICONS.copy, i18next.t('ai.copy'));
      copy.addEventListener('click', () => {
        void copyText(reply).then((copied) => {
          if (!copied) return;
          copy.innerHTML = ICONS.check;
          copy.classList.add('is-done');
          window.setTimeout(() => {
            copy.innerHTML = ICONS.copy;
            copy.classList.remove('is-done');
          }, COPIED_MS);
        });
      });
      foot.append(copy);
    }
    if (entry.status === 'stopped') {
      const retry = iconButton(
        ICONS.retry,
        i18next.t('ai.retry'),
        'ny-ai-msg__retry'
      );
      retry.addEventListener('click', () => this.actions.retry());
      foot.append(retry);
    }
  }

  private onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const answer = target.closest<HTMLElement>('[data-approval-answer]');
    const asked =
      answer?.closest<HTMLElement>('[data-approval]')?.dataset.approval;
    if (answer && asked && this.actions.approvals) {
      this.actions.approvals.answer(
        asked,
        answer.dataset.approvalAnswer as ApprovalAnswer
      );
      return;
    }
    const action = target.closest<HTMLElement>('[data-edit-action]');
    const edit = action?.closest<HTMLElement>('[data-edit]')?.dataset.edit;
    if (action && edit && this.actions.edits) {
      const edits = this.actions.edits;
      if (action.dataset.editAction === 'accept') edits.accept(edit);
      else if (action.dataset.editAction === 'reject') edits.reject(edit);
      else edits.reveal(edit);
      return;
    }
    const copy = target.closest<HTMLElement>('.ny-ai-md__copy');
    if (copy) {
      const code = copy.closest('pre')?.querySelector('code');
      const text = code?.textContent ?? '';
      void copyText(text).then((copied) => {
        if (!copied) return;
        copy.textContent = i18next.t('ai.copied');
        window.setTimeout(() => {
          copy.textContent = i18next.t('ai.copy');
        }, COPIED_MS);
      });
      return;
    }
    const link = target.closest<HTMLAnchorElement>(
      '.ny-ai-md a[href], .ny-ai-sources a[href]'
    );
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      link
        .closest('.ny-ai-md')
        ?.querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (isOpenableLink(href)) {
      void openExternalUrl(href).catch(console.error);
    }
  };
}
