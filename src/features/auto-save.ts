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
