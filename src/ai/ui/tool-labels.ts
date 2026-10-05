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

/** What a tool call did, in a line of the reply. */
export function toolLabel(part: ToolPart): string {
  const label = LABELS[part.name];
  if (label) return label(part);
  return i18next.t('ai.tool.generic', { name: part.name });
}
