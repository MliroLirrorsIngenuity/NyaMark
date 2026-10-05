import {
  guessCapabilities,
  isChatModel,
} from '../../../ai/providers/capabilities';
import { checkProvider } from '../../../ai/providers/check';
import { providerFetch } from '../../../ai/providers/connect';
import type { ListedModel } from '../../../ai/providers/models';
import {
  AI_PRESETS,
  type AiPreset,
  authSchemeOf,
  isPlainRemoteAddress,
  presetById,
} from '../../../ai/providers/presets';
import {
  type AiSecretStatus,
  type ProxySetting,
  deleteAiSecret,
  getAiSecretStatus,
  setAiSecret,
} from '../../../bridge/ipc/ai';
import { openExternalUrl } from '../../../bridge/ipc/attachments';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import {
  AI_PROVIDER_KINDS,
  type AiModelInfo,
  type AiModelRef,
  type AiProvider,
  type AiSettings,
  newAiProfileId,
} from '../../../state/ai-settings';
import { ensureStyle } from '../../../style/register';
import { type SelectOption, renderSelect } from '../select';

const styles = `
.ny-settings__field[hidden] {
  display: none;
}

.ny-settings__note {
  margin: -4px 0 10px;
  color: var(--ny-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.ny-settings__note--warn {
  margin: 0;
  color: #b0702a;
}

.ny-settings__note--error {
  margin: 0;
  color: #c55f5f;
}

.ny-settings__input,
.ny-settings__textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 12.5px;
  user-select: text;
  -webkit-user-select: text;
}

.ny-settings__textarea {
  min-height: 88px;
  line-height: 1.5;
  resize: vertical;
}

.ny-settings__input:focus-visible,
.ny-settings__textarea:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ny-accent), transparent 50%);
  outline-offset: 1px;
}

.ny-settings__button {
  flex: 0 0 auto;
  padding: 6px 11px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: default;
  white-space: nowrap;
}

.ny-settings__button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 40%);
}

.ny-settings__button:disabled {
  opacity: 0.55;
}

.ny-settings__button--link {
  border-color: transparent;
  background: transparent;
  color: var(--ny-accent);
  padding: 6px 4px;
}

.ny-ai-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ny-ai-provider {
  margin-bottom: 8px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 22%);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 28%);
}

.ny-ai-provider__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 14px;
}

.ny-ai-provider__title {
  flex: 1 1 auto;
  min-width: 0;
}

.ny-ai-provider__name {
  display: block;
  overflow: hidden;
  color: var(--ny-text-primary);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-ai-provider__meta {
  display: block;
  overflow: hidden;
  color: var(--ny-text-secondary);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-ai-provider__status {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--ny-text-secondary);
}

.ny-ai-provider__status.is-ok {
  color: #3f8f5a;
}

.ny-ai-provider__status.is-missing {
  color: #c55f5f;
}

.ny-ai-provider__body {
  padding: 4px 14px 12px;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 40%);
}

.ny-ai-provider__body[hidden] {
  display: none;
}

.ny-ai-provider__body .ny-settings__row {
  margin-top: 10px;
}

.ny-ai-key {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ny-ai-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.ny-ai-actions__result {
  flex: 1 1 200px;
  min-width: 0;
  font-size: 12px;
  color: var(--ny-text-secondary);
  overflow-wrap: anywhere;
}

.ny-ai-actions__result.is-ok {
  color: #3f8f5a;
}

.ny-ai-actions__result.is-error {
  color: #c55f5f;
}

.ny-ai-models {
  width: 100%;
  display: grid;
  gap: 2px;
}

.ny-ai-model {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto 92px 26px;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  color: var(--ny-text-primary);
}

.ny-ai-model__id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;
}

.ny-ai-model__flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ny-text-secondary);
}

.ny-ai-model__flag input {
  margin: 0;
  accent-color: var(--ny-accent);
}

.ny-ai-model input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 7px;
  background: transparent;
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 11.5px;
}

.ny-ai-model__remove {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ny-text-secondary);
  font-size: 15px;
  line-height: 1;
}

.ny-ai-model__remove:hover {
  background: color-mix(in srgb, var(--ny-border-strong), transparent 60%);
  color: var(--ny-text-primary);
}

.ny-ai-model-head {
  color: var(--ny-text-secondary);
  font-size: 11.5px;
}

.ny-ai-pick {
  width: 100%;
  display: grid;
  gap: 6px;
}

.ny-ai-pick[hidden] {
  display: none;
}

.ny-ai-pick__list {
  max-height: 220px;
  overflow: auto;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 30%);
  border-radius: 10px;
}

.ny-ai-pick__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 2px;
  font-size: 12px;
  color: var(--ny-text-primary);
}

.ny-ai-pick__item input {
  margin: 0;
  accent-color: var(--ny-accent);
}

.ny-ai-pick__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;

export type AiSectionOptions = {
  /** The proxy as the dialog has it now, saved or not. */
  proxy: () => ProxySetting;
};

export type AiSection = {
  element: HTMLElement;
  /**
   * Resolves once every key change sent from here has reached the app, so
   * keeping or dropping them all takes in the last one.
   */
  settled: () => Promise<void>;
};

/** The text of a failure, for a line in the settings. */
function failureText(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? 'error');
  if (message.includes('not-connected')) {
    return i18next.t('settings.ai.notConnected');
  }
  if (message.includes('key-needed')) {
    return i18next.t('settings.ai.keyNeeded');
  }
  return message;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function translated<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = el(tag, className, i18next.t(key));
  node.dataset.i18n = key;
  return node;
}

function button(key: string, className = 'ny-settings__button') {
  const node = translated('button', key, className);
  node.type = 'button';
  return node;
}

function input(type: string, className = 'ny-settings__input') {
  const node = el('input', className);
  node.type = type;
  node.spellcheck = false;
  node.autocomplete = 'off';
  return node;
}

/** `renderSelect` puts labels into HTML; names typed by the user go there. */
function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

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
    vision: listed.vision ?? guess.vision,
    tools: listed.tools ?? guess.tools,
    reasoning: listed.reasoning ?? guess.reasoning,
  };
}

/** The models the dropdowns offer, with the reference each value picks. */
function modelChoices(providers: AiProvider[]) {
  const refs = new Map<string, AiModelRef>();
  const options: SelectOption[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const value = `m${refs.size}`;
      refs.set(value, { provider: provider.id, model: model.id });
      options.push({
        value,
        label: escapeHtml(`${provider.name} · ${model.id}`),
      });
    }
  }
  return { refs, options };
}

function choiceFor(
  refs: Map<string, AiModelRef>,
  ref: AiModelRef | null
): string | null {
  if (!ref) return null;
  for (const [value, entry] of refs) {
    if (entry.provider === ref.provider && entry.model === ref.model) {
      return value;
    }
  }
  return null;
}

/**
 * The settings' AI tab: the services, the models to use, the proxy and the
 * user's own instructions. Keys typed here are held by the app for this
 * window until the dialog is confirmed or dismissed.
 */
export function renderAiSection(
  current: AiSettings,
  onChange: (next: AiSettings) => void,
  options: AiSectionOptions
): AiSection {
  ensureStyle('ny-settings-ai', styles);
  const state: AiSettings = structuredClone(current);
  const statuses = new Map<string, AiSecretStatus>();
  /** Providers moved to another address whose key must be typed again. */
  const keyNeeded = new Set<string>();
  /** Updates what a card shows of its saved key, without redrawing it. */
  const refreshers = new Map<string, () => void>();
  let editing: string | null = null;

  const pending = new Set<Promise<unknown>>();
  const track = <T>(request: Promise<T>): Promise<T> => {
    pending.add(request);
    const done = () => pending.delete(request);
    request.then(done, done);
    return request;
  };

  const emit = () => onChange(structuredClone(state));
  const refresh = (id: string) => refreshers.get(id)?.();

  const root = el('div');

  // Services.
  const services = el('section', 'ny-settings__section');
  services.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.services">AI services</h4>
    <p class="ny-settings__note" data-i18n="settings.ai.servicesNote">Connect the services you use. Keys stay in the system keychain and only go to the address they were entered for.</p>
  `;
  const storageNote = translated(
    'p',
    'settings.ai.fileStorage',
    'ny-settings__note ny-settings__note--warn'
  );
  storageNote.hidden = true;
  const list = el('div');
  const addRow = el('div', 'ny-settings__row');
  const addField = el('div', 'ny-settings__field');
  const presets = el('div', 'ny-ai-presets');
  for (const preset of AI_PRESETS) {
    const chip =
      preset.id === 'custom'
        ? button('settings.ai.custom')
        : el('button', 'ny-settings__button', preset.name);
    chip.type = 'button';
    chip.addEventListener('click', () => addProvider(preset));
    presets.append(chip);
  }
  addField.append(translated('span', 'settings.ai.add'), presets);
  addRow.append(addField);
  services.append(storageNote, list, addRow);

  const noteStorage = (status: AiSecretStatus) => {
    if (status.storage === 'file') storageNote.hidden = false;
  };

  // Models to use.
  const defaults = el('section', 'ny-settings__section');
  defaults.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.defaults">Models to use</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.chatModel">Assistant</span>
        <div class="ny-settings__select" data-key="chatModel"></div>
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.quickModel">Selection and slash commands</span>
        <div class="ny-settings__select" data-key="quickModel"></div>
      </label>
    </div>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.editMode">The assistant’s edits</span>
        <div class="ny-settings__select" data-key="editMode"></div>
      </label>
    </div>
  `;

  // Network.
  const network = el('section', 'ny-settings__section');
  network.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.network">Network</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.proxy">Proxy</span>
        <div class="ny-settings__select" data-key="proxy"></div>
      </label>
      <label class="ny-settings__field" data-row="proxyUrl">
        <span data-i18n="settings.ai.proxyUrl">Proxy address</span>
        <input class="ny-settings__input" type="text" data-key="proxyUrl" spellcheck="false" autocomplete="off" placeholder="http://127.0.0.1:7890" />
      </label>
    </div>
  `;

  // Instructions.
  const instructions = el('section', 'ny-settings__section');
  instructions.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.instructions">Custom instructions</h4>
    <p class="ny-settings__note" data-i18n="settings.ai.instructionsNote">Sent with every request: how you write, the language to answer in, what to leave alone.</p>
    <div class="ny-settings__row">
      <textarea class="ny-settings__textarea" data-key="instructions" maxlength="20000"></textarea>
    </div>
  `;

  root.append(services, defaults, network, instructions);

  const renderDefaults = () => {
    const { refs, options: choices } = modelChoices(state.providers);
    const pick = (
      key: 'chatModel' | 'quickModel',
      empty: SelectOption,
      set: (ref: AiModelRef | null) => void,
      ref: AiModelRef | null
    ) => {
      const host = defaults.querySelector<HTMLElement>(`[data-key="${key}"]`);
      if (!host) return;
      renderSelect(
        host,
        [empty, ...choices],
        choiceFor(refs, ref) ?? 'none',
        (value) => {
          set(refs.get(value) ?? null);
          emit();
        }
      );
    };
    pick(
      'chatModel',
      { value: 'none', label: 'None', i18n: 'settings.ai.noModel' },
      (ref) => {
        state.chatModel = ref;
      },
      state.chatModel
    );
    pick(
      'quickModel',
      {
        value: 'none',
        label: 'Same as the assistant',
        i18n: 'settings.ai.sameAsChat',
      },
      (ref) => {
        state.quickModel = ref;
      },
      state.quickModel
    );
    translateDOM(defaults);
  };

  const providersChanged = () => {
    // A model taken away can no longer be the one used.
    const has = (ref: AiModelRef | null) =>
      ref !== null &&
      state.providers.some(
        (provider) =>
          provider.id === ref.provider &&
          provider.models.some((model) => model.id === ref.model)
      );
    if (!has(state.chatModel)) state.chatModel = null;
    if (!has(state.quickModel)) state.quickModel = null;
    // The first model added is the one the assistant starts with.
    if (!state.chatModel) {
      const provider = state.providers.find((entry) => entry.models.length);
      const model = provider?.models[0];
      if (provider && model) {
        state.chatModel = { provider: provider.id, model: model.id };
      }
    }
    emit();
    renderDefaults();
  };

  const showStatus = (provider: AiProvider, status: HTMLElement) => {
    const saved = statuses.get(provider.id);
    const local = presetById(provider.preset)?.local ?? false;
    let key: string;
    let tone: 'ok' | 'missing';
    if (keyNeeded.has(provider.id)) {
      key = 'settings.ai.status.keyNeeded';
      tone = 'missing';
    } else if (saved?.hasKey) {
      key = 'settings.ai.status.saved';
      tone = 'ok';
    } else if (saved?.saved && local) {
      key = 'settings.ai.status.local';
      tone = 'ok';
    } else if (saved?.saved) {
      key = 'settings.ai.status.noKey';
      tone = 'missing';
    } else {
      key = 'settings.ai.status.notConnected';
      tone = 'missing';
    }
    status.className = `ny-ai-provider__status is-${tone}`;
    status.textContent = i18next.t(key, { hint: saved?.hint ?? '' });
  };

  /**
   * Binds the provider's key to its address and API. With no key given the
   * saved one stays, unless the address moved to another site.
   */
  const bind = async (provider: AiProvider, key: string | null) => {
    try {
      const status = await track(
        setAiSecret({
          profile: provider.id,
          baseUrl: provider.baseUrl,
          auth: authSchemeOf(provider.kind),
          key,
          keepKey: key === null,
        })
      );
      statuses.set(provider.id, status);
      keyNeeded.delete(provider.id);
      noteStorage(status);
    } catch (error) {
      if (String(error).includes('key-needed')) keyNeeded.add(provider.id);
      throw error;
    } finally {
      refresh(provider.id);
    }
  };

  const addProvider = (preset: AiPreset) => {
    const provider: AiProvider = {
      id: newAiProfileId(),
      name:
        preset.id === 'custom' ? i18next.t('settings.ai.custom') : preset.name,
      preset: preset.id,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      models: [],
    };
    state.providers.push(provider);
    editing = provider.id;
    providersChanged();
    renderList();
    if (provider.baseUrl) void bind(provider, null).catch(console.error);
    const field = provider.baseUrl && !preset.local ? 'key' : 'baseUrl';
    list
      .querySelector<HTMLElement>(
        `[data-provider="${provider.id}"] [data-key="${field}"]`
      )
      ?.focus();
  };

  const removeProvider = (provider: AiProvider) => {
    state.providers = state.providers.filter(
      (entry) => entry.id !== provider.id
    );
    statuses.delete(provider.id);
    keyNeeded.delete(provider.id);
    if (editing === provider.id) editing = null;
    void track(deleteAiSecret(provider.id)).catch(console.error);
    providersChanged();
    renderList();
  };

  const renderProvider = (provider: AiProvider): HTMLElement => {
    const preset = presetById(provider.preset);
    const local = preset?.local ?? false;
    const card = el('div', 'ny-ai-provider');
    card.dataset.provider = provider.id;

    const head = el('div', 'ny-ai-provider__head');
    const title = el('div', 'ny-ai-provider__title');
    const name = el('span', 'ny-ai-provider__name', provider.name);
    const meta = el('span', 'ny-ai-provider__meta');
    const showMeta = () => {
      meta.textContent = `${provider.baseUrl || '—'} · ${i18next.t(
        'settings.ai.modelCount',
        { count: provider.models.length }
      )}`;
    };
    showMeta();
    title.append(name, meta);
    const status = el('span');
    const open = editing === provider.id;
    const toggle = button(open ? 'settings.ai.done' : 'settings.ai.edit');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', () => {
      editing = open ? null : provider.id;
      renderList();
    });
    const remove = button('settings.ai.remove');
    remove.addEventListener('click', () => removeProvider(provider));
    head.append(title, status, toggle, remove);
    card.append(head);

    if (!open) {
      refreshers.set(provider.id, () => showStatus(provider, status));
      showStatus(provider, status);
      return card;
    }

    const body = el('div', 'ny-ai-provider__body');
    card.append(body);

    // Name and API.
    const first = el('div', 'ny-settings__row');
    const nameField = el('label', 'ny-settings__field');
    const nameInput = input('text');
    nameInput.value = provider.name;
    nameInput.addEventListener('change', () => {
      provider.name = nameInput.value.trim() || provider.name;
      nameInput.value = provider.name;
      name.textContent = provider.name;
      emit();
      renderDefaults();
    });
    nameField.append(translated('span', 'settings.ai.name'), nameInput);
    const kindField = el('label', 'ny-settings__field');
    const kindSelect = el('div', 'ny-settings__select');
    kindField.append(translated('span', 'settings.ai.kind'), kindSelect);
    first.append(nameField, kindField);

    // Address.
    const second = el('div', 'ny-settings__row');
    const urlField = el('label', 'ny-settings__field');
    const urlInput = input('text');
    urlInput.dataset.key = 'baseUrl';
    urlInput.value = provider.baseUrl;
    urlInput.placeholder = 'https://api.example.com/v1';
    const urlNote = el('p', 'ny-settings__note');
    urlNote.hidden = true;
    const showUrlNote = (failure?: string) => {
      const value = urlInput.value.trim();
      let text: string | null = null;
      let tone = 'warn';
      if (failure) {
        text = failure;
        tone = 'error';
      } else if (value && !isUrl(value)) {
        text = i18next.t('settings.ai.badUrl');
        tone = 'error';
      } else if (keyNeeded.has(provider.id)) {
        text = i18next.t('settings.ai.keyNeeded');
      } else if (isPlainRemoteAddress(value)) {
        text = i18next.t('settings.ai.plainHttp');
      }
      urlNote.hidden = text === null;
      urlNote.className = `ny-settings__note ny-settings__note--${tone}`;
      urlNote.textContent = text ?? '';
    };
    urlInput.addEventListener('input', () => showUrlNote());
    urlInput.addEventListener('change', () => {
      const value = urlInput.value.trim().replace(/\/+$/, '');
      urlInput.value = value;
      provider.baseUrl = value;
      showMeta();
      emit();
      if (!isUrl(value)) {
        showUrlNote();
        return;
      }
      void bind(provider, null).catch((error) => {
        if (!keyNeeded.has(provider.id)) showUrlNote(failureText(error));
      });
    });
    urlField.append(
      translated('span', 'settings.ai.baseUrl'),
      urlInput,
      urlNote
    );
    second.append(urlField);

    // Key.
    const third = el('div', 'ny-settings__row');
    const keyField = el('div', 'ny-settings__field');
    const keyLine = el('div', 'ny-ai-key');
    const keyInput = input('password');
    keyInput.dataset.key = 'key';
    const placeKey = () => {
      const saved = statuses.get(provider.id);
      keyInput.placeholder =
        saved?.hasKey && !keyNeeded.has(provider.id)
          ? i18next.t('settings.ai.keySaved', { hint: saved.hint ?? '' })
          : local
            ? i18next.t('settings.ai.keyOptional')
            : i18next.t('settings.ai.keyPlaceholder');
    };
    keyInput.addEventListener('change', () => {
      const key = keyInput.value.trim();
      if (!key) return;
      if (!isUrl(provider.baseUrl)) {
        showResult(i18next.t('settings.ai.badUrl'), 'error');
        return;
      }
      keyInput.value = '';
      void bind(provider, key).catch((error) =>
        showResult(failureText(error), 'error')
      );
    });
    keyLine.append(keyInput);
    const keyPage = preset?.keyPage;
    if (keyPage) {
      const getKey = button(
        'settings.ai.getKey',
        'ny-settings__button ny-settings__button--link'
      );
      getKey.addEventListener('click', () => {
        void openExternalUrl(keyPage).catch(console.error);
      });
      keyLine.append(getKey);
    }
    keyField.append(translated('span', 'settings.ai.key'), keyLine);
    third.append(keyField);

    refreshers.set(provider.id, () => {
      showStatus(provider, status);
      placeKey();
      showUrlNote();
    });
    refresh(provider.id);

    // Fetching and checking.
    const fourth = el('div', 'ny-settings__row');
    const actions = el('div', 'ny-ai-actions');
    const fetchButton = button('settings.ai.fetchModels');
    const checkButton = button('settings.ai.check');
    const result = el('span', 'ny-ai-actions__result');
    result.setAttribute('role', 'status');
    const showResult = (text: string, tone: 'ok' | 'error' | 'busy') => {
      result.textContent = text;
      result.className = `ny-ai-actions__result is-${tone}`;
    };
    actions.append(fetchButton, checkButton, result);
    fourth.append(actions);

    // Models.
    const fifth = el('div', 'ny-settings__row');
    const models = el('div', 'ny-ai-models');
    fifth.append(models);
    const sixth = el('div', 'ny-settings__row');
    const pick = el('div', 'ny-ai-pick');
    pick.hidden = true;
    sixth.append(pick);

    const modelsChanged = () => {
      renderModels();
      showMeta();
      providersChanged();
    };

    const renderModels = () => {
      models.replaceChildren(
        translated('span', 'settings.ai.models', 'ny-ai-model-head')
      );
      if (!provider.models.length) {
        models.append(
          translated('p', 'settings.ai.noModels', 'ny-settings__note')
        );
      } else {
        const columns = el('div', 'ny-ai-model ny-ai-model-head');
        columns.append(
          el('span'),
          translated('span', 'settings.ai.vision'),
          translated('span', 'settings.ai.tools'),
          translated('span', 'settings.ai.reasoning'),
          translated('span', 'settings.ai.context'),
          el('span')
        );
        models.append(columns);
      }
      for (const model of provider.models) {
        const row = el('div', 'ny-ai-model');
        const id = el('span', 'ny-ai-model__id', model.id);
        id.title = model.id;
        row.append(id);
        for (const flag of ['vision', 'tools', 'reasoning'] as const) {
          const box = el('input');
          box.type = 'checkbox';
          box.checked = model[flag];
          box.setAttribute(
            'aria-label',
            `${model.id}: ${i18next.t(`settings.ai.${flag}`)}`
          );
          box.addEventListener('change', () => {
            model[flag] = box.checked;
            emit();
          });
          const wrap = el('label', 'ny-ai-model__flag');
          wrap.append(box);
          row.append(wrap);
        }
        const context = el('input');
        context.type = 'number';
        context.min = '1024';
        context.step = '1024';
        context.value = String(model.contextWindow);
        context.setAttribute(
          'aria-label',
          `${model.id}: ${i18next.t('settings.ai.context')}`
        );
        context.addEventListener('change', () => {
          const value = Math.round(Number(context.value));
          if (Number.isFinite(value) && value >= 1024 && value <= 10_000_000) {
            model.contextWindow = value;
            emit();
          } else {
            context.value = String(model.contextWindow);
          }
        });
        row.append(context);
        const removeModel = el('button', 'ny-ai-model__remove', '×');
        removeModel.type = 'button';
        removeModel.setAttribute(
          'aria-label',
          `${i18next.t('settings.ai.removeModel')}: ${model.id}`
        );
        removeModel.addEventListener('click', () => {
          provider.models = provider.models.filter((entry) => entry !== model);
          modelsChanged();
          renderPick();
        });
        row.append(removeModel);
        models.append(row);
      }

      // By name, for a service that lists none or leaves a model out.
      const add = el('div', 'ny-ai-key');
      const addInput = input('text');
      addInput.placeholder = i18next.t('settings.ai.modelIdPlaceholder');
      const addButton = button('settings.ai.addModel');
      const addModel = () => {
        const id = addInput.value.trim();
        if (!id || provider.models.some((model) => model.id === id)) return;
        provider.models.push(guessCapabilities(id, { local }));
        modelsChanged();
        renderPick();
      };
      addButton.addEventListener('click', addModel);
      addInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        addModel();
      });
      add.append(addInput, addButton);
      models.append(add);
    };

    let listed: ListedModel[] = [];
    let filter = '';
    const renderPick = () => {
      if (!listed.length) {
        pick.hidden = true;
        pick.replaceChildren();
        return;
      }
      pick.hidden = false;
      const filterInput = input('search');
      filterInput.value = filter;
      filterInput.placeholder = i18next.t('settings.ai.filterModels', {
        count: listed.length,
      });
      const items = el('div', 'ny-ai-pick__list');
      const renderItems = () => {
        const needle = filter.trim().toLowerCase();
        items.replaceChildren();
        for (const entry of listed) {
          const text = `${entry.id} ${entry.name ?? ''}`.toLowerCase();
          if (needle && !text.includes(needle)) continue;
          const item = el('label', 'ny-ai-pick__item');
          const box = el('input');
          box.type = 'checkbox';
          box.checked = provider.models.some((model) => model.id === entry.id);
          box.addEventListener('change', () => {
            provider.models = provider.models.filter(
              (model) => model.id !== entry.id
            );
            if (box.checked) {
              provider.models.push(modelFromListing(entry, local));
            }
            modelsChanged();
          });
          const label = el('span', '', entry.id);
          label.title =
            entry.name && entry.name !== entry.id
              ? `${entry.name} (${entry.id})`
              : entry.id;
          item.append(box, label);
          items.append(item);
        }
      };
      filterInput.addEventListener('input', () => {
        filter = filterInput.value;
        renderItems();
      });
      renderItems();
      pick.replaceChildren(filterInput, items);
    };

    let running: AbortController | null = null;
    const run = async (mode: 'fetch' | 'check') => {
      if (!isUrl(provider.baseUrl)) {
        showResult(i18next.t('settings.ai.badUrl'), 'error');
        return;
      }
      running?.abort();
      const controller = new AbortController();
      running = controller;
      fetchButton.disabled = true;
      checkButton.disabled = true;
      showResult(
        i18next.t(
          mode === 'fetch' ? 'settings.ai.fetching' : 'settings.ai.checking'
        ),
        'busy'
      );
      try {
        const outcome = await checkProvider(
          provider,
          providerFetch(provider, options.proxy),
          controller.signal
        );
        if (outcome.kind === 'models') {
          listed = outcome.models
            .filter((entry) => isChatModel(entry.id))
            .sort((a, b) => a.id.localeCompare(b.id));
          showResult(
            i18next.t('settings.ai.connected', { count: listed.length }),
            'ok'
          );
          if (mode === 'fetch') renderPick();
        } else {
          showResult(
            i18next.t('settings.ai.answered', { model: outcome.model }),
            'ok'
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        showResult(
          i18next.t('settings.ai.failed', { message: failureText(error) }),
          'error'
        );
      } finally {
        if (running === controller) {
          running = null;
          fetchButton.disabled = false;
          checkButton.disabled = false;
        }
      }
    };
    fetchButton.addEventListener('click', () => void run('fetch'));
    checkButton.addEventListener('click', () => void run('check'));

    renderSelect(
      kindSelect,
      AI_PROVIDER_KINDS.map((kind) => ({
        value: kind,
        label: kind,
        i18n: `settings.ai.kinds.${kind}`,
      })),
      provider.kind,
      (value) => {
        provider.kind = value as AiProvider['kind'];
        emit();
        if (isUrl(provider.baseUrl)) {
          void bind(provider, null).catch((error) =>
            showResult(failureText(error), 'error')
          );
        }
      }
    );

    renderModels();
    body.append(first, second, third, fourth, fifth, sixth);
    return card;
  };

  const renderList = () => {
    refreshers.clear();
    list.replaceChildren(...state.providers.map(renderProvider));
    translateDOM(list);
  };

  // Proxy.
  const proxyHost = network.querySelector<HTMLElement>('[data-key="proxy"]');
  const proxyRow = network.querySelector<HTMLElement>('[data-row="proxyUrl"]');
  const proxyInput = network.querySelector<HTMLInputElement>(
    '[data-key="proxyUrl"]'
  );
  let proxyMode = state.proxy.mode;
  if (proxyInput && state.proxy.mode === 'manual') {
    proxyInput.value = state.proxy.url;
  }
  const setProxy = () => {
    if (proxyRow) proxyRow.hidden = proxyMode !== 'manual';
    const url = proxyInput?.value.trim() ?? '';
    // Manual with no address yet keeps to the system's until one is typed.
    state.proxy =
      proxyMode === 'manual'
        ? url
          ? { mode: 'manual', url }
          : { mode: 'system' }
        : { mode: proxyMode };
  };
  setProxy();
  if (proxyHost) {
    renderSelect(
      proxyHost,
      [
        { value: 'system', label: 'System', i18n: 'settings.ai.proxySystem' },
        { value: 'none', label: 'None', i18n: 'settings.ai.proxyNone' },
        { value: 'manual', label: 'Manual', i18n: 'settings.ai.proxyManual' },
      ],
      proxyMode,
      (value) => {
        proxyMode = value as ProxySetting['mode'];
        setProxy();
        emit();
        if (proxyMode === 'manual') proxyInput?.focus();
      }
    );
  }
  proxyInput?.addEventListener('change', () => {
    setProxy();
    emit();
  });

  const editModeHost = defaults.querySelector<HTMLElement>(
    '[data-key="editMode"]'
  );
  if (editModeHost) {
    renderSelect(
      editModeHost,
      [
        {
          value: 'review',
          label: 'Show them to accept or reject',
          i18n: 'settings.ai.editReview',
        },
        {
          value: 'auto',
          label: 'Apply them right away',
          i18n: 'settings.ai.editAuto',
        },
      ],
      state.editMode,
      (value) => {
        state.editMode = value === 'auto' ? 'auto' : 'review';
        emit();
      }
    );
  }

  const textarea = instructions.querySelector<HTMLTextAreaElement>(
    '[data-key="instructions"]'
  );
  if (textarea) {
    textarea.value = state.instructions;
    textarea.addEventListener('input', () => {
      state.instructions = textarea.value;
      emit();
    });
  }

  renderList();
  renderDefaults();
  translateDOM(root);

  // What is saved for each provider, staged changes included.
  for (const provider of state.providers) {
    void getAiSecretStatus(provider.id)
      .then((status) => {
        statuses.set(provider.id, status);
        noteStorage(status);
        refresh(provider.id);
      })
      .catch(console.error);
  }

  return {
    element: root,
    settled: async () => {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
