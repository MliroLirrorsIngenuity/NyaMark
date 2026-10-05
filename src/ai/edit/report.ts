/**
 * What the assistant is told of its edits and of what became of them: the
 * lines an edit left as they now read, and, since it last looked, which of
 * its changes the user took or turned down and where the text changed.
 */

import { textChange } from '../../editor/doc-diff';
import type { HunkEvent } from '../../editor/plugins/ai-proposals';
import { documentLines, lineAt } from '../agent/document-text';

/** Lines shown either side of what an edit changed. */
const CONTEXT_LINES = 2;
/** The most lines a report shows of what an edit changed. */
const MAX_SHOWN_LINES = 60;

export type EditStatus = 'proposed' | 'applied';

export type EditReport = {
  status: EditStatus;
  /** The edit's id, as the panel and later notices name it. */
  edit: string;
  changes: number;
  /** The lines the report shows, in the text after the edit. */
  from: number;
  to: number;
  text: string;
};

const plural = (count: number, one: string, other = `${one}s`) =>
  `${count} ${count === 1 ? one : other}`;

/** The lines `first`..`last` of `text`, numbered as reads number them. */
function shownLines(text: string, first: number, last: number) {
  const lines = documentLines(text);
  const width = String(lines.length).length;
  const end = Math.min(last, first + MAX_SHOWN_LINES - 1);
  const out: string[] = [];
  for (let number = first; number <= end; number++) {
    out.push(`${String(number).padStart(width)}\t${lines[number - 1] ?? ''}`);
  }
  if (end < last) {
    out.push(
      `… ${last - end} more changed lines; read on with offset ${end + 1}.`
    );
  }
  return out.join('\n');
}

/** The lines of `after` that differ from `before`, with some around them. */
export function changedLines(before: string, after: string) {
  const change = textChange(before, after);
  const total = documentLines(after).length;
  if (total === 0) return null;
  const first = lineAt(after, change.from);
  const last = Math.max(
    first,
    lineAt(after, change.from + Math.max(0, change.insert.length - 1))
  );
  return {
    from: Math.max(1, first - CONTEXT_LINES),
    to: Math.min(total, last + CONTEXT_LINES),
  };
}

export function editReport(options: {
  status: EditStatus;
  edit: string;
  changes: number;
  /** Earlier proposals the edit took the place of. */
  withdrawn: number;
  /** The text the edit was made on, its result, and what it was meant to be. */
  before: string;
  after: string;
  intended: string;
}): EditReport {
  const { status, edit, changes, withdrawn, before, after, intended } = options;
  const replacing = withdrawn
    ? ` in place of ${plural(withdrawn, 'earlier proposed change')}`
    : '';
  const parts = [
    changes === 0
      ? `Edit ${edit} takes back ${plural(withdrawn, 'proposed change')}; that text is as it was before them.`
      : status === 'proposed'
        ? `Edit ${edit} is proposed: ${plural(changes, 'change')}${replacing}, shown in the document for the user to accept or reject. Until they do, your reads and edits see the document with them in it.`
        : `Edit ${edit} is made: ${plural(changes, 'change')} to the document${replacing}.`,
  ];
  const lines = changedLines(before, after);
  if (lines) {
    parts.push(
      `Lines ${lines.from}–${lines.to} now read:\n${shownLines(after, lines.from, lines.to)}`
    );
  } else {
    parts.push('The document is now empty.');
  }
  if (after !== intended) {
    parts.push(
      'The editor writes Markdown its own way (list markers, escapes, spacing), so some of this text reads differently from how you gave it. The lines above are as the document holds them; copy from them in later edits.'
    );
  }
  return {
    status,
    edit,
    changes,
    from: lines?.from ?? 0,
    to: lines?.to ?? 0,
    text: parts.join('\n\n'),
  };
}

const OUTCOMES: Record<string, (count: number, edit: string) => string> = {
  accepted: (count, edit) =>
    `The user accepted ${plural(count, 'change')} of edit ${edit}.`,
  rejected: (count, edit) =>
    `The user rejected ${plural(count, 'change')} of edit ${edit}; that text is as it was before the edit.`,
  restored: (count, edit) =>
    `The user undid accepting ${plural(count, 'change')} of edit ${edit}; they are proposed again.`,
  'conflict:edited': (count, edit) =>
    `${plural(count, 'change')} of edit ${edit} ${count === 1 ? 'was' : 'were'} dropped: the user changed the text under ${count === 1 ? 'it' : 'them'}.`,
  'conflict:reload': (count, edit) =>
    `${plural(count, 'change')} of edit ${edit} ${count === 1 ? 'was' : 'were'} dropped: the file changed on disk and was read again.`,
  'conflict:invalid': (count, edit) =>
    `${plural(count, 'change')} of edit ${edit} could not be applied and ${count === 1 ? 'was' : 'were'} dropped.`,
};

/**
 * What happened to the assistant's edits, and where the text differs from
 * how it last saw it (`changed`, lines of the text as it is now). Null when
 * there is nothing to tell.
 */
export function noticeText(
  events: readonly HunkEvent[],
  changed: { from: number; to: number } | null
): string | null {
  const counts = new Map<string, { kind: string; edit: string; n: number }>();
  for (const event of events) {
    const kind = event.reason ? `${event.kind}:${event.reason}` : event.kind;
    const key = `${event.hunk.edit}\u0000${kind}`;
    const entry = counts.get(key) ?? { kind, edit: event.hunk.edit, n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  const lines: string[] = [];
  for (const { kind, edit, n } of counts.values()) {
    const say = OUTCOMES[kind];
    if (say) lines.push(`- ${say(n, edit)}`);
  }
  if (changed) {
    const where =
      changed.from === changed.to
        ? `line ${changed.from}`
        : `lines ${changed.from}–${changed.to}`;
    lines.push(
      `- The text differs from how you last saw it around ${where} (as it is now). Read those lines again before editing there.`
    );
  }
  return lines.length
    ? `Since you last looked at the document:\n${lines.join('\n')}`
    : null;
}
