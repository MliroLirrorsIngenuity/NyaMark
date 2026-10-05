import { describe, expect, test } from 'bun:test';
import { type ApprovalRequest, Approvals } from '../src/ai/agent/approvals';
import type { ToolPart } from '../src/ai/agent/session';
import {
  type FetchOutput,
  type WebApi,
  type WebSearchOutput,
  webTools,
} from '../src/ai/agent/tools/web';
import { searchSources } from '../src/ai/ui/tool-labels';
import type { WebPage, WebSearchResult } from '../src/bridge/ipc/ai';
import type { AiSearchSettings } from '../src/state/ai-settings';

type Tool = {
  execute?: (input: never, options: never) => unknown;
};

const run = <T>(tool: Tool, input: object, signal?: AbortSignal) =>
  tool.execute?.(
    input as never,
    {
      toolCallId: 'call-1',
      messages: [],
      abortSignal: signal ?? new AbortController().signal,
    } as never
  ) as Promise<T>;

const page = (url: string, text: string, extra: Partial<WebPage> = {}) =>
  ({
    url,
    status: 200,
    contentType: 'text/plain',
    text,
    truncated: false,
    ...extra,
  }) satisfies WebPage;

/** The web tools on a fake app, with the user answering each question. */
function setup(
  options: {
    results?: WebSearchResult[];
    engine?: string;
    searchError?: string;
    pages?: Record<string, WebPage>;
    /** Hosts the app refuses until the user allows them. */
    privateHosts?: string[];
    answer?: 'allow' | 'deny' | null;
    search?: AiSearchSettings;
  } = {}
) {
  const searches: Parameters<WebApi['search']>[0][] = [];
  const fetches: Parameters<WebApi['fetch']>[0][] = [];
  const api: WebApi = {
    search: async (request) => {
      searches.push(request);
      if (options.searchError) throw options.searchError;
      return {
        engine: (options.engine ?? 'bing') as never,
        results: options.results ?? [],
      };
    },
    fetch: async (request) => {
      fetches.push(request);
      const host = new URL(request.url).hostname;
      if (options.privateHosts?.includes(host) && !request.allowPrivate) {
        throw `private-address: ${host}`;
      }
      const found = options.pages?.[request.url];
      if (!found) throw 'timeout: no answer in 15 s';
      return found;
    },
  };
  const approvals = new Approvals();
  const asked: ApprovalRequest[] = [];
  approvals.subscribe(() => {
    const request = approvals.request('call-1');
    if (!request || asked.includes(request)) return;
    asked.push(request);
    const answer = options.answer === undefined ? 'allow' : options.answer;
    if (answer) queueMicrotask(() => approvals.answer('call-1', answer));
  });
  let search: AiSearchSettings = options.search ?? {
    engine: 'auto',
    searxngUrl: '',
    native: false,
  };
  const tools = webTools({
    api,
    approvals,
    settings: () => ({ search, proxy: { mode: 'system' } }),
    read: (fetched) => ({
      title: fetched.url.endsWith('/titled') ? 'A "Titled" <page>' : '',
      text: fetched.text,
    }),
  });
  return {
    tools,
    approvals,
    asked,
    searches,
    fetches,
    setSearch: (next: AiSearchSettings) => {
      search = next;
    },
  };
}

const RESULTS: WebSearchResult[] = [
  {
    title: 'Markdown Guide',
    url: 'https://www.markdownguide.org/',
    snippet: 'A free reference.',
  },
  { title: '', url: 'https://commonmark.org/help/', snippet: '' },
];

describe('web_search', () => {
  test('numbers the results and names the engine', async () => {
    const { tools, searches } = setup({ results: RESULTS });
    const output = await run<WebSearchOutput>(tools.web_search, {
      query: 'markdown',
      limit: 5,
    });
    expect(output.text).toBe(
      'Results for “markdown” from Bing:\n\n' +
        '1. Markdown Guide\n   https://www.markdownguide.org/\n   A free reference.\n\n' +
        '2. commonmark.org\n   https://commonmark.org/help/'
    );
    expect(output.count).toBe(2);
    expect(output.engine).toBe('bing');
    expect(searches).toEqual([
      {
        query: 'markdown',
        engine: 'auto',
        searxngUrl: undefined,
        proxy: { mode: 'system' },
        limit: 5,
      },
    ]);
  });

  test('searches SearXNG at its address, with the settings as they are now', async () => {
    const { tools, searches, setSearch } = setup({ engine: 'searxng' });
    setSearch({
      engine: 'searxng',
      searxngUrl: 'https://searx.example',
      native: false,
    });
    const output = await run<WebSearchOutput>(tools.web_search, {
      query: 'tauri',
    });
    expect(searches[0].engine).toBe('searxng');
    expect(searches[0].searxngUrl).toBe('https://searx.example');
    expect(output.text).toBe(
      'SearXNG found nothing for “tauri”. Try other words.'
    );
  });

  test('explains what went wrong', async () => {
    const failed = setup({ searchError: 'all-engines-failed: bing: captcha' });
    await expect(run(failed.tools.web_search, { query: 'x' })).rejects.toThrow(
      /^all-engines-failed: No search engine answered\..*\(bing: captcha\)$/
    );
    const odd = setup({ searchError: 'something-else: detail' });
    await expect(run(odd.tools.web_search, { query: 'x' })).rejects.toThrow(
      'something-else: detail'
    );
  });
});

describe('fetch_url', () => {
  test('gives the page with its address and title', async () => {
    const url = 'https://example.com/titled';
    const { tools, fetches } = setup({ pages: { [url]: page(url, 'Hello') } });
    const output = await run<FetchOutput>(tools.fetch_url, { url });
    expect(output).toEqual({
      text: `<page url="${url}" title="A  Titled   page ">\nHello\n</page>`,
      url,
      title: 'A "Titled" <page>',
    });
    expect(fetches).toEqual([
      { url, proxy: { mode: 'system' }, allowPrivate: false },
    ]);
  });

  test('reads a long page in parts, fetching it once', async () => {
    const url = 'https://example.com/long';
    const line = `${'x'.repeat(99)}\n`;
    const text = line.repeat(300);
    const { tools, fetches } = setup({ pages: { [url]: page(url, text) } });

    const first = await run<FetchOutput>(tools.fetch_url, { url });
    expect(first.text).toContain('read on with offset 20000.');
    expect(first.text).toContain('(30000 characters in all)');
    // Cut where a line ends.
    expect(first.text.includes(`${line}\n</page>`)).toBe(true);

    const second = await run<FetchOutput>(tools.fetch_url, {
      url,
      offset: 20_000,
    });
    expect(second.text).toStartWith(`<page url="${url}" offset="20000">\n`);
    expect(second.text).not.toContain('read on');
    expect(fetches).toHaveLength(1);

    await expect(run(tools.fetch_url, { url, offset: 30_000 })).rejects.toThrow(
      'The page has 30000 characters; offset 30000 is past its end.'
    );
  });

  test('cuts mid-line when no line ends near the cut', async () => {
    const url = 'https://example.com/one-line';
    const { tools } = setup({
      pages: { [url]: page(url, 'y'.repeat(25_000)) },
    });
    const output = await run<FetchOutput>(tools.fetch_url, { url });
    expect(output.text).toContain('read on with offset 20000.');
  });

  test('says when the page is an error page, empty or cut off', async () => {
    const missing = 'https://example.com/missing';
    const empty = 'https://example.com/empty';
    const cut = 'https://example.com/cut';
    const { tools } = setup({
      pages: {
        [missing]: page(missing, 'Not here', { status: 404 }),
        [empty]: page(empty, ''),
        [cut]: page(cut, 'Start', { truncated: true }),
      },
    });
    const errorPage = await run<FetchOutput>(tools.fetch_url, { url: missing });
    expect(errorPage.text).toContain(
      'The server answered HTTP 404; this is its error page.'
    );
    const nothing = await run<FetchOutput>(tools.fetch_url, { url: empty });
    expect(nothing.text).toContain('The page has no text to read');
    const longer = await run<FetchOutput>(tools.fetch_url, { url: cut });
    expect(longer.text).toContain('its end is cut off');
  });

  test('explains a page that cannot be read', async () => {
    const { tools } = setup();
    await expect(
      run(tools.fetch_url, { url: 'https://example.com/slow' })
    ).rejects.toThrow(
      'timeout: The page took too long to load. (no answer in 15 s)'
    );
  });

  test('reads text as it came by default', async () => {
    const url = 'https://example.com/a.txt';
    const approvals = new Approvals();
    const tools = webTools({
      api: {
        search: async () => ({ engine: 'bing', results: [] }),
        fetch: async () => page(url, '  plain *text*\n'),
      },
      approvals,
      settings: () => ({
        search: { engine: 'auto', searxngUrl: '', native: false },
        proxy: { mode: 'none' },
      }),
    });
    const output = await run<FetchOutput>(tools.fetch_url, { url });
    expect(output.text).toBe(`<page url="${url}">\nplain *text*\n</page>`);
  });
});

describe('pages on the local network', () => {
  const url = 'http://192.168.1.1/status';

  test('open once the user allows them, and the host stays allowed', async () => {
    const other = 'http://192.168.1.1/other';
    const { tools, asked, fetches, approvals } = setup({
      privateHosts: ['192.168.1.1'],
      pages: { [url]: page(url, 'Router'), [other]: page(other, 'More') },
    });
    const output = await run<FetchOutput>(tools.fetch_url, { url });
    expect(output.text).toContain('Router');
    expect(asked).toEqual([{ kind: 'page', url, host: '192.168.1.1' }]);
    expect(fetches.map((request) => request.allowPrivate)).toEqual([
      false,
      true,
    ]);
    expect(approvals.hostAllowed('192.168.1.1')).toBe(true);

    await run<FetchOutput>(tools.fetch_url, { url: other });
    expect(asked).toHaveLength(1);
    expect(fetches.at(-1)?.allowPrivate).toBe(true);

    approvals.reset();
    expect(approvals.hostAllowed('192.168.1.1')).toBe(false);
  });

  test('stay closed when the user says no', async () => {
    const { tools, fetches } = setup({
      privateHosts: ['192.168.1.1'],
      pages: { [url]: page(url, 'Router') },
      answer: 'deny',
    });
    await expect(run(tools.fetch_url, { url })).rejects.toThrow(
      /^denied: The user did not allow opening http:\/\/192\.168\.1\.1\/status/
    );
    await Bun.sleep(0);
    expect(fetches).toHaveLength(1);
  });

  test('stay closed when the turn stops first', async () => {
    const stop = new AbortController();
    const { tools, asked } = setup({
      privateHosts: ['192.168.1.1'],
      pages: { [url]: page(url, 'Router') },
      answer: null,
    });
    const reading = run(tools.fetch_url, { url }, stop.signal);
    await Bun.sleep(0);
    expect(asked).toHaveLength(1);
    stop.abort();
    await expect(reading).rejects.toThrow(/^denied:/);
  });
});

describe('the pages a web search found', () => {
  const part = (output: unknown, name = 'web_search'): ToolPart => ({
    type: 'tool',
    id: 'call-1',
    name,
    input: { query: 'markdown' },
    state: 'done',
    output,
  });

  test('come from our search, and from the services’ own', () => {
    expect(searchSources(part({ results: RESULTS }))).toEqual([
      { title: 'Markdown Guide', url: 'https://www.markdownguide.org/' },
      { title: '', url: 'https://commonmark.org/help/' },
    ]);
    // Anthropic's search gives a list of results.
    expect(
      searchSources(
        part([
          {
            type: 'web_search_result',
            url: 'https://example.com/a',
            title: 'A',
            encryptedContent: '…',
          },
        ])
      )
    ).toEqual([{ title: 'A', url: 'https://example.com/a' }]);
    // OpenAI's gives its sources.
    expect(
      searchSources(
        part({
          action: { type: 'search', query: 'markdown' },
          sources: [{ type: 'url', url: 'https://example.com/b' }],
        })
      )
    ).toEqual([{ title: '', url: 'https://example.com/b' }]);
  });

  test('are only web addresses, from web searches', () => {
    expect(
      searchSources(
        part({
          results: [
            { title: 'x', url: 'javascript:alert(1)' },
            { title: 'y', url: 'file:///etc/passwd' },
            { title: 'z' },
          ],
        })
      )
    ).toEqual([]);
    expect(searchSources(part({ results: RESULTS }, 'fetch_url'))).toEqual([]);
  });
});
