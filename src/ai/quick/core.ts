/**
 * What the AI menu on the page and its native sheet on the phone have in
 * common: the commands it offers, the request a command makes, and what
 * becomes of the reply or the failure.
 */

import type { NyaEditor } from '../../editor/editor';
import { i18next } from '../../i18n';
import type { AiQuickAction, AiSettings } from '../../state/ai-settings';
import { getSettings } from '../../state/settings';
import { describeFailure } from '../agent/session';
import type { EditController } from '../edit/controller';
import { EditError } from '../edit/text-edit';
import { connectModel } from '../providers/connect';
import { SETTINGS_FIXES, USAGE_FIXES, failureReading } from '../ui/failure';
import { quickCommands } from './actions';
import { askModel } from './ask';
import { type Landing, type Placement, landingTarget } from './place';
import { type QuickTask, quickPrompt } from './prompt';

/** How the menu opens: to choose, or running a slash command at once. */
export type QuickMode = 'menu' | 'continue' | 'summarize';

export type QuickHost = {
  editor: NyaEditor;
  edits: Pick<
    EditController,
    'placement' | 'forget' | 'placeReply' | 'revealEdit'
  >;
  documentPath: () => string | null;
  openSettings: () => void;
  /** Opens the conversation with `text` written, for the user to send. */
  toChat: (text: string) => void;
};

/** A command that has been chosen: what it asks, where its reply goes, and what it is called. */
export type Run = { task: QuickTask; landing: Landing; label: string };

/** The model the menu's commands go to: their own, or the chat's. */
export function quickModel(ai: AiSettings) {
  const ref = ai.quickModel ?? ai.chatModel;
  const provider = ref && ai.providers.find((p) => p.id === ref.provider);
  return ref && provider ? { ref, provider } : null;
}

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** The longest an instruction typed in reads as the command's name. */
const LABEL_CHARS = 60;

/** A streaming reply is drawn again at most this often. */
export const DRAW_MS = 50;

export function continueRun(): Run {
  return {
    task: { kind: 'continue' },
    landing: 'continue',
    label: i18next.t('ai.quick.continue'),
  };
}

export function summarizeRun(): Run {
  return {
    task: { kind: 'summarize' },
    landing: 'blocks',
    label: i18next.t('ai.quick.summarize'),
  };
}

/** One line of the menu; a line with no command takes the text typed on to the conversation. */
export type MenuItem = { id: string; label: string; run: Run | null };

/** The menu's items: what was typed first, then the commands that match. */
export function menuItems(
  typed: string,
  selected: boolean,
  actions: readonly AiQuickAction[]
): MenuItem[] {
  const items: MenuItem[] = [];
  if (typed) {
    const label =
      typed.length > LABEL_CHARS ? `${typed.slice(0, LABEL_CHARS)}…` : typed;
    items.push({
      id: 'typed',
      label: i18next.t(selected ? 'ai.quick.changeAs' : 'ai.quick.writeAs', {
        text: label,
      }),
      run: selected
        ? {
            task: { kind: 'transform', instruction: typed },
            landing: 'replace',
            label,
          }
        : {
            task: { kind: 'write', instruction: typed },
            landing: 'blocks',
            label,
          },
    });
  }
  const match = (name: string) =>
    !typed || name.toLowerCase().includes(typed.toLowerCase());
  if (selected) {
    const commands = quickCommands(
      actions,
      (key) => i18next.t(key),
      i18next.language
    );
    for (const command of commands) {
      if (!match(command.name)) continue;
      items.push({
        id: `command:${command.id}`,
        label: command.name,
        run: {
          task: { kind: 'transform', instruction: command.prompt },
          landing: 'replace',
          label: command.name,
        },
      });
    }
  } else {
    const runs: Array<[string, Run]> = [
      ['continue', continueRun()],
      ['summarize', summarizeRun()],
    ];
    for (const [id, run] of runs) {
      if (match(run.label)) items.push({ id, label: run.label, run });
    }
  }
  items.push({ id: 'chat', label: i18next.t('ai.quick.toChat'), run: null });
  return items;
}

/** What `run` asks of the model, with the document around where its reply goes. */
export function quickRequest(
  run: Run,
  placement: Placement,
  documentPath: string | null,
  instructions: string
) {
  const target = landingTarget(placement, run.landing);
  const { text } = placement;
  return quickPrompt(
    run.task,
    {
      title: documentPath ? fileName(documentPath) : null,
      before: text.slice(0, target.from),
      selected:
        run.task.kind === 'transform' ? text.slice(target.from, target.to) : '',
      after: text.slice(target.to),
    },
    instructions
  );
}

/** Asks the chosen model, handing the reply over as it comes. */
export function askQuick(
  chosen: NonNullable<ReturnType<typeof quickModel>>,
  request: { instructions: string; prompt: string },
  onText: (text: string) => void,
  signal: AbortSignal
): Promise<string> {
  return askModel(
    connectModel(
      chosen.provider,
      chosen.ref.model,
      () => getSettings().ai.proxy
    ),
    request,
    onText,
    signal
  );
}

/** A failure as the menu tells it, with the button that fixes it, if there is one. */
export function failureProblem(error: unknown): {
  message: string;
  detail: string | null;
  fix: 'settings' | 'usage' | null;
} {
  const failure = describeFailure(error);
  const reading = failureReading(failure);
  const fix = SETTINGS_FIXES.has(failure.code)
    ? 'settings'
    : USAGE_FIXES.has(failure.code)
      ? 'usage'
      : null;
  return { message: reading.text, detail: reading.detail, fix };
}

/** The reply gone in, with the edit to show if it went in as a proposal; or what stopped it, with the reply if it is worth copying. */
export type Landed =
  | { edit: string | null; problem?: undefined }
  | { problem: string; reply: string | null };

/** Puts the reply in where the command ran, as a proposal or at once. */
export async function landReply(
  edits: QuickHost['edits'],
  placement: Placement,
  run: Run,
  reply: string
): Promise<Landed> {
  if (!reply.trim()) {
    return { problem: i18next.t('ai.quick.empty'), reply: null };
  }
  try {
    const result = await edits.placeReply(placement, run.landing, reply);
    return {
      edit: result.report.status === 'proposed' ? result.report.edit : null,
    };
  } catch (error) {
    const unchanged = error instanceof EditError && error.code === 'no_change';
    return {
      problem: i18next.t(
        unchanged ? 'ai.quick.unchanged' : 'ai.quick.notPlaced'
      ),
      reply,
    };
  }
}
