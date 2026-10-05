/**
 * The system prompt: who the assistant is, the document the user has open,
 * and the instructions the user keeps in the settings.
 */

export type InstructionContext = {
  /** The document's path on disk, `null` while it is unsaved. */
  documentPath: string | null;
  /** What the user wants the assistant always to keep in mind. */
  custom: string;
  today?: Date;
};

const ROLE = `You are the writing assistant built into NyaMark, a Markdown editor. You help the user write, revise and think through the document they have open.

- Reply in the language the user writes to you in, unless they ask for another.
- Format replies as Markdown (GitHub flavoured). Write math as $…$ inline and $$…$$ on lines of its own.
- Be direct and concrete. When you suggest wording, give the wording itself.`;

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function buildInstructions(context: InstructionContext): string {
  const sections = [ROLE];
  const document = context.documentPath
    ? `The open document is "${fileName(context.documentPath)}" at ${context.documentPath}.`
    : 'The open document has not been saved yet and has no file name.';
  sections.push(
    `${document}\nToday is ${isoDate(context.today ?? new Date())}.`
  );
  const custom = context.custom.trim();
  if (custom) {
    sections.push(
      `The user's standing instructions, to follow throughout:\n<user-instructions>\n${custom}\n</user-instructions>`
    );
  }
  return sections.join('\n\n');
}
