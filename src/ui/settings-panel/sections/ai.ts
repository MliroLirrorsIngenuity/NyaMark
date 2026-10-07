import { isChatModel } from '../../../ai/providers/capabilities';
import { checkProvider } from '../../../ai/providers/check';
import { providerFetch } from '../../../ai/providers/connect';
import type { ListedModel } from '../../../ai/providers/models';
import {
  AI_PRESETS,
  type AiPreset,
  authSchemeOf,
  presetById,
} from '../../../ai/providers/presets';
import {
  type AiSecretStatus,
  type ChatGptStatus,
  type ProxySetting,
  SecretError,
  chatGptCancelSignIn,
  chatGptStatus,
  deleteAiSecret,
  getAiSecretStatus,
  setAiSecret,
  webAddressIsPublic,
} from '../../../bridge/ipc/ai';
import { openExternalUrl } from '../../../bridge/ipc/attachments';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import {
  AI_PROVIDER_KINDS,
  AI_SEARCH_ENGINES,
  type AiModelRef,
  type AiProvider,
  type AiSearchEngine,
  type AiSettings,
  CHATGPT_BASE_URL,
  isWebUrl,
  modelLabel,
  newAiProfileId,
} from '../../../state/ai-settings';
import { ensureStyle } from '../../../style/register';
import { type SelectOption, renderMenuButton, renderSelect } from '../select';
import {
  type ChatGptAccount,
  type ChatGptActivity,
  chatGptStyles,
  renderChatGptAccount,
} from './ai-chatgpt';
import { renderCompleteSection } from './ai-complete';
import {
  button,
  el,
  escapeHtml,
  failureText,
  input,
  translated,
} from './ai-dom';
import { renderHistorySection } from './ai-history';
import { mcpStyles, renderMcpSection } from './ai-mcp';
import {
  type Listing,
  modelFromListing,
  modelStyles,
  renderModelList,
} from './ai-models';
import { quickStyles, renderQuickSection } from './ai-quick';

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
  color: var(--ny-warning);
}

.ny-settings__note--error {
  margin: 0;
  color: var(--ny-del-ink);
}

/* As the dialog's own fields, in panel.ts. */
.ny-settings__input,
.ny-settings__textarea {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ny-line);
  border-radius: 10px;
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  user-select: text;
  -webkit-user-select: text;
}

.ny-settings__textarea {
  height: auto;
  min-height: 88px;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}

.ny-settings__input:hover:not(:focus),
.ny-settings__textarea:hover:not(:focus) {
  border-color: color-mix(in srgb, var(--ny-text-primary) 20%, transparent);
}

.ny-settings__input:focus-visible,
.ny-settings__textarea:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--ny-accent) 60%, transparent);
  box-shadow: 0 0 0 3px var(--ny-accent-soft);
}

.ny-settings__button {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ny-line);
  border-radius: 8px;
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: default;
  white-space: nowrap;
}

.ny-settings__button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ny-text-primary) 20%, transparent);
}

.ny-settings__button:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 1px;
}

.ny-settings__button:disabled {
  opacity: 0.55;
}

.ny-settings__button--link {
  border-color: transparent;
  background: transparent;
  color: var(--ny-accent-ink);
  padding: 0 4px;
}

.ny-ai-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* A card on the section, as the assistant's cards: the head, and what
   opens under it. */
.ny-ai-provider {
  margin-bottom: 8px;
  border: 1px solid var(--ny-line);
  border-radius: 12px;
  background: var(--ny-dock-bg);
}

.ny-ai-provider__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 14px;
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
  color: var(--ny-ok);
}

.ny-ai-provider__status.is-missing {
  color: var(--ny-del-ink);
}

.ny-ai-provider__body {
  padding: 4px 14px 12px;
  border-top: 1px solid var(--ny-line);
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
  color: var(--ny-ok);
}

.ny-ai-actions__result.is-error {
  color: var(--ny-del-ink);
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
  /** The keys were kept: what starts with a key starts again with the new one. */
  committed: () => void;
  /** The dialog closed. */
  destroy: () => void;
  /**
   * Opens the service set up from the preset `id` to fill in, adding it
   * when there is none yet.
   */
  addService: (id: string) => void;
};

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
        label: escapeHtml(`${provider.name} · ${modelLabel(model)}`),
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
 * The settings' AI tab: the services, the models to use, the proxy, the
 * MCP servers, the user's own instructions and the conversations kept. Keys typed here are held by the app for this
 * window until the dialog is confirmed or dismissed.
 */
export function renderAiSection(
  current: AiSettings,
  onChange: (next: AiSettings) => void,
  options: AiSectionOptions
): AiSection {
  ensureStyle('ny-settings-ai', styles);
  ensureStyle('ny-settings-ai-mcp', mcpStyles);
  ensureStyle('ny-settings-ai-quick', quickStyles);
  ensureStyle('ny-settings-ai-chatgpt', chatGptStyles);
  ensureStyle('ny-settings-ai-models', modelStyles);
  const state: AiSettings = structuredClone(current);
  const statuses = new Map<string, AiSecretStatus>();
  /** The ChatGPT account of each service that signs in with it. */
  const accounts = new Map<string, ChatGptStatus>();
  const activities = new Map<string, ChatGptActivity>();
  /** Providers moved to another address whose key must be typed again. */
  const keyNeeded = new Set<string>();
  /** Providers whose address or key is being saved. */
  const binding = new Set<string>();
  /** What each service answered for its models while the dialog is open. */
  const listings = new Map<string, Listing>();
  const loads = new Map<string, AbortController>();
  /** The models each card shows that its service does not list. */
  const kept = new Map<string, Set<string>>();
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
  const add = el('div', 'ny-settings__select');
  renderMenuButton(
    add,
    { i18n: 'settings.ai.add', text: i18next.t('settings.ai.add') },
    AI_PRESETS.map((preset, index) => {
      const custom = preset.id === 'custom';
      return {
        value: preset.id,
        label: custom ? i18next.t('settings.ai.custom') : preset.name,
        i18n: custom ? 'settings.ai.custom' : undefined,
        // The local services, and the one set up by hand, each a group.
        group: custom || preset.local !== AI_PRESETS[index - 1]?.local,
      };
    }),
    (id) => {
      const preset = presetById(id);
      if (preset) addProvider(preset);
    }
  );
  services.append(storageNote, list, add);

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
        <span data-i18n="settings.ai.completeModel">Suggestions while writing</span>
        <div class="ny-settings__select" data-key="completeModel"></div>
      </label>
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
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.ai.searchEngine">Web search</span>
        <div class="ny-settings__select" data-key="searchEngine"></div>
      </label>
      <label class="ny-settings__field" data-row="searxngUrl">
        <span data-i18n="settings.ai.searxngUrl">SearXNG address</span>
        <input class="ny-settings__input" type="text" data-key="searxngUrl" spellcheck="false" autocomplete="off" placeholder="https://searx.example.org" />
      </label>
    </div>
    <p class="ny-settings__note" data-i18n="settings.ai.searchNote">Needs no search key: the app reads the result pages Bing and DuckDuckGo show a browser. Automatic tries them in turn.</p>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="nativeSearch" />
        <span data-i18n="settings.ai.nativeSearch">Use the service’s own web search when it has one</span>
      </label>
    </div>
    <p class="ny-settings__note" data-i18n="settings.ai.nativeSearchNote">Anthropic and OpenAI search on their side and charge for each search. With other services the app searches.</p>
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

  const mcp = renderMcpSection({ state, emit, track });
  const quick = renderQuickSection({ state, emit });
  const complete = renderCompleteSection({ state, emit });
  const history = renderHistorySection({ state, emit });

  root.append(
    services,
    defaults,
    quick,
    complete,
    network,
    mcp.element,
    instructions,
    history
  );

  const renderDefaults = () => {
    const { refs, options: choices } = modelChoices(state.providers);
    const pick = (
      key: 'chatModel' | 'quickModel' | 'completeModel',
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
    pick(
      'completeModel',
      {
        value: 'none',
        label: 'Same as the selection commands',
        i18n: 'settings.ai.sameAsQuick',
      },
      (ref) => {
        state.completeModel = ref;
      },
      state.completeModel
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
    if (!has(state.completeModel)) state.completeModel = null;
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
    const account = accounts.get(provider.id);
    const local = presetById(provider.preset)?.local ?? false;
    let key: string;
    let tone: 'ok' | 'missing';
    if (provider.auth === 'chatgpt') {
      key = account?.signedIn
        ? 'settings.ai.status.signedIn'
        : 'settings.ai.status.signedOut';
      tone = account?.signedIn ? 'ok' : 'missing';
    } else if (keyNeeded.has(provider.id)) {
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
    binding.add(provider.id);
    try {
      const status = await track(
        setAiSecret({
          profile: provider.id,
          baseUrl: provider.baseUrl,
          auth: authSchemeOf(provider),
          key,
          keepKey: key === null,
        })
      );
      statuses.set(provider.id, status);
      keyNeeded.delete(provider.id);
      noteStorage(status);
    } catch (error) {
      if (error instanceof SecretError && error.failure.kind === 'key-needed') {
        keyNeeded.add(provider.id);
      }
      throw error;
    } finally {
      binding.delete(provider.id);
      refresh(provider.id);
    }
  };

  /** Drops what a service answered: its address, key or account changed. */
  const forget = (id: string) => {
    loads.get(id)?.abort();
    loads.delete(id);
    listings.delete(id);
  };

  /** What a service needs before its models can be fetched, or null. */
  const waitingFor = (provider: AiProvider): string | null => {
    if (provider.auth === 'chatgpt') {
      return accounts.get(provider.id)?.signedIn
        ? null
        : i18next.t('settings.ai.waitSignIn');
    }
    if (!isWebUrl(provider.baseUrl)) return i18next.t('settings.ai.waitUrl');
    const saved = statuses.get(provider.id);
    if (keyNeeded.has(provider.id)) return i18next.t('settings.ai.waitKey');
    if (saved?.hasKey) return null;
    // A local service answers without a key once its address is saved.
    if (!(presetById(provider.preset)?.local ?? false)) {
      return i18next.t('settings.ai.waitKey');
    }
    return saved?.saved ? null : i18next.t('settings.ai.waitUrl');
  };

  /** The models the service offers to chat with, in the order to show. */
  const chatModels = (provider: AiProvider, models: ListedModel[]) =>
    // ChatGPT lists what the account may use, in its own order.
    provider.auth === 'chatgpt'
      ? models
      : models
          .filter((entry) => isChatModel(entry.id))
          .sort((a, b) => a.id.localeCompare(b.id));

  const loadModels = async (provider: AiProvider) => {
    forget(provider.id);
    if (!isWebUrl(provider.baseUrl)) {
      listings.set(provider.id, {
        kind: 'failed',
        message: i18next.t('settings.ai.badUrl'),
      });
      refresh(provider.id);
      return;
    }
    const controller = new AbortController();
    loads.set(provider.id, controller);
    listings.set(provider.id, { kind: 'loading' });
    refresh(provider.id);
    let listing: Listing;
    try {
      const outcome = await checkProvider(
        provider,
        providerFetch(provider, options.proxy),
        controller.signal
      );
      listing =
        outcome.kind === 'models'
          ? { kind: 'models', models: chatModels(provider, outcome.models) }
          : outcome;
    } catch (error) {
      listing = { kind: 'failed', message: failureText(error) };
    }
    if (controller.signal.aborted) return;
    loads.delete(provider.id);
    listings.set(provider.id, listing);
    // ChatGPT lists what the plan includes: a new sign-in starts with all of it.
    if (
      listing.kind === 'models' &&
      provider.auth === 'chatgpt' &&
      !provider.models.length
    ) {
      provider.models = listing.models.map((entry) =>
        modelFromListing(entry, false)
      );
      providersChanged();
    }
    refresh(provider.id);
  };

  /** Fetches the models of the open card once its service can answer. */
  const ensureModels = (provider: AiProvider) => {
    if (
      editing === provider.id &&
      !listings.has(provider.id) &&
      !binding.has(provider.id) &&
      waitingFor(provider) === null
    ) {
      void loadModels(provider);
    }
  };

  /** Reads the ChatGPT account a service signs in with. */
  const loadAccount = (provider: AiProvider) => {
    void chatGptStatus(provider.id)
      .then((account) => {
        accounts.set(provider.id, account);
        refresh(provider.id);
      })
      .catch(console.error);
  };

  /** Signs the service in with a key, or with ChatGPT for its plan. */
  const setAuth = (provider: AiProvider, auth: AiProvider['auth']) => {
    if (provider.auth === auth) return;
    provider.auth = auth;
    forget(provider.id);
    // A ChatGPT sign-in's tokens are for OpenAI's API alone.
    if (auth === 'chatgpt') provider.baseUrl = CHATGPT_BASE_URL;
    emit();
    renderList();
    void bind(provider, null).catch(console.error);
    if (auth === 'chatgpt') loadAccount(provider);
  };

  const addProvider = (preset: AiPreset) => {
    const provider: AiProvider = {
      id: newAiProfileId(),
      name:
        preset.id === 'custom' ? i18next.t('settings.ai.custom') : preset.name,
      preset: preset.id,
      kind: preset.kind,
      auth: preset.auth ?? 'key',
      baseUrl: preset.baseUrl,
      models: [],
    };
    state.providers.push(provider);
    editing = provider.id;
    providersChanged();
    renderList();
    if (provider.baseUrl) void bind(provider, null).catch(console.error);
    if (provider.auth === 'chatgpt') loadAccount(provider);
    focusFirstField(provider, preset);
  };

  // What a service needs first: its key, where it runs, or a sign-in.
  const focusFirstField = (provider: AiProvider, preset: AiPreset) => {
    const field =
      provider.auth === 'chatgpt'
        ? 'signIn'
        : provider.baseUrl && !preset.local
          ? 'key'
          : 'baseUrl';
    list
      .querySelector<HTMLElement>(
        `[data-provider="${provider.id}"] [data-key="${field}"]`
      )
      ?.focus();
  };

  const addService = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    const existing =
      preset.id === 'custom'
        ? undefined
        : state.providers.find((provider) => provider.preset === preset.id);
    if (!existing) {
      addProvider(preset);
      return;
    }
    editing = existing.id;
    renderList();
    focusFirstField(existing, preset);
  };

  const removeProvider = (provider: AiProvider) => {
    state.providers = state.providers.filter(
      (entry) => entry.id !== provider.id
    );
    statuses.delete(provider.id);
    accounts.delete(provider.id);
    keyNeeded.delete(provider.id);
    forget(provider.id);
    kept.delete(provider.id);
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
    // Looked up once the address is set, not on every key typed.
    let reach: { url: string; isPublic: boolean } | null = null;
    const lookUp = (value: string) => {
      if (!isWebUrl(value) || new URL(value).protocol !== 'http:') return;
      if (reach?.url === value) return;
      void webAddressIsPublic(value).then(
        (isPublic) => {
          reach = { url: value, isPublic };
          if (urlInput.value.trim() === value) showUrlNote();
        },
        // Only a warning hangs on it; without an answer there is none.
        () => {}
      );
    };
    const showUrlNote = (failure?: string) => {
      const value = urlInput.value.trim();
      let text: string | null = null;
      let tone = 'warn';
      if (failure) {
        text = failure;
        tone = 'error';
      } else if (value && !isWebUrl(value)) {
        text = i18next.t('settings.ai.badUrl');
        tone = 'error';
      } else if (keyNeeded.has(provider.id)) {
        text = i18next.t('settings.ai.keyNeeded');
      } else if (reach?.url === value && reach.isPublic) {
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
      if (!isWebUrl(value)) {
        showUrlNote();
        return;
      }
      lookUp(value);
      forget(provider.id);
      void bind(provider, null).catch((error) => {
        if (!keyNeeded.has(provider.id)) showUrlNote(failureText(error));
      });
    });
    urlField.append(
      translated('span', 'settings.ai.baseUrl'),
      urlInput,
      urlNote
    );
    const chatgpt = provider.auth === 'chatgpt';
    const signsInWithChatGpt = provider.kind === 'openai';
    urlField.hidden = chatgpt;
    // OpenAI's API alone takes a ChatGPT sign-in.
    if (signsInWithChatGpt) {
      const authField = el('label', 'ny-settings__field');
      const authSelect = el('div', 'ny-settings__select');
      authField.append(translated('span', 'settings.ai.auth'), authSelect);
      renderSelect(
        authSelect,
        [
          { value: 'key', label: 'API key', i18n: 'settings.ai.authKey' },
          {
            value: 'chatgpt',
            label: 'ChatGPT account',
            i18n: 'settings.ai.authChatgpt',
          },
        ],
        provider.auth,
        (value) => setAuth(provider, value === 'chatgpt' ? 'chatgpt' : 'key')
      );
      second.append(authField);
    }
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
    const keyNote = el('p', 'ny-settings__note ny-settings__note--error');
    keyNote.hidden = true;
    const showKeyError = (text: string | null) => {
      keyNote.hidden = text === null;
      keyNote.textContent = text ?? '';
    };
    keyInput.addEventListener('change', () => {
      const key = keyInput.value.trim();
      if (!key) return;
      if (!isWebUrl(provider.baseUrl)) {
        showKeyError(i18next.t('settings.ai.badUrl'));
        return;
      }
      keyInput.value = '';
      showKeyError(null);
      forget(provider.id);
      void bind(provider, key).catch((error) =>
        showKeyError(failureText(error))
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
    keyField.append(translated('span', 'settings.ai.key'), keyLine, keyNote);
    keyField.hidden = chatgpt;
    third.append(keyField);

    let account: ChatGptAccount | null = null;
    if (chatgpt) {
      let activity = activities.get(provider.id);
      if (!activity) {
        activity = { busy: null, message: null };
        activities.set(provider.id, activity);
      }
      account = renderChatGptAccount({
        provider,
        activity,
        status: () => accounts.get(provider.id),
        changed: (next) => {
          const before = accounts.get(provider.id);
          accounts.set(provider.id, next);
          if (
            before?.signedIn !== next.signedIn ||
            before?.email !== next.email
          ) {
            forget(provider.id);
          }
        },
        redraw: () => refresh(provider.id),
        proxy: options.proxy,
      });
      const accountField = el('div', 'ny-settings__field');
      accountField.append(
        translated('span', 'settings.ai.chatgpt.title'),
        account.element
      );
      third.append(accountField);
    }

    // Models.
    let keptIds = kept.get(provider.id);
    if (!keptIds) {
      keptIds = new Set();
      kept.set(provider.id, keptIds);
    }
    const models = renderModelList({
      provider,
      local,
      listing: () => listings.get(provider.id),
      waiting: () => waitingFor(provider),
      kept: keptIds,
      reload: () => void loadModels(provider),
      changed: () => {
        showMeta();
        providersChanged();
      },
      edited: emit,
    });
    const fourth = el('div', 'ny-settings__row');
    fourth.append(models.element);

    refreshers.set(provider.id, () => {
      showStatus(provider, status);
      showMeta();
      placeKey();
      showUrlNote();
      account?.refresh();
      models.refresh();
      ensureModels(provider);
    });
    refresh(provider.id);
    lookUp(provider.baseUrl);

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
        if (provider.kind !== 'openai' && provider.auth === 'chatgpt') {
          setAuth(provider, 'key');
          return;
        }
        emit();
        // Whether it may sign in with ChatGPT changed: the fields do too.
        if ((provider.kind === 'openai') !== signsInWithChatGpt) renderList();
        forget(provider.id);
        if (isWebUrl(provider.baseUrl)) {
          void bind(provider, null).catch((error) =>
            showKeyError(failureText(error))
          );
        } else {
          refresh(provider.id);
        }
      }
    );

    body.append(first, second, third, fourth);
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

  // Web search.
  const engineHost = network.querySelector<HTMLElement>(
    '[data-key="searchEngine"]'
  );
  const searxngRow = network.querySelector<HTMLElement>(
    '[data-row="searxngUrl"]'
  );
  const searxngInput = network.querySelector<HTMLInputElement>(
    '[data-key="searxngUrl"]'
  );
  let engine = state.search.engine;
  if (searxngInput) searxngInput.value = state.search.searxngUrl;
  const setSearch = () => {
    if (searxngRow) searxngRow.hidden = engine !== 'searxng';
    const searxngUrl = searxngInput?.value.trim() ?? '';
    // SearXNG with no address yet searches as auto until one is typed.
    state.search = {
      ...state.search,
      searxngUrl,
      engine: engine === 'searxng' && !searxngUrl ? 'auto' : engine,
    };
  };
  setSearch();
  if (engineHost) {
    renderSelect(
      engineHost,
      [
        { value: 'auto', label: 'Automatic', i18n: 'settings.ai.searchAuto' },
        { value: 'bing', label: 'Bing' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
        { value: 'searxng', label: 'SearXNG' },
      ],
      engine,
      (value) => {
        engine = AI_SEARCH_ENGINES.includes(value as AiSearchEngine)
          ? (value as AiSearchEngine)
          : 'auto';
        setSearch();
        emit();
        if (engine === 'searxng') searxngInput?.focus();
      }
    );
  }
  searxngInput?.addEventListener('change', () => {
    setSearch();
    emit();
  });
  const nativeBox = network.querySelector<HTMLInputElement>(
    '[data-key="nativeSearch"]'
  );
  if (nativeBox) {
    nativeBox.checked = state.search.native;
    nativeBox.addEventListener('change', () => {
      state.search = { ...state.search, native: nativeBox.checked };
      emit();
    });
  }

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
    if (provider.auth === 'chatgpt') loadAccount(provider);
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
    committed: mcp.committed,
    destroy: () => {
      // A sign-in still waiting on the browser has nothing left to land in.
      if ([...activities.values()].some((entry) => entry.busy === 'sign-in')) {
        void chatGptCancelSignIn().catch(console.error);
      }
      for (const load of loads.values()) load.abort();
      mcp.destroy();
    },
    addService,
  };
}
