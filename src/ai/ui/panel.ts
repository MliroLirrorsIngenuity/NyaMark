/**
 * The assistant docks to the right of the window, beside the outline, and
 * the document makes room for it. It is loaded the first time it is opened;
 * nothing of it is on the way to the first frame.
 */

import type { NyaEditor } from '../../editor/editor';
import { i18next } from '../../i18n';
import { translateDOM } from '../../i18n/dom';
import type { AiSettings } from '../../state/ai-settings';
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { keepReadingPosition } from '../../ui/reading-position';
import { buildInstructions } from '../agent/instructions';
import {
  ChatFailureError,
  ChatSession,
  type SessionChange,
  type TurnSetup,
} from '../agent/session';
import { connectModel } from '../providers/connect';
import { Composer } from './composer';
import { ICONS } from './icons';
import { MessageList } from './messages';
import { ModelPicker } from './model-picker';
import panelStyles from './panel.css?inline';

export type AiPanelHost = {
  editor: NyaEditor;
  /** The open document's path, `null` while it is unsaved. */
  documentPath: () => string | null;
  /** Opens the AI section of the settings. */
  openSettings: () => void;
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

function iconButton(icon: string, key: string, fallback: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ny-ai__icon';
  button.innerHTML = icon;
  button.title = fallback;
  button.setAttribute('aria-label', fallback);
  button.setAttribute('data-i18n-title', key);
  button.setAttribute('data-i18n-aria-label', key);
  return button;
}

export class AiPanel {
  private readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly setup: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly picker: ModelPicker;
  private readonly list: MessageList;
  private readonly composer: Composer;
  private readonly session: ChatSession;
  private readonly newChat: HTMLButtonElement;
  private ai: AiSettings = getSettings().ai;
  private visible = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly host: AiPanelHost) {
    ensureStyle('ai-panel', panelStyles);
    applyWidth(storedWidth());

    this.session = new ChatSession(() => this.prepareTurn());

    this.root = document.createElement('aside');
    this.root.className = 'ny-ai';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'AI assistant');
    this.root.setAttribute('data-i18n-aria-label', 'ai.title');

    const resize = document.createElement('div');
    resize.className = 'ny-ai__resize';
    resize.title = 'Drag to resize';
    resize.setAttribute('data-i18n-title', 'ai.resize');
    this.bindResize(resize);

    const header = document.createElement('div');
    header.className = 'ny-ai__header';
    this.picker = new ModelPicker({
      choose: (ref) => {
        void updateSettings({ ai: { chatModel: ref } }).catch(console.error);
      },
      manage: () => this.host.openSettings(),
    });
    this.newChat = iconButton(ICONS.newChat, 'ai.newChat', 'New chat');
    this.newChat.addEventListener('click', () => {
      this.session.clear();
      this.composer.focus();
    });
    const close = iconButton(ICONS.close, 'ai.close', 'Close');
    close.addEventListener('click', () => this.hide());
    header.append(this.picker.element, this.newChat, close);

    this.scroller = document.createElement('div');
    this.scroller.className = 'ny-ai__body';

    this.setup = this.stateCard(
      'ai.setup.title',
      'Connect an AI service',
      'ai.setup.body',
      'Add a service and a model in Settings to start.',
      { key: 'ai.setup.action', fallback: 'Open AI settings' }
    );
    this.empty = this.stateCard(
      'ai.empty.title',
      'What shall we write?',
      'ai.empty.body',
      'Ask about this document, or ask for a draft, a rewrite or ideas.'
    );

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
    });
    this.scroller.append(this.setup, this.empty, this.list.element, jump);

    this.composer = new Composer({
      send: (text) => void this.session.send(text),
      stop: () => this.session.stop(),
      leave: () => this.host.editor.focus(),
    });

    this.root.append(resize, header, this.scroller, this.composer.element);
    document.body.append(this.root);
    translateDOM(this.root);

    this.cleanups.push(
      this.session.subscribe((change) => this.sessionChanged(change)),
      subscribeSettings((settings) => this.settingsChanged(settings.ai))
    );
    const onLanguage = () => {
      this.picker.update(this.ai);
      this.list.redraw(this.session.entries);
      this.composer.redraw();
    };
    i18next.on('languageChanged', onLanguage);
    this.cleanups.push(() => i18next.off('languageChanged', onLanguage));
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

  destroy() {
    this.session.clear();
    this.hide();
    for (const cleanup of this.cleanups) cleanup();
    this.list.destroy();
    this.root.remove();
  }

  private setPressed(pressed: boolean) {
    document
      .getElementById('tb-ai')
      ?.setAttribute('aria-pressed', String(pressed));
  }

  private stateCard(
    titleKey: string,
    title: string,
    textKey: string,
    text: string,
    action?: { key: string; fallback: string }
  ) {
    const card = document.createElement('div');
    card.className = 'ny-ai__state';
    const heading = document.createElement('p');
    heading.className = 'ny-ai__state-title';
    heading.textContent = title;
    heading.setAttribute('data-i18n', titleKey);
    const body = document.createElement('p');
    body.className = 'ny-ai__state-text';
    body.textContent = text;
    body.setAttribute('data-i18n', textKey);
    card.append(heading, body);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ny-ai__button ny-ai__button--primary';
      button.textContent = action.fallback;
      button.setAttribute('data-i18n', action.key);
      button.addEventListener('click', () => this.host.openSettings());
      card.append(button);
    }
    return card;
  }

  private prepareTurn(): TurnSetup {
    const ai = getSettings().ai;
    const ref = ai.chatModel;
    const provider = ref && ai.providers.find((p) => p.id === ref.provider);
    if (!ref || !provider) {
      throw new ChatFailureError({ code: 'no-model', message: '' });
    }
    return {
      model: connectModel(provider, ref.model, () => getSettings().ai.proxy),
      modelLabel: ref.model,
      instructions: buildInstructions({
        documentPath: this.host.documentPath(),
        custom: ai.instructions,
      }),
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
    this.drawState();
  }

  /** Setting up, an empty conversation, or the conversation. */
  private drawState() {
    const ready = hasModels(this.ai);
    const empty = this.list.isEmpty;
    this.setup.hidden = ready || !empty;
    this.empty.hidden = !ready || !empty;
    this.composer.element.hidden = !ready && empty;
    this.newChat.disabled = empty;
  }

  private bindResize(handle: HTMLElement) {
    let dragging = false;
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const limit = Math.min(MAX_WIDTH, window.innerWidth * MAX_SHARE);
      const width = Math.max(
        MIN_WIDTH,
        Math.min(limit, window.innerWidth - event.clientX)
      );
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
