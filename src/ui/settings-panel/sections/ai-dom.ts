// The small pieces the AI tab of the settings builds itself from.
import { i18next } from '../../../i18n';

/** The text of a failure, for a line in the settings. */
export function failureText(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? 'error');
  if (message.includes('not-connected')) {
    return i18next.t('settings.ai.notConnected');
  }
  if (message.includes('key-needed')) {
    return i18next.t('settings.ai.keyNeeded');
  }
  return message;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function translated<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = el(tag, className, i18next.t(key));
  node.dataset.i18n = key;
  return node;
}

export function button(key: string, className = 'ny-settings__button') {
  const node = translated('button', key, className);
  node.type = 'button';
  return node;
}

export function input(type: string, className = 'ny-settings__input') {
  const node = el('input', className);
  node.type = type;
  node.spellcheck = false;
  node.autocomplete = 'off';
  return node;
}

/** `renderSelect` puts labels into HTML; names typed by the user go there. */
export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
