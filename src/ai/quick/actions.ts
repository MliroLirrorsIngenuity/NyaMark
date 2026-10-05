/**
 * The commands of the AI menu over the selection, as the user set them: the
 * built-in ones in the app's language until the user writes their own name
 * or prompt, and those the user added.
 */

import {
  type AiQuickAction,
  type BuiltinQuickAction,
  isBuiltinQuickAction,
} from '../../state/ai-settings';

/** What each built-in command asks of the model. */
const PROMPTS: Record<BuiltinQuickAction, (language: string) => string> = {
  polish: () =>
    'Polish the text: make it read smoothly and clearly, mend awkward wording, and keep its meaning, tone and language.',
  rewrite: () =>
    'Rewrite the text in other words, keeping its meaning and its language.',
  shorter: () =>
    'Make the text shorter: keep what matters, cut the rest, and keep its language.',
  longer: () =>
    'Make the text longer: develop its ideas with detail and examples, in its language and style.',
  grammar: () =>
    'Fix the spelling, grammar and punctuation of the text. Leave everything else as it is.',
  formal: () =>
    'Make the tone of the text more formal, keeping its meaning and its language.',
  casual: () =>
    'Make the tone of the text more casual and friendly, keeping its meaning and its language.',
  'translate-en': () => 'Translate the text into English.',
  'translate-zh': (language) =>
    `Translate the text into ${language === 'zh-TW' ? 'Traditional' : 'Simplified'} Chinese.`,
};

/** The i18n key of a built-in command's name. */
export function builtinQuickName(id: BuiltinQuickAction): string {
  return `ai.quick.action.${id}`;
}

/** What a built-in command asks, in the app's language `language`. */
export function builtinQuickPrompt(
  id: BuiltinQuickAction,
  language: string
): string {
  return PROMPTS[id](language);
}

export type QuickCommand = { id: string; name: string; prompt: string };

/** The longest a name taken from a prompt runs. */
const NAME_FROM_PROMPT = 40;

/** What `action` asks: the user's prompt, or the built-in one's. */
export function quickActionPrompt(
  action: AiQuickAction,
  language: string
): string {
  if (action.prompt) return action.prompt;
  return isBuiltinQuickAction(action.id)
    ? builtinQuickPrompt(action.id, language)
    : '';
}

/** What `action` is called: the user's name, the built-in one's, or its prompt's start. */
export function quickActionName(
  action: AiQuickAction,
  translate: (key: string) => string,
  language: string
): string {
  if (action.name) return action.name;
  if (isBuiltinQuickAction(action.id)) {
    return translate(builtinQuickName(action.id));
  }
  const prompt = quickActionPrompt(action, language);
  return prompt.length > NAME_FROM_PROMPT
    ? `${prompt.slice(0, NAME_FROM_PROMPT)}…`
    : prompt;
}

/**
 * The commands to offer: each with the name and the prompt it runs with.
 * A command the user added with no prompt yet is left out.
 */
export function quickCommands(
  actions: readonly AiQuickAction[],
  translate: (key: string) => string,
  language: string
): QuickCommand[] {
  const commands: QuickCommand[] = [];
  for (const action of actions) {
    const prompt = quickActionPrompt(action, language);
    if (!prompt) continue;
    const name = quickActionName(action, translate, language);
    commands.push({ id: action.id, name, prompt });
  }
  return commands;
}
