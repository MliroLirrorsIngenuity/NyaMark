import { subscribeSettings } from '../state/settings';

/**
 * Saves on a timer while auto-save is on. The next save is scheduled once
 * the previous one finished, so a slow volume never stacks saves up.
 */
export function bindAutoSave(save: () => Promise<void>) {
  let enabled = false;
  let intervalMs = 60_000;
  let timer: number | null = null;

  const schedule = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (!enabled) return;

    timer = window.setTimeout(async () => {
      timer = null;
      try {
        await save();
      } finally {
        schedule();
      }
    }, intervalMs);
  };

  // A change to any other setting leaves the countdown running: restarted
  // on each, a document could go long past its interval unsaved.
  subscribeSettings((settings) => {
    const { autoSave, autoSaveIntervalMs } = settings.save;
    if (
      timer !== null &&
      autoSave === enabled &&
      autoSaveIntervalMs === intervalMs
    ) {
      return;
    }
    enabled = autoSave;
    intervalMs = autoSaveIntervalMs;
    schedule();
  });
}

/** How often a phone writes unsaved edits; iOS may end a background app at any time. */
const MOBILE_SAVE_INTERVAL_MS = 2_000;

/** On a phone every edit is saved shortly after it is made, and at once when the app leaves the screen. */
export function bindMobileAutoSave(save: () => Promise<void>) {
  let saving: Promise<void> | null = null;
  const run = () => {
    saving ??= save().finally(() => {
      saving = null;
    });
    return saving;
  };
  window.setInterval(() => void run(), MOBILE_SAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void run();
  });
}
