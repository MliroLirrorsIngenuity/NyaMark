/**
 * Keeps the app's MCP servers in step with the settings, and what each one
 * offers within reach of the assistant and the settings. The servers run
 * in the app, one set for every window; each window's hub sends it the
 * servers the settings turn on whenever they change, and the app starts,
 * stops or restarts only those that differ.
 */

import {
  type McpServerConfig,
  type McpStatus,
  type McpToolResult,
  type ProxySetting,
  mcpCallTool,
  mcpRestart,
  mcpStatus,
  mcpSync,
} from '../../bridge/ipc/ai';
import type { AiMcpServer, AiSettings } from '../../state/ai-settings';
import { subscribeSettings } from '../../state/settings';

/** The app's MCP commands, as the hub uses them. */
export type McpApi = {
  sync(servers: McpServerConfig[], proxy: ProxySetting): Promise<McpStatus[]>;
  status(): Promise<McpStatus[]>;
  restart(id: string): Promise<McpStatus>;
  call(
    server: string,
    tool: string,
    args: Record<string, unknown> | null
  ): Promise<McpToolResult>;
};

const MCP: McpApi = {
  sync: mcpSync,
  status: mcpStatus,
  restart: mcpRestart,
  call: mcpCallTool,
};

export type McpPolling = {
  /** How often a server still starting is looked at. */
  starting: number;
  /** How often the servers are looked at while someone watches them. */
  watching: number;
};

const POLLING: McpPolling = { starting: 500, watching: 1500 };

/** Whether the server has what it needs to start. */
export function isComplete(server: AiMcpServer): boolean {
  return server.transport === 'stdio'
    ? server.command.length > 0
    : /^https?:\/\/\S+$/i.test(server.url);
}

/** The server as the app starts it. */
export function serverConfig(server: AiMcpServer): McpServerConfig {
  if (server.transport === 'http') {
    return {
      transport: 'http',
      id: server.id,
      name: server.name,
      url: server.url,
      headers: server.headers,
      useKey: server.useKey,
    };
  }
  return {
    transport: 'stdio',
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd || null,
  };
}

/** The servers the settings turn on, as the app starts them. */
export function enabledConfigs(
  ai: Pick<AiSettings, 'mcpServers'>
): McpServerConfig[] {
  return ai.mcpServers
    .filter((server) => server.enabled && isComplete(server))
    .map(serverConfig);
}

export class McpHub {
  private known: McpStatus[] = [];
  private applied: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchers = 0;

  constructor(
    private readonly api: McpApi = MCP,
    private readonly polling: McpPolling = POLLING
  ) {}

  /** Where each running server is, as last heard. */
  get statuses(): readonly McpStatus[] {
    return this.known;
  }

  status(id: string): McpStatus | undefined {
    return this.known.find((status) => status.id === id);
  }

  /** Starts and stops the servers to match the settings. */
  apply(ai: Pick<AiSettings, 'mcpServers' | 'proxy'>): Promise<void> {
    const servers = enabledConfigs(ai);
    const key = JSON.stringify([servers, ai.proxy]);
    if (key === this.applied) return this.settled();
    this.applied = key;
    return this.enqueue(() => this.api.sync(servers, ai.proxy)).catch(
      (error) => {
        // The same settings are sent again next time.
        if (this.applied === key) this.applied = null;
        throw error;
      }
    );
  }

  /** Asks the app where each server is now. */
  refresh(): Promise<void> {
    return this.enqueue(() => this.api.status());
  }

  /** Stops a server and starts it again. */
  restart(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.api.restart(id);
      return await this.api.status();
    });
  }

  call(
    server: string,
    tool: string,
    args: Record<string, unknown> | null
  ): Promise<McpToolResult> {
    return this.api.call(server, tool, args);
  }

  /** Resolves once the changes sent so far have reached the app. */
  async settled(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Looks at the servers every so often until the returned function is
   * called: a server can fail, or a stopped one come back, at any time.
   */
  watch(): () => void {
    this.watchers++;
    this.schedule();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.watchers--;
    };
  }

  private enqueue(request: () => Promise<McpStatus[]>): Promise<void> {
    const next = this.queue
      .catch(() => undefined)
      .then(request)
      .then((statuses) => this.received(statuses));
    this.queue = next;
    return next;
  }

  private received(statuses: McpStatus[]) {
    this.known = statuses;
    for (const listener of this.listeners) listener();
    this.schedule();
  }

  private schedule() {
    if (this.timer !== null) return;
    const starting = this.known.some((status) => status.state === 'starting');
    if (!starting && this.watchers === 0) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.refresh().catch(console.error);
      },
      starting ? this.polling.starting : this.polling.watching
    );
  }
}

let shared: McpHub | null = null;

/**
 * The window's hub. The first call starts the servers the settings turn
 * on, and keeps them in step with the settings from then on.
 */
export function mcpHub(): McpHub {
  if (!shared) {
    const hub = new McpHub();
    shared = hub;
    subscribeSettings((settings) => {
      void hub.apply(settings.ai).catch((error) => {
        console.error('Failed to start the MCP servers:', error);
      });
    });
  }
  return shared;
}
