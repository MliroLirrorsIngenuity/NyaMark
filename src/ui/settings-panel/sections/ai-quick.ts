/**
 * The commands of the AI menu over a selection, in the AI tab: the built-in
 * ones, renamed or reworded as the user likes, and the user's own, in the
 * order the menu lists them.
 */

import {
  builtinQuickPrompt,
  quickActionName,
  quickActionPrompt,
} from '../../../ai/quick/actions';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import {
  type AiQuickAction,
  type AiSettings,
  MAX_QUICK_ACTIONS,
  defaultQuickActions,
  isBuiltinQuickAction,
  newQuickActionId,
} from '../../../state/ai-settings';
import { button, el, input, translated } from './ai-dom';

export const quickStyles = `
.ny-ai-quick-row__move {
  min-width: 28px;
  padding-inline: 6px;
}
`;

export type QuickSectionOptions = {
  /** The tab's working copy of the settings, changed in place. */
  state: AiSettings;
  /** Tells the dialog the settings changed. */
  emit: () => void;
};

const translate = (key: string) => i18next.t(key);

/** The first line of what the command asks, for its card's second line. */
function preview(action: AiQuickAction): string {
  const prompt = quickActionPrompt(action, i18next.language);
  return prompt.split('\n', 1)[0] || '—';
}

export function renderQuickSection({
  state,
  emit,
}: QuickSectionOptions): HTMLElement {
  let editing: string | null = null;

  const section = el('section', 'ny-settings__section');
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.quick.title">AI menu commands</h4>
    <p class="ny-settings__note" data-i18n="settings.ai.quick.note">What the AI menu over a selection offers, in this order. A built-in command left blank keeps its own name and wording.</p>
  `;
  const list = el('div');
  const add = button('settings.ai.quick.add');
  const reset = button('settings.ai.quick.reset');
  const actions = el('div', 'ny-ai-presets');
  actions.append(add, reset);
  const row = el('div', 'ny-settings__row');
  row.append(actions);
  section.append(list, row);

  add.addEventListener('click', () => {
    if (state.quickActions.length >= MAX_QUICK_ACTIONS) return;
    const action: AiQuickAction = {
      id: newQuickActionId(),
      name: '',
      prompt: '',
    };
    state.quickActions.push(action);
    editing = action.id;
    emit();
    render();
    list
      .querySelector<HTMLElement>(
        `[data-quick="${action.id}"] [data-key="prompt"]`
      )
      ?.focus();
  });
  reset.addEventListener('click', () => {
    state.quickActions = defaultQuickActions();
    editing = null;
    emit();
    render();
  });

  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    const entries = state.quickActions;
    if (to < 0 || to >= entries.length) return;
    [entries[index], entries[to]] = [entries[to], entries[index]];
    emit();
    render();
    list
      .querySelector<HTMLElement>(
        `[data-quick="${entries[to].id}"] [data-move="${by}"]`
      )
      ?.focus();
  };

  const renderAction = (action: AiQuickAction, index: number) => {
    const builtin = isBuiltinQuickAction(action.id) ? action.id : null;
    const card = el('div', 'ny-ai-provider');
    card.dataset.quick = action.id;

    const head = el('div', 'ny-ai-provider__head');
    const title = el('div', 'ny-ai-provider__title');
    const name = el(
      'span',
      'ny-ai-provider__name',
      quickActionName(action, translate, i18next.language) ||
        i18next.t('settings.ai.quick.untitled')
    );
    const meta = el('span', 'ny-ai-provider__meta', preview(action));
    title.append(name, meta);

    const up = el('button', 'ny-settings__button ny-ai-quick-row__move', '↑');
    up.type = 'button';
    up.dataset.move = '-1';
    up.disabled = index === 0;
    up.setAttribute('aria-label', i18next.t('settings.ai.quick.moveUp'));
    up.title = i18next.t('settings.ai.quick.moveUp');
    up.addEventListener('click', () => move(index, -1));
    const down = el('button', 'ny-settings__button ny-ai-quick-row__move', '↓');
    down.type = 'button';
    down.dataset.move = '1';
    down.disabled = index === state.quickActions.length - 1;
    down.setAttribute('aria-label', i18next.t('settings.ai.quick.moveDown'));
    down.title = i18next.t('settings.ai.quick.moveDown');
    down.addEventListener('click', () => move(index, 1));

    const open = editing === action.id;
    const toggle = button(open ? 'settings.ai.done' : 'settings.ai.edit');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', () => {
      editing = open ? null : action.id;
      render();
    });
    const remove = button('settings.ai.remove');
    remove.addEventListener('click', () => {
      state.quickActions = state.quickActions.filter(
        (entry) => entry.id !== action.id
      );
      if (editing === action.id) editing = null;
      emit();
      render();
    });
    head.append(title, up, down, toggle, remove);
    card.append(head);
    if (!open) return card;

    const body = el('div', 'ny-ai-provider__body');
    const changed = () => {
      name.textContent =
        quickActionName(action, translate, i18next.language) ||
        i18next.t('settings.ai.quick.untitled');
      meta.textContent = preview(action);
      emit();
    };

    const nameField = el('label', 'ny-settings__field');
    const nameInput = input('text');
    nameInput.dataset.key = 'name';
    nameInput.maxLength = 100;
    nameInput.value = action.name;
    nameInput.spellcheck = true;
    if (builtin)
      nameInput.placeholder = i18next.t(`ai.quick.action.${builtin}`);
    nameInput.addEventListener('input', () => {
      action.name = nameInput.value.trim();
      changed();
    });
    nameField.append(translated('span', 'settings.ai.name'), nameInput);
    const nameRow = el('div', 'ny-settings__row');
    nameRow.append(nameField);

    const promptField = el('label', 'ny-settings__field');
    const prompt = el('textarea', 'ny-settings__textarea');
    prompt.dataset.key = 'prompt';
    prompt.rows = 4;
    prompt.maxLength = 8000;
    prompt.value = action.prompt;
    prompt.placeholder = builtin
      ? builtinQuickPrompt(builtin, i18next.language)
      : i18next.t('settings.ai.quick.promptPlaceholder');
    prompt.addEventListener('input', () => {
      action.prompt = prompt.value.trim();
      changed();
    });
    promptField.append(translated('span', 'settings.ai.quick.prompt'), prompt);
    const promptRow = el('div', 'ny-settings__row');
    promptRow.append(promptField);

    body.append(nameRow, promptRow);
    card.append(body);
    return card;
  };

  const render = () => {
    list.replaceChildren(
      ...state.quickActions.map((action, index) => renderAction(action, index))
    );
    add.disabled = state.quickActions.length >= MAX_QUICK_ACTIONS;
    translateDOM(section);
  };

  render();
  return section;
}
