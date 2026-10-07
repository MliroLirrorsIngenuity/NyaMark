/**
 * A service's models, in the AI tab: those it lists and those added by ID,
 * in one list with a switch each. The tab fetches the list as soon as the
 * service can answer and keeps it while the dialog is open.
 */

import { guessCapabilities } from '../../../ai/providers/capabilities';
import type { ListedModel } from '../../../ai/providers/models';
import { ICONS } from '../../../ai/ui/icons';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import {
  type AiModelInfo,
  type AiProvider,
  modelLabel,
} from '../../../state/ai-settings';
import { el, input, translated } from './ai-dom';

export const modelStyles = `
.ny-ai-models {
  display: grid;
  gap: 8px;
  width: 100%;
}

.ny-ai-models__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.ny-ai-models__title {
  color: var(--ny-text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.ny-ai-models__count {
  color: var(--ny-text-secondary);
  font-size: 11.5px;
}

.ny-ai-models .ny-settings__note {
  margin: 0;
}

.ny-ai-models__reload {
  display: inline-grid;
  margin-left: auto;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ny-text-secondary);
}

.ny-ai-models__reload svg {
  width: 15px;
  height: 15px;
}

.ny-ai-models__reload:hover:not(:disabled) {
  background: var(--ny-fill-soft);
  color: var(--ny-text-primary);
}

.ny-ai-models__reload:disabled:not([aria-busy="true"]) {
  opacity: 0.4;
}

.ny-ai-models__reload:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 1px;
}

.ny-ai-models__reload[aria-busy="true"] svg {
  animation: ny-ai-models-spin 0.9s linear infinite;
}

@keyframes ny-ai-models-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ny-ai-models__reload[aria-busy="true"] svg {
    animation: none;
  }
}

.ny-ai-models__box {
  overflow: hidden;
  border: 1px solid var(--ny-line);
  border-radius: 10px;
}

.ny-ai-models__box:has(.ny-ai-models__search input:focus) {
  border-color: color-mix(in srgb, var(--ny-accent) 60%, transparent);
  box-shadow: 0 0 0 3px var(--ny-accent-soft);
}

.ny-ai-models__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ny-line);
  color: var(--ny-text-secondary);
}

.ny-ai-models__search svg {
  flex: none;
  width: 14px;
  height: 14px;
}

.ny-ai-models__search input {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  user-select: text;
  -webkit-user-select: text;
}

/* The box carries the ring, in place of the dialog's (shell.css). */
.ny-ai-models .ny-ai-models__search input:focus-visible {
  outline: none;
}

.ny-ai-models__search input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}

.ny-ai-models__list {
  max-height: 288px;
  overflow: auto;
  padding: 4px;
}

.ny-ai-models__empty {
  margin: 0;
  padding: 14px 10px;
  color: var(--ny-text-secondary);
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}

.ny-ai-model {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 8px 0 10px;
  border-radius: 7px;
}

.ny-ai-model:hover {
  background: var(--ny-fill-soft);
}

.ny-ai-model__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ny-text-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-ai-model:not(.is-on) .ny-ai-model__name {
  color: var(--ny-text-secondary);
}

.ny-ai-model__caps {
  display: flex;
  gap: 2px;
}

.ny-ai-model__cap {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: color-mix(in srgb, var(--ny-text-secondary) 55%, transparent);
}

.ny-ai-model__cap svg {
  width: 14px;
  height: 14px;
}

.ny-ai-model__cap[aria-pressed="true"] {
  background: var(--ny-accent-soft);
  color: var(--ny-accent-ink);
}

.ny-ai-model__cap:hover {
  color: var(--ny-text-primary);
}

.ny-ai-model__cap[aria-pressed="true"]:hover {
  color: var(--ny-accent-ink);
}

.ny-ai-model__cap:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 1px;
}

.ny-ai-model__context {
  box-sizing: border-box;
  width: 72px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ny-text-secondary);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: text;
  -webkit-user-select: text;
}

.ny-ai-model__context:hover:not(:focus) {
  border-color: var(--ny-line);
}

.ny-ai-models input.ny-ai-model__context:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--ny-accent) 60%, transparent);
  box-shadow: 0 0 0 3px var(--ny-accent-soft);
  color: var(--ny-text-primary);
}

.ny-ai-model .ny-settings__field--checkbox {
  flex: none;
}

.ny-ai-models__add {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ny-accent-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
}

.ny-ai-models__add svg {
  flex: none;
  width: 14px;
  height: 14px;
}

.ny-ai-models__add span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-ai-models__add:hover,
.ny-ai-models__add:focus-visible {
  background: var(--ny-fill-soft);
  outline: none;
}
`;

/** What a service answered when asked for its models. */
export type Listing =
  | { kind: 'loading' }
  | { kind: 'models'; models: ListedModel[] }
  /** It lists none, and its first model answered instead. */
  | { kind: 'answered'; model: string }
  | { kind: 'failed'; message: string };

export type ModelListOptions = {
  provider: AiProvider;
  local: boolean;
  /** The service's answer, undefined until it is asked. */
  listing: () => Listing | undefined;
  /** What the service needs before it can be asked, or null for nothing. */
  waiting: () => string | null;
  /**
   * The IDs of the models shown while the dialog is open and not listed,
   * so one switched off stays in the list to switch on again.
   */
  kept: Set<string>;
  reload: () => void;
  /** A model was switched on or off. */
  changed: () => void;
  /** A model's details changed. */
  edited: () => void;
};

export type ModelList = {
  element: HTMLElement;
  /** Draws the list again when the service's answer or models changed. */
  refresh: () => void;
};

const CAPABILITIES = [
  ['vision', ICONS.image],
  ['tools', ICONS.wrench],
  ['reasoning', ICONS.bulb],
] as const;

/** Where a model the service lists starts in the settings. */
export function modelFromListing(
  listed: ListedModel,
  local: boolean
): AiModelInfo {
  const guess = guessCapabilities(listed.id, {
    local,
    contextWindow: listed.contextWindow,
  });
  return {
    ...guess,
    ...(listed.name && { name: listed.name }),
    vision: listed.vision ?? guess.vision,
    tools: listed.tools ?? guess.tools,
    reasoning: listed.reasoning ?? guess.reasoning,
    ...(listed.efforts && { efforts: listed.efforts }),
    ...(listed.defaultEffort && { defaultEffort: listed.defaultEffort }),
  };
}

/**
 * Takes the levels of thought the service lists now into a model already
 * on; says whether they changed. The level chosen stays.
 */
export function followListing(
  model: AiModelInfo,
  listed: ListedModel
): boolean {
  const before = JSON.stringify([model.efforts, model.defaultEffort]);
  model.efforts = listed.efforts;
  model.defaultEffort = listed.defaultEffort;
  return JSON.stringify([model.efforts, model.defaultEffort]) !== before;
}

/** A context length as the list shows it: 272K, 1M, or in full. */
export function formatTokens(value: number): string {
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1000 === 0) return `${value / 1000}K`;
  return value.toLocaleString('en-US');
}

/** A context length as typed: 272000, 272,000, 272K or 1.5M. */
export function parseTokens(text: string): number | null {
  const typed = text.trim().split(',').join('');
  const unit = typed.slice(-1).toLowerCase();
  const scale = unit === 'k' ? 1000 : unit === 'm' ? 1_000_000 : 1;
  const number = Number(scale === 1 ? typed : typed.slice(0, -1));
  if (!typed || !Number.isFinite(number)) return null;
  const value = Math.round(number * scale);
  return value >= 1024 && value <= 10_000_000 ? value : null;
}

type Row = { id: string; label: string; listed: ListedModel | null };

let switches = 0;

export function renderModelList(options: ModelListOptions): ModelList {
  const { provider, local } = options;
  const element = el('div', 'ny-ai-models');

  const head = el('div', 'ny-ai-models__head');
  const count = el('span', 'ny-ai-models__count');
  const reload = el('button', 'ny-ai-models__reload');
  reload.type = 'button';
  reload.innerHTML = ICONS.retry;
  reload.title = i18next.t('settings.ai.reloadModels');
  reload.setAttribute('aria-label', reload.title);
  reload.addEventListener('click', options.reload);
  head.append(
    translated('span', 'settings.ai.models', 'ny-ai-models__title'),
    count,
    reload
  );

  const note = el('p', 'ny-settings__note');
  const box = el('div', 'ny-ai-models__box');
  const search = el('label', 'ny-ai-models__search');
  search.innerHTML = ICONS.search;
  const field = input('search', '');
  field.placeholder = i18next.t('settings.ai.modelSearch');
  field.setAttribute('aria-label', field.placeholder);
  search.append(field);
  const list = el('div', 'ny-ai-models__list');
  box.append(search, list);
  element.append(head, note, box);

  const enabled = (id: string) =>
    provider.models.find((model) => model.id === id);

  // Drawn again only when something it shows changed elsewhere, so a
  // field being typed in keeps its focus.
  const shows = () => [
    options.listing(),
    options.waiting(),
    provider.models.map((model) => model.id).join('\n'),
  ];
  let drawn = shows();

  /** The models not listed come first, then the list in its order. */
  const rows = (): Row[] => {
    const listing = options.listing();
    const listed = listing?.kind === 'models' ? listing.models : [];
    const ids = new Set(listed.map((entry) => entry.id));
    for (const model of provider.models) {
      if (!ids.has(model.id)) options.kept.add(model.id);
    }
    const own = [...options.kept]
      .filter((id) => !ids.has(id))
      .map((id): Row => {
        const model = enabled(id);
        return { id, label: model ? modelLabel(model) : id, listed: null };
      });
    return [
      ...own,
      ...listed.map((entry) => ({
        id: entry.id,
        label:
          provider.auth === 'chatgpt' ? (entry.name ?? entry.id) : entry.id,
        listed: entry,
      })),
    ];
  };

  const enable = (row: Row) => {
    if (enabled(row.id)) return;
    provider.models.push(
      row.listed
        ? modelFromListing(row.listed, local)
        : guessCapabilities(row.id, { local })
    );
  };

  const details = (model: AiModelInfo, label: string): HTMLElement[] => {
    const caps = el('span', 'ny-ai-model__caps');
    for (const [flag, icon] of CAPABILITIES) {
      const cap = el('button', 'ny-ai-model__cap');
      cap.type = 'button';
      cap.innerHTML = icon;
      cap.title = i18next.t(`settings.ai.capability.${flag}`);
      cap.setAttribute(
        'aria-label',
        i18next.t('settings.ai.modelDetail', {
          model: label,
          detail: cap.title,
        })
      );
      cap.setAttribute('aria-pressed', String(model[flag]));
      cap.addEventListener('click', () => {
        model[flag] = !model[flag];
        cap.setAttribute('aria-pressed', String(model[flag]));
        options.edited();
      });
      caps.append(cap);
    }
    const context = input('text', 'ny-ai-model__context');
    context.value = formatTokens(model.contextWindow);
    context.title = i18next.t('settings.ai.contextTokens');
    context.setAttribute(
      'aria-label',
      i18next.t('settings.ai.modelDetail', {
        model: label,
        detail: context.title,
      })
    );
    context.addEventListener('change', () => {
      const value = parseTokens(context.value);
      if (value !== null) {
        model.contextWindow = value;
        options.edited();
      }
      context.value = formatTokens(model.contextWindow);
    });
    return [caps, context];
  };

  const drawRow = (row: Row): HTMLElement => {
    const item = el('div', 'ny-ai-model');
    const name = el('label', 'ny-ai-model__name', row.label);
    name.title = row.label === row.id ? row.id : `${row.label} (${row.id})`;
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.id = `ny-ai-model-${++switches}`;
    toggle.setAttribute(
      'aria-label',
      i18next.t('settings.ai.useModel', { model: row.label })
    );
    name.htmlFor = toggle.id;
    const holder = el('label', 'ny-settings__field--checkbox');
    holder.append(toggle);
    item.append(name, holder);
    // The switch stays in place, and with it the focus.
    let parts: HTMLElement[] = [];
    const fill = () => {
      const model = enabled(row.id);
      toggle.checked = model !== undefined;
      item.classList.toggle('is-on', model !== undefined);
      for (const part of parts) part.remove();
      parts = model ? details(model, row.label) : [];
      holder.before(...parts);
    };
    toggle.addEventListener('change', () => {
      if (toggle.checked) enable(row);
      else {
        provider.models = provider.models.filter(
          (entry) => entry.id !== row.id
        );
      }
      fill();
      showCount();
      drawn = shows();
      options.changed();
    });
    fill();
    return item;
  };

  const addById = (id: string) => {
    options.kept.add(id);
    enable({ id, label: id, listed: null });
    field.value = '';
    drawList();
    showCount();
    drawn = shows();
    options.changed();
  };

  const addRow = (id: string) => {
    const add = el('button', 'ny-ai-models__add');
    add.type = 'button';
    add.innerHTML = ICONS.plus;
    add.append(el('span', '', i18next.t('settings.ai.addModelId', { id })));
    add.addEventListener('click', () => addById(id));
    return add;
  };

  const empty = (text: string) => el('p', 'ny-ai-models__empty', text);

  const drawList = () => {
    const all = rows();
    const query = field.value.trim();
    const needle = query.toLowerCase();
    const shown = needle
      ? all.filter((row) =>
          `${row.id} ${row.label}`.toLowerCase().includes(needle)
        )
      : all;
    const items = shown.map(drawRow);
    // A query nothing matches offers to add it instead.
    if (query && !all.some((row) => row.id === query)) {
      items.push(addRow(query));
    } else if (!shown.length) {
      items.push(
        empty(
          options.listing()?.kind === 'loading'
            ? i18next.t('settings.ai.fetching')
            : i18next.t('settings.ai.noModels')
        )
      );
    }
    list.replaceChildren(...items);
  };

  const showCount = () => {
    const listing = options.listing();
    const enabledCount = provider.models.length;
    count.textContent =
      listing?.kind === 'models'
        ? i18next.t('settings.ai.modelsEnabledOf', {
            count: enabledCount,
            total: rows().length,
          })
        : enabledCount
          ? i18next.t('settings.ai.modelsEnabled', { count: enabledCount })
          : '';
  };

  const showNote = () => {
    const listing = options.listing();
    const loading = listing?.kind === 'loading';
    reload.disabled = loading || options.waiting() !== null;
    reload.setAttribute('aria-busy', String(loading));
    let text: string | null = listing ? null : options.waiting();
    if (listing?.kind === 'failed') {
      text = i18next.t('settings.ai.failed', { message: listing.message });
    } else if (listing?.kind === 'answered') {
      text = i18next.t('settings.ai.unlisted', { model: listing.model });
    }
    note.hidden = text === null;
    note.className = `ny-settings__note${
      listing?.kind === 'failed' ? ' ny-settings__note--error' : ''
    }`;
    note.textContent = text ?? '';
  };

  field.addEventListener('input', drawList);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    const id = field.value.trim();
    if (!id) return;
    const row = rows().find((entry) => entry.id === id);
    if (!row) {
      addById(id);
      return;
    }
    if (enabled(id)) return;
    enable(row);
    drawList();
    showCount();
    drawn = shows();
    options.changed();
  });

  const refresh = () => {
    showNote();
    showCount();
    const now = shows();
    if (now.every((value, index) => value === drawn[index])) return;
    drawn = now;
    drawList();
  };

  showNote();
  showCount();
  drawList();
  translateDOM(element);
  return { element, refresh };
}
