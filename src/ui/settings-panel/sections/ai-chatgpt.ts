/**
 * A service that signs in with ChatGPT, in the AI tab: its requests use the
 * user's ChatGPT plan. The sign-in happens in the browser and holds at once;
 * a service the dialog signed in that it leaves without ChatGPT signs out
 * again when the dialog is confirmed or dismissed.
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
import { animationsSettled, openModal } from '../../modal';
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

.ny-chatgpt-welcome__logo {
  display: flex;
  justify-content: center;
  margin: 4px 0 12px;
  color: var(--ny-text-primary);
}

.ny-chatgpt-welcome__logo svg {
  width: 32px;
  height: 32px;
}

.ny-chatgpt-welcome .ny-settings-confirm__title,
.ny-chatgpt-welcome .ny-settings-confirm__body {
  text-align: center;
}

.ny-chatgpt-welcome .ny-settings-confirm__actions {
  justify-content: center;
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
    case 'plan-disabled':
      return i18next.t('settings.ai.chatgpt.error.planDisabled');
    case 'access-denied':
      return i18next.t('settings.ai.chatgpt.error.accessDenied');
    case 'timed-out':
      return i18next.t('settings.ai.chatgpt.error.timedOut');
    case 'account-mismatch':
      return i18next.t('settings.ai.chatgpt.error.accountMismatch');
    case 'registration-incomplete':
      return i18next.t('settings.ai.chatgpt.error.registrationIncomplete');
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
    default:
      return error.message;
  }
}

/**
 * The first sign-in that lets NyaMark use the plan says so once, over the
 * settings dialog `host`.
 */
function showWelcome(host: HTMLElement) {
  const overlay = el('div', 'ny-settings-confirm ny-chatgpt-welcome');
  const panel = el('div', 'ny-settings-confirm__panel');
  const logo = el('div', 'ny-chatgpt-welcome__logo');
  logo.innerHTML = ICONS.chatgpt;
  const title = translated(
    'h4',
    'settings.ai.chatgpt.welcome.title',
    'ny-settings-confirm__title'
  );
  title.id = 'ny-chatgpt-welcome-title';
  const body = translated(
    'p',
    'settings.ai.chatgpt.welcome.body',
    'ny-settings-confirm__body'
  );
  const actions = el('div', 'ny-settings-confirm__actions');
  const ok = button(
    'settings.ai.chatgpt.welcome.ok',
    'ny-settings-dialog__button ny-settings-dialog__button--primary'
  );
  actions.append(ok);
  panel.append(logo, title, body, actions);
  overlay.append(panel);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    modal.release();
    overlay.classList.add('is-closing');
    await animationsSettled(overlay);
    overlay.remove();
  };
  ok.addEventListener('click', () => void close());
  host.append(overlay);
  const modal = openModal({
    overlay,
    dialog: panel,
    labelledBy: title.id,
    initialFocus: ok,
    onDismiss: () => void close(),
  });
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
  /** The settings dialog, which the welcome opens over. */
  dialog: () => HTMLElement | null;
  /** The proxy as the dialog has it now, saved or not. */
  proxy: () => ProxySetting;
  /** Switches the service to an API key. */
  useKey: () => void;
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
  dialog,
  proxy,
  useKey,
}: ChatGptAccountOptions): ChatGptAccount {
  const element = el('div', 'ny-chatgpt');

  const signIn = async (fresh: boolean, consent: boolean) => {
    activity.busy = 'sign-in';
    activity.message = null;
    redraw();
    try {
      const result = await chatGptSignIn({
        profile: provider.id,
        proxy: proxy(),
        fresh,
        consent,
        page: {
          signedIn: i18next.t('settings.ai.chatgpt.page.signedIn'),
          failed: i18next.t('settings.ai.chatgpt.page.failed'),
        },
      });
      changed(result.status);
      const host = dialog();
      if (result.welcome && host) showWelcome(host);
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
      // The tokens are gone either way; ChatGPT may still list NyaMark.
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
      const line = el('div', 'ny-chatgpt__account');
      line.innerHTML = ICONS.chatgpt;
      const who = account.email ?? account.name;
      line.append(
        el(
          'span',
          'ny-chatgpt__who',
          who
            ? i18next.t('settings.ai.chatgpt.signedInAs', { who })
            : i18next.t('settings.ai.chatgpt.signedIn')
        )
      );
      parts.push(line);
      if (account.planEnabled) {
        actions.append(
          action(
            'ai.plan.manage',
            () => void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error)
          )
        );
      } else {
        parts.push(
          translated(
            'p',
            'settings.ai.chatgpt.planOff',
            'ny-settings__note ny-settings__note--warn'
          )
        );
        actions.append(
          continueButton(
            'settings.ai.chatgpt.enablePlan',
            () => void signIn(false, true)
          ),
          action('settings.ai.chatgpt.useKey', useKey)
        );
      }
      actions.append(
        action(
          'settings.ai.chatgpt.otherAccount',
          () => void signIn(true, false)
        ),
        action('settings.ai.chatgpt.signOut', () => void signOut())
      );
    } else {
      parts.push(
        translated('p', 'settings.ai.chatgpt.about', 'ny-settings__note')
      );
      const start = continueButton(
        'settings.ai.chatgpt.continue',
        () => void signIn(false, false)
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
    parts.push(actions);
    element.replaceChildren(...parts);
    translateDOM(element);
  };

  draw();
  return { element, refresh: draw };
}
