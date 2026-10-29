/**
 * The AI menu, over the selection or at the caret: the user's commands, a
 * line to ask for anything else, and once one runs, the reply as it comes.
 * The finished reply goes into the document as a proposal to accept or
 * reject, as the assistant's edits do, or straight in when the settings say
 * so.
 */

import { openExternalUrl } from '../../bridge/ipc/attachments';
import { i18next } from '../../i18n';
import { getSettings } from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { forInputMethod } from '../../ui/ime';
import { CHATGPT_USAGE_URL } from '../providers/chatgpt';
import { renderChatMarkdown } from '../render/markdown';
import { copyText } from '../ui/clipboard';
import { ICONS } from '../ui/icons';
import {
  DRAW_MS,
  type QuickHost,
  type QuickMode,
  type Run,
  askQuick,
  continueRun,
  failureProblem,
  landReply,
  menuItems,
  quickModel,
  quickRequest,
  summarizeRun,
} from './core';
import type { Placement } from './place';
import { cleanReply } from './prompt';
import quickStyles from './quick.css?inline';
import { clearSelectionMark, markSelection, selectionRange } from './selection';

export type { QuickHost, QuickMode };

type Item = { label: string; run: () => void };

/** Space kept between the menu and the text, and the window's edges. */
const GAP = 6;
const MARGIN = 8;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label: string, primary = false) {
  const node = el(
    'button',
    `ny-ai__button ny-ai__button--small${primary ? ' ny-ai__button--primary' : ''}`,
    label
  );
  node.type = 'button';
  return node;
}

function rectOf(range: Range | null): DOMRect | null {
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  // A caret in an empty line has no box of its own; its line has.
  const node =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const line = node?.getBoundingClientRect();
  return line && line.height > 0 ? line : null;
}

export class QuickMenu {
  private root: HTMLElement | null = null;
  private range: Range | null = null;
  private lastRect: DOMRect | null = null;
  private returnFocus: HTMLElement | null = null;
  private placement: Placement | null = null;
  private running: AbortController | null = null;
  private items: Item[] = [];
  private active = 0;
  private drawTimer: number | null = null;
  private readonly cleanups: Array<() => void> = [];
  /** Counts the openings, so that only the last one goes on. */
  private openings = 0;

  constructor(private readonly host: QuickHost) {
    ensureStyle('ai-quick', quickStyles);
  }

  /** Reads Markdown as the editor does. */
  private readonly parse = (markdown: string) =>
    this.host.editor.markdownTree(markdown);

  get isOpen(): boolean {
    return this.root != null;
  }

  /** Opens the menu where the selection or the caret is. */
  async open(mode: QuickMode) {
    this.close(false);
    const opening = ++this.openings;
    // Read before the menu takes the focus, and with it the page's selection.
    const range = selectionRange();
    const focused = document.activeElement;
    const placement = await this.host.edits.placement();
    if (opening !== this.openings) {
      this.host.edits.forget(placement);
      return;
    }
    this.range = range;
    this.returnFocus = focused instanceof HTMLElement ? focused : null;
    this.placement = placement;
    this.mount();
    if (!quickModel(getSettings().ai)) {
      this.showNoModel();
      return;
    }
    if (mode === 'continue') this.start(continueRun());
    else if (mode === 'summarize') this.start(summarizeRun());
    else this.showMenu();
  }

  /** Closes the menu, stopping what runs; `refocus` gives the text the caret back. */
  close(refocus = true) {
    this.running?.abort();
    this.running = null;
    if (this.drawTimer != null) window.clearTimeout(this.drawTimer);
    this.drawTimer = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root?.remove();
    this.root = null;
    clearSelectionMark();
    if (refocus && this.returnFocus?.isConnected) {
      this.returnFocus.focus({ preventScroll: true });
    }
    this.returnFocus = null;
    if (this.placement) this.host.edits.forget(this.placement);
    this.placement = null;
    this.range = null;
    this.lastRect = null;
  }

  destroy() {
    this.openings++;
    this.close(false);
  }

  private mount() {
    const root = el('div', 'ny-ai-quick');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', i18next.t('ai.quick.title'));
    document.body.append(root);
    this.root = root;
    // The selection toolbar would stand over the menu's text.
    document.documentElement.classList.add('ny-ai-asking');
    this.cleanups.push(() =>
      document.documentElement.classList.remove('ny-ai-asking')
    );
    markSelection(this.range);

    const onPointer = (event: PointerEvent) => {
      if (!this.root || this.root.contains(event.target as Node)) return;
      // What is written goes on; the menu stays to show it.
      if (this.running) return;
      this.close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || forInputMethod(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    const onMove = () => this.position();
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    this.cleanups.push(() => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    });
  }

  /** Under the selection, or over it where there is no room below. */
  private position() {
    const root = this.root;
    if (!root) return;
    const rect = rectOf(this.range) ?? this.lastRect;
    if (rect) this.lastRect = rect;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = document.documentElement.clientHeight;
    let left = rect ? rect.left : (viewWidth - width) / 2;
    left = Math.max(MARGIN, Math.min(left, viewWidth - width - MARGIN));
    let top = rect ? rect.bottom + GAP : viewHeight / 3;
    if (rect && top + height > viewHeight - MARGIN) {
      const above = rect.top - GAP - height;
      top = above >= MARGIN ? above : viewHeight - MARGIN - height;
    }
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
  }

  /** The bar, with what goes under it on a card of its own. */
  private draw(bar: HTMLElement, ...below: HTMLElement[]) {
    if (!this.root) return;
    const card = el('div', 'ny-ai-quick__card');
    card.append(...below);
    this.root.replaceChildren(bar, card);
    this.position();
  }

  private bar(content: HTMLElement) {
    const bar = el('div', 'ny-ai-quick__bar');
    const icon = el('span', 'ny-ai-quick__icon');
    icon.innerHTML = ICONS.sparkle;
    bar.append(icon, content);
    return bar;
  }

  private showNoModel() {
    const note = el('div', 'ny-ai-quick__note', i18next.t('ai.error.noModel'));
    const open = button(i18next.t('ai.openSettings'), true);
    open.addEventListener('click', () => {
      this.close(false);
      this.host.openSettings();
    });
    const actions = el('div', 'ny-ai-quick__actions');
    actions.append(open);
    this.draw(this.bar(note), actions);
    open.focus();
  }

  private showMenu() {
    const selected = this.placement?.selection != null;
    const input = el('input', 'ny-ai-quick__input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = i18next.t(
      selected ? 'ai.quick.placeholderSelection' : 'ai.quick.placeholderCaret'
    );
    input.setAttribute('aria-label', input.placeholder);
    const list = el('div', 'ny-ai-quick__list');
    list.setAttribute('role', 'listbox');

    const drawItems = () => {
      this.items = this.menuItems(input.value.trim(), selected);
      this.active = Math.min(this.active, this.items.length - 1);
      list.replaceChildren(
        ...this.items.map((item, index) => {
          const option = el('button', 'ny-ai-menu__item ny-ai-quick__item');
          option.type = 'button';
          option.tabIndex = -1;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(index === this.active));
          option.append(el('span', '', item.label));
          option.addEventListener('pointerenter', () => {
            this.active = index;
            mark();
          });
          option.addEventListener('click', () => item.run());
          return option;
        })
      );
      this.position();
    };
    const mark = () => {
      const options = list.querySelectorAll('[role="option"]');
      for (const [index, option] of [...options].entries()) {
        option.setAttribute('aria-selected', String(index === this.active));
        if (index === this.active) option.scrollIntoView({ block: 'nearest' });
      }
    };

    input.addEventListener('input', () => {
      this.active = 0;
      drawItems();
    });
    input.addEventListener('keydown', (event) => {
      if (forInputMethod(event)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = this.items.length;
        if (count === 0) return;
        this.active =
          (this.active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        mark();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.items[this.active]?.run();
      }
    });

    this.draw(this.bar(input), list);
    drawItems();
    input.focus();
  }

  /** The menu's items: what was typed first, then the commands that match. */
  private menuItems(typed: string, selected: boolean): Item[] {
    return menuItems(typed, selected, getSettings().ai.quickActions).map(
      (item) => ({
        label: item.label,
        run: () => {
          const run = item.run;
          if (run) {
            this.start(run);
            return;
          }
          this.close(false);
          this.host.toChat(typed);
        },
      })
    );
  }

  /** Asks the model, shows the reply as it comes, and puts it in. */
  private start(run: Run) {
    const placement = this.placement;
    const chosen = quickModel(getSettings().ai);
    if (!placement || !this.root) return;
    if (!chosen) {
      this.showNoModel();
      return;
    }
    const request = quickRequest(
      run,
      placement,
      this.host.documentPath(),
      getSettings().ai.instructions
    );

    const controller = new AbortController();
    this.running = controller;
    const label = el('span', 'ny-ai-quick__label', run.label);
    const spinner = el('span', 'ny-ai-quick__spinner');
    const head = el('div', 'ny-ai-quick__head');
    head.append(label, spinner);
    const preview = el('div', 'ny-ai-quick__preview ny-ai-md');
    preview.hidden = true;
    const stop = button(i18next.t('ai.stop'));
    stop.addEventListener('click', () => this.close());
    const foot = el('div', 'ny-ai-quick__actions');
    foot.append(
      el('span', 'ny-ai-quick__hint', i18next.t('ai.quick.escHint')),
      stop
    );
    this.draw(this.bar(head), preview, foot);
    // Escape stops it, as the button does.
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });

    let latest = '';
    const drawPreview = () => {
      this.drawTimer = null;
      preview.hidden = latest.trim() === '';
      preview.innerHTML = renderChatMarkdown(cleanReply(latest, this.parse));
      preview.scrollTop = preview.scrollHeight;
      this.position();
    };
    const ask = async () =>
      askQuick(
        chosen,
        request,
        (sofar) => {
          if (this.running !== controller) return;
          latest = sofar;
          this.drawTimer ??= window.setTimeout(drawPreview, DRAW_MS);
        },
        controller.signal
      );
    void ask()
      .then((reply) => {
        if (this.running !== controller) return;
        this.running = null;
        latest = reply;
        if (this.drawTimer != null) window.clearTimeout(this.drawTimer);
        drawPreview();
        return this.land(run, cleanReply(reply, this.parse), preview);
      })
      .catch((error) => {
        if (this.running !== controller) return;
        this.running = null;
        this.showFailure(run, error, preview);
      });
  }

  /** Puts the reply in where the command ran, as a proposal or at once. */
  private async land(run: Run, reply: string, preview: HTMLElement) {
    const placement = this.placement;
    if (!placement) return;
    const landed = await landReply(this.host.edits, placement, run, reply);
    if (landed.problem !== undefined) {
      this.showProblem(run, landed.problem, landed.reply, preview);
      return;
    }
    this.close();
    if (landed.edit) this.host.edits.revealEdit(landed.edit);
  }

  private showFailure(run: Run, error: unknown, preview: HTMLElement) {
    const { message, detail, fix } = failureProblem(error);
    this.showProblem(run, message, null, preview, detail, fix);
  }

  /** What went wrong, with the reply when there is one to copy. */
  private showProblem(
    run: Run,
    message: string,
    reply: string | null,
    preview: HTMLElement,
    detail: string | null = null,
    fix: 'settings' | 'usage' | null = null
  ) {
    const head = el('div', 'ny-ai-quick__head');
    head.append(el('span', 'ny-ai-quick__label', run.label));
    const note = el('div', 'ny-ai-quick__error');
    note.setAttribute('role', 'alert');
    note.append(el('div', '', message));
    if (detail) note.append(el('div', 'ny-ai-quick__detail', detail));
    const actions = el('div', 'ny-ai-quick__actions');
    if (fix === 'settings') {
      const open = button(i18next.t('ai.openSettings'), true);
      open.addEventListener('click', () => {
        this.close(false);
        this.host.openSettings();
      });
      actions.append(open);
    } else if (fix === 'usage') {
      const usage = button(i18next.t('ai.plan.manage'), true);
      usage.addEventListener('click', () => {
        void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
      });
      actions.append(usage);
    }
    if (reply) {
      const copy = button(i18next.t('ai.copy'));
      copy.addEventListener('click', () => {
        void copyText(reply).then((copied) => {
          if (copied) copy.textContent = i18next.t('ai.copied');
        });
      });
      actions.append(copy);
    } else {
      const retry = button(i18next.t('ai.retry'));
      retry.addEventListener('click', () => this.start(run));
      actions.append(retry);
    }
    const close = button(i18next.t('ai.close'));
    close.addEventListener('click', () => this.close());
    actions.append(close);
    const below: HTMLElement[] = [];
    if (!preview.hidden) below.push(preview);
    below.push(note, actions);
    this.draw(this.bar(head), ...below);
    (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}
