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

/** A pause in typing this long saves the edits on a phone. */
const MOBILE_IDLE_MS = 1_200;
/** Typing without a pause still saves this often; iOS may end a background app at any time. */
const MOBILE_MAX_UNSAVED_MS = 10_000;

/**
 * On a phone every edit is saved: once typing pauses, at least every few
 * seconds while it goes on, and at once when the app leaves the screen. The
 * returned function is called on every edit; `save` does nothing while
 * nothing is unsaved.
 */
export function bindMobileAutoSave(save: () => Promise<void>) {
  let saving: Promise<void> | null = null;
  let idle: number | undefined;
  let firstUnsaved: number | null = null;
  const run = () => {
    window.clearTimeout(idle);
    firstUnsaved = null;
    saving ??= save().finally(() => {
      saving = null;
    });
    return saving;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void run();
  });
  return () => {
    const now = Date.now();
    firstUnsaved ??= now;
    window.clearTimeout(idle);
    if (now - firstUnsaved >= MOBILE_MAX_UNSAVED_MS) void run();
    else idle = window.setTimeout(() => void run(), MOBILE_IDLE_MS);
  };
}
