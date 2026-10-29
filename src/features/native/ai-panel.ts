/** The page's side of the native assistant, loaded the first time its sheet opens. */

import {
  type ApprovalAnswer,
  type ApprovalRequest,
  Approvals,
} from '../../ai/agent/approvals';
import {
  type AssistantEntry,
  type ChatEntry,
  ChatSession,
  type SessionChange,
  type ToolPart,
  type UserEntry,
  replyText,
} from '../../ai/agent/session';
import { EditController } from '../../ai/edit/controller';
import { ConversationKeeper } from '../../ai/history/keeper';
import { conversationTitle } from '../../ai/history/saved';
import { type ChatImage, MAX_IMAGES, fitWithin } from '../../ai/images/image';
import { prepareImage } from '../../ai/images/prepare';
import { mcpHub } from '../../ai/mcp/hub';
import { CHATGPT_USAGE_URL } from '../../ai/providers/chatgpt';
import { AI_PRESETS } from '../../ai/providers/presets';
import type { QuickMode } from '../../ai/quick/core';
import { isOpenableLink } from '../../ai/render/markdown';
import {
  effortChoiceLabel,
  effortLabel,
  effortState,
} from '../../ai/ui/effort-menu';
import {
  SETTINGS_FIXES,
  USAGE_FIXES,
  failureReading,
} from '../../ai/ui/failure';
import { historyTitle, keptWhen } from '../../ai/ui/history-menu';
import {
  type TrayNote,
  trayFailed,
  trayFull,
  trayNotice,
} from '../../ai/ui/image-tray';
import {
  ENDING_TEXT,
  footMeta,
  outcomeText,
  sourceHost,
  stepSummary,
  toolImages,
} from '../../ai/ui/messages';
import { MODES, MODE_ORDER } from '../../ai/ui/mode-menu';
import { modelChoices } from '../../ai/ui/model-picker';
import {
  type AiPanelHost,
  SUGGESTIONS,
  chatModel,
  chooseEffort,
  editTag,
  fileName,
  hasModels,
  prepareTurn,
  reviewSummary,
  usesChatgptPlan,
} from '../../ai/ui/panel-core';
import {
  proposedEdit,
  searchSources,
  toolLabel,
} from '../../ai/ui/tool-labels';
import {
  openExternalUrl,
  resolveDocumentAssetPath,
  toAssetUrl,
} from '../../bridge/ipc/attachments';
import { i18next } from '../../i18n';
import type { AiSettings } from '../../state/ai-settings';
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from '../../state/settings';
import { isNetworkPath } from '../attachment-paths';
import { type MdBlock, markdownBlocks } from './markdown-blocks';
import { type PanelMessage, postPanel } from './panels';
import type { NativeQuickMenu } from './quick';

/** The longest side of a thumbnail sent to the sheet, in pixels. */
const THUMBNAIL_SIDE = 256;
const THUMBNAIL_QUALITY = 0.8;

/** A button in a card, by what it answers with. */
export type ActionData = { id: string; label: string; primary?: boolean };

export type DiffRowData = {
  kind: 'same' | 'removed' | 'added' | 'gap';
  mark: string;
  text: string;
};

/** One piece of a reply, as the sheet draws it. */
export type PartData =
  | { kind: 'text'; blocks: MdBlock[] }
  | {
      kind: 'group';
      id: string;
      label: string;
      state: ReturnType<typeof stepSummary>['state'];
      /** The fold holds one step, whose line is the fold's own. */
      single: boolean;
      /** One step with nothing under it: nothing to unfold. */
      flat: boolean;
      parts: PartData[];
      /** The questions and edits the steps raised, under the fold. */
      cards: PartData[];
    }
  | { kind: 'reasoning'; label: string; text: string }
  | { kind: 'tool'; id: string; label: string; state: ToolPart['state'] }
  | { kind: 'sources'; label: string; items: SourceData[] }
  | { kind: 'image'; thumbnail: string; caption: string }
  | {
      kind: 'approval';
      id: string;
      title: string;
      note: string | null;
      /** A written note: its path and the lines put in and taken out. */
      meta: { path: string; added: number; removed: number } | null;
      /** What a page or a tool would be given, to show as it is. */
      text: string | null;
      rows: DiffRowData[];
      answers: Array<{
        id: ApprovalAnswer;
        label: string;
        role: 'primary' | 'plain';
      }>;
    }
  | {
      kind: 'edit';
      edit: string;
      title: string;
      meta: string;
      pending: boolean;
      reveal: string;
      accept: string;
      reject: string;
    };

export type SourceData = { title: string; host: string; href: string };

export type UserEntryData = {
  id: number;
  role: 'user';
  text: string;
  images: Array<{ thumbnail: string }>;
};

export type AssistantEntryData = {
  id: number;
  role: 'assistant';
  parts: PartData[];
  /** Waiting for the first word, or for what the model makes of a tool's result. */
  waiting: boolean;
  status: { text: string } | null;
  foot: { text: string; actions: Array<{ id: string; label: string }> } | null;
  error: { text: string; detail: string | null; actions: ActionData[] } | null;
};

export type EntryData = UserEntryData | AssistantEntryData;

/** What drawing an entry reads of the panel around it. */
export type EntryContext = {
  outcome: (edit: string) => ReturnType<EditController['outcome']>;
  request: (id: string) => ApprovalRequest | null;
  documentName: () => string | null;
  /** The base64 of a small picture of `image`; empty while it is being made. */
  thumbnail: (image: ChatImage) => string;
  blocks: (key: string, text: string) => MdBlock[];
};

function approvalCard(id: string, request: ApprovalRequest): PartData {
  const answer = (
    key: ApprovalAnswer,
    label: string
  ): { id: ApprovalAnswer; label: string; role: 'primary' | 'plain' } => ({
    id: key,
    label: i18next.t(label),
    role: key === 'allow' ? 'primary' : 'plain',
  });
  const card = {
    kind: 'approval' as const,
    id,
    title: '',
    note: null as string | null,
    meta: null as { path: string; added: number; removed: number } | null,
    text: null as string | null,
    rows: [] as DiffRowData[],
    answers: [] as Array<{
      id: ApprovalAnswer;
      label: string;
      role: 'primary' | 'plain';
    }>,
  };
  switch (request.kind) {
    case 'folder':
      card.title = i18next.t('ai.approval.folder');
      card.note = request.reason;
      card.answers = [
        answer('deny', 'ai.approval.notNow'),
        answer('allow', 'ai.approval.chooseFolder'),
      ];
      break;
    case 'page':
      card.title = i18next.t('ai.approval.page');
      card.note = i18next.t('ai.approval.pageNote', { host: request.host });
      card.text = request.url;
      card.answers = [
        answer('deny', 'ai.approval.deny'),
        answer('allow', 'ai.approval.open'),
      ];
      break;
    case 'tool':
      card.title = i18next.t('ai.approval.tool', {
        tool: request.tool,
        server: request.serverName,
      });
      card.note = i18next.t('ai.approval.toolNote');
      card.text = request.input;
      card.answers = [
        answer('deny', 'ai.approval.deny'),
        answer('always', 'ai.approval.alwaysTool'),
        answer('allow', 'ai.approval.allow'),
      ];
      break;
    default: {
      const { diff } = request;
      card.title = i18next.t(
        request.created ? 'ai.approval.create' : 'ai.approval.change',
        { file: fileName(request.path) }
      );
      card.meta = {
        path: request.path,
        added: diff.added,
        removed: diff.removed,
      };
      card.rows = diff.rows.map((row) =>
        row.kind === 'gap'
          ? {
              kind: 'gap',
              mark: '',
              text: i18next.t('ai.approval.gap', { count: Number(row.text) }),
            }
          : {
              kind: row.kind,
              mark: { same: ' ', removed: '-', added: '+' }[row.kind],
              text: row.text,
            }
      );
      if (diff.truncated) {
        card.rows.push({
          kind: 'gap',
          mark: '',
          text: i18next.t('ai.approval.more'),
        });
      }
      card.answers = [
        answer('deny', 'ai.approval.deny'),
        answer('always', 'ai.approval.always'),
        answer('allow', 'ai.approval.allow'),
      ];
    }
  }
  return card;
}

/** The steps of one tool call, and the cards it raised. */
function toolParts(part: ToolPart, context: EntryContext) {
  const steps: PartData[] = [
    {
      kind: 'tool',
      id: part.id,
      label: toolLabel(part),
      state: part.state,
    },
  ];
  const sources = part.state === 'done' ? searchSources(part) : [];
  if (sources.length > 0) {
    steps.push({
      kind: 'sources',
      label: i18next.t('ai.tool.sources', { count: sources.length }),
      items: sources.map((source) => {
        const host = sourceHost(source.url);
        return { title: source.title || host, host, href: source.url };
      }),
    });
  }
  const images = toolImages(part);
  for (const image of images) {
    steps.push({
      kind: 'image',
      thumbnail: context.thumbnail(image),
      caption: `${image.name} · ${image.width}×${image.height}`,
    });
  }

  const cards: PartData[] = [];
  const request = context.request(part.id);
  if (request) cards.push(approvalCard(part.id, request));
  const edit = proposedEdit(part);
  const outcome = edit ? context.outcome(edit) : null;
  if (edit && outcome) {
    const pending = outcome.pending > 0;
    cards.push({
      kind: 'edit',
      edit,
      title: context.documentName() ?? i18next.t('ai.edit.thisDocument'),
      meta: pending
        ? i18next.t('ai.edit.pending', { count: outcome.pending })
        : outcomeText(outcome),
      pending,
      reveal: i18next.t('ai.edit.show'),
      accept: i18next.t('ai.edit.accept'),
      reject: i18next.t('ai.edit.reject'),
    });
  }
  return { steps, cards, plain: sources.length === 0 && images.length === 0 };
}

/**
 * The reply as the sheet draws it: text, and between the texts the
 * reasoning and tool calls folded into one line, as `MessageList` does.
 */
function replyParts(entry: AssistantEntry, context: EntryContext): PartData[] {
  const streaming = entry.status === 'streaming';
  const parts: PartData[] = [];
  let run: {
    indexes: number[];
    steps: PartData[];
    cards: PartData[];
    plain: boolean;
  } | null = null;
  const fold = () => {
    if (!run) return;
    const { indexes, steps, cards, plain } = run;
    const summary = stepSummary(entry, indexes);
    parts.push({
      kind: 'group',
      id: `${entry.id}:${indexes[0]}`,
      label: summary.label,
      state: summary.state,
      single: summary.single,
      flat: summary.single && summary.tools.length === 1 && plain,
      parts: steps,
      cards,
    });
    run = null;
  };
  for (const [index, part] of entry.parts.entries()) {
    if (part.type === 'text') {
      fold();
      parts.push({
        kind: 'text',
        blocks: context.blocks(`${entry.id}:${index}`, part.text),
      });
      continue;
    }
    run ??= { indexes: [], steps: [], cards: [], plain: true };
    run.indexes.push(index);
    if (part.type === 'reasoning') {
      const thinking = streaming && index === entry.parts.length - 1;
      run.steps.push({
        kind: 'reasoning',
        label: i18next.t(thinking ? 'ai.thinkingNow' : 'ai.thinking'),
        text: part.text,
      });
      continue;
    }
    const tool = toolParts(part, context);
    run.steps.push(...tool.steps);
    run.cards.push(...tool.cards);
    run.plain = run.plain && tool.plain;
  }
  fold();
  return parts;
}

function userEntryData(entry: UserEntry, context: EntryContext): UserEntryData {
  return {
    id: entry.id,
    role: 'user',
    text: entry.text,
    images: entry.images.map((image) => ({
      thumbnail: context.thumbnail(image),
    })),
  };
}

function assistantEntryData(
  entry: AssistantEntry,
  context: EntryContext
): AssistantEntryData {
  const streaming = entry.status === 'streaming';
  const last = entry.parts[entry.parts.length - 1];
  const waiting =
    streaming && (!last || (last.type === 'tool' && last.state !== 'running'));

  let status: AssistantEntryData['status'] = null;
  if (entry.status === 'stopped') status = { text: i18next.t('ai.stopped') };
  else if (entry.status === 'done' && entry.ending) {
    status = { text: i18next.t(ENDING_TEXT[entry.ending]) };
  }

  let error: AssistantEntryData['error'] = null;
  if (entry.status === 'error' && entry.error) {
    const { code } = entry.error;
    const reading = failureReading(entry.error);
    const actions: ActionData[] = [];
    if (SETTINGS_FIXES.has(code)) {
      actions.push({
        id: 'settings',
        label: i18next.t('ai.openSettings'),
        primary: true,
      });
    }
    if (USAGE_FIXES.has(code)) {
      actions.push({
        id: 'plan',
        label: i18next.t('ai.plan.manage'),
        primary: true,
      });
    }
    actions.push({ id: 'retry', label: i18next.t('ai.retry') });
    error = { text: reading.text, detail: reading.detail, actions };
  }

  let foot: AssistantEntryData['foot'] = null;
  if (!streaming) {
    const actions: Array<{ id: string; label: string }> = [];
    if (replyText(entry))
      actions.push({ id: 'copy', label: i18next.t('ai.copy') });
    if (entry.status === 'stopped') {
      actions.push({ id: 'retry', label: i18next.t('ai.retry') });
    }
    foot = { text: footMeta(entry), actions };
  }

  return {
    id: entry.id,
    role: 'assistant',
    parts: replyParts(entry, context),
    waiting,
    status,
    foot,
    error,
  };
}

/** A message of the conversation as the sheet draws it. */
export function entryData(entry: ChatEntry, context: EntryContext): EntryData {
  return entry.role === 'user'
    ? userEntryData(entry, context)
    : assistantEntryData(entry, context);
}

export type TrayItem = { id: number; image: ChatImage };

/** What the sheet shows around the conversation. */
export type StateData = ReturnType<typeof stateData>;

export type StateInput = {
  ai: AiSettings;
  /** The conversation's entries, for its title. */
  entries: readonly ChatEntry[];
  busy: boolean;
  /** How many of the assistant's changes wait, and which one is marked. */
  pending: number;
  position: number;
  tray: readonly TrayItem[];
  note: TrayNote | null;
  thumbnail: (image: ChatImage) => string;
};

/** The modes the menu offers, the one in force marked. */
function modeData(ai: AiSettings) {
  const current = MODES[ai.editMode];
  return {
    value: ai.editMode,
    label: i18next.t(current.label),
    note: i18next.t(current.note),
    options: MODE_ORDER.map((value) => ({
      value,
      label: i18next.t(MODES[value].label),
      note: i18next.t(MODES[value].note),
      checked: value === ai.editMode,
    })),
  };
}

export const modelValue = (provider: string, model: string) =>
  JSON.stringify([provider, model]);

export function stateData(input: StateInput) {
  const { ai, entries, busy, pending, position, tray, note } = input;
  const ready = hasModels(ai);
  const empty = entries.length === 0;
  const choices = modelChoices(ai);
  const effort = effortState(ai);
  const chosen = chatModel(ai);
  const blind = chosen && !chosen.vision ? chosen.label : null;

  return {
    title: conversationTitle(entries) || i18next.t('ai.title'),
    ready,
    empty,
    busy,
    labels: {
      newChat: i18next.t('ai.newChat'),
      close: i18next.t('ai.close'),
      jump: i18next.t('ai.jump'),
      waiting: i18next.t('ai.waiting'),
      hideKeyboard: i18next.t('mobile.hideKeyboard'),
    },
    history: {
      visible: ai.keepHistory,
      label: i18next.t('ai.history.open'),
      loading: i18next.t('ai.history.loading'),
      empty: i18next.t('ai.history.empty'),
      listFailed: i18next.t('ai.history.listFailed'),
      delete: i18next.t('ai.history.delete'),
    },
    setup:
      !ready && empty
        ? {
            title: i18next.t('ai.setup.title'),
            body: i18next.t('ai.setup.body'),
            services: AI_PRESETS.filter((preset) => preset.id !== 'custom').map(
              (preset) => ({ id: preset.id, name: preset.name })
            ),
            action: i18next.t('ai.setup.action'),
            note: i18next.t('ai.setup.more'),
          }
        : null,
    intro:
      ready && empty
        ? {
            title: i18next.t('ai.empty.title'),
            body: i18next.t('ai.empty.body'),
            suggestions: SUGGESTIONS.map((suggestion) => ({
              icon: suggestion.name,
              label: i18next.t(suggestion.key),
            })),
          }
        : null,
    model: {
      label: choices.label,
      title: choices.title,
      groups: choices.groups.map((group) => ({
        name: group.name,
        options: group.models.map((model) => ({
          value: modelValue(model.ref.provider, model.ref.model),
          label: model.label,
          checked: model.checked,
        })),
      })),
      manage: i18next.t('ai.manageServices'),
    },
    effort:
      effort.levels.length === 0
        ? null
        : {
            label: effortLabel(effort),
            title: i18next.t('ai.effort.current', {
              level: effortLabel(effort),
            }),
            heading: i18next.t('ai.effort.title', { model: effort.model }),
            options: [null, ...effort.levels].map((level) => ({
              value: level ?? '',
              label: effortChoiceLabel(effort, level),
              checked: level === effort.chosen,
            })),
          },
    mode: modeData(ai),
    review:
      pending > 0
        ? {
            text: reviewSummary(pending, position),
            prev: i18next.t('ai.edit.prev'),
            next: i18next.t('ai.edit.next'),
            rejectAll: i18next.t('ai.edit.rejectAll'),
            acceptAll: i18next.t('ai.edit.acceptAll'),
          }
        : null,
    plan: usesChatgptPlan(ai)
      ? {
          text: i18next.t('ai.plan.using'),
          manage: i18next.t('ai.plan.manage'),
        }
      : null,
    composer:
      !ready && empty
        ? null
        : {
            placeholder: i18next.t('ai.placeholder'),
            send: i18next.t('ai.send'),
            stop: i18next.t('ai.stop'),
            attach: i18next.t('ai.image.attach'),
            room: MAX_IMAGES - tray.length,
            images: tray.map((item) => ({
              id: item.id,
              name: item.image.name,
              thumbnail: input.thumbnail(item.image),
              remove: i18next.t('ai.image.remove', { name: item.image.name }),
            })),
            notice: trayNotice(note, blind, tray.length) || null,
          },
  };
}

/** What the panel drives: the conversation, its edits, its questions and its kept copies. */
export type AiCore = {
  session: Pick<
    ChatSession,
    'entries' | 'busy' | 'send' | 'stop' | 'retry' | 'subscribe'
  > &
    Partial<Pick<ChatSession, 'clear'>>;
  edits: Pick<
    EditController,
    | 'subscribe'
    | 'pending'
    | 'position'
    | 'outcome'
    | 'placement'
    | 'forget'
    | 'placeReply'
    | 'acceptEdit'
    | 'rejectEdit'
    | 'revealEdit'
    | 'step'
    | 'accept'
    | 'reject'
  > &
    Partial<Pick<EditController, 'destroy'>>;
  keeper: Pick<
    ConversationKeeper,
    'current' | 'list' | 'open' | 'remove' | 'startNew' | 'flush'
  > &
    Partial<Pick<ConversationKeeper, 'destroy' | 'openLatest'>>;
  approvals: Pick<Approvals, 'request' | 'answer' | 'subscribe'> &
    Partial<Pick<Approvals, 'reset'>>;
};

/** The conversation of the open document, with the edits it makes. */
export function createAiCore(host: AiPanelHost): AiCore {
  const approvals = new Approvals();
  const edits = new EditController({
    editor: host.editor,
    sourceSelection: host.sourceSelection,
    flushSource: host.flushSource,
    followSource: host.followSource,
    editMode: () => getSettings().ai.editMode,
    localImage: async (src) => {
      const path = await resolveDocumentAssetPath(host.documentPath(), src);
      return path && !isNetworkPath(path) ? toAssetUrl(path) : null;
    },
    editTag: editTag(),
  });
  const session: ChatSession = new ChatSession(() =>
    prepareTurn({
      editor: host.editor,
      documentPath: host.documentPath,
      edits,
      approvals,
      showModel: (caption, images) => session.showModel(caption, images),
    })
  );
  const keeper = new ConversationKeeper({
    session,
    edits,
    documentPath: host.documentPath,
    enabled: () => getSettings().ai.keepHistory,
    switched: () => approvals.reset(),
  });
  return { session, edits, keeper, approvals };
}

/** A small picture of `image`, as the base64 of a JPEG. */
async function makeThumbnail(image: ChatImage): Promise<string> {
  const url = URL.createObjectURL(
    new Blob([image.data], { type: image.mediaType })
  );
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const { width, height } = fitWithin(
      picture.naturalWidth,
      picture.naturalHeight,
      THUMBNAIL_SIDE
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas to draw on');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(picture, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
    return data.slice(data.indexOf(',') + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export type NativeAiOptions = {
  /** Makes the base64 of a small picture of an image. */
  thumbnail?: (image: ChatImage) => Promise<string>;
};

/** The assistant on the phone: the dock's panel without its DOM, sending the sheet what to draw. */
export class NativeAiPanel {
  private readonly core: AiCore;
  private readonly draw: NonNullable<NativeAiOptions['thumbnail']>;
  private ai: AiSettings = getSettings().ai;
  private visible = false;
  private destroyed = false;
  private readonly cleanups: Array<() => void> = [];
  /** Entries and state as last sent, to send only what changed. */
  private readonly sent = new Map<number, string>();
  private sentState = '';
  private readonly dirty = new Set<number>();
  private frame: number | null = null;
  private tray: TrayItem[] = [];
  private nextTrayId = 1;
  private note: TrayNote | null = null;
  private readonly pictures = new WeakMap<Uint8Array, string>();
  private readonly drawing = new WeakSet<Uint8Array>();
  private picturesFrame: number | null = null;
  private readonly blockMemo = new Map<
    string,
    { text: string; blocks: MdBlock[] }
  >();
  /** Runs once the sheet has gone, as opening the settings does. */
  private afterClose: (() => void) | null = null;
  private quick: Promise<NativeQuickMenu> | null = null;
  /** Text the AI menu hands the conversation, written in once the sheet is up. */
  private pendingWrite: string | null = null;

  constructor(
    private readonly host: AiPanelHost,
    core?: AiCore,
    options: NativeAiOptions = {}
  ) {
    this.core = core ?? createAiCore(host);
    this.draw = options.thumbnail ?? makeThumbnail;
    const { session, edits, approvals } = this.core;
    this.cleanups.push(
      session.subscribe((change) => this.sessionChanged(change)),
      subscribeSettings((settings) => this.settingsChanged(settings.ai)),
      edits.subscribe(() => this.cardsChanged()),
      approvals.subscribe(() => this.cardsChanged())
    );
    const onLanguage = () => this.redraw();
    i18next.on('languageChanged', onLanguage);
    this.cleanups.push(() => i18next.off('languageChanged', onLanguage));
    // The servers the user added start with the assistant.
    mcpHub();
    void this.core.keeper.openLatest?.();
  }

  private get context(): EntryContext {
    return {
      outcome: (edit) => this.core.edits.outcome(edit),
      request: (id) => this.core.approvals.request(id),
      documentName: () => {
        const path = this.host.documentPath();
        return path ? fileName(path) : null;
      },
      thumbnail: this.thumbnail,
      blocks: this.blocks,
    };
  }

  /** The sheet opened: it is sent the whole conversation. */
  show() {
    this.visible = true;
    this.sentState = '';
    this.sendState();
    this.sendEntries();
    this.writePending();
  }

  /** The sheet went away. */
  hide() {
    this.visible = false;
    this.dirty.clear();
    this.core.keeper.flush();
    const after = this.afterClose;
    this.afterClose = null;
    after?.();
  }

  destroy() {
    this.destroyed = true;
    this.core.keeper.destroy?.();
    this.core.approvals.reset?.();
    this.core.session.clear?.();
    for (const cleanup of this.cleanups) cleanup();
    this.core.edits.destroy?.();
    void this.quick?.then((menu) => menu.destroy());
    if (this.frame != null) cancelAnimationFrame(this.frame);
    if (this.picturesFrame != null) cancelAnimationFrame(this.picturesFrame);
  }

  /**
   * Opens the AI menu at the selection or the caret, or runs one of its
   * slash commands there. Its edits are this panel's, to review alike.
   */
  async ask(mode: QuickMode) {
    this.quick ??= import('./quick').then(
      ({ NativeQuickMenu }) =>
        new NativeQuickMenu({
          editor: this.host.editor,
          edits: this.core.edits,
          documentPath: this.host.documentPath,
          openSettings: () => this.openSettings(),
          toChat: (text) => this.toChat(text),
        })
    );
    await (await this.quick).open(mode);
  }

  /** Opens the conversation with `text` written, for the user to send. */
  private toChat(text: string) {
    if (hasModels(this.ai) && text) this.pendingWrite = text;
    if (this.visible) this.writePending();
    else postPanel('ai', 'present');
  }

  private writePending() {
    if (this.pendingWrite == null) return;
    postPanel('ai', 'write', { text: this.pendingWrite });
    this.pendingWrite = null;
  }

  /** What the user did on the sheet. */
  handle(message: PanelMessage) {
    const { session, edits, keeper, approvals } = this.core;
    switch (message.op) {
      case 'open':
        this.show();
        return;
      case 'close':
        this.hide();
        return;
      case 'send':
        this.send(String(message.text ?? ''));
        return;
      case 'stop':
        session.stop();
        return;
      case 'retry':
        void session.retry();
        return;
      case 'newChat':
        keeper.startNew();
        return;
      case 'suggestion': {
        const suggestion = SUGGESTIONS[Number(message.index)];
        if (!suggestion || session.busy) return;
        void session.send(i18next.t(suggestion.key), []);
        return;
      }
      case 'service':
        this.openSettings(String(message.id));
        return;
      case 'settings':
        this.openSettings();
        return;
      case 'model':
        this.chooseModel(String(message.value));
        return;
      case 'effort': {
        const level = effortState(this.ai).levels.find(
          (candidate) => candidate === message.value
        );
        chooseEffort(level ?? null);
        return;
      }
      case 'mode': {
        const mode = MODE_ORDER.find(
          (candidate) => candidate === message.value
        );
        if (mode) {
          void updateSettings({ ai: { editMode: mode } }).catch(console.error);
        }
        return;
      }
      case 'history':
        void this.sendHistory();
        return;
      case 'conversation':
        void this.conversation(String(message.action), String(message.id));
        return;
      case 'attach':
        void this.attach(
          (message.images as Array<{
            name: string;
            type: string;
            data: string;
          }>) ?? []
        );
        return;
      case 'unattach':
        this.tray = this.tray.filter((item) => item.id !== Number(message.id));
        this.note = null;
        this.sendState();
        return;
      case 'edit': {
        const edit = String(message.edit);
        if (message.action === 'accept') edits.acceptEdit(edit);
        else if (message.action === 'reject') edits.rejectEdit(edit);
        else edits.revealEdit(edit);
        return;
      }
      case 'review':
        if (message.action === 'prev') edits.step(-1);
        else if (message.action === 'next') edits.step(1);
        else if (message.action === 'acceptAll') edits.accept();
        else if (message.action === 'rejectAll') edits.reject();
        return;
      case 'approval':
        approvals.answer(String(message.id), message.answer as ApprovalAnswer);
        return;
      case 'copy': {
        const entry = session.entries.find(
          (candidate) => candidate.id === Number(message.entry)
        );
        if (entry?.role === 'assistant') {
          postPanel('ai', 'copy', { text: replyText(entry) });
        }
        return;
      }
      case 'link': {
        const href = String(message.href);
        if (isOpenableLink(href)) {
          void openExternalUrl(href).catch(console.error);
        }
        return;
      }
      case 'plan':
        void openExternalUrl(CHATGPT_USAGE_URL).catch(console.error);
        return;
    }
  }

  private send(text: string) {
    const { session } = this.core;
    const images = this.tray.map((item) => item.image);
    if (session.busy || (!text.trim() && images.length === 0)) return;
    this.tray = [];
    this.note = null;
    void session.send(text, images);
    this.sendState();
  }

  private chooseModel(value: string) {
    for (const group of modelChoices(this.ai).groups) {
      const model = group.models.find(
        (candidate) =>
          modelValue(candidate.ref.provider, candidate.ref.model) === value
      );
      if (model) {
        void updateSettings({ ai: { chatModel: model.ref } }).catch(
          console.error
        );
        return;
      }
    }
  }

  /** Closes the sheet, then opens the settings; the settings open at once when the sheet is not up. */
  private openSettings(service?: string) {
    const open = () => this.host.openSettings(service);
    if (!this.visible) {
      open();
      return;
    }
    this.afterClose = open;
    postPanel('ai', 'hide');
  }

  private async sendHistory(failed = false) {
    const { keeper } = this.core;
    try {
      const summaries = await keeper.list();
      postPanel('ai', 'history', {
        items: summaries.map((summary) => ({
          id: summary.id,
          title: historyTitle(summary),
          detail: keptWhen(summary.updatedAt),
          current: summary.id === keeper.current,
        })),
        failed: failed ? i18next.t('ai.history.failed') : null,
      });
    } catch (error) {
      console.warn('Failed to list the conversations:', error);
      postPanel('ai', 'history', {
        items: [],
        failed: i18next.t('ai.history.listFailed'),
      });
    }
  }

  private async conversation(action: string, id: string) {
    const { keeper } = this.core;
    if (action === 'open') {
      try {
        await keeper.open(id);
        postPanel('ai', 'historyDone');
      } catch (error) {
        console.warn('Failed to open the conversation:', error);
        await this.sendHistory(true);
      }
    } else if (action === 'remove') {
      try {
        await keeper.remove(id);
      } catch (error) {
        console.warn('Failed to delete the conversation:', error);
      }
      await this.sendHistory();
    }
  }

  /** Reads the images the sheet picked and brings them within what services take, in turn. */
  private async attach(
    sources: Array<{ name: string; type: string; data: string }>
  ) {
    if (sources.length === 0 && this.tray.length >= MAX_IMAGES) {
      this.note = trayFull();
      this.sendState();
      return;
    }
    for (const source of sources) {
      if (this.destroyed) return;
      if (this.tray.length >= MAX_IMAGES) {
        this.note = trayFull();
        break;
      }
      const name = source.name || i18next.t('ai.image.pasted');
      try {
        const bytes = bytesOf(source.data);
        const image = await prepareImage(
          new Blob([bytes], { type: source.type }),
          name
        );
        this.tray.push({ id: this.nextTrayId++, image });
        this.note = null;
      } catch (error) {
        console.error('Failed to attach image:', error);
        this.note = trayFailed(name, error);
      }
      this.sendState();
    }
    this.sendState();
  }

  private blocks = (key: string, text: string): MdBlock[] => {
    const known = this.blockMemo.get(key);
    if (known?.text === text) return known.blocks;
    const blocks = markdownBlocks(text);
    this.blockMemo.set(key, { text, blocks });
    return blocks;
  };

  private thumbnail = (image: ChatImage): string => {
    const known = this.pictures.get(image.data);
    if (known !== undefined) return known;
    if (!this.drawing.has(image.data)) {
      this.drawing.add(image.data);
      void this.draw(image)
        .catch((error) => {
          console.error('Failed to draw a thumbnail:', error);
          return '';
        })
        .then((data) => {
          this.pictures.set(image.data, data);
          this.picturesDrawn();
        });
    }
    return '';
  };

  /** Sends what holds a thumbnail again, once per frame however many were drawn. */
  private picturesDrawn() {
    if (this.destroyed || !this.visible || this.picturesFrame != null) return;
    this.picturesFrame = requestAnimationFrame(() => {
      this.picturesFrame = null;
      this.sendState();
      for (const entry of this.core.session.entries) {
        if (entry.role === 'user' ? entry.images.length > 0 : hasTool(entry)) {
          this.sendEntry(entry);
        }
      }
    });
  }

  private sessionChanged(change: SessionChange) {
    switch (change.kind) {
      case 'reset':
        this.blockMemo.clear();
        this.sendEntries();
        break;
      case 'added':
        this.sendEntry(change.entry);
        break;
      case 'updated':
        this.entryUpdated(change.entry);
        break;
      case 'removed':
        this.sent.delete(change.entry.id);
        this.dirty.delete(change.entry.id);
        for (const key of [...this.blockMemo.keys()]) {
          if (key.startsWith(`${change.entry.id}:`)) this.blockMemo.delete(key);
        }
        if (this.visible) postPanel('ai', 'removed', { id: change.entry.id });
        break;
    }
    this.sendState();
  }

  /** A reply on its way is sent at most once a frame. */
  private entryUpdated(entry: ChatEntry) {
    if (!this.visible || entry.role !== 'assistant') return;
    if (entry.status !== 'streaming') {
      this.dirty.delete(entry.id);
      this.sendEntry(entry);
      return;
    }
    this.dirty.add(entry.id);
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      const ids = [...this.dirty];
      this.dirty.clear();
      for (const id of ids) {
        const entry = this.core.session.entries.find(
          (candidate) => candidate.id === id
        );
        if (entry) this.sendEntry(entry);
      }
    });
  }

  private settingsChanged(ai: AiSettings) {
    this.ai = ai;
    this.sendState();
  }

  /** Draws again what became of each edit and what each tool asks. */
  private cardsChanged() {
    for (const entry of this.core.session.entries) {
      if (entry.role === 'assistant' && hasTool(entry)) this.sendEntry(entry);
    }
    this.sendState();
  }

  /** Draws every word again, as after the language changed. */
  private redraw() {
    this.sendEntries();
    this.sendState();
  }

  private sendEntry(entry: ChatEntry) {
    if (!this.visible) return;
    const data = entryData(entry, this.context);
    const json = JSON.stringify(data);
    if (this.sent.get(entry.id) === json) return;
    this.sent.set(entry.id, json);
    postPanel('ai', 'entry', { entry: data });
  }

  private sendEntries() {
    if (!this.visible) return;
    this.sent.clear();
    const entries = this.core.session.entries.map((entry) => {
      const data = entryData(entry, this.context);
      this.sent.set(entry.id, JSON.stringify(data));
      return data;
    });
    postPanel('ai', 'entries', { entries });
  }

  private sendState() {
    if (!this.visible) return;
    const { session, edits } = this.core;
    const state = stateData({
      ai: this.ai,
      entries: session.entries,
      busy: session.busy,
      pending: edits.pending().length,
      position: edits.position(),
      tray: this.tray,
      note: this.note,
      thumbnail: this.thumbnail,
    });
    const json = JSON.stringify(state);
    if (json === this.sentState) return;
    this.sentState = json;
    postPanel('ai', 'state', state);
  }
}

function hasTool(entry: AssistantEntry): boolean {
  return entry.parts.some((part) => part.type === 'tool');
}
