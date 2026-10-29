import { type PanelMessage, onPanel, postPanel } from './panels';

/**
 * A form the native sheet draws: the settings, the PDF export and the image
 * questions. The page builds each page of it from its own state and strings;
 * the native side draws them in NyaMark's design and reports what the user
 * did. Every row's `id` is unique within its page.
 */

export type FormTone = 'muted' | 'warning' | 'error' | 'success';

export type FormOption = { value: string; label: string; detail?: string };

export type FormAction = { id: string; label: string; destructive?: boolean };

export type FormRow =
  /** A switch. */
  | {
      kind: 'toggle';
      id: string;
      label: string;
      detail?: string;
      value: boolean;
      disabled?: boolean;
    }
  /** One of a few values, picked from a menu, as the settings' dropdowns. */
  | {
      kind: 'choice';
      id: string;
      label: string;
      detail?: string;
      value: string | null;
      options: FormOption[];
      /** Shown while `value` is null or matches no option. */
      placeholder?: string;
      disabled?: boolean;
    }
  /** Large option cards, one of which is chosen, as the image questions. */
  | { kind: 'cards'; id: string; value: string | null; options: FormOption[] }
  /** A number typed in, kept between `min` and `max`. */
  | {
      kind: 'number';
      id: string;
      label: string;
      detail?: string;
      value: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
      disabled?: boolean;
    }
  /** A number dragged along a slider; `valueText` is what it shows. */
  | {
      kind: 'slider';
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      valueText: string;
      disabled?: boolean;
    }
  | {
      kind: 'text';
      id: string;
      label: string;
      detail?: string;
      value: string;
      placeholder?: string;
      /** Typed as a password: hidden, no suggestions. */
      secure?: boolean;
      multiline?: boolean;
      /** `code` turns off capitals, autocorrect and smart punctuation. */
      input?: 'text' | 'url' | 'email' | 'code';
      error?: string;
      disabled?: boolean;
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      role?: 'normal' | 'primary' | 'destructive';
      detail?: string;
      disabled?: boolean;
      /** Shows a spinner in place of the label and takes no taps. */
      busy?: boolean;
    }
  /** A label with a value beside it, read only. */
  | { kind: 'value'; id: string; label: string; value: string; detail?: string }
  | { kind: 'note'; id: string; text: string; tone?: FormTone }
  /** A row with a chevron; a tap sends `open`. */
  | {
      kind: 'link';
      id: string;
      label: string;
      value?: string;
      detail?: string;
      /** Leaves the app: drawn with an arrow out instead of a chevron. */
      external?: boolean;
    }
  /**
   * An entry of a list, as a service or an MCP server: a tap sends `open`,
   * `actions` are offered on a swipe and a long press, and `toggle`, when
   * set, draws a switch whose change is sent as `change`.
   */
  | {
      kind: 'item';
      id: string;
      title: string;
      detail?: string;
      badge?: string;
      tone?: FormTone;
      toggle?: boolean;
      actions?: FormAction[];
    };

export type FormSection = {
  id: string;
  title?: string;
  footer?: string;
  rows: FormRow[];
};

export type FormButton = {
  id: string;
  label: string;
  role?: 'normal' | 'primary' | 'destructive';
  disabled?: boolean;
};

export type FormPage = {
  id: string;
  title: string;
  /** Beside the title on the left, as the settings' Cancel; pages pushed later get a back button there. */
  leading?: FormButton;
  /** Beside the title on the right, as the settings' OK. */
  trailing?: FormButton;
  /** A segmented control under the header, as the settings' tabs. */
  tabs?: { value: string; options: FormOption[] };
  sections: FormSection[];
  /** A button across the foot of the page, as Reset to defaults. */
  footer?: FormButton;
};

export type FormView = {
  /** The pages from the first to the one shown; pushing one adds it at the end. */
  pages: FormPage[];
  height: 'medium' | 'large';
  /** Whether a swipe down may take the sheet away; it sends `dismiss` when it does. */
  dismissible: boolean;
};

/** What the user did in the native form. `page` is the page's id. */
export type FormEvent =
  | { op: 'change'; page: string; id: string; value: boolean | string | number }
  | { op: 'press'; page: string; id: string }
  | { op: 'open'; page: string; id: string }
  | { op: 'action'; page: string; id: string; action: string }
  | { op: 'tab'; page: string; value: string }
  /** The user went back from `page`, with the back button or a swipe. */
  | { op: 'back'; page: string }
  | { op: 'dismiss' };

export type FormAlert = {
  title: string;
  message?: string;
  actions: Array<{
    id: string;
    label: string;
    role?: 'cancel' | 'destructive' | 'default';
  }>;
};

const forms = new Map<string, NativeForm>();
const openers = new Map<string, () => unknown>();
let replies = 0;
const waiting = new Map<string, (value: string | null) => void>();

onPanel('form', (message: PanelMessage) => {
  const name = String(message.form);
  if (message.op === 'open') return openers.get(name)?.();
  if (message.op === 'reply') {
    const id = String(message.reply);
    waiting.get(id)?.(message.value == null ? null : String(message.value));
    waiting.delete(id);
    return;
  }
  return forms.get(name)?.receive(message);
});

/** Has the native bottom bar's button for the form `name` call `open`. */
export function registerFormOpener(name: string, open: () => unknown) {
  openers.set(name, open);
}

/**
 * The page's side of one native form: it sends what `render` builds, again
 * on `refresh`, and hands each thing the user does to `handle`.
 */
export class NativeForm {
  private sent = '';
  private frame = 0;
  private shown = false;

  constructor(
    readonly name: string,
    private readonly render: () => FormView,
    private readonly handle: (event: FormEvent) => unknown
  ) {}

  get isShown() {
    return this.shown;
  }

  show() {
    forms.set(this.name, this);
    this.shown = true;
    this.sent = '';
    this.post();
  }

  /** Sends the form again once this frame is over, when it changed. */
  refresh() {
    if (!this.shown) return;
    this.frame ||= requestAnimationFrame(() => this.post());
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (forms.get(this.name) === this) forms.delete(this.name);
    postPanel('form', 'hide', { form: this.name });
  }

  /** Asks with the system's alert over the form; resolves to the action's id, or null. */
  alert(alert: FormAlert): Promise<string | null> {
    const reply = `r${++replies}`;
    return new Promise((resolve) => {
      waiting.set(reply, resolve);
      postPanel('form', 'alert', { form: this.name, reply, ...alert });
    });
  }

  private post() {
    this.frame = 0;
    if (!this.shown) return;
    const view = this.render();
    const text = JSON.stringify(view);
    if (text === this.sent) return;
    this.sent = text;
    postPanel('form', 'show', { form: this.name, view });
  }

  /** @internal Takes a message from the native side. */
  async receive(message: PanelMessage) {
    const { panel: _panel, type: _type, form: _form, ...event } = message;
    if (event.op === 'dismiss') {
      this.shown = false;
      if (forms.get(this.name) === this) forms.delete(this.name);
    }
    await this.handle(event as unknown as FormEvent);
    this.refresh();
  }
}
