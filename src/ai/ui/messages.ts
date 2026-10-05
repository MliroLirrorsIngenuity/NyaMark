import { openExternalUrl } from '../../bridge/ipc/attachments';
import { i18next } from '../../i18n';
import {
  type AssistantEntry,
  type ChatEntry,
  type ChatFailureCode,
  type ChatPart,
  type ToolPart,
  type UserEntry,
  replyText,
} from '../agent/session';
import { isOpenableLink, renderChatMarkdown } from '../render/markdown';
import { copyText } from './clipboard';
import { ICONS } from './icons';
import { toolLabel } from './tool-labels';

/** Within this of the end, the list keeps following a reply as it grows. */
const NEAR_END_PX = 32;
/** A streaming reply is drawn again at most this often. */
const STREAM_RENDER_MS = 50;
/** How long a copy button says it copied. */
const COPIED_MS = 1500;

const FAILURE_TEXT: Record<ChatFailureCode, string> = {
  'no-model': 'ai.error.noModel',
  'not-connected': 'ai.error.notConnected',
  'key-needed': 'ai.error.keyNeeded',
  unauthorized: 'ai.error.unauthorized',
  'rate-limited': 'ai.error.rateLimited',
  network: 'ai.error.network',
  other: 'ai.error.other',
};

/** Failures fixed in the settings, with a button that goes there. */
const SETTINGS_FIXES = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
  'unauthorized',
]);

/** Failures the message explains in full; the service's words add nothing. */
const SELF_EXPLAINED = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
]);

const ENDING_TEXT: Record<NonNullable<AssistantEntry['ending']>, string> = {
  'step-limit': 'ai.ending.stepLimit',
  length: 'ai.ending.length',
  filtered: 'ai.ending.filtered',
};

const TOOL_ICONS: Record<ToolPart['state'], string> = {
  running: '',
  done: ICONS.check,
  error: ICONS.alert,
  stopped: ICONS.dash,
};

type PartView = {
  type: ChatPart['type'];
  root: HTMLElement;
  body: HTMLElement;
  /** A reasoning part's summary line, or a tool part's state icon. */
  summary: HTMLElement | null;
  shown: string;
};

type EntryView = {
  root: HTMLElement;
  content: HTMLElement;
  parts: PartView[];
  pending: HTMLElement | null;
  status: HTMLElement;
  foot: HTMLElement;
  /** What the status and foot show, to draw them only when it changes. */
  shownState: string;
};

export type MessageListActions = {
  retry: () => void;
  openSettings: () => void;
};

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
    if (entry.role === 'assistant') this.dirty.delete(entry);
  }

  /** Draws every reply again, as after the language changed. */
  redraw(entries: readonly ChatEntry[]) {
    for (const entry of entries) {
      const view = this.views.get(entry.id);
      if (entry.role !== 'assistant' || !view) continue;
      view.shownState = '';
      for (const part of view.parts) part.shown = '\u0000';
      this.draw(entry, view);
    }
  }

  destroy() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.scroller.removeEventListener('scroll', this.onScroll);
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
    return el('div', 'ny-ai-msg ny-ai-msg--user', entry.text);
  }

  private assistantView(): EntryView {
    const root = el('div', 'ny-ai-msg ny-ai-msg--assistant');
    const content = el('div', 'ny-ai-msg__content');
    const status = el('div', 'ny-ai-msg__status');
    const foot = el('div', 'ny-ai-msg__foot');
    root.append(content, status, foot);
    return {
      root,
      content,
      parts: [],
      pending: null,
      status,
      foot,
      shownState: '',
    };
  }

  private draw(entry: AssistantEntry, view: EntryView) {
    const streaming = entry.status === 'streaming';
    entry.parts.forEach((part, index) => {
      let shown = view.parts[index];
      if (!shown || shown.type !== part.type) {
        shown = this.partView(part.type);
        view.parts[index]?.root.replaceWith(shown.root);
        if (!view.parts[index]) view.content.append(shown.root);
        view.parts[index] = shown;
      }
      if (part.type === 'tool') {
        this.drawTool(part, shown);
        return;
      }
      if (shown.summary) {
        const thinking = streaming && index === entry.parts.length - 1;
        shown.summary.textContent = i18next.t(
          thinking ? 'ai.thinkingNow' : 'ai.thinking'
        );
      }
      if (shown.shown === part.text) return;
      shown.shown = part.text;
      if (part.type === 'reasoning') {
        shown.body.textContent = part.text;
      } else {
        shown.body.innerHTML = renderChatMarkdown(part.text);
        this.addCodeCopyButtons(shown.body);
      }
    });

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

  private partView(type: ChatPart['type']): PartView {
    if (type === 'text') {
      const body = el('div', 'ny-ai-md');
      return { type, root: body, body, summary: null, shown: '\u0000' };
    }
    if (type === 'tool') {
      const root = el('div', 'ny-ai-tool');
      const icon = el('span', 'ny-ai-tool__icon');
      const body = el('span', 'ny-ai-tool__label');
      root.append(icon, body);
      return { type, root, body, summary: icon, shown: '\u0000' };
    }
    const root = el('details', 'ny-ai-reasoning');
    const summary = el('summary', '');
    const body = el('div', 'ny-ai-reasoning__text');
    root.append(summary, body);
    return { type, root, body, summary, shown: '\u0000' };
  }

  private drawTool(part: ToolPart, view: PartView) {
    const label = toolLabel(part);
    const key = [part.state, label, part.error ?? ''].join('\u0000');
    if (view.shown === key) return;
    view.shown = key;
    view.root.dataset.state = part.state;
    view.body.textContent = label;
    view.root.title = part.error ? `${label}\n${part.error}` : label;
    if (view.summary) view.summary.innerHTML = TOOL_ICONS[part.state];
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
    const link = target.closest<HTMLAnchorElement>('.ny-ai-md a[href]');
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
