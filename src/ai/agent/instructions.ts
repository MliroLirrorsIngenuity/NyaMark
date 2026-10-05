/**
 * The system prompt: who the assistant is, the document the user has open,
 * and the instructions the user keeps in the settings.
 */

import {
  type DocumentSnapshot,
  documentLines,
  headings,
  numberedText,
  outlineText,
  readSelection,
} from './document-text';

export type InstructionContext = {
  /** The document's path on disk, `null` while it is unsaved. */
  documentPath: string | null;
  /** What the user wants the assistant always to keep in mind. */
  custom: string;
  /** The document as the turn begins. */
  document?: DocumentSnapshot;
  today?: Date;
};

/** A document up to this long is in the instructions whole. */
export const INLINE_DOCUMENT_CHARS = 24_000;
/** The most headings the instructions list for a longer one. */
const OUTLINE_HEADINGS = 200;
/** The most of a selection the instructions quote. */
const SELECTION_CHARS = 4000;

const ROLE = `You are the writing assistant built into NyaMark, a Markdown editor. You help the user write, revise and think through the document they have open.

- Reply in the language the user writes to you in, unless they ask for another.
- Format replies as Markdown (GitHub flavoured). Write math as $…$ inline and $$…$$ on lines of its own.
- Be direct and concrete. When you suggest wording, give the wording itself.
- When you need a part of the document you have not been shown, read it with the tools rather than guess. When the user says "this", "here" or "the selection", they most likely mean what they have selected.`;

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** What the turn begins knowing of the document's text. */
function documentContext(snapshot: DocumentSnapshot): string {
  const { text } = snapshot;
  const lines = documentLines(text);
  if (lines.length === 0 || !text.trim()) return 'The document is empty.';
  const size = `It has ${lines.length} lines (${text.length} characters).`;
  const parts: string[] = [];
  if (text.length <= INLINE_DOCUMENT_CHARS) {
    parts.push(
      `${size} Here it is as it is now, each line given as its number, a tab, then the line; the number and the tab are not part of the text.\n<document>\n${numberedText(text)}\n</document>`
    );
  } else {
    parts.push(
      `${size} It is too long to show here; read it with the tools. Its outline:\n${outlineText(headings(text), OUTLINE_HEADINGS)}`
    );
  }
  const selection = readSelection(snapshot, SELECTION_CHARS);
  if (selection) {
    const lines =
      selection.from === selection.to
        ? `line ${selection.from}`
        : `lines ${selection.from}–${selection.to}`;
    parts.push(
      `The user has selected text on ${lines}:\n<selection>\n${selection.selected}\n</selection>`
    );
  } else {
    parts.push('Nothing is selected in the document.');
  }
  return parts.join('\n\n');
}

export function buildInstructions(context: InstructionContext): string {
  const sections = [ROLE];
  const document = context.documentPath
    ? `The open document is "${fileName(context.documentPath)}" at ${context.documentPath}.`
    : 'The open document has not been saved yet and has no file name.';
  sections.push(
    `${document}\nToday is ${isoDate(context.today ?? new Date())}.`
  );
  if (context.document) sections.push(documentContext(context.document));
  const custom = context.custom.trim();
  if (custom) {
    sections.push(
      `The user's standing instructions, to follow throughout:\n<user-instructions>\n${custom}\n</user-instructions>`
    );
  }
  return sections.join('\n\n');
}
