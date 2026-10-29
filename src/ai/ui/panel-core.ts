/**
 * What the assistant's dock and its native sheet on the phone have in
 * common: how a turn is set up, and the words and choices around it.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  listWorkspace,
  pickWorkspaceRoot,
  readImageForAi,
  readWorkspaceFile,
  searchWorkspace,
  webFetch,
  webSearch,
  workspaceRoots,
  writeWorkspaceFile,
} from '../../bridge/ipc/ai';
import { resolveDocumentAssetPath } from '../../bridge/ipc/attachments';
import type { NyaEditor } from '../../editor/editor';
import { i18next } from '../../i18n';
import {
  type AiEffort,
  type AiSettings,
  modelLabel,
} from '../../state/ai-settings';
import { getSettings, updateSettings } from '../../state/settings';
import type { Approvals } from '../agent/approvals';
import type { MarkdownTree } from '../agent/document-text';
import { buildInstructions } from '../agent/instructions';
import { ChatFailureError, type TurnSetup } from '../agent/session';
import { documentTools } from '../agent/tools/document';
import { editTools } from '../agent/tools/edit';
import { imageTools } from '../agent/tools/image';
import { mcpTools } from '../agent/tools/mcp';
import { type WebApi, webTools } from '../agent/tools/web';
import { type WorkspaceApi, workspaceTools } from '../agent/tools/workspace';
import type { EditController } from '../edit/controller';
import type { ChatImage } from '../images/image';
import { prepareImage } from '../images/prepare';
import { mcpHub } from '../mcp/hub';
import { connectModel } from '../providers/connect';
import { nativeSearchTool } from '../providers/native-search';
import { ICONS } from './icons';

export type AiPanelHost = {
  editor: NyaEditor;
  /** The source pane's selection in the editor's document, null outside it. */
  sourceSelection: () => { from: number; to: number } | null;
  /** Pushes the source pane's edits into the editor; nothing outside it. */
  flushSource: () => void;
  /** Has the source pane follow a change made to the editor from `before`. */
  followSource: (before: ProseNode) => void;
  /** The open document's path, `null` while it is unsaved. */
  documentPath: () => string | null;
  /**
   * Opens the AI section of the settings; with `service`, the service set
   * up from that preset, to fill in.
   */
  openSettings: (service?: string) => void;
};

export function hasModels(ai: AiSettings): boolean {
  return ai.providers.some((provider) => provider.models.length > 0);
}

/** The chat model and what is known of it. */
export function chatModel(ai: AiSettings) {
  const ref = ai.chatModel;
  const provider = ref && ai.providers.find((p) => p.id === ref.provider);
  if (!ref || !provider) return null;
  const model = provider.models.find((m) => m.id === ref.model);
  return {
    ref,
    provider,
    label: model ? modelLabel(model) : ref.model,
    vision: model?.vision ?? false,
  };
}

/** Whether the replies are paid for by a ChatGPT plan. */
export function usesChatgptPlan(ai: AiSettings): boolean {
  return chatModel(ai)?.provider.auth === 'chatgpt';
}

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Four letters that set this run's edits apart from those kept before. */
export const editTag = () =>
  Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** What an empty conversation offers to ask, each sent as it reads. */
export const SUGGESTIONS = [
  { name: 'summary', icon: ICONS.summary, key: 'ai.empty.summarize' },
  { name: 'proofread', icon: ICONS.proofread, key: 'ai.empty.proofread' },
  { name: 'pen', icon: ICONS.pen, key: 'ai.empty.continue' },
  { name: 'heading', icon: ICONS.heading, key: 'ai.empty.nameIt' },
];

export const WORKSPACE: WorkspaceApi = {
  roots: workspaceRoots,
  pickRoot: pickWorkspaceRoot,
  list: listWorkspace,
  read: readWorkspaceFile,
  search: searchWorkspace,
  write: writeWorkspaceFile,
};

export const WEB: WebApi = { search: webSearch, fetch: webFetch };

/** Keeps the user's choice to run an MCP server's tool without asking. */
export function allowMcpTool(server: string, tool: string) {
  const mcpServers = getSettings().ai.mcpServers.map((entry) =>
    entry.id === server && !entry.allowed.includes(tool)
      ? { ...entry, allowed: [...entry.allowed, tool] }
      : entry
  );
  void updateSettings({ ai: { mcpServers } }).catch(console.error);
}

/** Keeps the level of thought chosen with the chat model. */
export function chooseEffort(effort: AiEffort | null) {
  const ai = getSettings().ai;
  const ref = ai.chatModel;
  if (!ref) return;
  const providers = ai.providers.map((provider) =>
    provider.id === ref.provider
      ? {
          ...provider,
          models: provider.models.map((model) =>
            model.id === ref.model
              ? { ...model, effort: effort ?? undefined }
              : model
          ),
        }
      : provider
  );
  void updateSettings({ ai: { providers } }).catch(console.error);
}

/** The line over the composer for the changes still waiting; `at` is 0 when none is marked. */
export function reviewSummary(count: number, at: number): string {
  return at
    ? i18next.t('ai.edit.pendingAt', { count, at })
    : i18next.t('ai.edit.pending', { count });
}

/** What a turn reaches in the panel it is set up for. */
export type TurnContext = {
  editor: NyaEditor;
  documentPath: () => string | null;
  edits: EditController;
  approvals: Approvals;
  /** Has the model see images a tool opened. */
  showModel: (caption: string, images: readonly ChatImage[]) => void;
};

export async function prepareTurn(context: TurnContext): Promise<TurnSetup> {
  const { editor, documentPath, edits, approvals, showModel } = context;
  const ai = getSettings().ai;
  const chosen = chatModel(ai);
  if (!chosen) {
    throw new ChatFailureError({ code: 'no-model', message: '' });
  }
  const { ref, provider, label, vision } = chosen;
  // What became of the earlier edits goes before the text it changed.
  const notices = await edits.notices();
  const document = await edits.read();
  const read = () => edits.read();
  const tree: MarkdownTree = (text) => editor.markdownTree(text);
  const folders = await workspaceRoots().catch(() => []);
  const native = ai.search.native ? nativeSearchTool(provider) : null;
  const hub = mcpHub();
  await hub.refresh().catch(console.error);
  const servers = hub.statuses.filter(
    (status) => status.state === 'ready' && status.tools.length > 0
  );
  return {
    model: connectModel(provider, ref.model, () => getSettings().ai.proxy),
    modelLabel: label,
    instructions: buildInstructions({
      documentPath: documentPath(),
      custom: ai.instructions,
      document: { ...document, tree },
      editMode: ai.editMode,
      notices,
      folders,
      vision,
      mcpServers: servers.map((status) => status.name),
    }),
    tools: {
      ...mcpTools({
        statuses: servers,
        servers: () => getSettings().ai.mcpServers,
        call: (server, tool, args) => hub.call(server, tool, args),
        approvals,
        allowAlways: allowMcpTool,
        prepare: vision ? prepareImage : undefined,
        show: vision ? showModel : undefined,
      }),
      ...documentTools(read, tree, () => edits.notices()),
      ...editTools(edits),
      ...workspaceTools({
        api: WORKSPACE,
        approvals,
        documentPath,
        readDocument: read,
        edits,
      }),
      ...webTools({
        api: WEB,
        approvals,
        settings: () => getSettings().ai,
      }),
      // The service's own search, where the user prefers it and it has one.
      ...(native ? { web_search: native } : {}),
      ...(vision
        ? imageTools({
            resolve: (src) => resolveDocumentAssetPath(documentPath(), src),
            read: readImageForAi,
            prepare: prepareImage,
            show: showModel,
          })
        : {}),
    },
  };
}
