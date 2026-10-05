/**
 * Suggestions while writing, in the AI tab: on or off, how long typing
 * stops before one is asked for, and where the caret takes one. The model
 * they use is picked with the others, under the models to use.
 */

import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import { type AiSettings, COMPLETE_DELAYS } from '../../../state/ai-settings';
import { renderSelect } from '../select';
import { el } from './ai-dom';

export type CompleteSectionOptions = {
  /** The tab's working copy of the settings, changed in place. */
  state: AiSettings;
  /** Tells the dialog the settings changed. */
  emit: () => void;
};

export function renderCompleteSection({
  state,
  emit,
}: CompleteSectionOptions): HTMLElement {
  const section = el('section', 'ny-settings__section');
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.complete.title">Suggestions while writing</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="completeEnabled" />
        <span data-i18n="settings.ai.complete.enabled">Suggest the next words while writing</span>
      </label>
    </div>
    <p class="ny-settings__note" data-i18n="settings.ai.complete.note">When you stop typing, the model suggests how the text goes on, in grey after the caret. Tab takes it, Cmd/Ctrl+→ takes the next word and Esc lets it go. Each suggestion sends the text around the caret to the service.</p>
    <div class="ny-settings__row" data-row="completeOptions">
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.complete.delay">Pause before suggesting</span>
        <div class="ny-settings__select" data-key="completeDelay"></div>
      </label>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="completeAtEnd" />
        <span data-i18n="settings.ai.complete.atEndOnly">Only at the end of a paragraph</span>
      </label>
    </div>
  `;

  const enabled = section.querySelector<HTMLInputElement>(
    '[data-key="completeEnabled"]'
  );
  const options = section.querySelector<HTMLElement>(
    '[data-row="completeOptions"]'
  );
  const atEnd = section.querySelector<HTMLInputElement>(
    '[data-key="completeAtEnd"]'
  );
  const delayHost = section.querySelector<HTMLElement>(
    '[data-key="completeDelay"]'
  );

  const showOptions = () => {
    if (options) options.hidden = !state.complete.enabled;
  };
  if (enabled) {
    enabled.checked = state.complete.enabled;
    enabled.addEventListener('change', () => {
      state.complete = { ...state.complete, enabled: enabled.checked };
      showOptions();
      emit();
    });
  }
  if (atEnd) {
    atEnd.checked = state.complete.atEndOnly;
    atEnd.addEventListener('change', () => {
      state.complete = { ...state.complete, atEndOnly: atEnd.checked };
      emit();
    });
  }
  if (delayHost) {
    renderSelect(
      delayHost,
      COMPLETE_DELAYS.map((delay) => ({
        value: String(delay),
        label: i18next.t('settings.ai.complete.seconds', {
          value: delay / 1000,
        }),
      })),
      String(state.complete.delay),
      (value) => {
        state.complete = { ...state.complete, delay: Number(value) };
        emit();
      }
    );
  }
  showOptions();
  translateDOM(section);
  return section;
}
