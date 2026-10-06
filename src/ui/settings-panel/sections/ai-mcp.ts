/**
 * The MCP servers in the AI tab: adding a program on this computer or a
 * service on the web, turning each on or off, where each one is, its log,
 * and the tools that run without asking. Changes start and stop servers
 * once the dialog is confirmed; what each server is doing shows live.
 */

import { isComplete, mcpHub } from '../../../ai/mcp/hub';
import {
  type AiSecretStatus,
  type McpStartFailure,
  type McpStatus,
  SecretError,
  deleteAiSecret,
  getAiSecretStatus,
  setAiSecret,
} from '../../../bridge/ipc/ai';
import { i18next } from '../../../i18n';
import { translateDOM } from '../../../i18n/dom';
import {
  type AiMcpServer,
  type AiSettings,
  mcpKeyProfile,
  newMcpServerId,
} from '../../../state/ai-settings';
import { renderSelect } from '../select';
import { button, el, failureText, input, isUrl, translated } from './ai-dom';

export const mcpStyles = `
.ny-ai-mcp__switch {
  flex: 0 0 auto;
}

.ny-ai-mcp__live {
  display: grid;
  gap: 6px;
  width: 100%;
}

.ny-ai-mcp__live > [hidden] {
  display: none;
}

.ny-ai-mcp__log {
  font-size: 12px;
  color: var(--ny-text-secondary);
}

.ny-ai-mcp__log pre {
  max-height: 180px;
  margin: 6px 0 0;
  padding: 6px 8px;
  overflow: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ny-text-primary), transparent 95%);
  font-family: var(--ny-font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}

.ny-ai-mcp__tools {
  display: grid;
  gap: 2px;
  width: 100%;
}

.ny-ai-mcp__tool {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 2px 8px;
  padding: 3px 0;
  font-size: 12px;
  color: var(--ny-text-primary);
}

.ny-ai-mcp__tool input {
  margin: 2px 0 0;
  accent-color: var(--ny-accent);
}

.ny-ai-mcp__tool-name {
  font-family: var(--ny-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.ny-ai-mcp__tool-about {
  grid-column: 2;
  color: var(--ny-text-secondary);
  font-size: 11.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
`;

export type McpSectionOptions = {
  /** The tab's working copy of the settings, changed in place. */
  state: AiSettings;
  /** Tells the dialog the settings changed. */
  emit: () => void;
  /** Keeps a key change waiting until the dialog settles the keys. */
  track: <T>(request: Promise<T>) => Promise<T>;
};

export type McpSection = {
  element: HTMLElement;
  /** The keys typed here were kept: servers given a new one start with it. */
  committed: () => void;
  destroy: () => void;
};

/** One per line; blank lines are left out. */
export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `NAME=value` or `Name: value` lines, as pairs; the name goes first. */
export function parsePairs(text: string, separator: '=' | ':') {
  const pairs: [string, string][] = [];
  for (const line of parseLines(text)) {
    const at = line.indexOf(separator);
    const name = (at < 0 ? line : line.slice(0, at)).trim();
    const value = at < 0 ? '' : line.slice(at + 1).trim();
    if (name) pairs.push([name, value]);
  }
  return pairs;
}

export function formatPairs(
  pairs: readonly [string, string][],
  separator: '=' | ':'
): string {
  const join = separator === ':' ? ': ' : '=';
  return pairs.map(([name, value]) => `${name}${join}${value}`).join('\n');
}

/** Why a server failed, in the user's words. */
export function mcpErrorText(failure: McpStartFailure): string {
  const text = (key: string, detail = '') =>
    i18next.t(`settings.ai.mcp.error.${key}`, { detail });
  switch (failure.kind) {
    case 'spawn':
      return text('spawn', failure.message);
    case 'bad-cwd':
      return text('badCwd', failure.path);
    case 'command-not-found':
      return text('commandNotFound', failure.command);
    case 'bad-url':
      return text('badUrl', failure.url);
    case 'unsupported-scheme':
      return i18next.t('settings.ai.badUrl');
    case 'bad-header':
      return text('badHeader', failure.name);
    case 'reserved-header':
      return text('reservedHeader', failure.name);
    case 'not-connected':
      return text('noKey');
    case 'key-needed':
      return i18next.t('settings.ai.keyNeeded');
    case 'bad-profile':
      return text('keyStore', failure.kind);
    case 'store':
      return text('keyStore', failure.message);
    case 'bad-proxy':
      return text('badProxy', failure.message);
    case 'timeout':
      return text('timeout');
    case 'exited':
      return text('exited');
    case 'server':
      return text('server', failure.message);
    case 'connection':
      return text('connection', failure.message);
  }
}

function textarea(rows: number) {
  const node = el('textarea', 'ny-settings__textarea');
  node.rows = rows;
  node.spellcheck = false;
  node.style.minHeight = 'auto';
  return node;
}

function field(key: string, ...children: HTMLElement[]) {
  const node = el('label', 'ny-settings__field');
  node.append(translated('span', key), ...children);
  return node;
}

function row(...children: HTMLElement[]) {
  const node = el('div', 'ny-settings__row');
  node.append(...children);
  return node;
}

export function renderMcpSection({
  state,
  emit,
  track,
}: McpSectionOptions): McpSection {
  const hub = mcpHub();
  const keys = new Map<string, AiSecretStatus>();
  /** Servers given a key here, to start again once it is kept. */
  const keyChanged = new Set<string>();
  /** Servers moved to another address whose key must be typed again. */
  const keyNeeded = new Set<string>();
  /** Updates what a card shows of its server, without redrawing it. */
  const refreshers = new Map<string, () => void>();
  let editing: string | null = null;

  const section = el('section', 'ny-settings__section');
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.ai.mcp.title">MCP servers</h4>
    <p class="ny-settings__note" data-i18n="settings.ai.mcp.note">Servers give the assistant more tools. A local server runs as a program on this computer with your permissions: add only ones you trust. Changes take effect when you press OK.</p>
  `;
  const list = el('div');
  const addLocal = button('settings.ai.mcp.addLocal');
  const addRemote = button('settings.ai.mcp.addRemote');
  const actions = el('div', 'ny-ai-presets');
  actions.append(addLocal, addRemote);
  section.append(list, row(actions));

  const statusOf = (server: AiMcpServer): McpStatus | undefined =>
    hub.status(server.id);

  const showStatus = (server: AiMcpServer, node: HTMLElement) => {
    const status = statusOf(server);
    let key: string;
    let tone: 'ok' | 'missing' | 'idle' = 'idle';
    let count = 0;
    if (!server.enabled) key = 'settings.ai.mcp.status.off';
    else if (!isComplete(server)) {
      key = 'settings.ai.mcp.status.incomplete';
      tone = 'missing';
    } else if (!status) key = 'settings.ai.mcp.status.pending';
    else if (status.state === 'ready') {
      key = 'settings.ai.mcp.status.ready';
      tone = 'ok';
      count = status.tools.length;
    } else if (status.state === 'failed') {
      key = 'settings.ai.mcp.status.failed';
      tone = 'missing';
    } else key = `settings.ai.mcp.status.${status.state}`;
    node.className = `ny-ai-provider__status is-${tone}`;
    node.textContent = i18next.t(key, { count });
  };

  const metaOf = (server: AiMcpServer) =>
    server.transport === 'stdio'
      ? [server.command, ...server.args].join(' ') || '—'
      : server.url || '—';

  const bindKey = async (server: AiMcpServer, key: string | null) => {
    try {
      const status = await track(
        setAiSecret({
          profile: mcpKeyProfile(server.id),
          baseUrl: server.url,
          auth: 'bearer',
          key,
          keepKey: key === null,
        })
      );
      keys.set(server.id, status);
      keyNeeded.delete(server.id);
      if (key !== null) keyChanged.add(server.id);
    } catch (error) {
      if (error instanceof SecretError && error.failure.kind === 'key-needed') {
        keyNeeded.add(server.id);
      }
      throw error;
    } finally {
      refreshers.get(server.id)?.();
    }
  };

  const add = (transport: AiMcpServer['transport']) => {
    const server: AiMcpServer = {
      id: newMcpServerId(),
      name: i18next.t(
        transport === 'stdio'
          ? 'settings.ai.mcp.localName'
          : 'settings.ai.mcp.remoteName'
      ),
      enabled: true,
      transport,
      command: '',
      args: [],
      env: [],
      cwd: '',
      url: '',
      headers: [],
      useKey: false,
      allowed: [],
    };
    state.mcpServers.push(server);
    editing = server.id;
    emit();
    render();
    list
      .querySelector<HTMLElement>(
        `[data-server="${server.id}"] [data-key="${transport === 'stdio' ? 'command' : 'url'}"]`
      )
      ?.focus();
  };
  addLocal.addEventListener('click', () => add('stdio'));
  addRemote.addEventListener('click', () => add('http'));

  const remove = (server: AiMcpServer) => {
    state.mcpServers = state.mcpServers.filter(
      (entry) => entry.id !== server.id
    );
    if (keys.get(server.id)?.saved || keyChanged.has(server.id)) {
      void track(deleteAiSecret(mcpKeyProfile(server.id))).catch(console.error);
    }
    keys.delete(server.id);
    keyChanged.delete(server.id);
    keyNeeded.delete(server.id);
    if (editing === server.id) editing = null;
    emit();
    render();
  };

  /** Where the server is, its log and its tools, kept up as they change. */
  const liveView = (server: AiMcpServer) => {
    const root = el('div', 'ny-ai-mcp__live');
    const error = el('p', 'ny-settings__note ny-settings__note--error');
    const log = el('details', 'ny-ai-mcp__log');
    const summary = translated('summary', 'settings.ai.mcp.log');
    const logText = el('pre');
    log.append(summary, logText);
    // Once the user opens or closes the log, it stays as they left it.
    let logTouched = false;
    summary.addEventListener('click', () => {
      logTouched = true;
    });
    const restart = button('settings.ai.mcp.restart');
    restart.addEventListener('click', () => {
      restart.disabled = true;
      void hub
        .restart(server.id)
        .catch(console.error)
        .finally(() => {
          restart.disabled = false;
        });
    });
    const restartLine = el('div', 'ny-ai-actions');
    restartLine.append(restart);
    const tools = el('div', 'ny-ai-mcp__tools');
    let drawnTools = '';
    root.append(error, log, restartLine, tools);

    const drawTools = (status: McpStatus | undefined) => {
      // The tools it offers now, and those allowed before that it may not.
      const offered = new Map<string, string>();
      for (const tool of status?.state === 'ready' ? status.tools : []) {
        offered.set(tool.name, tool.description ?? tool.title ?? '');
      }
      for (const name of server.allowed) {
        if (!offered.has(name)) offered.set(name, '');
      }
      const key = JSON.stringify([[...offered], server.allowed]);
      if (key === drawnTools) return;
      drawnTools = key;
      tools.replaceChildren();
      tools.hidden = offered.size === 0;
      if (offered.size === 0) return;
      tools.append(
        translated('span', 'settings.ai.mcp.tools', 'ny-ai-model-head')
      );
      for (const [name, about] of offered) {
        const item = el('label', 'ny-ai-mcp__tool');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = server.allowed.includes(name);
        check.title = i18next.t('settings.ai.mcp.alwaysAllow');
        check.setAttribute(
          'aria-label',
          `${name}: ${i18next.t('settings.ai.mcp.alwaysAllow')}`
        );
        check.addEventListener('change', () => {
          server.allowed = check.checked
            ? [...new Set([...server.allowed, name])]
            : server.allowed.filter((entry) => entry !== name);
          emit();
        });
        item.append(check, el('span', 'ny-ai-mcp__tool-name', name));
        if (about) {
          const text = el('span', 'ny-ai-mcp__tool-about', about);
          text.title = about;
          item.append(text);
        }
        tools.append(item);
      }
      tools.append(
        translated('p', 'settings.ai.mcp.toolsNote', 'ny-settings__note')
      );
    };

    const update = () => {
      const status = statusOf(server);
      const failure = status?.state === 'failed' ? status.error : null;
      error.hidden = !failure;
      error.textContent = failure ? mcpErrorText(failure) : '';
      const lines = status?.stderr ?? [];
      log.hidden = lines.length === 0;
      const text = lines.join('\n');
      if (logText.textContent !== text) {
        const atEnd =
          logText.scrollTop + logText.clientHeight >= logText.scrollHeight - 4;
        logText.textContent = text;
        if (atEnd) logText.scrollTop = logText.scrollHeight;
      }
      if (!logTouched) log.open = Boolean(failure);
      restartLine.hidden = !status;
      drawTools(status);
    };
    return { root, update };
  };

  const renderServer = (server: AiMcpServer): HTMLElement => {
    const card = el('div', 'ny-ai-provider');
    card.dataset.server = server.id;

    const head = el('div', 'ny-ai-provider__head');
    const title = el('div', 'ny-ai-provider__title');
    const name = el('span', 'ny-ai-provider__name', server.name);
    const meta = el('span', 'ny-ai-provider__meta', metaOf(server));
    title.append(name, meta);
    const status = el('span');
    const switchField = el(
      'label',
      'ny-settings__field ny-settings__field--checkbox ny-ai-mcp__switch'
    );
    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.checked = server.enabled;
    enabled.setAttribute('aria-label', i18next.t('settings.ai.mcp.enabled'));
    enabled.addEventListener('change', () => {
      server.enabled = enabled.checked;
      emit();
      showStatus(server, status);
    });
    switchField.append(enabled);
    const open = editing === server.id;
    const toggle = button(open ? 'settings.ai.done' : 'settings.ai.edit');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', () => {
      editing = open ? null : server.id;
      render();
    });
    const removeButton = button('settings.ai.remove');
    removeButton.addEventListener('click', () => remove(server));
    head.append(title, status, switchField, toggle, removeButton);
    card.append(head);

    if (!open) {
      refreshers.set(server.id, () => showStatus(server, status));
      showStatus(server, status);
      return card;
    }

    const body = el('div', 'ny-ai-provider__body');
    card.append(body);
    const changed = () => {
      meta.textContent = metaOf(server);
      emit();
      showStatus(server, status);
    };

    // Name and kind.
    const nameInput = input('text');
    nameInput.value = server.name;
    nameInput.addEventListener('change', () => {
      server.name = nameInput.value.trim() || server.name;
      nameInput.value = server.name;
      name.textContent = server.name;
      changed();
    });
    const kind = el('div', 'ny-settings__select');
    renderSelect(
      kind,
      [
        {
          value: 'stdio',
          label: 'Local program',
          i18n: 'settings.ai.mcp.stdio',
        },
        { value: 'http', label: 'Web service', i18n: 'settings.ai.mcp.http' },
      ],
      server.transport,
      (value) => {
        server.transport = value === 'http' ? 'http' : 'stdio';
        changed();
        render();
      }
    );
    body.append(
      row(
        field('settings.ai.name', nameInput),
        field('settings.ai.mcp.kind', kind)
      )
    );

    let keyNote: HTMLElement | null = null;
    let keyInput: HTMLInputElement | null = null;
    if (server.transport === 'stdio') {
      const command = input('text');
      command.dataset.key = 'command';
      command.value = server.command;
      command.placeholder = 'npx';
      command.addEventListener('change', () => {
        server.command = command.value.trim();
        command.value = server.command;
        changed();
      });
      const args = textarea(3);
      args.value = server.args.join('\n');
      args.placeholder = '-y\n@modelcontextprotocol/server-everything';
      args.addEventListener('change', () => {
        server.args = parseLines(args.value);
        changed();
      });
      const env = textarea(2);
      env.value = formatPairs(server.env, '=');
      env.placeholder = 'NAME=value';
      env.addEventListener('change', () => {
        server.env = parsePairs(env.value, '=');
        changed();
      });
      const cwd = input('text');
      cwd.value = server.cwd;
      cwd.placeholder = i18next.t('settings.ai.mcp.cwdPlaceholder');
      cwd.addEventListener('change', () => {
        server.cwd = cwd.value.trim();
        cwd.value = server.cwd;
        changed();
      });
      body.append(
        row(field('settings.ai.mcp.command', command)),
        row(
          field(
            'settings.ai.mcp.args',
            args,
            translated('p', 'settings.ai.mcp.argsNote', 'ny-settings__note')
          )
        ),
        row(
          field(
            'settings.ai.mcp.env',
            env,
            translated('p', 'settings.ai.mcp.envNote', 'ny-settings__note')
          )
        ),
        row(field('settings.ai.mcp.cwd', cwd))
      );
    } else {
      const url = input('text');
      url.dataset.key = 'url';
      url.value = server.url;
      url.placeholder = 'https://example.com/mcp';
      const urlNote = el('p', 'ny-settings__note ny-settings__note--error');
      urlNote.hidden = true;
      url.addEventListener('change', () => {
        server.url = url.value.trim();
        url.value = server.url;
        changed();
        const bad = server.url !== '' && !isUrl(server.url);
        urlNote.hidden = !bad;
        urlNote.textContent = bad ? i18next.t('settings.ai.badUrl') : '';
        if (!bad && server.useKey && keys.get(server.id)?.saved) {
          void bindKey(server, null).catch(console.error);
        }
      });
      const headers = textarea(2);
      headers.value = formatPairs(server.headers, ':');
      headers.placeholder = 'Name: value';
      headers.addEventListener('change', () => {
        server.headers = parsePairs(headers.value, ':');
        changed();
      });

      const useKey = el('input');
      useKey.type = 'checkbox';
      useKey.checked = server.useKey;
      const useKeyField = el(
        'label',
        'ny-settings__field ny-settings__field--checkbox'
      );
      useKeyField.append(useKey, translated('span', 'settings.ai.mcp.useKey'));
      const key = input('password');
      keyInput = key;
      const keyField = field('settings.ai.key', key);
      keyNote = el('p', 'ny-settings__note ny-settings__note--warn');
      keyNote.hidden = true;
      keyField.append(keyNote);
      keyField.hidden = !server.useKey;
      useKey.addEventListener('change', () => {
        server.useKey = useKey.checked;
        keyField.hidden = !server.useKey;
        changed();
      });
      key.addEventListener('change', () => {
        const typed = key.value.trim();
        if (!typed) return;
        if (!isUrl(server.url)) {
          urlNote.hidden = false;
          urlNote.textContent = i18next.t('settings.ai.badUrl');
          return;
        }
        key.value = '';
        void bindKey(server, typed).catch((error) => {
          if (keyNote) {
            keyNote.hidden = false;
            keyNote.textContent = failureText(error);
          }
        });
      });
      body.append(
        row(field('settings.ai.mcp.url', url, urlNote)),
        row(
          field(
            'settings.ai.mcp.headers',
            headers,
            translated('p', 'settings.ai.mcp.headersNote', 'ny-settings__note')
          )
        ),
        row(useKeyField),
        row(keyField)
      );
    }

    const live = liveView(server);
    body.append(row(live.root));
    refreshers.set(server.id, () => {
      showStatus(server, status);
      live.update();
      if (keyInput) {
        const saved = keys.get(server.id);
        keyInput.placeholder =
          saved?.hasKey && !keyNeeded.has(server.id)
            ? i18next.t('settings.ai.keySaved', { hint: saved.hint ?? '' })
            : i18next.t('settings.ai.keyPlaceholder');
      }
      if (keyNote && keyNeeded.has(server.id)) {
        keyNote.hidden = false;
        keyNote.textContent = i18next.t('settings.ai.keyNeeded');
      }
    });
    refreshers.get(server.id)?.();
    return card;
  };

  const render = () => {
    refreshers.clear();
    list.replaceChildren(...state.mcpServers.map(renderServer));
    if (state.mcpServers.length === 0) {
      list.append(
        translated('p', 'settings.ai.mcp.empty', 'ny-settings__note')
      );
    }
    translateDOM(list);
  };

  render();

  // What is saved of each server's key, staged changes included.
  for (const server of state.mcpServers) {
    if (server.transport !== 'http') continue;
    void getAiSecretStatus(mcpKeyProfile(server.id))
      .then((status) => {
        keys.set(server.id, status);
        refreshers.get(server.id)?.();
      })
      .catch(console.error);
  }

  const unsubscribe = hub.subscribe(() => {
    for (const refresh of refreshers.values()) refresh();
  });
  const unwatch = hub.watch();
  void hub.refresh().catch(console.error);

  return {
    element: section,
    committed: () => {
      for (const id of keyChanged) {
        void hub.restart(id).catch(() => undefined);
      }
      keyChanged.clear();
    },
    destroy: () => {
      unsubscribe();
      unwatch();
    },
  };
}
