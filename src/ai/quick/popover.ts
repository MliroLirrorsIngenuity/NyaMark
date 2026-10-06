/**
 * The AI menu, over the selection or at the caret: the user's commands, a
 * line to ask for anything else, and once one runs, the reply as it comes.
 * The finished reply goes into the document as a proposal to accept or
 * reject, as the assistant's edits do, or straight in when the settings say
 * so.
 */

import type { NyaEditor } from '../../editor/editor';
import { i18next } from '../../i18n';
import type { AiSettings } from '../../state/ai-settings';
import { getSettings } from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { forInputMethod } from '../../ui/ime';
import { describeFailure } from '../agent/session';
import type { EditController } from '../edit/controller';
import { EditError } from '../edit/text-edit';
import { connectModel } from '../providers/connect';
import { renderChatMarkdown } from '../render/markdown';
import { copyText } from '../ui/clipboard';
import { FAILURE_TEXT, SELF_EXPLAINED, SETTINGS_FIXES } from '../ui/failure';
import { ICONS } from '../ui/icons';
import { quickCommands } from './actions';
import { askModel } from './ask';
import { type Landing, type Placement, landingTarget } from './place';
import { type QuickTask, cleanReply, quickPrompt } from './prompt';
import quickStyles from './quick.css?inline';

/** How the menu opens: to choose, or running a slash command at once. */
export type QuickMode = 'menu' | 'continue' | 'summarize';

export type QuickHost = {
  editor: NyaEditor;
  edits: EditController;
  documentPath: () => string | null;
  openSettings: () => void;
  /** Opens the conversation with `text` written, for the user to send. */
  toChat: (text: string) => void;
};

type Run = { task: QuickTask; landing: Landing; label: string };

type Item = { label: string; run: () => void };

/** The model the menu's commands go to: their own, or the chat's. */
function quickModel(ai: AiSettings) {
  const ref = ai.quickModel ?? ai.chatModel;
  const provider = ref && ai.providers.find((p) => p.id === ref.provider);
  return ref && provider ? { ref, provider } : null;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** The longest an instruction typed in reads as the command's name. */
const LABEL_CHARS = 60;
/** A streaming reply is drawn again at most this often. */
const DRAW_MS = 50;
/** Space kept between the menu and the text, and the window's edges. */
const GAP = 6;
const MARGIN = 8;
const HIGHLIGHT = 'ny-ai-quick';

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

/** Where the selection or the caret is on screen, from the page's selection. */
function selectionRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0).cloneRange();
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
    if (mode === 'continue') this.start(this.continueRun());
    else if (mode === 'summarize') this.start(this.summarizeRun());
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
    this.clearHighlight();
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
    this.highlight();

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

  /** Marks the selection while the menu has the focus, as the page no longer does. */
  private highlight() {
    const range = this.range;
    if (!range || range.collapsed || typeof Highlight === 'undefined') return;
    CSS.highlights?.set(HIGHLIGHT, new Highlight(range));
  }

  private clearHighlight() {
    if (typeof Highlight === 'undefined') return;
    CSS.highlights?.delete(HIGHLIGHT);
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

  private draw(...children: HTMLElement[]) {
    if (!this.root) return;
    this.root.replaceChildren(...children);
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
    const items: Item[] = [];
    if (typed) {
      const label =
        typed.length > LABEL_CHARS ? `${typed.slice(0, LABEL_CHARS)}…` : typed;
      items.push({
        label: i18next.t(selected ? 'ai.quick.changeAs' : 'ai.quick.writeAs', {
          text: label,
        }),
        run: () =>
          this.start(
            selected
              ? {
                  task: { kind: 'transform', instruction: typed },
                  landing: 'replace',
                  label,
                }
              : {
                  task: { kind: 'write', instruction: typed },
                  landing: 'blocks',
                  label,
                }
          ),
      });
    }
    const match = (name: string) =>
      !typed || name.toLowerCase().includes(typed.toLowerCase());
    if (selected) {
      const commands = quickCommands(
        getSettings().ai.quickActions,
        (key) => i18next.t(key),
        i18next.language
      );
      for (const command of commands) {
        if (!match(command.name)) continue;
        items.push({
          label: command.name,
          run: () =>
            this.start({
              task: { kind: 'transform', instruction: command.prompt },
              landing: 'replace',
              label: command.name,
            }),
        });
      }
    } else {
      for (const run of [this.continueRun(), this.summarizeRun()]) {
        if (match(run.label))
          items.push({ label: run.label, run: () => this.start(run) });
      }
    }
    items.push({
      label: i18next.t('ai.quick.toChat'),
      run: () => {
        this.close(false);
        this.host.toChat(typed);
      },
    });
    return items;
  }

  private continueRun(): Run {
    return {
      task: { kind: 'continue' },
      landing: 'continue',
      label: i18next.t('ai.quick.continue'),
    };
  }

  private summarizeRun(): Run {
    return {
      task: { kind: 'summarize' },
      landing: 'blocks',
      label: i18next.t('ai.quick.summarize'),
    };
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
    const target = landingTarget(placement, run.landing);
    const { text } = placement;
    const path = this.host.documentPath();
    const request = quickPrompt(
      run.task,
      {
        title: path ? fileName(path) : null,
        before: text.slice(0, target.from),
        selected:
          run.task.kind === 'transform'
            ? text.slice(target.from, target.to)
            : '',
        after: text.slice(target.to),
      },
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
      askModel(
        connectModel(
          chosen.provider,
          chosen.ref.model,
          () => getSettings().ai.proxy
        ),
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
    if (!reply.trim()) {
      this.showProblem(run, i18next.t('ai.quick.empty'), null, preview);
      return;
    }
    try {
      const result = await this.host.edits.placeReply(
        placement,
        run.landing,
        reply
      );
      this.close();
      if (result.report.status === 'proposed') {
        this.host.edits.revealEdit(result.report.edit);
      }
    } catch (error) {
      const unchanged =
        error instanceof EditError && error.code === 'no_change';
      this.showProblem(
        run,
        i18next.t(unchanged ? 'ai.quick.unchanged' : 'ai.quick.notPlaced'),
        reply,
        preview
      );
    }
  }

  private showFailure(run: Run, error: unknown, preview: HTMLElement) {
    const failure = describeFailure(error);
    const message = i18next.t(FAILURE_TEXT[failure.code], {
      status: failure.status,
    });
    const detail =
      failure.message && !SELF_EXPLAINED.has(failure.code)
        ? failure.message
        : null;
    this.showProblem(
      run,
      message,
      null,
      preview,
      detail,
      SETTINGS_FIXES.has(failure.code)
    );
  }

  /** What went wrong, with the reply when there is one to copy. */
  private showProblem(
    run: Run,
    message: string,
    reply: string | null,
    preview: HTMLElement,
    detail: string | null = null,
    settings = false
  ) {
    const head = el('div', 'ny-ai-quick__head');
    head.append(el('span', 'ny-ai-quick__label', run.label));
    const note = el('div', 'ny-ai-quick__error');
    note.setAttribute('role', 'alert');
    note.append(el('div', '', message));
    if (detail) note.append(el('div', 'ny-ai-quick__detail', detail));
    const actions = el('div', 'ny-ai-quick__actions');
    if (settings) {
      const open = button(i18next.t('ai.openSettings'), true);
      open.addEventListener('click', () => {
        this.close(false);
        this.host.openSettings();
      });
      actions.append(open);
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
    const children: HTMLElement[] = [this.bar(head)];
    if (!preview.hidden) children.push(preview);
    children.push(note, actions);
    this.draw(...children);
    (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}
