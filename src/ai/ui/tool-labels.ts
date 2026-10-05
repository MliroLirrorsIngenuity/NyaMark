import { i18next } from '../../i18n';
import type { ToolPart } from '../agent/session';

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

const isDenied = (part: ToolPart) =>
  part.state === 'error' && (part.error ?? '').startsWith('denied:');

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
  if (isDenied(part)) return i18next.t('ai.tool.fileDenied', fileOf(part));
  if (part.state === 'error') {
    return i18next.t('ai.tool.fileFailed', fileOf(part));
  }
  return i18next.t(
    part.state === 'done' ? 'ai.tool.changedFile' : 'ai.tool.changingFile',
    fileOf(part)
  );
};
LABELS.write_file = (part) => {
  if (isDenied(part)) return i18next.t('ai.tool.fileDenied', fileOf(part));
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
  if (part.state === 'error') return i18next.t('ai.tool.noFolder');
  if (part.state !== 'done') return i18next.t('ai.tool.askingFolder');
  return i18next.t('ai.tool.gotFolder', {
    folder: fileName(field<string>(part.output, 'path')),
  });
};

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
  return i18next.t('ai.tool.generic', { name: part.name });
}
