import { i18next } from '../../i18n';
import type { ToolPart } from '../agent/session';
import { isMcpToolName } from '../agent/tools/mcp';

/** A field of a tool's input or output, when it has that field. */
function field<T>(value: unknown, key: string): T | undefined {
  if (value == null || typeof value !== 'object') return undefined;
  return (value as Record<string, T | undefined>)[key];
}

type Labeller = (part: ToolPart) => string;

const LABELS: Record<string, Labeller> = {
  read_document: (part) => {
    const from = field<number>(part.output, 'from');
    const to = field<number>(part.output, 'to');
    const total = field<number>(part.output, 'total') ?? 0;
    if (part.state !== 'done' || from == null || to == null) {
      return i18next.t('ai.tool.readDocument');
    }
    if (from <= 1 && to >= total) return i18next.t('ai.tool.readDocumentAll');
    return i18next.t('ai.tool.readLines', { from, to });
  },
  read_outline: () => i18next.t('ai.tool.readOutline'),
  read_section: (part) => {
    const found = field<{ text?: string }>(part.output, 'heading')?.text;
    const heading = found ?? field<string>(part.input, 'heading') ?? '';
    return i18next.t('ai.tool.readSection', { heading });
  },
  read_selection: () => i18next.t('ai.tool.readSelection'),
  search_document: (part) => {
    const query = field<string>(part.input, 'query') ?? '';
    const count = field<number>(part.output, 'count');
    return part.state === 'done' && count != null
      ? i18next.t('ai.tool.searchFound', { query, count })
      : i18next.t('ai.tool.search', { query });
  },
};

/** An edit tool's line: what it is doing, or what it did. */
function editLabel(running: string): Labeller {
  return (part) => {
    if (part.state === 'error') return i18next.t('ai.tool.editFailed');
    if (part.state !== 'done') return i18next.t(running);
    const count = field<number>(part.output, 'changes') ?? 0;
    if (count === 0) return i18next.t('ai.tool.withdrew');
    return i18next.t(
      field<string>(part.output, 'status') === 'applied'
        ? 'ai.tool.applied'
        : 'ai.tool.proposed',
      { count }
    );
  };
}

LABELS.edit_document = editLabel('ai.tool.editing');
LABELS.insert_text = editLabel('ai.tool.inserting');
LABELS.write_document = editLabel('ai.tool.writing');

const fileName = (path: string | undefined) =>
  (path ?? '').split(/[\\/]/).pop() || (path ?? '');

/** The note a file tool named, as the line shows it. */
const fileOf = (part: ToolPart) => ({
  file: fileName(field<string>(part.input, 'path')),
});

LABELS.list_files = (part) => {
  const count = field<number>(part.output, 'count');
  return part.state === 'done' && count != null
    ? i18next.t('ai.tool.listedFiles', { count })
    : i18next.t('ai.tool.listFiles');
};
LABELS.read_file = (part) =>
  i18next.t(
    part.state === 'done' ? 'ai.tool.readFile' : 'ai.tool.readingFile',
    fileOf(part)
  );
LABELS.search_files = (part) => {
  const query = field<string>(part.input, 'query') ?? '';
  const count = field<number>(part.output, 'count');
  return part.state === 'done' && count != null
    ? i18next.t('ai.tool.searchedFiles', { query, count })
    : i18next.t('ai.tool.searchFiles', { query });
};
LABELS.edit_file = (part) => {
  // On the open document it is an edit like the others.
  if (field<string>(part.output, 'edit')) {
    return editLabel('ai.tool.editing')(part);
  }
  if (part.state === 'denied')
    return i18next.t('ai.tool.fileDenied', fileOf(part));
  if (part.state === 'error') {
    return i18next.t('ai.tool.fileFailed', fileOf(part));
  }
  return i18next.t(
    part.state === 'done' ? 'ai.tool.changedFile' : 'ai.tool.changingFile',
    fileOf(part)
  );
};
LABELS.write_file = (part) => {
  if (part.state === 'denied')
    return i18next.t('ai.tool.fileDenied', fileOf(part));
  if (part.state === 'error') {
    return i18next.t('ai.tool.fileFailed', fileOf(part));
  }
  if (part.state !== 'done') {
    return i18next.t('ai.tool.writingFile', fileOf(part));
  }
  return i18next.t(
    field<string>(part.output, 'status') === 'created'
      ? 'ai.tool.createdFile'
      : 'ai.tool.replacedFile',
    fileOf(part)
  );
};
LABELS.request_folder = (part) => {
  if (part.state === 'error' || part.state === 'denied') {
    return i18next.t('ai.tool.noFolder');
  }
  if (part.state !== 'done') return i18next.t('ai.tool.askingFolder');
  return i18next.t('ai.tool.gotFolder', {
    folder: fileName(field<string>(part.output, 'path')),
  });
};

/** What a web search looked for: ours and Anthropic's give a query, OpenAI's its action. */
function searchQuery(part: ToolPart): string {
  const query = field<string>(part.input, 'query');
  if (typeof query === 'string') return query;
  const action = field<unknown>(part.output, 'action');
  const asked = field<string>(action, 'query');
  if (typeof asked === 'string') return asked;
  const queries = field<unknown[]>(action, 'queries');
  return Array.isArray(queries) && typeof queries[0] === 'string'
    ? queries[0]
    : '';
}

export type Source = { title: string; url: string };

/**
 * The pages a web search found: the results of ours, or of the service's
 * own search, which gives them as a list (Anthropic) or as sources (OpenAI).
 */
export function searchSources(part: ToolPart): Source[] {
  if (part.name !== 'web_search') return [];
  const output = part.output;
  const list = Array.isArray(output)
    ? output
    : (field<unknown[]>(output, 'results') ??
      field<unknown[]>(output, 'sources'));
  const sources: Source[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const url = field<string>(entry, 'url');
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const title = field<string>(entry, 'title');
    sources.push({ url, title: typeof title === 'string' ? title : '' });
  }
  return sources;
}

function siteOf(url: string | undefined) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

LABELS.web_search = (part) => {
  const query = searchQuery(part);
  if (part.state === 'error') return i18next.t('ai.tool.webSearchFailed');
  if (part.state !== 'done') {
    return query
      ? i18next.t('ai.tool.webSearchingFor', { query })
      : i18next.t('ai.tool.webSearching');
  }
  if (!query) return i18next.t('ai.tool.webSearched');
  return i18next.t('ai.tool.webSearchedFor', {
    query,
    count: searchSources(part).length,
  });
};
LABELS.fetch_url = (part) => {
  const site = siteOf(
    field<string>(part.output, 'url') ?? field<string>(part.input, 'url')
  );
  if (part.state === 'denied') return i18next.t('ai.tool.pageDenied', { site });
  if (part.state === 'error') return i18next.t('ai.tool.pageFailed', { site });
  if (part.state !== 'done') return i18next.t('ai.tool.fetchingPage', { site });
  const title = field<string>(part.output, 'title');
  return title
    ? i18next.t('ai.tool.fetchedTitledPage', { title, site })
    : i18next.t('ai.tool.fetchedPage', { site });
};

LABELS.view_image = (part) => {
  const src = field<string>(part.input, 'src') ?? '';
  const image = /^data:/i.test(src)
    ? i18next.t('ai.image.embedded')
    : fileName(src);
  if (part.state === 'error') {
    return i18next.t('ai.tool.imageFailed', { image });
  }
  if (part.state !== 'done') {
    return i18next.t('ai.tool.viewingImage', { image });
  }
  return i18next.t('ai.tool.viewedImage', { image });
};

/**
 * An MCP tool's line, by the names the server and tool have; until it
 * returns, by the name the assistant called it.
 */
function mcpLabel(part: ToolPart): string {
  const [, server = '', ...rest] = part.name.split('__');
  const names = {
    server: field<string>(part.output, 'server') ?? server,
    tool: field<string>(part.output, 'tool') ?? (rest.join('__') || part.name),
  };
  if (part.state === 'denied') return i18next.t('ai.tool.mcpDenied', names);
  if (part.state === 'error') return i18next.t('ai.tool.mcpFailed', names);
  if (part.state !== 'done') return i18next.t('ai.tool.mcpRunning', names);
  return i18next.t('ai.tool.mcpUsed', names);
}

/** The edit a tool call proposed, while it is the user's to accept. */
export function proposedEdit(part: ToolPart): string | null {
  if (part.state !== 'done' || !LABELS[part.name]) return null;
  if (field<string>(part.output, 'status') !== 'proposed') return null;
  if (!field<number>(part.output, 'changes')) return null;
  return field<string>(part.output, 'edit') ?? null;
}

/** What a tool call did, in a line of the reply. */
export function toolLabel(part: ToolPart): string {
  const label = LABELS[part.name];
  if (label) return label(part);
  if (isMcpToolName(part.name)) return mcpLabel(part);
  return i18next.t('ai.tool.generic', { name: part.name });
}
