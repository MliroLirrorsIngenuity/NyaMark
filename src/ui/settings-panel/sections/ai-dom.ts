// The small pieces the AI tab of the settings builds itself from.
import { AiFetchError, SecretError } from '../../../bridge/ipc/ai';
import { i18next } from '../../../i18n';

/**
 * What the app said went wrong with a key or a request: thrown as it is, or
 * as the cause of the `fetch` or SDK error it became.
 */
function appFailure(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  for (const candidate of [error, cause]) {
    if (candidate instanceof SecretError || candidate instanceof AiFetchError) {
      return candidate.failure;
    }
  }
  return null;
}

/** The text of a failure, for a line in the settings. */
export function failureText(error: unknown): string {
  const failure = appFailure(error);
  switch (failure?.kind) {
    case 'not-connected':
      return i18next.t('settings.ai.notConnected');
    case 'key-needed':
      return i18next.t('settings.ai.keyNeeded');
    case 'bad-url':
      return i18next.t('settings.ai.badUrl');
    case 'signed-out':
      return i18next.t('settings.ai.chatgpt.error.signedOut');
    case 'plan-disabled':
      return i18next.t('settings.ai.chatgpt.error.planDisabled');
    case 'sign-in-failed':
      return i18next.t('settings.ai.chatgpt.error.oauth', {
        message: failure.message
          ? `${failure.message} (${failure.code})`
          : failure.code,
      });
    default:
      return error instanceof Error ? error.message : String(error ?? 'error');
  }
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
