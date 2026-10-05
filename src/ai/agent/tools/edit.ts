/**
 * The tools the assistant edits the open document with. Each edit is made
 * on the document as the assistant reads it, its pending proposals in it,
 * and becomes proposals the user accepts or rejects in the document (or is
 * applied at once, as the settings say).
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { EditController } from '../../edit/controller';
import type { EditReport } from '../../edit/report';
import {
  EditError,
  type TextEdit,
  insertAfterLine,
  replaceText,
  rewriteText,
} from '../../edit/text-edit';

export type EditToolOutput = EditReport;

const SHOWN =
  'The change is shown to the user in the document to accept or reject, unless they chose to have edits applied right away; until they decide, the document you read has it in. The result gives the changed lines as the document now has them.';

async function run(
  controller: EditController,
  make: (text: string) => TextEdit
): Promise<EditToolOutput> {
  try {
    const { report, notices } = await controller.edit(make);
    return notices
      ? { ...report, text: `${notices}\n\n${report.text}` }
      : report;
  } catch (error) {
    if (error instanceof EditError) {
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}

export function editTools(controller: EditController) {
  return {
    edit_document: tool({
      description: `Replace text in the open document. old_string has to match the document's Markdown exactly, as a read shows it but without the line numbers, and be found once unless replace_all is set. Give just enough of the text around a change to find it once; to change several places, call this once for each. ${SHOWN}`,
      inputSchema: z.object({
        old_string: z
          .string()
          .min(1)
          .describe('The text to replace, exactly as it is in the document.'),
        new_string: z
          .string()
          .describe('The text to put in its place; empty to delete it.'),
        replace_all: z
          .boolean()
          .optional()
          .describe('Replace every place old_string is found. Off by default.'),
      }),
      execute: ({ old_string, new_string, replace_all }) =>
        run(controller, (text) =>
          replaceText(text, old_string, new_string, replace_all)
        ),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    insert_text: tool({
      description: `Put new Markdown into the open document after a line, as blocks of its own: paragraphs, headings, lists, tables and so on. A blank line is added either side where there is none. ${SHOWN}`,
      inputSchema: z.object({
        after_line: z
          .number()
          .int()
          .min(0)
          .describe(
            'The line to put it after, as a read numbers the lines; 0 puts it at the top.'
          ),
        text: z.string().min(1).describe('The Markdown to put in.'),
      }),
      execute: ({ after_line, text }) =>
        run(controller, (current) =>
          insertAfterLine(current, after_line, text)
        ),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    write_document: tool({
      description: `Write the whole open document anew: a first draft in an empty document, or a rewrite of most of it. For changes to some of it, use edit_document, which the user can review piece by piece. ${SHOWN}`,
      inputSchema: z.object({
        text: z.string().describe('The whole document, as Markdown.'),
      }),
      execute: ({ text }) =>
        run(controller, (current) => rewriteText(current, text)),
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),
  };
}
