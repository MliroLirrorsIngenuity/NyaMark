import type { AuthScheme } from '../../bridge/ipc/ai';
import type { AiProviderKind } from '../../state/ai-settings';

export type AiPreset = {
  id: string;
  /** Shown as is: these are names. */
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  /** Runs on this computer or the local network and takes no key. */
  local: boolean;
  /** Where the user gets a key. */
  keyPage?: string;
};

/**
 * Services a user can add in one step. Every other service that speaks one
 * of these APIs is added as `custom`.
 */
export const AI_PRESETS: readonly AiPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
    keyPage: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    local: false,
    keyPage: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    local: false,
    keyPage: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    local: false,
    keyPage: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    local: false,
    keyPage: 'https://openrouter.ai/keys',
  },
  {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    local: false,
    keyPage: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    local: false,
    keyPage: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    kind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    local: false,
    keyPage: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    local: false,
    keyPage: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'volcengine',
    name: '火山方舟 (Doubao)',
    kind: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    local: false,
    keyPage: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    local: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    local: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    kind: 'openai-compatible',
    baseUrl: '',
    local: false,
  },
];

export function presetById(id: string): AiPreset | undefined {
  return AI_PRESETS.find((preset) => preset.id === id);
}

/** Where each API expects its key; the app puts it there. */
export function authSchemeOf(kind: AiProviderKind): AuthScheme {
  if (kind === 'anthropic') return 'x-api-key';
  if (kind === 'google') return 'x-goog-api-key';
  return 'bearer';
}

/**
 * An `http:` address off this computer and the local network: a key sent
 * there crosses the internet in the clear.
 */
export function isPlainRemoteAddress(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') {
    return false;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':')) return !/^f[cd]|^fe[89ab]/.test(host);
  return true;
}
