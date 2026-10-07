/**
 * A service that signs in with ChatGPT, in the AI tab: its requests go to
 * Codex on the user's ChatGPT plan. The sign-in happens in the browser and
 * holds at once; a service the dialog signed in that it leaves without
 * ChatGPT signs out again when the dialog is confirmed or dismissed.
 */

import { CHATGPT_USAGE_URL } from '../../../ai/providers/chatgpt';
import { ICONS } from '../../../ai/ui/icons';
import {
  ChatGptError,
  type ChatGptStatus,
  type ProxySetting,
  chatGptCancelSignIn,
  chatGptSignIn,
  chatGptSignOut,
} from '../../../bridge/ipc/ai';
import { openExternalUrl } from '../../../bridge/ipc/attachments';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import type { AiProvider } from '../../../state/ai-settings';
import { button, el, failureText, translated } from './ai-dom';

export const chatGptStyles = `
.ny-chatgpt {
  display: grid;
  gap: 8px;
  width: 100%;
}

.ny-chatgpt .ny-settings__note {
  margin: 0;
}

.ny-chatgpt__account {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--ny-text-primary);
  font-size: 13px;
}

/* The account, and what can be done with it on the same line. */
.ny-chatgpt__signed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.ny-chatgpt__signed .ny-chatgpt__account {
  flex: 1 1 180px;
}

.ny-chatgpt__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ny-chatgpt__account svg {
  flex: none;
  width: 16px;
  height: 16px;
}

.ny-chatgpt__who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;
}

/* OpenAI's button: the logo and "Continue with ChatGPT", black or white. */
.ny-chatgpt__continue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 34px;
  padding: 0 16px;
  border: 1px solid #0d0d0d;
  border-radius: 999px;
  background: #0d0d0d;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: default;
}

.ny-chatgpt__continue svg {
  width: 16px;
  height: 16px;
}

.ny-chatgpt__continue:hover:not(:disabled) {
  background: #2b2b2b;
}

.ny-chatgpt__continue:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 2px;
}

.ny-chatgpt__continue:disabled {
  opacity: 0.55;
}

:root[data-theme="dark"] .ny-chatgpt__continue {
  border-color: #fff;
  background: #fff;
  color: #0d0d0d;
}

:root[data-theme="dark"] .ny-chatgpt__continue:hover:not(:disabled) {
  background: #e6e6e6;
}

.ny-ai-actions__result.is-warn {
  color: var(--ny-warning);
}
`;

/** What signing in with ChatGPT failed with, for a line in the settings. */
export function chatGptFailureText(error: unknown): string | null {
  if (!(error instanceof ChatGptError)) return failureText(error);
  const failure = error.failure;
  switch (failure.kind) {
    case 'cancelled':
      return null;
    case 'signed-out':
      return i18next.t('settings.ai.chatgpt.error.signedOut');
    case 'sign-in-again':
      return i18next.t('settings.ai.chatgpt.error.signInAgain');
    case 'access-denied':
      return i18next.t('settings.ai.chatgpt.error.accessDenied');
    case 'no-codex':
      return i18next.t('settings.ai.chatgpt.error.noCodex');
    case 'timed-out':
      return i18next.t('settings.ai.chatgpt.error.timedOut');
    case 'ports-busy':
      return i18next.t('settings.ai.chatgpt.error.portsBusy');
    case 'oauth':
      return i18next.t('settings.ai.chatgpt.error.oauth', {
        message: failure.message
          ? `${failure.message} (${failure.code})`
          : failure.code,
      });
    case 'browser':
      return i18next.t('settings.ai.chatgpt.error.browser', {
        message: failure.message,
      });
    case 'store':
      return i18next.t('settings.ai.chatgpt.error.store', {
        message: failure.message,
      });
    case 'network':
      return i18next.t('settings.ai.chatgpt.error.network', {
        message: failure.message,
      });
    case 'bad-proxy':
      return i18next.t('settings.ai.badProxy', { message: failure.message });
    default:
      return error.message;
  }
}

/** What a service's sign-in is doing, kept while its card is drawn again. */
export type ChatGptActivity = {
  busy: 'sign-in' | 'sign-out' | null;
  message: { text: string; tone: 'error' | 'warn' } | null;
};

export type ChatGptAccountOptions = {
  provider: AiProvider;
  activity: ChatGptActivity;
  /** The account as last read, undefined until it is. */
  status: () => ChatGptStatus | undefined;
  /** The account changed; the card is drawn again with it. */
  changed: (status: ChatGptStatus) => void;
  /** Draws the service's card as it is now, whichever is shown. */
  redraw: () => void;
  /** The proxy as the dialog has it now, saved or not. */
  proxy: () => ProxySetting;
};

export type ChatGptAccount = {
  element: HTMLElement;
  /** Draws the account again, as `status` now reads. */
  refresh: () => void;
};

export function renderChatGptAccount({
  provider,
  activity,
  status,
  changed,
  redraw,
  proxy,
}: ChatGptAccountOptions): ChatGptAccount {
  const element = el('div', 'ny-chatgpt');

  const signIn = async (fresh: boolean) => {
    activity.busy = 'sign-in';
    activity.message = null;
    redraw();
    try {
      changed(
        await chatGptSignIn({
          profile: provider.id,
          proxy: proxy(),
          fresh,
          page: {
            signedIn: i18next.t('settings.ai.chatgpt.page.signedIn'),
            failed: i18next.t('settings.ai.chatgpt.page.failed'),
          },
        })
      );
    } catch (error) {
      const text = chatGptFailureText(error);
      if (text) activity.message = { text, tone: 'error' };
    } finally {
      activity.busy = null;
      redraw();
    }
  };

  const signOut = async () => {
    activity.busy = 'sign-out';
    activity.message = null;
    redraw();
    try {
      const result = await chatGptSignOut(provider.id, proxy());
      changed(result.status);
      // The tokens are gone here either way; OpenAI may still hold them.
      if (!result.revoked) {
        activity.message = {
          text: i18next.t('settings.ai.chatgpt.notRevoked'),
          tone: 'warn',
        };
      }
    } catch (error) {
      const text = chatGptFailureText(error);
      if (text) activity.message = { text, tone: 'error' };
    } finally {
      activity.busy = null;
      redraw();
    }
  };

  const draw = () => {
    const busy = activity.busy !== null;
    const action = (
      key: string,
      run: () => void,
      className = 'ny-settings__button'
    ) => {
      const node = button(key, className);
      node.disabled = busy;
      node.addEventListener('click', run);
      return node;
    };
    const continueButton = (key: string, run: () => void) => {
      const node = el('button', 'ny-chatgpt__continue');
      node.type = 'button';
      node.disabled = busy;
      node.innerHTML = ICONS.chatgpt;
      node.append(translated('span', key));
      node.addEventListener('click', run);
      return node;
    };

    const account = status();
    const actions = el('div', 'ny-ai-actions');
    const parts: HTMLElement[] = [];
    if (account?.signedIn) {
      const signed = el('div', 'ny-chatgpt__signed');
      const line = el('div', 'ny-chatgpt__account');
      line.innerHTML = ICONS.chatgpt;
      const who = account.email;
      line.append(
        el(
          'span',
          'ny-chatgpt__who',
          who
            ? i18next.t('settings.ai.chatgpt.signedInAs', { who })
            : i18next.t('settings.ai.chatgpt.signedIn')
        )
      );
      const buttons = el('div', 'ny-chatgpt__buttons');
      buttons.append(
        action(
          'ai.plan.manage',
          () => void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error)
        ),
        action('settings.ai.chatgpt.otherAccount', () => void signIn(true)),
        action('settings.ai.chatgpt.signOut', () => void signOut())
      );
      signed.append(line, buttons);
      parts.push(signed);
    } else {
      parts.push(
        translated('p', 'settings.ai.chatgpt.about', 'ny-settings__note')
      );
      const start = continueButton(
        'settings.ai.chatgpt.continue',
        () => void signIn(false)
      );
      start.dataset.key = 'signIn';
      actions.append(start);
    }
    if (activity.busy === 'sign-in') {
      const cancel = button('settings.cancel');
      cancel.addEventListener('click', () => {
        void chatGptCancelSignIn().catch(console.error);
      });
      actions.append(cancel);
    }
    const result = el('span', 'ny-ai-actions__result');
    result.setAttribute('role', 'status');
    if (activity.busy === 'sign-in') {
      result.textContent = i18next.t('settings.ai.chatgpt.waiting');
    } else if (activity.message) {
      result.textContent = activity.message.text;
      result.classList.add(`is-${activity.message.tone}`);
    }
    actions.append(result);
    if (actions.childElementCount > 1 || result.textContent)
      parts.push(actions);
    element.replaceChildren(...parts);
    translateDOM(element);
  };

  draw();
  return { element, refresh: draw };
}
