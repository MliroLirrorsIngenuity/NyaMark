import { mcpHub } from '../../ai/mcp/hub';
import { CHATGPT_USAGE_URL } from '../../ai/providers/chatgpt';
import {
  AI_PRESETS,
  type AiPreset,
  presetById,
} from '../../ai/providers/presets';
import { builtinQuickPrompt, quickActionName } from '../../ai/quick/actions';
import {
  type AiSecretStatus,
  type ChatGptStatus,
  type ProxySetting,
  SecretError,
  chatGptCancelSignIn,
  chatGptStatus,
  deleteAiSecret,
  getAiSecretStatus,
  webAddressIsPublic,
} from '../../bridge/ipc/ai';
import { openExternalUrl } from '../../bridge/ipc/attachments';
import { i18next } from '../../i18n';
import {
  AI_PROVIDER_KINDS,
  AI_SEARCH_ENGINES,
  type AiMcpServer,
  type AiProvider,
  type AiQuickAction,
  type AiSearchEngine,
  type AiSettings,
  CHATGPT_BASE_URL,
  COMPLETE_DELAYS,
  MAX_QUICK_ACTIONS,
  defaultQuickActions,
  isBuiltinQuickAction,
  isWebUrl,
  mcpKeyProfile,
  modelLabel,
  newQuickActionId,
} from '../../state/ai-settings';
import {
  type ProviderKnown,
  adoptListing,
  bindSecret,
  choiceFor,
  fetchListing,
  keepModelsInUse,
  modelEntries,
  providerFromPreset,
  providerStatus,
  providerWaitingFor,
  proxyOf,
  searchOf,
} from '../../ui/settings-panel/sections/ai';
import {
  type ChatGptActivity,
  chatGptActions,
} from '../../ui/settings-panel/sections/ai-chatgpt';
import { failureText } from '../../ui/settings-panel/sections/ai-dom';
import { deleteAllConversations } from '../../ui/settings-panel/sections/ai-history';
import {
  bindMcpKey,
  formatPairs,
  mcpErrorText,
  mcpServerMeta,
  mcpStatusLine,
  newMcpServer,
  offeredTools,
  parseLines,
  parsePairs,
} from '../../ui/settings-panel/sections/ai-mcp';
import {
  type Listing,
  enableModel,
  formatTokens,
  matchModelRows,
  modelRows,
  modelsCount,
  modelsNote,
  parseTokens,
} from '../../ui/settings-panel/sections/ai-models';
import { quickPreview } from '../../ui/settings-panel/sections/ai-quick';
import type {
  FormEvent,
  FormPage,
  FormRow,
  FormSection,
  FormTone,
  NativeForm,
} from './form';

/**
 * The settings' AI tab in the native form, as `renderAiSection` is on the
 * page: the same settings, held in the dialog's working copy until OK.
 */
export type NativeAiTab = {
  /** The tab's sections on the settings' first page. */
  sections: () => FormSection[];
  /** A page the tab pushed, by its id; null once it is gone. */
  page: (id: string) => FormPage | null;
  /** What the user did on the tab's rows or on a page it pushed. */
  handle: (event: FormEvent) => void | Promise<void>;
  /** As `AiSection.settled`. */
  settled: () => Promise<void>;
  /** As `AiSection.committed`. */
  committed: () => void;
  /** The dialog closed. */
  destroy: () => void;
  /** As `AiSection.addService`. */
  addService: (id: string) => void;
};

export type NativeAiTabOptions = {
  /** The proxy as the dialog has it now, saved or not. */
  proxy: () => ProxySetting;
  form: NativeForm;
  /** Pushes the page `id`, which `page` then builds. */
  push: (id: string) => void;
  /** Goes back from the page `id` and any above it. */
  pop: (id: string) => void;
};

const ADD_PAGE = 'ai.add';
const SERVICE_PAGE = 'ai.service.';
const MODEL_PAGE = 'ai.model.';
const QUICK_PAGE = 'ai.quick.';
const SERVER_PAGE = 'ai.mcp.';

/** A model's row on its service's page is named after the model. */
const MODEL_ROW = 'ai.model.';
const QUICK_ROW = 'ai.quick.item.';
const SERVER_ROW = 'ai.mcp.item.';
const TOOL_ROW = 'ai.mcp.tool.';

const CAPABILITIES = ['vision', 'tools', 'reasoning'] as const;

const MAX_NAME = 100;
const MAX_PROMPT = 8000;
const MAX_INSTRUCTIONS = 20000;

const t = (key: string, values?: Record<string, unknown>) =>
  i18next.t(key, values);

const STATUS_TONES = {
  ok: 'success',
  missing: 'error',
  idle: 'muted',
} as const satisfies Record<string, FormTone>;

/** The address without the slashes that end it. */
function trimSlashes(address: string): string {
  let end = address.length;
  while (end > 0 && address[end - 1] === '/') end--;
  return address.slice(0, end);
}

export function createNativeAiTab(
  current: AiSettings,
  onChange: (next: AiSettings) => void,
  options: NativeAiTabOptions
): NativeAiTab {
  const { form } = options;
  const state: AiSettings = structuredClone(current);
  const hub = mcpHub();
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
  /** The models each page shows that its service does not list. */
  const kept = new Map<string, Set<string>>();
  /** What the model search of each service's page holds. */
  const searches = new Map<string, string>();
  const keyFailures = new Map<string, string>();
  const urlFailures = new Map<string, string>();
  /** Whether each service's plain HTTP address is outside this computer. */
  const reach = new Map<string, { url: string; isPublic: boolean }>();
  let fileStorage = false;
  let editing: string | null = null;

  const serverKeys = new Map<string, AiSecretStatus>();
  /** Servers given a key here, to start again once it is kept. */
  const serverKeyChanged = new Set<string>();
  const serverKeyNeeded = new Set<string>();
  const serverKeyFailures = new Map<string, string>();
  /** Servers whose key was typed while their address was not one. */
  const serverUrlRejected = new Set<string>();
  const restarting = new Set<string>();

  let historyStatus: { text: string; tone?: FormTone } | null = null;
  let clearing = false;

  let proxyMode = state.proxy.mode;
  let proxyUrl = state.proxy.mode === 'manual' ? state.proxy.url : '';
  let engine = state.search.engine;
  let searxngUrl = state.search.searxngUrl;

  const pending = new Set<Promise<unknown>>();
  const track = <T>(request: Promise<T>): Promise<T> => {
    pending.add(request);
    const done = () => pending.delete(request);
    request.then(done, done);
    return request;
  };

  const emit = () => onChange(structuredClone(state));

  const providerOf = (id: string) =>
    state.providers.find((provider) => provider.id === id);
  const serverOf = (id: string) =>
    state.mcpServers.find((server) => server.id === id);
  const actionOf = (id: string) =>
    state.quickActions.find((action) => action.id === id);

  const setProxy = () => {
    state.proxy = proxyOf(proxyMode, proxyUrl.trim());
  };
  const setSearch = () => {
    state.search = searchOf(state.search, engine, searxngUrl.trim());
  };
  setProxy();
  setSearch();

  const known = (provider: AiProvider): ProviderKnown => ({
    saved: statuses.get(provider.id),
    account: accounts.get(provider.id),
    keyNeeded: keyNeeded.has(provider.id),
  });

  const waitingFor = (provider: AiProvider) =>
    providerWaitingFor(provider, known(provider));

  const keptOf = (provider: AiProvider) => {
    let ids = kept.get(provider.id);
    if (!ids) {
      ids = new Set();
      kept.set(provider.id, ids);
    }
    return ids;
  };

  const activityOf = (provider: AiProvider) => {
    let activity = activities.get(provider.id);
    if (!activity) {
      activity = { busy: null, message: null };
      activities.set(provider.id, activity);
    }
    return activity;
  };

  /** Fetches the models of the open page once its service can answer. */
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

  const refresh = (id: string) => {
    const provider = providerOf(id);
    if (provider) ensureModels(provider);
    form.refresh();
  };

  const providersChanged = () => {
    keepModelsInUse(state);
    emit();
    form.refresh();
  };

  /**
   * Binds the provider's key to its address and API. With no key given the
   * saved one stays, unless the address moved to another site.
   */
  const bind = async (provider: AiProvider, key: string | null) => {
    binding.add(provider.id);
    try {
      const status = await track(bindSecret(provider, key));
      statuses.set(provider.id, status);
      keyNeeded.delete(provider.id);
      if (status.storage === 'file') fileStorage = true;
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

  const loadModels = async (provider: AiProvider) => {
    forget(provider.id);
    if (!isWebUrl(provider.baseUrl)) {
      listings.set(provider.id, {
        kind: 'failed',
        message: t('settings.ai.badUrl'),
      });
      refresh(provider.id);
      return;
    }
    const controller = new AbortController();
    loads.set(provider.id, controller);
    listings.set(provider.id, { kind: 'loading' });
    refresh(provider.id);
    const listing = await fetchListing(
      provider,
      options.proxy,
      controller.signal
    );
    if (controller.signal.aborted) return;
    loads.delete(provider.id);
    listings.set(provider.id, listing);
    const adopted = adoptListing(provider, listing);
    if (adopted === 'added') providersChanged();
    else if (adopted === 'followed') emit();
    refresh(provider.id);
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

  /** Looked up once the address is set, not on every key typed. */
  const lookUp = (provider: AiProvider) => {
    const value = provider.baseUrl;
    if (!isWebUrl(value) || new URL(value).protocol !== 'http:') return;
    if (reach.get(provider.id)?.url === value) return;
    void webAddressIsPublic(value).then(
      (isPublic) => {
        reach.set(provider.id, { url: value, isPublic });
        form.refresh();
      },
      // Only a warning hangs on it; without an answer there is none.
      () => {}
    );
  };

  /** Signs the service in with a key, or with ChatGPT for its plan. */
  const setAuth = (provider: AiProvider, auth: AiProvider['auth']) => {
    if (provider.auth === auth) return;
    provider.auth = auth;
    forget(provider.id);
    // A ChatGPT sign-in's tokens are for OpenAI's API alone.
    if (auth === 'chatgpt') provider.baseUrl = CHATGPT_BASE_URL;
    emit();
    void bind(provider, null).catch(console.error);
    if (auth === 'chatgpt') loadAccount(provider);
    form.refresh();
  };

  const addProvider = (preset: AiPreset) => {
    const provider = providerFromPreset(preset);
    state.providers.push(provider);
    editing = provider.id;
    providersChanged();
    if (provider.baseUrl) void bind(provider, null).catch(console.error);
    if (provider.auth === 'chatgpt') loadAccount(provider);
    return provider;
  };

  const openService = (provider: AiProvider) => {
    editing = provider.id;
    lookUp(provider);
    options.push(`${SERVICE_PAGE}${provider.id}`);
    refresh(provider.id);
  };

  const addService = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    const existing =
      preset.id === 'custom'
        ? undefined
        : state.providers.find((provider) => provider.preset === preset.id);
    openService(existing ?? addProvider(preset));
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
  };

  const addModelById = (provider: AiProvider, id: string) => {
    const local = presetById(provider.preset)?.local ?? false;
    keptOf(provider).add(id);
    enableModel(provider, { id, label: id, listed: null }, local);
    searches.delete(provider.id);
    providersChanged();
  };

  const setModel = (provider: AiProvider, id: string, on: boolean) => {
    if (on) {
      const row = modelRows(
        provider,
        listings.get(provider.id),
        keptOf(provider)
      ).find((entry) => entry.id === id);
      if (!row) return;
      const local = presetById(provider.preset)?.local ?? false;
      enableModel(provider, row, local);
    } else {
      provider.models = provider.models.filter((model) => model.id !== id);
    }
    providersChanged();
  };

  // Services.
  const urlNotes = (
    provider: AiProvider
  ): { error?: string; warning?: string } => {
    const failure = urlFailures.get(provider.id);
    const value = provider.baseUrl;
    if (failure) return { error: failure };
    if (value && !isWebUrl(value)) return { error: t('settings.ai.badUrl') };
    if (keyNeeded.has(provider.id)) {
      return { warning: t('settings.ai.keyNeeded') };
    }
    const looked = reach.get(provider.id);
    if (looked?.url === value && looked.isPublic) {
      return { warning: t('settings.ai.plainHttp') };
    }
    return {};
  };

  const connectionRows = (provider: AiProvider): FormRow[] => {
    const preset = presetById(provider.preset);
    const local = preset?.local ?? false;
    const rows: FormRow[] = [
      {
        kind: 'text',
        id: 'ai.service.name',
        label: t('settings.ai.name'),
        value: provider.name,
      },
      {
        kind: 'choice',
        id: 'ai.service.kind',
        label: t('settings.ai.kind'),
        value: provider.kind,
        options: AI_PROVIDER_KINDS.map((kind) => ({
          value: kind,
          label: t(`settings.ai.kinds.${kind}`),
        })),
      },
    ];
    // OpenAI's API alone takes a ChatGPT sign-in.
    if (provider.kind === 'openai') {
      rows.push({
        kind: 'choice',
        id: 'ai.service.auth',
        label: t('settings.ai.auth'),
        value: provider.auth,
        options: [
          { value: 'key', label: t('settings.ai.authKey') },
          { value: 'chatgpt', label: t('settings.ai.authChatgpt') },
        ],
      });
    }
    if (provider.auth === 'chatgpt') return rows;

    const { error, warning } = urlNotes(provider);
    rows.push({
      kind: 'text',
      id: 'ai.service.baseUrl',
      label: t('settings.ai.baseUrl'),
      value: provider.baseUrl,
      placeholder: 'https://api.example.com/v1',
      input: 'url',
      error,
    });
    if (warning) {
      rows.push({
        kind: 'note',
        id: 'ai.service.baseUrlNote',
        text: warning,
        tone: 'warning',
      });
    }
    const saved = statuses.get(provider.id);
    let placeholder = t('settings.ai.keyPlaceholder');
    if (saved?.hasKey && !keyNeeded.has(provider.id)) {
      placeholder = t('settings.ai.keySaved', { hint: saved.hint ?? '' });
    } else if (local) {
      placeholder = t('settings.ai.keyOptional');
    }
    rows.push({
      kind: 'text',
      id: 'ai.service.key',
      label: t('settings.ai.key'),
      value: '',
      placeholder,
      secure: true,
      input: 'code',
      error: keyFailures.get(provider.id),
    });
    if (preset?.keyPage) {
      rows.push({
        kind: 'link',
        id: 'ai.service.getKey',
        label: t('settings.ai.getKey'),
        external: true,
      });
    }
    return rows;
  };

  const accountSection = (provider: AiProvider): FormSection => {
    const activity = activityOf(provider);
    const account = accounts.get(provider.id);
    const busy = activity.busy !== null;
    const rows: FormRow[] = [];
    if (account?.signedIn) {
      rows.push(
        {
          kind: 'note',
          id: 'ai.service.signedInAs',
          text: account.email
            ? t('settings.ai.chatgpt.signedInAs', { who: account.email })
            : t('settings.ai.chatgpt.signedIn'),
        },
        {
          kind: 'link',
          id: 'ai.service.manage',
          label: t('ai.plan.manage'),
          external: true,
        },
        {
          kind: 'button',
          id: 'ai.service.otherAccount',
          label: t('settings.ai.chatgpt.otherAccount'),
          disabled: busy,
          busy: activity.busy === 'sign-in',
        },
        {
          kind: 'button',
          id: 'ai.service.signOut',
          label: t('settings.ai.chatgpt.signOut'),
          disabled: busy,
          busy: activity.busy === 'sign-out',
        }
      );
    } else {
      rows.push(
        {
          kind: 'note',
          id: 'ai.service.about',
          text: t('settings.ai.chatgpt.about'),
        },
        {
          kind: 'button',
          id: 'ai.service.signIn',
          label: t('settings.ai.chatgpt.continue'),
          role: 'primary',
          disabled: busy,
          busy: activity.busy === 'sign-in',
        }
      );
    }
    if (activity.busy === 'sign-in') {
      rows.push(
        {
          kind: 'button',
          id: 'ai.service.cancelSignIn',
          label: t('settings.cancel'),
        },
        {
          kind: 'note',
          id: 'ai.service.result',
          text: t('settings.ai.chatgpt.waiting'),
        }
      );
    } else if (activity.message) {
      rows.push({
        kind: 'note',
        id: 'ai.service.result',
        text: activity.message.text,
        tone: activity.message.tone === 'warn' ? 'warning' : 'error',
      });
    }
    return {
      id: 'ai.service.account',
      title: t('settings.ai.chatgpt.title'),
      rows,
    };
  };

  const modelsSection = (provider: AiProvider): FormSection => {
    const listing = listings.get(provider.id);
    const waiting = waitingFor(provider);
    const all = modelRows(provider, listing, keptOf(provider));
    const query = searches.get(provider.id) ?? '';
    const shown = matchModelRows(all, query);
    const loading = listing?.kind === 'loading';
    const note = modelsNote(listing, waiting);
    const rows: FormRow[] = [];
    if (note.text !== null) {
      rows.push({
        kind: 'note',
        id: 'ai.service.modelsNote',
        text: note.text,
        tone: note.failed ? 'error' : 'muted',
      });
    }
    rows.push(
      {
        kind: 'button',
        id: 'ai.service.reload',
        label: t('settings.ai.reloadModels'),
        busy: loading,
        disabled: loading || waiting !== null,
      },
      {
        kind: 'text',
        id: 'ai.service.search',
        label: t('settings.ai.modelSearch'),
        value: query,
        input: 'code',
      }
    );
    for (const row of shown) {
      const model = provider.models.find((entry) => entry.id === row.id);
      rows.push({
        kind: 'item',
        id: `${MODEL_ROW}${row.id}`,
        title: row.label,
        detail: row.label === row.id ? undefined : row.id,
        badge: model ? formatTokens(model.contextWindow) : undefined,
        toggle: model !== undefined,
      });
    }
    const typed = query.trim();
    if (typed && !all.some((row) => row.id === typed)) {
      rows.push({
        kind: 'button',
        id: 'ai.service.addModel',
        label: t('settings.ai.addModelId', { id: typed }),
      });
    } else if (!shown.length) {
      rows.push({
        kind: 'note',
        id: 'ai.service.noModels',
        text: loading ? t('settings.ai.fetching') : t('settings.ai.noModels'),
      });
    }
    return {
      id: 'ai.service.models',
      title: t('settings.ai.models'),
      footer:
        modelsCount(listing, provider.models.length, all.length) || undefined,
      rows,
    };
  };

  const servicePage = (provider: AiProvider): FormPage => ({
    id: `${SERVICE_PAGE}${provider.id}`,
    title: provider.name,
    sections: [
      { id: 'ai.service.connection', rows: connectionRows(provider) },
      ...(provider.auth === 'chatgpt' ? [accountSection(provider)] : []),
      modelsSection(provider),
      {
        id: 'ai.service.danger',
        rows: [
          {
            kind: 'button',
            id: 'ai.service.remove',
            label: t('settings.ai.remove'),
            role: 'destructive',
          },
        ],
      },
    ],
  });

  const modelPage = (
    provider: AiProvider,
    modelId: string
  ): FormPage | null => {
    const model = provider.models.find((entry) => entry.id === modelId);
    if (!model) return null;
    return {
      id: `${MODEL_PAGE}${provider.id}.${modelId}`,
      title: modelLabel(model),
      sections: [
        {
          id: 'ai.model.capabilities',
          rows: CAPABILITIES.map((flag) => ({
            kind: 'toggle',
            id: `ai.model.${flag}`,
            label: t(`settings.ai.capability.${flag}`),
            value: model[flag],
          })),
        },
        {
          id: 'ai.model.limits',
          rows: [
            {
              kind: 'text',
              id: 'ai.model.context',
              label: t('settings.ai.contextTokens'),
              value: formatTokens(model.contextWindow),
              input: 'code',
            },
          ],
        },
      ],
    };
  };

  const addPage = (): FormPage => {
    const sections: FormSection[] = [];
    let group: FormRow[] = [];
    AI_PRESETS.forEach((preset, index) => {
      const custom = preset.id === 'custom';
      // The local services, and the one set up by hand, each a group.
      if (
        !sections.length ||
        custom ||
        preset.local !== AI_PRESETS[index - 1]?.local
      ) {
        group = [];
        sections.push({ id: `ai.add.group${sections.length}`, rows: group });
      }
      group.push({
        kind: 'link',
        id: `ai.add.${preset.id}`,
        label: custom ? t('settings.ai.custom') : preset.name,
      });
    });
    return { id: ADD_PAGE, title: t('settings.ai.add'), sections };
  };

  const servicesSection = (): FormSection => {
    const rows: FormRow[] = [];
    if (fileStorage) {
      rows.push({
        kind: 'note',
        id: 'ai.storage',
        text: t('settings.ai.fileStorage'),
        tone: 'warning',
      });
    }
    for (const provider of state.providers) {
      const { key, tone } = providerStatus(provider, known(provider));
      rows.push({
        kind: 'item',
        id: `${SERVICE_PAGE}${provider.id}`,
        title: provider.name,
        detail: `${provider.baseUrl || '—'} · ${t('settings.ai.modelCount', {
          count: provider.models.length,
        })}`,
        badge: t(key, { hint: statuses.get(provider.id)?.hint ?? '' }),
        tone: STATUS_TONES[tone],
        actions: [
          {
            id: 'remove',
            label: t('settings.ai.remove'),
            destructive: true,
          },
        ],
      });
    }
    rows.push({ kind: 'link', id: ADD_PAGE, label: t('settings.ai.add') });
    return {
      id: 'ai.services',
      title: t('settings.ai.services'),
      footer: t('settings.ai.servicesNote'),
      rows,
    };
  };

  // Models to use.
  const modelChoice = (
    key: 'chatModel' | 'quickModel' | 'completeModel',
    label: string,
    empty: string
  ): FormRow => {
    const entries = modelEntries(state.providers);
    const refs = new Map(entries.map((entry) => [entry.value, entry.ref]));
    return {
      kind: 'choice',
      id: `ai.${key}`,
      label,
      value: choiceFor(refs, state[key]) ?? 'none',
      options: [
        { value: 'none', label: empty },
        ...entries.map((entry) => ({ value: entry.value, label: entry.label })),
      ],
    };
  };

  const defaultsSection = (): FormSection => ({
    id: 'ai.defaults',
    title: t('settings.ai.defaults'),
    rows: [
      modelChoice(
        'chatModel',
        t('settings.ai.chatModel'),
        t('settings.ai.noModel')
      ),
      modelChoice(
        'quickModel',
        t('settings.ai.quickModel'),
        t('settings.ai.sameAsChat')
      ),
      modelChoice(
        'completeModel',
        t('settings.ai.completeModel'),
        t('settings.ai.sameAsQuick')
      ),
      {
        kind: 'choice',
        id: 'ai.editMode',
        label: t('settings.ai.editMode'),
        value: state.editMode,
        options: [
          { value: 'review', label: t('settings.ai.editReview') },
          { value: 'auto', label: t('settings.ai.editAuto') },
        ],
      },
    ],
  });

  // AI menu commands.
  const quickName = (action: AiQuickAction) =>
    quickActionName(action, (key) => t(key), i18next.language) ||
    t('settings.ai.quick.untitled');

  const quickSection = (): FormSection => {
    const last = state.quickActions.length - 1;
    const rows: FormRow[] = state.quickActions.map((action, index) => ({
      kind: 'item',
      id: `${QUICK_ROW}${action.id}`,
      title: quickName(action),
      detail: quickPreview(action),
      actions: [
        ...(index > 0
          ? [{ id: 'up', label: t('settings.ai.quick.moveUp') }]
          : []),
        ...(index < last
          ? [{ id: 'down', label: t('settings.ai.quick.moveDown') }]
          : []),
        { id: 'remove', label: t('settings.ai.remove'), destructive: true },
      ],
    }));
    rows.push(
      {
        kind: 'button',
        id: 'ai.quick.add',
        label: t('settings.ai.quick.add'),
        disabled: state.quickActions.length >= MAX_QUICK_ACTIONS,
      },
      {
        kind: 'button',
        id: 'ai.quick.reset',
        label: t('settings.ai.quick.reset'),
      }
    );
    return {
      id: 'ai.quick',
      title: t('settings.ai.quick.title'),
      footer: t('settings.ai.quick.note'),
      rows,
    };
  };

  const quickPage = (action: AiQuickAction): FormPage => {
    const builtin = isBuiltinQuickAction(action.id) ? action.id : null;
    return {
      id: `${QUICK_PAGE}${action.id}`,
      title: quickName(action),
      sections: [
        {
          id: 'ai.quick.fields',
          rows: [
            {
              kind: 'text',
              id: 'ai.quick.name',
              label: t('settings.ai.name'),
              value: action.name,
              placeholder: builtin
                ? t(`ai.quick.action.${builtin}`)
                : undefined,
            },
            {
              kind: 'text',
              id: 'ai.quick.prompt',
              label: t('settings.ai.quick.prompt'),
              value: action.prompt,
              placeholder: builtin
                ? builtinQuickPrompt(builtin, i18next.language)
                : t('settings.ai.quick.promptPlaceholder'),
              multiline: true,
            },
          ],
        },
      ],
    };
  };

  const moveAction = (id: string, by: -1 | 1) => {
    const index = state.quickActions.findIndex((action) => action.id === id);
    const to = index + by;
    const entries = state.quickActions;
    if (index < 0 || to < 0 || to >= entries.length) return;
    [entries[index], entries[to]] = [entries[to], entries[index]];
    emit();
  };

  // Suggestions while writing.
  const completeSection = (): FormSection => {
    const { complete } = state;
    const rows: FormRow[] = [
      {
        kind: 'toggle',
        id: 'ai.complete.enabled',
        label: t('settings.ai.complete.enabled'),
        value: complete.enabled,
      },
      {
        kind: 'note',
        id: 'ai.complete.note',
        text: t('settings.ai.complete.note'),
      },
    ];
    if (complete.enabled) {
      rows.push(
        {
          kind: 'choice',
          id: 'ai.complete.delay',
          label: t('settings.ai.complete.delay'),
          value: String(complete.delay),
          options: COMPLETE_DELAYS.map((delay) => ({
            value: String(delay),
            label: t('settings.ai.complete.seconds', { value: delay / 1000 }),
          })),
        },
        {
          kind: 'toggle',
          id: 'ai.complete.atEnd',
          label: t('settings.ai.complete.atEndOnly'),
          value: complete.atEndOnly,
        }
      );
    }
    return {
      id: 'ai.complete',
      title: t('settings.ai.complete.title'),
      rows,
    };
  };

  // Network.
  const networkSection = (): FormSection => {
    const rows: FormRow[] = [
      {
        kind: 'choice',
        id: 'ai.proxy',
        label: t('settings.ai.proxy'),
        value: proxyMode,
        options: [
          { value: 'system', label: t('settings.ai.proxySystem') },
          { value: 'none', label: t('settings.ai.proxyNone') },
          { value: 'manual', label: t('settings.ai.proxyManual') },
        ],
      },
    ];
    if (proxyMode === 'manual') {
      rows.push({
        kind: 'text',
        id: 'ai.proxyUrl',
        label: t('settings.ai.proxyUrl'),
        value: proxyUrl,
        placeholder: 'http://127.0.0.1:7890',
        input: 'url',
      });
    }
    rows.push({
      kind: 'choice',
      id: 'ai.searchEngine',
      label: t('settings.ai.searchEngine'),
      value: engine,
      options: [
        { value: 'auto', label: t('settings.ai.searchAuto') },
        { value: 'bing', label: 'Bing' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
        { value: 'searxng', label: 'SearXNG' },
      ],
    });
    if (engine === 'searxng') {
      rows.push({
        kind: 'text',
        id: 'ai.searxngUrl',
        label: t('settings.ai.searxngUrl'),
        value: searxngUrl,
        placeholder: 'https://searx.example.org',
        input: 'url',
      });
    }
    rows.push(
      { kind: 'note', id: 'ai.searchNote', text: t('settings.ai.searchNote') },
      {
        kind: 'toggle',
        id: 'ai.nativeSearch',
        label: t('settings.ai.nativeSearch'),
        value: state.search.native,
      },
      {
        kind: 'note',
        id: 'ai.nativeSearchNote',
        text: t('settings.ai.nativeSearchNote'),
      }
    );
    return { id: 'ai.network', title: t('settings.ai.network'), rows };
  };

  // MCP servers.
  const bindKey = async (server: AiMcpServer, key: string | null) => {
    try {
      const status = await track(bindMcpKey(server, key));
      serverKeys.set(server.id, status);
      serverKeyNeeded.delete(server.id);
      if (key !== null) serverKeyChanged.add(server.id);
    } catch (error) {
      if (error instanceof SecretError && error.failure.kind === 'key-needed') {
        serverKeyNeeded.add(server.id);
      }
      throw error;
    } finally {
      form.refresh();
    }
  };

  const removeServer = (server: AiMcpServer) => {
    state.mcpServers = state.mcpServers.filter(
      (entry) => entry.id !== server.id
    );
    if (serverKeys.get(server.id)?.saved || serverKeyChanged.has(server.id)) {
      void track(deleteAiSecret(mcpKeyProfile(server.id))).catch(console.error);
    }
    serverKeys.delete(server.id);
    serverKeyChanged.delete(server.id);
    serverKeyNeeded.delete(server.id);
    emit();
  };

  const mcpSection = (): FormSection => {
    const rows: FormRow[] = state.mcpServers.map((server) => {
      const { text, tone } = mcpStatusLine(server, hub.status(server.id));
      return {
        kind: 'item',
        id: `${SERVER_ROW}${server.id}`,
        title: server.name,
        detail: mcpServerMeta(server),
        badge: text,
        tone: STATUS_TONES[tone],
        toggle: server.enabled,
        actions: [
          { id: 'remove', label: t('settings.ai.remove'), destructive: true },
        ],
      };
    });
    if (!rows.length) {
      rows.push({
        kind: 'note',
        id: 'ai.mcp.empty',
        text: t('settings.ai.mcp.empty'),
      });
    }
    rows.push(
      {
        kind: 'button',
        id: 'ai.mcp.addLocal',
        label: t('settings.ai.mcp.addLocal'),
      },
      {
        kind: 'button',
        id: 'ai.mcp.addRemote',
        label: t('settings.ai.mcp.addRemote'),
      }
    );
    return {
      id: 'ai.mcp',
      title: t('settings.ai.mcp.title'),
      footer: t('settings.ai.mcp.note'),
      rows,
    };
  };

  const serverRows = (server: AiMcpServer): FormRow[] => {
    const rows: FormRow[] = [
      {
        kind: 'text',
        id: 'ai.mcp.name',
        label: t('settings.ai.name'),
        value: server.name,
      },
      {
        kind: 'choice',
        id: 'ai.mcp.kind',
        label: t('settings.ai.mcp.kind'),
        value: server.transport,
        options: [
          { value: 'stdio', label: t('settings.ai.mcp.stdio') },
          { value: 'http', label: t('settings.ai.mcp.http') },
        ],
      },
    ];
    if (server.transport === 'stdio') {
      rows.push(
        {
          kind: 'text',
          id: 'ai.mcp.command',
          label: t('settings.ai.mcp.command'),
          value: server.command,
          placeholder: 'npx',
          input: 'code',
        },
        {
          kind: 'text',
          id: 'ai.mcp.args',
          label: t('settings.ai.mcp.args'),
          detail: t('settings.ai.mcp.argsNote'),
          value: server.args.join('\n'),
          placeholder: '-y\n@modelcontextprotocol/server-everything',
          multiline: true,
          input: 'code',
        },
        {
          kind: 'text',
          id: 'ai.mcp.env',
          label: t('settings.ai.mcp.env'),
          detail: t('settings.ai.mcp.envNote'),
          value: formatPairs(server.env, '='),
          placeholder: 'NAME=value',
          multiline: true,
          input: 'code',
        },
        {
          kind: 'text',
          id: 'ai.mcp.cwd',
          label: t('settings.ai.mcp.cwd'),
          value: server.cwd,
          placeholder: t('settings.ai.mcp.cwdPlaceholder'),
          input: 'code',
        }
      );
      return rows;
    }
    const badUrl =
      (server.url !== '' && !isWebUrl(server.url)) ||
      serverUrlRejected.has(server.id);
    rows.push(
      {
        kind: 'text',
        id: 'ai.mcp.url',
        label: t('settings.ai.mcp.url'),
        value: server.url,
        placeholder: 'https://example.com/mcp',
        input: 'url',
        error: badUrl ? t('settings.ai.badUrl') : undefined,
      },
      {
        kind: 'text',
        id: 'ai.mcp.headers',
        label: t('settings.ai.mcp.headers'),
        detail: t('settings.ai.mcp.headersNote'),
        value: formatPairs(server.headers, ':'),
        placeholder: 'Name: value',
        multiline: true,
        input: 'code',
      },
      {
        kind: 'toggle',
        id: 'ai.mcp.useKey',
        label: t('settings.ai.mcp.useKey'),
        value: server.useKey,
      }
    );
    if (server.useKey) {
      const saved = serverKeys.get(server.id);
      const needed = serverKeyNeeded.has(server.id);
      rows.push({
        kind: 'text',
        id: 'ai.mcp.key',
        label: t('settings.ai.key'),
        value: '',
        placeholder:
          saved?.hasKey && !needed
            ? t('settings.ai.keySaved', { hint: saved.hint ?? '' })
            : t('settings.ai.keyPlaceholder'),
        secure: true,
        input: 'code',
        error: serverKeyFailures.get(server.id),
      });
      if (needed) {
        rows.push({
          kind: 'note',
          id: 'ai.mcp.keyNeeded',
          text: t('settings.ai.keyNeeded'),
          tone: 'warning',
        });
      }
    }
    return rows;
  };

  const serverPage = (server: AiMcpServer): FormPage => {
    const status = hub.status(server.id);
    const failure = status?.state === 'failed' ? status.error : null;
    const live: FormRow[] = [];
    if (failure) {
      live.push({
        kind: 'note',
        id: 'ai.mcp.error',
        text: mcpErrorText(failure),
        tone: 'error',
      });
    }
    if (status?.stderr.length) {
      live.push({
        kind: 'text',
        id: 'ai.mcp.log',
        label: t('settings.ai.mcp.log'),
        value: status.stderr.join('\n'),
        multiline: true,
        input: 'code',
        disabled: true,
      });
    }
    if (status) {
      live.push({
        kind: 'button',
        id: 'ai.mcp.restart',
        label: t('settings.ai.mcp.restart'),
        busy: restarting.has(server.id),
      });
    }
    const sections: FormSection[] = [
      { id: 'ai.mcp.general', rows: serverRows(server) },
    ];
    if (live.length) sections.push({ id: 'ai.mcp.live', rows: live });
    const offered = offeredTools(server, status);
    if (offered.size) {
      sections.push({
        id: 'ai.mcp.tools',
        title: t('settings.ai.mcp.tools'),
        footer: t('settings.ai.mcp.toolsNote'),
        rows: [...offered].map(([name, about]) => ({
          kind: 'toggle',
          id: `${TOOL_ROW}${name}`,
          label: name,
          detail: about || undefined,
          value: server.allowed.includes(name),
        })),
      });
    }
    return {
      id: `${SERVER_PAGE}${server.id}`,
      title: server.name,
      sections,
    };
  };

  // Custom instructions.
  const instructionsSection = (): FormSection => ({
    id: 'ai.custom',
    title: t('settings.ai.instructions'),
    footer: t('settings.ai.instructionsNote'),
    rows: [
      {
        kind: 'text',
        id: 'ai.instructions',
        label: t('settings.ai.instructions'),
        value: state.instructions,
        multiline: true,
      },
    ],
  });

  // Conversations.
  const historySection = (): FormSection => {
    const rows: FormRow[] = [
      {
        kind: 'toggle',
        id: 'ai.keepHistory',
        label: t('settings.ai.history.keep'),
        value: state.keepHistory,
      },
      {
        kind: 'note',
        id: 'ai.historyNote',
        text: t('settings.ai.history.note'),
      },
      {
        kind: 'button',
        id: 'ai.clearHistory',
        label: t('settings.ai.history.clear'),
        role: 'destructive',
        busy: clearing,
      },
    ];
    if (historyStatus) {
      rows.push({
        kind: 'note',
        id: 'ai.historyStatus',
        text: historyStatus.text,
        tone: historyStatus.tone,
      });
    }
    return { id: 'ai.history', title: t('settings.ai.history.title'), rows };
  };

  const clearHistory = async () => {
    const answer = await form
      .alert({
        title: t('settings.ai.history.clearTitle'),
        message: t('settings.ai.history.clearConfirm'),
        actions: [
          { id: 'cancel', label: t('settings.cancel'), role: 'cancel' },
          {
            id: 'delete',
            label: t('settings.ai.history.clearOk'),
            role: 'destructive',
          },
        ],
      })
      .catch(() => null);
    if (answer !== 'delete') return;
    clearing = true;
    form.refresh();
    try {
      await deleteAllConversations();
      historyStatus = { text: t('settings.ai.history.cleared') };
    } catch (error) {
      console.error('Failed to delete the conversations:', error);
      historyStatus = {
        text: t('settings.ai.history.clearFailed'),
        tone: 'error',
      };
    } finally {
      clearing = false;
      form.refresh();
    }
  };

  // Events.
  const pickModel = (
    key: 'chatModel' | 'quickModel' | 'completeModel',
    value: string
  ) => {
    state[key] =
      modelEntries(state.providers).find((entry) => entry.value === value)
        ?.ref ?? null;
    emit();
  };

  const onRoot = (event: FormEvent): void | Promise<void> => {
    if (event.op === 'open') {
      if (event.id === ADD_PAGE) return options.push(ADD_PAGE);
      if (event.id.startsWith(SERVICE_PAGE)) {
        const provider = providerOf(event.id.slice(SERVICE_PAGE.length));
        if (provider) openService(provider);
      } else if (event.id.startsWith(QUICK_ROW)) {
        options.push(`${QUICK_PAGE}${event.id.slice(QUICK_ROW.length)}`);
      } else if (event.id.startsWith(SERVER_ROW)) {
        options.push(`${SERVER_PAGE}${event.id.slice(SERVER_ROW.length)}`);
      }
      return;
    }
    if (event.op === 'action') {
      if (event.id.startsWith(SERVICE_PAGE)) {
        const provider = providerOf(event.id.slice(SERVICE_PAGE.length));
        if (provider && event.action === 'remove') removeProvider(provider);
      } else if (event.id.startsWith(QUICK_ROW)) {
        const id = event.id.slice(QUICK_ROW.length);
        if (event.action === 'up') moveAction(id, -1);
        else if (event.action === 'down') moveAction(id, 1);
        else if (event.action === 'remove') {
          state.quickActions = state.quickActions.filter(
            (action) => action.id !== id
          );
          emit();
        }
      } else if (event.id.startsWith(SERVER_ROW)) {
        const server = serverOf(event.id.slice(SERVER_ROW.length));
        if (server && event.action === 'remove') removeServer(server);
      }
      return;
    }
    if (event.op === 'press') {
      switch (event.id) {
        case 'ai.quick.add': {
          if (state.quickActions.length >= MAX_QUICK_ACTIONS) return;
          const action = { id: newQuickActionId(), name: '', prompt: '' };
          state.quickActions.push(action);
          emit();
          return options.push(`${QUICK_PAGE}${action.id}`);
        }
        case 'ai.quick.reset':
          state.quickActions = defaultQuickActions();
          return emit();
        case 'ai.mcp.addLocal':
        case 'ai.mcp.addRemote': {
          const server = newMcpServer(
            event.id === 'ai.mcp.addLocal' ? 'stdio' : 'http'
          );
          state.mcpServers.push(server);
          emit();
          return options.push(`${SERVER_PAGE}${server.id}`);
        }
        case 'ai.clearHistory':
          return clearHistory();
      }
      return;
    }
    if (event.op !== 'change') return;
    const { id, value } = event;
    if (id.startsWith(SERVER_ROW)) {
      const server = serverOf(id.slice(SERVER_ROW.length));
      if (server) {
        server.enabled = Boolean(value);
        emit();
      }
      return;
    }
    switch (id) {
      case 'ai.chatModel':
        return pickModel('chatModel', String(value));
      case 'ai.quickModel':
        return pickModel('quickModel', String(value));
      case 'ai.completeModel':
        return pickModel('completeModel', String(value));
      case 'ai.editMode':
        state.editMode = value === 'auto' ? 'auto' : 'review';
        return emit();
      case 'ai.complete.enabled':
        state.complete = { ...state.complete, enabled: Boolean(value) };
        return emit();
      case 'ai.complete.delay':
        state.complete = { ...state.complete, delay: Number(value) };
        return emit();
      case 'ai.complete.atEnd':
        state.complete = { ...state.complete, atEndOnly: Boolean(value) };
        return emit();
      case 'ai.proxy':
        proxyMode = value === 'none' || value === 'manual' ? value : 'system';
        setProxy();
        return emit();
      case 'ai.proxyUrl':
        proxyUrl = String(value);
        setProxy();
        return emit();
      case 'ai.searchEngine':
        engine = AI_SEARCH_ENGINES.includes(value as AiSearchEngine)
          ? (value as AiSearchEngine)
          : 'auto';
        setSearch();
        return emit();
      case 'ai.searxngUrl':
        searxngUrl = String(value);
        setSearch();
        return emit();
      case 'ai.nativeSearch':
        state.search = { ...state.search, native: Boolean(value) };
        return emit();
      case 'ai.instructions':
        state.instructions = String(value).slice(0, MAX_INSTRUCTIONS);
        return emit();
      case 'ai.keepHistory':
        state.keepHistory = Boolean(value);
        return emit();
    }
  };

  const onAdd = (event: FormEvent) => {
    if (event.op !== 'open' || !event.id.startsWith('ai.add.')) return;
    const preset = presetById(event.id.slice('ai.add.'.length));
    if (!preset) return;
    const provider = addProvider(preset);
    options.pop(ADD_PAGE);
    openService(provider);
  };

  const onService = (provider: AiProvider, event: FormEvent) => {
    const preset = presetById(provider.preset);
    const actions = () =>
      chatGptActions({
        provider,
        activity: activityOf(provider),
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

    if (event.op === 'open') {
      if (event.id === 'ai.service.getKey' && preset?.keyPage) {
        void openExternalUrl(preset.keyPage).catch(console.error);
      } else if (event.id === 'ai.service.manage') {
        void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
      } else if (event.id.startsWith(MODEL_ROW)) {
        const id = event.id.slice(MODEL_ROW.length);
        if (provider.models.some((model) => model.id === id)) {
          options.push(`${MODEL_PAGE}${provider.id}.${id}`);
        }
      }
      return;
    }
    if (event.op === 'press') {
      switch (event.id) {
        case 'ai.service.signIn':
          return void actions().signIn(false);
        case 'ai.service.otherAccount':
          return void actions().signIn(true);
        case 'ai.service.signOut':
          return void actions().signOut();
        case 'ai.service.cancelSignIn':
          return void chatGptCancelSignIn().catch(console.error);
        case 'ai.service.reload':
          return void loadModels(provider);
        case 'ai.service.addModel': {
          const typed = (searches.get(provider.id) ?? '').trim();
          if (typed) addModelById(provider, typed);
          return;
        }
        case 'ai.service.remove':
          options.pop(`${SERVICE_PAGE}${provider.id}`);
          return removeProvider(provider);
      }
      return;
    }
    if (event.op !== 'change') return;
    const { id, value } = event;
    if (id.startsWith(MODEL_ROW)) {
      return setModel(provider, id.slice(MODEL_ROW.length), Boolean(value));
    }
    switch (id) {
      case 'ai.service.name':
        provider.name = String(value).trim() || provider.name;
        emit();
        return form.refresh();
      case 'ai.service.kind': {
        const kind = AI_PROVIDER_KINDS.find((entry) => entry === value);
        if (!kind) return;
        provider.kind = kind;
        if (kind !== 'openai' && provider.auth === 'chatgpt') {
          return setAuth(provider, 'key');
        }
        emit();
        forget(provider.id);
        if (isWebUrl(provider.baseUrl)) {
          void bind(provider, null).catch((error) =>
            keyFailures.set(provider.id, failureText(error))
          );
        }
        return refresh(provider.id);
      }
      case 'ai.service.auth':
        return setAuth(provider, value === 'chatgpt' ? 'chatgpt' : 'key');
      case 'ai.service.baseUrl': {
        const address = trimSlashes(String(value).trim());
        provider.baseUrl = address;
        urlFailures.delete(provider.id);
        emit();
        if (!isWebUrl(address)) return form.refresh();
        lookUp(provider);
        forget(provider.id);
        void bind(provider, null).catch((error) => {
          if (!keyNeeded.has(provider.id)) {
            urlFailures.set(provider.id, failureText(error));
          }
        });
        return refresh(provider.id);
      }
      case 'ai.service.key': {
        const key = String(value).trim();
        if (!key) return;
        if (!isWebUrl(provider.baseUrl)) {
          keyFailures.set(provider.id, t('settings.ai.badUrl'));
          return form.refresh();
        }
        keyFailures.delete(provider.id);
        forget(provider.id);
        void bind(provider, key).catch((error) => {
          keyFailures.set(provider.id, failureText(error));
        });
        return form.refresh();
      }
      case 'ai.service.search':
        searches.set(provider.id, String(value));
        return form.refresh();
    }
  };

  const onModel = (provider: AiProvider, modelId: string, event: FormEvent) => {
    const model = provider.models.find((entry) => entry.id === modelId);
    if (!model || event.op !== 'change') return;
    const flag = CAPABILITIES.find((entry) => `ai.model.${entry}` === event.id);
    if (flag) {
      model[flag] = Boolean(event.value);
      return emit();
    }
    if (event.id === 'ai.model.context') {
      const tokens = parseTokens(String(event.value));
      if (tokens === null) return;
      model.contextWindow = tokens;
      emit();
    }
  };

  const onQuick = (action: AiQuickAction, event: FormEvent) => {
    if (event.op !== 'change') return;
    const text = String(event.value);
    if (event.id === 'ai.quick.name') {
      action.name = text.slice(0, MAX_NAME).trim();
      emit();
    } else if (event.id === 'ai.quick.prompt') {
      action.prompt = text.slice(0, MAX_PROMPT).trim();
      emit();
    }
  };

  const onServer = (server: AiMcpServer, event: FormEvent) => {
    if (event.op === 'press' && event.id === 'ai.mcp.restart') {
      restarting.add(server.id);
      form.refresh();
      return void hub
        .restart(server.id)
        .catch(console.error)
        .finally(() => {
          restarting.delete(server.id);
          form.refresh();
        });
    }
    if (event.op !== 'change') return;
    const { id, value } = event;
    if (id.startsWith(TOOL_ROW)) {
      const name = id.slice(TOOL_ROW.length);
      server.allowed = value
        ? [...new Set([...server.allowed, name])]
        : server.allowed.filter((entry) => entry !== name);
      return emit();
    }
    const text = String(value);
    switch (id) {
      case 'ai.mcp.name':
        server.name = text.trim() || server.name;
        break;
      case 'ai.mcp.kind':
        server.transport = value === 'http' ? 'http' : 'stdio';
        break;
      case 'ai.mcp.command':
        server.command = text.trim();
        break;
      case 'ai.mcp.args':
        server.args = parseLines(text);
        break;
      case 'ai.mcp.env':
        server.env = parsePairs(text, '=');
        break;
      case 'ai.mcp.cwd':
        server.cwd = text.trim();
        break;
      case 'ai.mcp.url':
        server.url = text.trim();
        serverUrlRejected.delete(server.id);
        if (
          isWebUrl(server.url) &&
          server.useKey &&
          serverKeys.get(server.id)?.saved
        ) {
          void bindKey(server, null).catch(console.error);
        }
        break;
      case 'ai.mcp.headers':
        server.headers = parsePairs(text, ':');
        break;
      case 'ai.mcp.useKey':
        server.useKey = Boolean(value);
        break;
      case 'ai.mcp.key': {
        const key = text.trim();
        if (!key) return;
        if (!isWebUrl(server.url)) {
          serverUrlRejected.add(server.id);
          return form.refresh();
        }
        serverKeyFailures.delete(server.id);
        void bindKey(server, key).catch((error) => {
          serverKeyFailures.set(server.id, failureText(error));
        });
        return form.refresh();
      }
      default:
        return;
    }
    emit();
  };

  const leave = (page: string) => {
    if (!page.startsWith(SERVICE_PAGE)) return;
    const id = page.slice(SERVICE_PAGE.length);
    if (editing === id) editing = null;
    searches.delete(id);
    keyFailures.delete(id);
    urlFailures.delete(id);
  };

  const handle = (event: FormEvent): void | Promise<void> => {
    if (event.op === 'tab' || event.op === 'dismiss') return;
    if (event.op === 'back') return leave(event.page);
    const { page } = event;
    if (page === ADD_PAGE) return onAdd(event);
    if (page.startsWith(SERVICE_PAGE)) {
      const provider = providerOf(page.slice(SERVICE_PAGE.length));
      return provider ? onService(provider, event) : undefined;
    }
    if (page.startsWith(MODEL_PAGE)) {
      const [providerId, ...rest] = page.slice(MODEL_PAGE.length).split('.');
      const provider = providerOf(providerId);
      return provider ? onModel(provider, rest.join('.'), event) : undefined;
    }
    if (page.startsWith(QUICK_PAGE)) {
      const action = actionOf(page.slice(QUICK_PAGE.length));
      return action ? onQuick(action, event) : undefined;
    }
    if (page.startsWith(SERVER_PAGE)) {
      const server = serverOf(page.slice(SERVER_PAGE.length));
      return server ? onServer(server, event) : undefined;
    }
    return onRoot(event);
  };

  const page = (id: string): FormPage | null => {
    if (id === ADD_PAGE) return addPage();
    if (id.startsWith(SERVICE_PAGE)) {
      const provider = providerOf(id.slice(SERVICE_PAGE.length));
      return provider ? servicePage(provider) : null;
    }
    if (id.startsWith(MODEL_PAGE)) {
      const [providerId, ...rest] = id.slice(MODEL_PAGE.length).split('.');
      const provider = providerOf(providerId);
      return provider ? modelPage(provider, rest.join('.')) : null;
    }
    if (id.startsWith(QUICK_PAGE)) {
      const action = actionOf(id.slice(QUICK_PAGE.length));
      return action ? quickPage(action) : null;
    }
    if (id.startsWith(SERVER_PAGE)) {
      const server = serverOf(id.slice(SERVER_PAGE.length));
      return server ? serverPage(server) : null;
    }
    return null;
  };

  // What is saved for each service and server, staged changes included.
  for (const provider of state.providers) {
    if (provider.auth === 'chatgpt') loadAccount(provider);
    void getAiSecretStatus(provider.id)
      .then((status) => {
        statuses.set(provider.id, status);
        if (status.storage === 'file') fileStorage = true;
        refresh(provider.id);
      })
      .catch(console.error);
  }
  for (const server of state.mcpServers) {
    if (server.transport !== 'http') continue;
    void getAiSecretStatus(mcpKeyProfile(server.id))
      .then((status) => {
        serverKeys.set(server.id, status);
        form.refresh();
      })
      .catch(console.error);
  }
  const unsubscribe = hub.subscribe(() => form.refresh());
  void hub.refresh().catch(console.error);

  return {
    sections: () => [
      servicesSection(),
      defaultsSection(),
      quickSection(),
      completeSection(),
      networkSection(),
      mcpSection(),
      instructionsSection(),
      historySection(),
    ],
    page,
    handle,
    settled: async () => {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    committed: () => {
      for (const id of serverKeyChanged) {
        void hub.restart(id).catch(() => undefined);
      }
      serverKeyChanged.clear();
    },
    destroy: () => {
      // A sign-in still waiting on the browser has nothing left to land in.
      if ([...activities.values()].some((entry) => entry.busy === 'sign-in')) {
        void chatGptCancelSignIn().catch(console.error);
      }
      for (const load of loads.values()) load.abort();
      unsubscribe();
    },
    addService,
  };
}
