import { errorDialog } from '../bridge/ipc/files';
import { i18next } from '../i18n';

/**
 * Last line of defence for errors no caller handled: an exception thrown in
 * an event listener or a rejected promise nobody awaited. Without it they
 * only reach the devtools console, and a failed action looks to the user
 * like nothing happened.
 *
 * Each distinct message is shown once per window and one dialog at a time,
 * so a failure that repeats (a frame callback, a listener on every key)
 * cannot bury the window under dialogs.
 */

/** Reported as errors by the WebView, harmless to the user. */
const IGNORED_MESSAGES = [
  // A ResizeObserver callback that resizes what it observes; the browser
  // delivers the rest on the next frame.
  /^ResizeObserver loop/,
];

export function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

export function createErrorReporter(show: (text: string) => Promise<void>) {
  const shown = new Set<string>();
  let showing = false;
  return (reason: unknown) => {
    const text = describeError(reason);
    if (!text || IGNORED_MESSAGES.some((pattern) => pattern.test(text))) {
      return;
    }
    if (showing || shown.has(text)) return;
    shown.add(text);
    showing = true;
    show(text)
      // A failing dialog must not raise another unhandled rejection.
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        showing = false;
      });
  };
}

export function installErrorBoundary() {
  const report = createErrorReporter((text) =>
    errorDialog(
      i18next.isInitialized
        ? i18next.t('dialog.unexpectedError', { message: text })
        : `NyaMark ran into an unexpected error: ${text}`
    )
  );
  // The WebView already logs both to the console.
  window.addEventListener('error', (event) => {
    report(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    report(event.reason);
  });
}
