/**
 * Conversations, in the AI tab: whether each document's conversations are
 * kept on this computer, and deleting every one kept. Deleting is done
 * when confirmed, whatever becomes of the dialog.
 */

import { confirmDialog } from '../../../bridge/ipc/files';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import type { AiSettings } from '../../../state/ai-settings';
import { el } from './ai-dom';

export type HistorySectionOptions = {
  /** The tab's working copy of the settings, changed in place. */
  state: AiSettings;
  /** Tells the dialog the settings changed. */
  emit: () => void;
};

export function renderHistorySection({
  state,
  emit,
}: HistorySectionOptions): HTMLElement {
  const section = el('section', 'ny-settings__section');
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.history.title">Conversations</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="keepHistory" />
        <span data-i18n="settings.ai.history.keep">Keep each document’s conversations</span>
      </label>
    </div>
    <p class="ny-settings__note" data-i18n="settings.ai.history.note">Kept on this computer with the app’s data, and opened again with the document. An unsaved document’s conversations go when its window closes.</p>
    <div class="ny-settings__row">
      <button type="button" class="ny-settings__button" data-action="clearHistory" data-i18n="settings.ai.history.clear">Delete all conversations…</button>
      <span class="ny-settings__note" data-role="historyStatus" role="status"></span>
    </div>
  `;

  const keep = section.querySelector<HTMLInputElement>(
    '[data-key="keepHistory"]'
  );
  const clear = section.querySelector<HTMLButtonElement>(
    '[data-action="clearHistory"]'
  );
  const status = section.querySelector<HTMLElement>(
    '[data-role="historyStatus"]'
  );

  if (keep) {
    keep.checked = state.keepHistory;
    keep.addEventListener('change', () => {
      state.keepHistory = keep.checked;
      emit();
    });
  }
  clear?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      i18next.t('settings.ai.history.clearConfirm'),
      {
        title: i18next.t('settings.ai.history.clearTitle'),
        okLabel: i18next.t('settings.ai.history.clearOk'),
        cancelLabel: i18next.t('settings.cancel'),
      }
    ).catch(() => false);
    if (!confirmed) return;
    clear.disabled = true;
    try {
      const { conversationStore } = await import('../../../ai/history/store');
      await conversationStore().clear();
      if (status) status.textContent = i18next.t('settings.ai.history.cleared');
    } catch (error) {
      console.error('Failed to delete the conversations:', error);
      if (status) {
        status.textContent = i18next.t('settings.ai.history.clearFailed');
      }
    } finally {
      clear.disabled = false;
    }
  });
  translateDOM(section);
  return section;
}
