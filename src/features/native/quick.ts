/** The page's side of the native AI menu: its state is sent to the sheet, and what the user does there is done as the popover does it. */

import { CHATGPT_USAGE_URL } from '../../ai/providers/chatgpt';
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
} from '../../ai/quick/core';
import type { Placement } from '../../ai/quick/place';
import { cleanReply } from '../../ai/quick/prompt';
import quickStyles from '../../ai/quick/quick.css?inline';
import {
  clearSelectionMark,
  markSelection,
  selectionRange,
} from '../../ai/quick/selection';
import { openExternalUrl } from '../../bridge/ipc/attachments';
import { i18next } from '../../i18n';
import { getSettings } from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { type MdBlock, markdownBlocks } from './markdown-blocks';
import { type PanelMessage, onPanel, postPanel } from './panels';

/** A button of the sheet, by what it does. */
export type QuickButton = { id: string; label: string; primary?: boolean };

/** What the sheet draws: one of the popover's four states and everything it says in it. */
export type QuickStateData = {
  view: 'noModel' | 'menu' | 'running' | 'problem';
  /** Counts the openings, so the sheet starts its text field afresh for each. */
  session: number;
  title: string;
  /** The command that runs or failed. */
  label: string | null;
  /** The ask to set up a model, or what went wrong. */
  note: string | null;
  detail: string | null;
  placeholder: string | null;
  items: Array<{ id: string; label: string }>;
  /** The reply as it comes, once there is any. */
  preview: MdBlock[] | null;
  hint: string | null;
  copied: string;
  buttons: QuickButton[];
};

type View =
  | { kind: 'noModel' }
  | { kind: 'menu' }
  | { kind: 'running'; run: Run }
  | {
      kind: 'problem';
      run: Run;
      message: string;
      detail: string | null;
      reply: string | null;
      fix: 'settings' | 'usage' | null;
    };

export type QuickStateInput = {
  view: View;
  session: number;
  typed: string;
  selected: boolean;
  preview: MdBlock[] | null;
};

/** The popover's four states as the sheet draws them. */
export function quickStateData(input: QuickStateInput): QuickStateData {
  const { view, session, typed, selected, preview } = input;
  const state: QuickStateData = {
    view: view.kind,
    session,
    title: i18next.t('ai.quick.title'),
    label: null,
    note: null,
    detail: null,
    placeholder: null,
    items: [],
    preview: null,
    hint: null,
    copied: i18next.t('ai.copied'),
    buttons: [],
  };
  switch (view.kind) {
    case 'noModel':
      state.note = i18next.t('ai.error.noModel');
      state.buttons = [
        { id: 'settings', label: i18next.t('ai.openSettings'), primary: true },
      ];
      break;
    case 'menu':
      state.placeholder = i18next.t(
        selected ? 'ai.quick.placeholderSelection' : 'ai.quick.placeholderCaret'
      );
      state.items = menuItems(
        typed.trim(),
        selected,
        getSettings().ai.quickActions
      ).map(({ id, label }) => ({ id, label }));
      break;
    case 'running':
      state.label = view.run.label;
      state.preview = preview;
      state.hint = i18next.t('ai.quick.escHint');
      state.buttons = [{ id: 'stop', label: i18next.t('ai.stop') }];
      break;
    case 'problem': {
      state.label = view.run.label;
      state.preview = preview;
      state.note = view.message;
      state.detail = view.detail;
      if (view.fix === 'settings') {
        state.buttons.push({
          id: 'settings',
          label: i18next.t('ai.openSettings'),
          primary: true,
        });
      } else if (view.fix === 'usage') {
        state.buttons.push({
          id: 'usage',
          label: i18next.t('ai.plan.manage'),
          primary: true,
        });
      }
      state.buttons.push(
        view.reply
          ? { id: 'copy', label: i18next.t('ai.copy') }
          : { id: 'retry', label: i18next.t('ai.retry') },
        { id: 'close', label: i18next.t('ai.close') }
      );
      break;
    }
  }
  return state;
}

/**
 * The AI menu on the phone: the popover without its DOM. The commands, the
 * request, the reply and its landing are the popover's own (see `core`).
 */
export class NativeQuickMenu {
  private view: View | null = null;
  private range: Range | null = null;
  private placement: Placement | null = null;
  private returnFocus: HTMLElement | null = null;
  private running: AbortController | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | null = null;
  private latest = '';
  private preview: MdBlock[] | null = null;
  private typed = '';
  private readonly cleanups: Array<() => void> = [];
  /** Counts the openings, so that only the last one goes on. */
  private openings = 0;
  /** The sheet has been asked for and has not yet reported it is gone. */
  private shown = false;
  private hiding = false;
  /** Runs once the sheet has gone. */
  private afterClose: (() => void) | null = null;
  private refocus: HTMLElement | null = null;
  private readonly unbind: () => void;

  constructor(private readonly host: QuickHost) {
    ensureStyle('ai-quick', quickStyles);
    this.unbind = onPanel('quick', (message) => this.handle(message));
  }

  /** Reads Markdown as the editor does. */
  private readonly parse = (markdown: string) =>
    this.host.editor.markdownTree(markdown);

  get isOpen(): boolean {
    return this.view != null;
  }

  /** Opens the menu where the selection or the caret is. */
  async open(mode: QuickMode) {
    if (this.hiding) {
      this.afterClose = () => void this.open(mode);
      return;
    }
    this.reset();
    const opening = ++this.openings;
    // Read before the sheet takes the focus, and with it the page's selection.
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
    this.typed = '';
    this.mount();
    if (!quickModel(getSettings().ai)) {
      this.show({ kind: 'noModel' });
      return;
    }
    if (mode === 'continue') this.start(continueRun());
    else if (mode === 'summarize') this.start(summarizeRun());
    else this.show({ kind: 'menu' });
  }

  /** What the user did on the sheet. */
  handle(message: PanelMessage) {
    switch (message.op) {
      case 'close':
        this.closed();
        return;
      case 'prompt':
        this.typed = String(message.text ?? '');
        if (this.view?.kind === 'menu') this.sendState();
        return;
      case 'run':
        this.runItem(String(message.id));
        return;
      case 'stop':
        this.leave(true);
        return;
      case 'settings':
        this.leave(false, () => this.host.openSettings());
        return;
      case 'usage':
        void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
        return;
      case 'retry':
        if (this.view?.kind === 'problem') this.start(this.view.run);
        return;
      case 'copy':
        if (this.view?.kind === 'problem' && this.view.reply) {
          postPanel('quick', 'copy', { text: this.view.reply });
        }
        return;
    }
  }

  destroy() {
    this.openings++;
    this.reset();
    this.unbind();
  }

  private get selected(): boolean {
    return this.placement?.selection != null;
  }

  /** Stops what runs and lets go of the place, leaving the sheet as it is. */
  private reset() {
    this.running?.abort();
    this.running = null;
    if (this.drawTimer != null) clearTimeout(this.drawTimer);
    this.drawTimer = null;
    this.latest = '';
    this.preview = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    clearSelectionMark();
    if (this.returnFocus) this.refocus = this.returnFocus;
    this.returnFocus = null;
    if (this.placement) this.host.edits.forget(this.placement);
    this.placement = null;
    this.range = null;
    this.view = null;
  }

  /** Closes the sheet, `refocus` giving the text its caret back, and then does `then`. */
  private leave(refocus: boolean, then?: () => void) {
    this.reset();
    if (!refocus) this.refocus = null;
    if (!this.shown) {
      this.refocus?.focus({ preventScroll: true });
      this.refocus = null;
      then?.();
      return;
    }
    this.afterClose = then ?? null;
    if (!this.hiding) {
      this.hiding = true;
      postPanel('quick', 'hide');
    }
  }

  /** The sheet is gone, however it went. */
  private closed() {
    this.shown = false;
    this.hiding = false;
    this.reset();
    if (this.refocus?.isConnected) this.refocus.focus({ preventScroll: true });
    this.refocus = null;
    const after = this.afterClose;
    this.afterClose = null;
    after?.();
  }

  private mount() {
    // The selection toolbar would stand over the sheet's text.
    document.documentElement.classList.add('ny-ai-asking');
    markSelection(this.range);
    const onPointer = () => {
      // What is written goes on; the sheet stays to show it.
      if (this.running) return;
      this.leave(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.leave(true);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    this.cleanups.push(() => {
      document.documentElement.classList.remove('ny-ai-asking');
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    });
  }

  private show(view: View) {
    this.view = view;
    if (!this.shown) {
      this.shown = true;
      postPanel('quick', 'present');
    }
    this.sendState();
  }

  private sendState() {
    if (!this.view || this.hiding) return;
    postPanel(
      'quick',
      'state',
      quickStateData({
        view: this.view,
        session: this.openings,
        typed: this.typed,
        selected: this.selected,
        preview: this.preview,
      })
    );
  }

  /** The command the user chose from the list. */
  private runItem(id: string) {
    if (this.view?.kind !== 'menu') return;
    const typed = this.typed.trim();
    const item = menuItems(
      typed,
      this.selected,
      getSettings().ai.quickActions
    ).find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.run) this.start(item.run);
    else this.leave(false, () => this.host.toChat(typed));
  }

  /** Asks the model, shows the reply as it comes, and puts it in. */
  private start(run: Run) {
    const placement = this.placement;
    const chosen = quickModel(getSettings().ai);
    if (!placement) return;
    if (!chosen) {
      this.show({ kind: 'noModel' });
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
    this.latest = '';
    this.preview = null;
    this.show({ kind: 'running', run });

    const ask = async () =>
      askQuick(
        chosen,
        request,
        (sofar) => {
          if (this.running !== controller) return;
          this.latest = sofar;
          this.drawTimer ??= setTimeout(() => this.drawPreview(), DRAW_MS);
        },
        controller.signal
      );
    void ask()
      .then((reply) => {
        if (this.running !== controller) return;
        this.running = null;
        this.latest = reply;
        if (this.drawTimer != null) clearTimeout(this.drawTimer);
        this.drawPreview();
        return this.land(run, cleanReply(reply, this.parse));
      })
      .catch((error) => {
        if (this.running !== controller) return;
        this.running = null;
        const { message, detail, fix } = failureProblem(error);
        this.showProblem(run, message, null, detail, fix);
      });
  }

  private drawPreview() {
    this.drawTimer = null;
    this.preview =
      this.latest.trim() === ''
        ? null
        : markdownBlocks(cleanReply(this.latest, this.parse));
    this.sendState();
  }

  /** Puts the reply in where the command ran, as a proposal or at once. */
  private async land(run: Run, reply: string) {
    const placement = this.placement;
    if (!placement) return;
    const landed = await landReply(this.host.edits, placement, run, reply);
    if (landed.problem !== undefined) {
      this.showProblem(run, landed.problem, landed.reply);
      return;
    }
    this.leave(true);
    if (landed.edit) this.host.edits.revealEdit(landed.edit);
  }

  /** What went wrong, with the reply when there is one to copy. */
  private showProblem(
    run: Run,
    message: string,
    reply: string | null,
    detail: string | null = null,
    fix: 'settings' | 'usage' | null = null
  ) {
    if (!this.placement) return;
    this.show({ kind: 'problem', run, message, detail, reply, fix });
  }
}
