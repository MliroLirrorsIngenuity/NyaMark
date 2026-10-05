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

const LINE_NOTE =
  'Each line is given as its number, a tab, then the line; the number and the tab are not part of the text.';

export function documentTools(read: DocumentReader) {
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
      execute: async ({ offset, limit }) => {
        const { text } = await read();
        return readLines(text, offset, limit);
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_outline: tool({
      description:
        'List the headings of the open document, each with its level and line number.',
      inputSchema: z.object({}),
      execute: async () => {
        const list = headings((await read()).text);
        return { text: outlineText(list), count: list.length };
      },
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
      execute: async ({ heading, line }) =>
        readSection((await read()).text, heading, line),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_selection: tool({
      description: `Read what the user has selected in the document: the lines it is on, numbered, and the selected text exactly. ${LINE_NOTE}`,
      inputSchema: z.object({}),
      execute: async () => {
        const selection = readSelection(await read());
        return (
          selection ?? {
            text: 'Nothing is selected in the document.',
            from: 0,
            to: 0,
            selected: '',
          }
        );
      },
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
      execute: async ({ query, regex, caseSensitive }) =>
        searchLines((await read()).text, query, { regex, caseSensitive }),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),
  };
}
