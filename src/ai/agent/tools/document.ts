/**
 * The tools the assistant reads the open document with. Each call reads
 * the document as it is at that moment, so edits the user makes while the
 * assistant works are seen by its next read.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  type DocumentSnapshot,
  MAX_READ_LINES,
  headings,
  outlineText,
  readLines,
  readSection,
  readSelection,
  searchLines,
} from '../document-text';

export type DocumentReader = () => Promise<DocumentSnapshot>;
/** What the assistant has yet to be told of the document; null for nothing. */
export type DocumentNotices = () => Promise<string | null>;

const LINE_NOTE =
  'Each line is given as its number, a tab, then the line; the number and the tab are not part of the text.';

export function documentTools(
  read: DocumentReader,
  notices: DocumentNotices = async () => null
) {
  /** What `result` gives, the notices before its text. */
  const told = async <T extends { text: string }>(
    result: (snapshot: DocumentSnapshot) => T
  ) => {
    // Told first: the read is then the assistant's last look.
    const note = await notices();
    const value = result(await read());
    return note ? { ...value, text: `${note}\n\n${value.text}` } : value;
  };
  return {
    read_document: tool({
      description: `Read the open document as Markdown, whole or from a line on. ${LINE_NOTE} A long document is returned in parts; the end of each part says where to read on.`,
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'The line to start at, from 1. Leave out to start at the top.'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_READ_LINES)
          .optional()
          .describe(`The most lines to return, at most ${MAX_READ_LINES}.`),
      }),
      execute: ({ offset, limit }) =>
        told(({ text }) => readLines(text, offset, limit)),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_outline: tool({
      description:
        'List the headings of the open document, each with its level and line number.',
      inputSchema: z.object({}),
      execute: () =>
        told(({ text }) => {
          const list = headings(text);
          return { text: outlineText(list), count: list.length };
        }),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_section: tool({
      description: `Read one section of the open document: a heading and everything under it, down to the next heading of the same level or above. ${LINE_NOTE}`,
      inputSchema: z.object({
        heading: z
          .string()
          .describe("The heading's words, as the outline gives them."),
        line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "The heading's line number, to pick one of several headings with the same words."
          ),
      }),
      execute: ({ heading, line }) =>
        told(({ text }) => readSection(text, heading, line)),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_selection: tool({
      description: `Read what the user has selected in the document: the lines it is on, numbered, and the selected text exactly. ${LINE_NOTE}`,
      inputSchema: z.object({}),
      execute: () =>
        told(
          (snapshot) =>
            readSelection(snapshot) ?? {
              text: 'Nothing is selected in the document.',
              from: 0,
              to: 0,
              selected: '',
            }
        ),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    search_document: tool({
      description: `Find the lines of the open document that hold some text. Returns each line with its number and the number of matches. ${LINE_NOTE}`,
      inputSchema: z.object({
        query: z.string().min(1).describe('The text to look for.'),
        regex: z
          .boolean()
          .optional()
          .describe('Read the query as a JavaScript regular expression.'),
        caseSensitive: z
          .boolean()
          .optional()
          .describe('Match upper and lower case exactly. Off by default.'),
      }),
      execute: ({ query, regex, caseSensitive }) =>
        told(({ text }) => searchLines(text, query, { regex, caseSensitive })),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),
  };
}
