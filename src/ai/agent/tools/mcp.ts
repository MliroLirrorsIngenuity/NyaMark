/**
 * The tools of the MCP servers the user added, offered to the assistant
 * under names of their own. Each call waits for the user to allow it,
 * unless they chose to always allow that tool. What a tool returns is read
 * down to text; its images reach the model in a message from the app, as
 * those view_image opens do.
 */

import { type Tool, dynamicTool, jsonSchema } from 'ai';
import {
  type InvokeFailure,
  McpCallError,
  type McpCallFailure,
  type McpStatus,
  type McpTool,
  type McpToolResult,
} from '../../../bridge/ipc/ai';
import type { AiMcpServer } from '../../../state/ai-settings';
import type { ChatImage } from '../../images/image';
import { type Approvals, type Denied, modelOutput } from '../approvals';
import { dataUrlBlob } from './image';

export type McpToolHost = {
  /** The servers running now; only those ready offer tools. */
  statuses: readonly McpStatus[];
  /** The servers as the settings have them when a tool runs. */
  servers: () => readonly AiMcpServer[];
  call(
    server: string,
    tool: string,
    args: Record<string, unknown> | null
  ): Promise<McpToolResult>;
  approvals: Approvals;
  /** Keeps the user's choice to run the tool without asking. */
  allowAlways(server: string, tool: string): void;
  /** For a model that sees images: brings one within what services take. */
  prepare?: (source: Blob, name: string) => Promise<ChatImage>;
  /** Has the model see the images before its next step. */
  show?: (caption: string, images: ChatImage[]) => void;
};

export type McpOutput = {
  text: string;
  server: string;
  tool: string;
  /** The images the tool returned, as they were sent. */
  images?: ChatImage[];
};

/** The longest tool name the services take. */
const MAX_NAME = 64;
/** The most of a tool's output the assistant reads. */
const MAX_TEXT = 50_000;
/** The most of the arguments shown to the user when asking. */
const MAX_PREVIEW = 4000;
/** The most images one call shows the model. */
const MAX_TOOL_IMAGES = 4;

const PREFIX = 'mcp__';

function slug(text: string): string {
  return text
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
}

/** A short, steady tag for text, to keep shortened names apart. */
function tag(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}

/**
 * The name the assistant calls a server's tool by: `mcp__<server>__<tool>`,
 * in the letters every service takes and short enough for all of them,
 * and apart from the names in `taken`, which it joins.
 */
export function mcpToolName(
  server: string,
  serverId: string,
  tool: string,
  taken: Set<string>
): string {
  const head = `${PREFIX}${(slug(server) || slug(serverId) || 'server').slice(0, 24)}__`;
  let tail = slug(tool) || 'tool';
  if (head.length + tail.length > MAX_NAME) {
    const suffix = `_${tag(tool)}`;
    tail = tail.slice(0, MAX_NAME - head.length - suffix.length) + suffix;
  }
  let name = head + tail;
  for (let count = 2; taken.has(name); count++) {
    const suffix = `_${count}`;
    name =
      head + tail.slice(0, MAX_NAME - head.length - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith(PREFIX);
}

/** The schema a tool takes, as the services expect one: an object. */
export function toolSchema(schema: Record<string, unknown>) {
  const { $schema: _, ...rest } = schema ?? {};
  return {
    ...rest,
    type: 'object' as const,
    properties:
      rest.properties && typeof rest.properties === 'object'
        ? rest.properties
        : {},
  };
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The arguments, as the user is shown them. */
export function argumentsPreview(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input ?? {}, null, 2) ?? '{}';
  } catch {
    text = String(input);
  }
  return cut(text, MAX_PREVIEW);
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type ReadResult = {
  text: string;
  /** The images in it, as their media type and base64 data. */
  images: { mediaType: string; data: string }[];
};

/** What a tool returned, as text, with its images set apart. */
export function readResult(result: McpToolResult): ReadResult {
  const parts: string[] = [];
  const images: ReadResult['images'] = [];
  for (const block of result.content ?? []) {
    switch (block.type) {
      case 'text':
        parts.push(str(block.text));
        break;
      case 'image': {
        images.push({ mediaType: str(block.mimeType), data: str(block.data) });
        parts.push(`[image ${images.length}]`);
        break;
      }
      case 'audio':
        parts.push(
          `[audio (${str(block.mimeType) || 'unknown type'}), not shown]`
        );
        break;
      case 'resource': {
        const resource = field(block, 'resource');
        const uri = str(field(resource, 'uri'));
        const text = field(resource, 'text');
        if (typeof text === 'string') parts.push(`Resource ${uri}:\n${text}`);
        else {
          const type = str(field(resource, 'mimeType')) || 'binary';
          parts.push(`[resource ${uri} (${type}), not shown]`);
        }
        break;
      }
      case 'resource_link': {
        const name = str(block.title) || str(block.name);
        const description = str(block.description);
        parts.push(
          `[resource link: ${name ? `${name} ` : ''}<${str(block.uri)}>${description ? ` ${description}` : ''}]`
        );
        break;
      }
      default:
        parts.push(`[${str(block.type) || 'unknown'} content, not shown]`);
    }
  }
  // Structured output stands in for text the tool left out.
  if (parts.length === 0 && result.structuredContent != null) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  let text = parts.join('\n\n').trim();
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT)}\n\n[The output was cut at ${MAX_TEXT} characters.]`;
  }
  return { text, images };
}

/** What the app's failures mean, for the assistant. */
const EXPLAINED: Record<(McpCallFailure | InvokeFailure)['kind'], string> = {
  'unknown-server':
    'The server is no longer running: the user turned it off or removed it.',
  'not-ready':
    'The server is starting, or failed to start. Tell the user if it keeps failing; they can see why in the AI settings.',
  'bad-arguments': 'The arguments must be a JSON object.',
  'unexpected-response':
    'The server answered with something other than a tool result.',
  timeout: 'The tool took too long and was stopped.',
  exited: 'The server stopped while the tool ran.',
  server: 'The server refused the call.',
  connection: 'The connection to the server failed.',
  invoke: 'The app could not make the call.',
};

function failure(error: unknown): Error {
  if (!(error instanceof McpCallError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const { kind } = error.failure;
  const detail = 'message' in error.failure ? error.failure.message : '';
  return new Error(
    `${kind}: ${EXPLAINED[kind]}${detail ? ` (${detail.slice(0, 500)})` : ''}`
  );
}

/** Rejects when the turn is stopped; the server's own timeout ends the call. */
function untilStopped<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('stopped'));
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error('stopped'));
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      }
    );
  });
}

/** The tools of every ready server, by the names the assistant calls them. */
export function mcpTools(host: McpToolHost): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  const taken = new Set<string>();
  // Each image goes into every step after it, so a turn shows only so many.
  let shown = 0;

  const wrap = (status: McpStatus, tool: McpTool) => {
    const name = mcpToolName(status.name, status.id, tool.name, taken);
    const about = tool.description?.trim() || tool.title?.trim() || '';
    tools[name] = dynamicTool({
      description: cut(
        `From the MCP server "${status.name}", tool "${tool.name}".${about ? ` ${about}` : ''}`,
        4000
      ),
      inputSchema: jsonSchema(toolSchema(tool.inputSchema)),
      execute: async (input, { toolCallId, abortSignal }) => {
        const server = host.servers().find((entry) => entry.id === status.id);
        const allowed =
          server?.allowed.includes(tool.name) ||
          host.approvals.toolAllowed(status.id, tool.name);
        if (!allowed) {
          const answer = await host.approvals.ask(
            toolCallId,
            {
              kind: 'tool',
              server: status.id,
              serverName: server?.name ?? status.name,
              tool: tool.name,
              input: argumentsPreview(input),
            },
            abortSignal
          );
          if (answer === 'deny') {
            const denied: Denied = {
              denied: `The user did not allow running ${tool.name} from ${status.name}.`,
            };
            return denied;
          }
          if (answer === 'always') host.allowAlways(status.id, tool.name);
        }
        const args =
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : null;
        let result: McpToolResult;
        try {
          result = await untilStopped(
            host.call(status.id, tool.name, args),
            abortSignal
          );
        } catch (error) {
          throw failure(error);
        }
        const read = readResult(result);
        if (result.isError) {
          throw new Error(`tool-error: ${read.text || 'The tool failed.'}`);
        }
        const output: McpOutput = {
          text: read.text || '(The tool returned nothing.)',
          server: status.name,
          tool: tool.name,
        };
        if (read.images.length === 0) return output;
        const images: ChatImage[] = [];
        const { prepare, show } = host;
        for (const [index, image] of read.images.entries()) {
          if (!prepare || !show || shown >= MAX_TOOL_IMAGES) break;
          const blob = await dataUrlBlob(
            `data:${image.mediaType};base64,${image.data}`
          );
          if (!blob) continue;
          try {
            images.push(await prepare(blob, `${tool.name}-${index + 1}`));
            shown++;
          } catch {
            // An image that cannot be read stays a line in the text.
          }
        }
        if (images.length > 0 && show) {
          show(
            `The images ${tool.name} from the MCP server "${status.name}" returned. This message is from the app, not the user.`,
            images
          );
          output.images = images;
          output.text += `\n\n[${images.length} of the images follow in a message from the app.]`;
        } else {
          output.text +=
            '\n\n[The images are not shown: this model does not see images, or the turn has shown as many as it may.]';
        }
        return output;
      },
      toModelOutput: ({ output }) => modelOutput(output as McpOutput | Denied),
    });
  };

  for (const status of host.statuses) {
    if (status.state !== 'ready') continue;
    for (const tool of status.tools) wrap(status, tool);
  }
  return tools;
}
