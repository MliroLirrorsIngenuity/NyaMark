import { i18next } from '../../i18n';
import { forInputMethod } from '../../ui/ime';
import type { ChatImage } from '../images/image';
import { ICONS } from './icons';
import { ImageTray } from './image-tray';

export type ComposerActions = {
  send: (text: string, images: ChatImage[]) => void;
  stop: () => void;
  /** Escape with nothing to stop: back to the document. */
  leave: () => void;
  /** Asks for image files to send. */
  attach: () => void;
  /** Images pasted into the message. */
  paste: (files: File[]) => void;
};

/**
 * Where the user writes to the assistant. Enter sends and Shift-Enter starts
 * a new line; the Enter that commits an input method's text does neither.
 * Images pasted, dropped or chosen wait over it, to go with the message.
 */
export class Composer {
  readonly element: HTMLElement;
  /** The images going with the next message. */
  readonly images: ImageTray;
  private readonly input: HTMLTextAreaElement;
  private readonly button: HTMLButtonElement;
  private readonly attach: HTMLButtonElement;
  private busy = false;

  constructor(private readonly actions: ComposerActions) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__composer';

    this.input = document.createElement('textarea');
    this.input.className = 'ny-ai__input';
    this.input.rows = 1;
    this.input.placeholder = 'Message the assistant';
    this.input.setAttribute('data-i18n-placeholder', 'ai.placeholder');
    this.input.setAttribute('aria-label', 'Message');
    this.input.setAttribute('data-i18n-aria-label', 'ai.placeholder');
    this.input.spellcheck = true;
    this.input.addEventListener('input', () => this.changed());
    this.input.addEventListener('keydown', this.onKey);
    this.input.addEventListener('paste', this.onPaste);
    this.images = new ImageTray(() => this.changed());

    const bar = document.createElement('div');
    bar.className = 'ny-ai__composer-bar';
    const hint = document.createElement('span');
    hint.className = 'ny-ai__hint';
    hint.textContent = 'Enter to send · Shift+Enter for a new line';
    hint.setAttribute('data-i18n', 'ai.hint');

    this.attach = document.createElement('button');
    this.attach.type = 'button';
    this.attach.className = 'ny-ai__icon ny-ai__attach';
    this.attach.innerHTML = ICONS.image;
    this.attach.addEventListener('click', () => this.actions.attach());

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__send';
    this.button.addEventListener('click', () => {
      if (this.busy) this.actions.stop();
      else this.submit();
    });
    bar.append(this.attach, hint, this.button);

    this.element.append(this.images.element, this.input, bar);
    this.drawButton();
  }

  get hasFocus(): boolean {
    return this.element.contains(document.activeElement);
  }

  focus() {
    this.input.focus();
  }

  /** Adds `text` to what is written, as the AI menu hands it over. */
  write(text: string) {
    if (text) {
      const draft = this.input.value.trimEnd();
      this.input.value = draft ? `${draft}\n${text}` : text;
      this.changed();
    }
    this.input.focus();
    this.input.setSelectionRange(
      this.input.value.length,
      this.input.value.length
    );
  }

  setBusy(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.drawButton();
  }

  /** Draws the labels again, as after the language changed. */
  redraw() {
    this.drawButton();
    this.images.redraw();
  }

  private get empty(): boolean {
    return !this.input.value.trim() && this.images.count === 0;
  }

  private drawButton() {
    const label = i18next.t(this.busy ? 'ai.stop' : 'ai.send');
    this.button.innerHTML = this.busy ? ICONS.stop : ICONS.send;
    this.button.classList.toggle('is-stop', this.busy);
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.disabled = !this.busy && this.empty;
    const attach = i18next.t('ai.image.attach');
    this.attach.title = attach;
    this.attach.setAttribute('aria-label', attach);
  }

  private changed() {
    this.fit();
    this.button.disabled = !this.busy && this.empty;
  }

  /** Grows with what is written, up to the height the style allows. */
  private fit() {
    this.input.style.height = 'auto';
    this.input.style.height = `${this.input.scrollHeight}px`;
  }

  private submit() {
    const text = this.input.value;
    if (this.busy || this.empty) return;
    this.input.value = '';
    const images = this.images.take();
    this.changed();
    this.actions.send(text, images);
  }

  private onPaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
      file.type.startsWith('image/')
    );
    if (files.length === 0) return;
    // A copied image file carries its name as text too; the image is meant.
    event.preventDefault();
    this.actions.paste(files);
  };

  private onKey = (event: KeyboardEvent) => {
    if (forInputMethod(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      this.submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.busy) this.actions.stop();
      else this.actions.leave();
    }
  };
}
