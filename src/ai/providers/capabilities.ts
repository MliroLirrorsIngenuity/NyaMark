import type { AiModelInfo } from '../../state/ai-settings';

/**
 * Models a chat cannot use: embeddings, speech, images out, moderation.
 * Listing them would only offer choices that fail.
 */
const NOT_CHAT =
  /embed|whisper|tts|transcri|speech|audio|dall-e|image-gen|imagen|gpt-image|moderation|rerank|realtime|veo|sora|lyria|search-preview|computer-use/i;

export function isChatModel(id: string): boolean {
  return !NOT_CHAT.test(id);
}

const VISION =
  /gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|chatgpt|\bo[134](-|$)|claude|gemini|gemma-3|vision|[-_.]vl\b|vl-|qwen.*-vl|qvq|glm-4(\.\d+)?v|pixtral|llava|minicpm-v|llama-?3\.2.*vision|llama-?4|grok-(2-vision|4)|kimi.*(vision|k2\.5|latest)|doubao.*(vision|seed)|mistral-(medium|small)-3/i;

const REASONING =
  /\bo[134](-|$)|gpt-5|reason|thinking|\br1\b|-r1|deepseek-r|qwq|qwen3|claude-(opus|sonnet)-[45]|claude-3-7|gemini-(2\.5|3)|grok-(3-mini|4)|glm-4\.[5-9]|kimi-k2|magistral|seed.*thinking/i;

/** Tokens a model reads, by family, for when the service does not say. */
const CONTEXT: Array<[RegExp, number]> = [
  [/gemini|gpt-4\.1|llama-?4/i, 1_000_000],
  [/gpt-5/i, 400_000],
  [/claude/i, 200_000],
  [/\bo[134](-|$)/i, 200_000],
  [
    /kimi|moonshot.*128k|qwen.*(plus|max|turbo|long)|glm-4\.[5-9]|doubao/i,
    128_000,
  ],
  [/deepseek|gpt-4o|mistral|grok/i, 128_000],
  [/32k/i, 32_768],
  [/8k/i, 8_192],
];

/**
 * What a model can do, guessed from its id for the settings to start with;
 * the user can change each guess there.
 */
export function guessCapabilities(
  id: string,
  options: { local: boolean; contextWindow?: number }
): AiModelInfo {
  const context =
    options.contextWindow ??
    CONTEXT.find(([pattern]) => pattern.test(id))?.[1] ??
    // Local runners load a model with a small window unless told otherwise.
    (options.local ? 32_768 : 128_000);
  return {
    id,
    vision: VISION.test(id),
    tools: true,
    reasoning: REASONING.test(id),
    contextWindow: context,
  };
}
