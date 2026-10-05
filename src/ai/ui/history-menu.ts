import type { ConversationSummary } from '../../bridge/ipc/ai';
import { i18next } from '../../i18n';
import { pushEscapeLayer } from '../../ui/escape-layers';
import { ICONS } from './icons';

export type HistoryActions = {
  list: () => Promise<ConversationSummary[]>;
  /** The id of the conversation shown. */
  current: () => string;
  /** Opens a kept conversation; false when another was opened meanwhile. */
  open: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
};

/** When a conversation was last kept: the time today, else the day. */
export function keptWhen(at: number, now = new Date()): string {
  const date = new Date(at);
  const language = i18next.language || undefined;
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(language, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat(language, {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** The document's kept conversations, to open one or delete it. */
export class HistoryMenu {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private releaseEscape: (() => void) | null = null;
  /** Counts the lists asked for, to draw only the latest. */
  private listing = 0;

  constructor(private readonly actions: HistoryActions) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__history';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__icon';
    this.button.innerHTML = ICONS.history;
    this.button.title = 'Conversations';
    this.button.setAttribute('aria-label', 'Conversations');
    this.button.setAttribute('data-i18n-title', 'ai.history.open');
    this.button.setAttribute('data-i18n-aria-label', 'ai.history.open');
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(this.menu.hidden);
    });

    this.menu = document.createElement('div');
    this.menu.className = 'ny-ai-menu ny-ai-menu--end ny-ai-history';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.menu.addEventListener('keydown', this.onMenuKey);

    this.element.append(this.button, this.menu);
  }

  destroy() {
    this.setOpen(false);
  }

  private setOpen(open: boolean) {
    if (open === !this.menu.hidden) return;
    this.menu.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      void this.load();
      document.addEventListener('mousedown', this.onOutside, true);
      this.releaseEscape = pushEscapeLayer({
        dismiss: () => {
          this.setOpen(false);
          this.button.focus();
        },
      });
    } else {
      this.listing++;
      document.removeEventListener('mousedown', this.onOutside, true);
      this.releaseEscape?.();
      this.releaseEscape = null;
    }
  }

  private async load(failed = false) {
    const listing = ++this.listing;
    if (this.menu.childElementCount === 0) {
      this.drawNote('ai.history.loading');
    }
    let summaries: ConversationSummary[];
    try {
      summaries = await this.actions.list();
    } catch (error) {
      console.warn('Failed to list the conversations:', error);
      if (listing === this.listing) this.drawNote('ai.history.listFailed');
      return;
    }
    if (listing !== this.listing) return;
    this.draw(summaries, failed);
  }

  private drawNote(key: string) {
    const note = document.createElement('div');
    note.className = 'ny-ai-history__note';
    note.textContent = i18next.t(key);
    this.menu.replaceChildren(note);
  }

  private draw(summaries: readonly ConversationSummary[], failed: boolean) {
    const hadFocus = this.menu.contains(document.activeElement);
    this.menu.replaceChildren();
    if (failed) {
      const note = document.createElement('div');
      note.className = 'ny-ai-history__note ny-ai-history__note--error';
      note.setAttribute('role', 'alert');
      note.textContent = i18next.t('ai.history.failed');
      this.menu.append(note);
    }
    if (summaries.length === 0) {
      const note = document.createElement('div');
      note.className = 'ny-ai-history__note';
      note.textContent = i18next.t('ai.history.empty');
      this.menu.append(note);
      return;
    }
    const current = this.actions.current();
    const now = new Date();
    for (const summary of summaries) {
      this.menu.append(this.row(summary, summary.id === current, now));
    }
    if (hadFocus || !failed) {
      const focus =
        this.menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
        this.menu.querySelector<HTMLElement>('.ny-ai-menu__item');
      focus?.focus();
    }
  }

  private row(summary: ConversationSummary, checked: boolean, now: Date) {
    const row = document.createElement('div');
    row.className = 'ny-ai-history__row';

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ny-ai-menu__item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(checked));
    const text = document.createElement('span');
    text.className = 'ny-ai-history__text';
    const title = document.createElement('span');
    title.className = 'ny-ai-history__title';
    title.textContent = summary.title || i18next.t('ai.history.untitled');
    const when = document.createElement('span');
    when.className = 'ny-ai-history__when';
    when.textContent = keptWhen(summary.updatedAt, now);
    text.append(title, when);
    item.title = title.textContent;
    const mark = document.createElement('span');
    mark.className = 'ny-ai-menu__check';
    mark.textContent = checked ? '✓' : '';
    item.append(text, mark);
    item.addEventListener('click', () => void this.open(summary.id, item));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ny-ai-history__delete';
    remove.innerHTML = ICONS.trash;
    const label = i18next.t('ai.history.delete');
    remove.title = label;
    remove.setAttribute('aria-label', label);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.remove(summary.id);
    });

    row.append(item, remove);
    return row;
  }

  private async open(id: string, item: HTMLButtonElement) {
    item.setAttribute('aria-busy', 'true');
    try {
      await this.actions.open(id);
      this.setOpen(false);
    } catch (error) {
      console.warn('Failed to open the conversation:', error);
      if (!this.menu.hidden) await this.load(true);
    } finally {
      item.removeAttribute('aria-busy');
    }
  }

  private async remove(id: string) {
    try {
      await this.actions.remove(id);
    } catch (error) {
      console.warn('Failed to delete the conversation:', error);
    }
    if (!this.menu.hidden) await this.load();
  }

  private onOutside = (event: MouseEvent) => {
    if (!this.element.contains(event.target as Node)) this.setOpen(false);
  };

  private onMenuKey = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      active?.classList.contains('ny-ai-menu__item')
    ) {
      event.preventDefault();
      active.parentElement
        ?.querySelector<HTMLElement>('.ny-ai-history__delete')
        ?.click();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [
      ...this.menu.querySelectorAll<HTMLElement>('.ny-ai-menu__item'),
    ];
    const at = items.indexOf(active as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
  };
}
