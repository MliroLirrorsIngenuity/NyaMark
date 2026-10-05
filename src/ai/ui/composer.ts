import { i18next } from '../../i18n';
import { forInputMethod } from '../../ui/ime';
import { ICONS } from './icons';

export type ComposerActions = {
  send: (text: string) => void;
  stop: () => void;
  /** Escape with nothing to stop: back to the document. */
  leave: () => void;
};

/**
 * Where the user writes to the assistant. Enter sends and Shift-Enter starts
 * a new line; the Enter that commits an input method's text does neither.
 */
export class Composer {
  readonly element: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly button: HTMLButtonElement;
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

    const bar = document.createElement('div');
    bar.className = 'ny-ai__composer-bar';
    const hint = document.createElement('span');
    hint.className = 'ny-ai__hint';
    hint.textContent = 'Enter to send · Shift+Enter for a new line';
    hint.setAttribute('data-i18n', 'ai.hint');

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__send';
    this.button.addEventListener('click', () => {
      if (this.busy) this.actions.stop();
      else this.submit();
    });
    bar.append(hint, this.button);

    this.element.append(this.input, bar);
    this.drawButton();
  }

  get hasFocus(): boolean {
    return this.element.contains(document.activeElement);
  }

  focus() {
    this.input.focus();
  }

  setBusy(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.drawButton();
  }

  /** Draws the labels again, as after the language changed. */
  redraw() {
    this.drawButton();
  }

  private drawButton() {
    const label = i18next.t(this.busy ? 'ai.stop' : 'ai.send');
    this.button.innerHTML = this.busy ? ICONS.stop : ICONS.send;
    this.button.classList.toggle('is-stop', this.busy);
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.disabled = !this.busy && !this.input.value.trim();
  }

  private changed() {
    this.fit();
    this.button.disabled = !this.busy && !this.input.value.trim();
  }

  /** Grows with what is written, up to the height the style allows. */
  private fit() {
    this.input.style.height = 'auto';
    this.input.style.height = `${this.input.scrollHeight}px`;
  }

  private submit() {
    const text = this.input.value;
    if (this.busy || !text.trim()) return;
    this.input.value = '';
    this.changed();
    this.actions.send(text);
  }

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
