/**
 * The tools the assistant reads and writes the other notes in the
 * document's folder with, and in folders the user gives it. The app keeps
 * them to Markdown and text files inside those folders; each write waits
 * for the user to allow it, shown as the lines it changes. The open
 * document itself is read and edited as the document tools do it, with its
 * unsaved changes and the user's review.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  type InvokeFailure,
  WorkspaceError,
  type WorkspaceFailure,
  type WorkspaceList,
  type WorkspaceMatches,
  type WorkspaceText,
  type WorkspaceWritten,
} from '../../../bridge/ipc/ai';
import type { EditController } from '../../edit/controller';
import { changedLines } from '../../edit/report';
import { EditError, replaceText } from '../../edit/text-edit';
import type { ApprovalAnswer, Approvals } from '../approvals';
import { MAX_READ_LINES, documentLines, readLines } from '../document-text';
import { lineDiff } from '../line-diff';
import type { DocumentReader } from './document';
import { type EditToolOutput, editOpenDocument } from './edit';

/** The app's file commands, as the tools use them. */
export type WorkspaceApi = {
  roots(): Promise<string[]>;
  pickRoot(): Promise<string | null>;
  list(options: { glob?: string; limit?: number }): Promise<WorkspaceList>;
  read(path: string): Promise<WorkspaceText>;
  search(options: {
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    limit?: number;
  }): Promise<WorkspaceMatches>;
  write(options: {
    path: string;
    text: string;
    expectedVersion?: string;
    create?: boolean;
  }): Promise<WorkspaceWritten>;
};

export type WorkspaceHost = {
  api: WorkspaceApi;
  approvals: Approvals;
  /** The open document's path, null while it is unsaved. */
  documentPath(): string | null;
  /** The open document as the assistant reads it. */
  readDocument: DocumentReader;
  edits: EditController;
};

export type FileToolOutput = {
  text: string;
  /** The file as the app found it. */
  path?: string;
  count?: number;
  status?: 'written' | 'created';
};

const NOTE_EXTENSIONS = /\.(md|markdown|mdx|txt)$/i;
/** Lines a write's result shows either side of what it changed. */
const SHOWN_LINES = 40;

type Failure = WorkspaceFailure | InvokeFailure;

/** What each failure of the app's file commands means, for the assistant. */
const EXPLAINED: Record<Failure['kind'], string> = {
  'no-workspace':
    'No folder is open to you: the document has not been saved in one, and the user has given you none. Ask them to save the document, or ask for a folder with request_folder.',
  'outside-workspace':
    'That path is outside the folders you may use, or in a hidden folder. list_files shows what you can reach.',
  'not-found': 'There is no such file. list_files shows what there is.',
  'not-markdown':
    'Only Markdown and text notes (.md, .markdown, .mdx, .txt) can be read and written; that path names a folder or another kind of file.',
  exists:
    'A file of that name is already there. Read it, then change it with edit_file, or give write_file its version to replace it.',
  changed:
    'The file changed on disk since you read it. Read it again before writing it.',
  'too-large': 'The file is too large to read.',
  'not-utf8': 'The file is not UTF-8 text.',
  'read-only': 'The file is read-only.',
  'version-needed':
    'The file is already there. Read it first, then write it with the version the read gave.',
  'empty-query': 'Give some text to look for.',
  'bad-glob': 'That is not a pattern list_files can read.',
  'bad-regex': 'That is not a regular expression search_files can read.',
  io: 'The file could not be read or written.',
  invoke: 'The app could not run the command.',
};

/** A failure told so the assistant can act. */
function explained(failure: Failure): Error {
  const detail =
    'message' in failure ? ` (${failure.message.slice(0, 500)})` : '';
  return new Error(`${failure.kind}: ${EXPLAINED[failure.kind]}${detail}`);
}

/** An error from the app's file commands, told so the assistant can act. */
function failure(error: unknown): Error {
  if (error instanceof WorkspaceError) return explained(error.failure);
  return error instanceof Error ? error : new Error(String(error));
}

async function attempt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw failure(error);
  }
}

const unslash = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
const baseName = (path: string) => unslash(path).split('/').pop() ?? path;

function folderOf(path: string) {
  const clean = unslash(path);
  return clean.slice(0, Math.max(0, clean.lastIndexOf('/')));
}

/**
 * Whether the app's path for a note, `found`, is the open document. The app
 * gives the real path, links resolved; the window keeps the one it opened,
 * so beside the plain match, the name in the first folder counts.
 */
function isOpenDocument(
  found: string,
  documentPath: string | null,
  roots: readonly string[]
) {
  if (!documentPath) return false;
  if (unslash(found) === unslash(documentPath)) return true;
  const root = roots[0];
  if (!root || baseName(folderOf(documentPath)) !== baseName(root)) {
    return false;
  }
  return unslash(found) === `${unslash(root)}/${baseName(documentPath)}`;
}

function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateText(ms: number | null) {
  if (ms == null) return '';
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `, modified ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rootsText(roots: readonly string[], documentPath: string | null) {
  return roots
    .map((root, index) => {
      const own =
        index === 0 &&
        documentPath != null &&
        baseName(folderOf(documentPath)) === baseName(root);
      return `- ${root}${own ? " (the open document's folder)" : ''}`;
    })
    .join('\n');
}

/** The lines a write changed, numbered, with a few around them. */
function writtenLines(before: string, after: string) {
  const range = changedLines(before, after);
  if (!range) return 'The file is now empty.';
  const count = Math.min(SHOWN_LINES, range.to - range.from + 1);
  return `Lines ${range.from}–${range.from + count - 1} now read:\n${readLines(after, range.from, count).text}`;
}

const denied = (what: string) =>
  new Error(`denied: The user did not allow ${what}. Ask them what to do.`);

const allowed = (answer: ApprovalAnswer) => answer !== 'deny';

export function workspaceTools(host: WorkspaceHost) {
  const { api, approvals } = host;

  /** The open document's lines, for a file tool that named it. */
  const readOpen = async (offset?: number, limit?: number) => {
    const { text } = await host.readDocument();
    const read = readLines(text, offset, limit);
    return {
      text: `This is the document open in the editor, read as it is there with its unsaved changes and the changes you proposed. Edit it with the document tools.\n\n${read.text}`,
    };
  };

  return {
    list_files: tool({
      description:
        "List the Markdown and text notes you can read: those in the open document's folder and its subfolders, and in folders the user gave you. Paths are given relative to the first folder when there is one folder, otherwise in full; the other file tools take them as given.",
      inputSchema: z.object({
        glob: z
          .string()
          .optional()
          .describe(
            'Only paths that match this pattern, e.g. "drafts/**" or "*.md".'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe('The most files to list; 500 when left out.'),
      }),
      execute: async ({ glob, limit }): Promise<FileToolOutput> => {
        const roots = await attempt(() => api.roots());
        if (roots.length === 0) throw explained({ kind: 'no-workspace' });
        const list = await attempt(() => api.list({ glob, limit }));
        const documentPath = host.documentPath();
        const lines = list.files.map((file) => {
          const name = roots.length === 1 ? file.relative : file.path;
          const open = isOpenDocument(file.path, documentPath, roots)
            ? ' (open in the editor)'
            : '';
          return `${name} (${sizeText(file.size)}${dateText(file.modified)})${open}`;
        });
        const parts = [
          `Folders you may use:\n${rootsText(roots, documentPath)}`,
        ];
        parts.push(
          lines.length
            ? `${lines.length} file${lines.length === 1 ? '' : 's'}${glob ? ` matching ${glob}` : ''}:\n${lines.join('\n')}`
            : `No notes${glob ? ` match ${glob}` : ' are there'}.`
        );
        if (list.truncated) {
          parts.push(
            'There are more; narrow the list with a glob to see the rest.'
          );
        }
        return { text: parts.join('\n\n'), count: lines.length };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    read_file: tool({
      description: `Read a note from the folders you may use, whole or from a line on. Each line is given as its number, a tab, then the line; the number and the tab are not part of the text. A long note is returned in parts. The result ends with the note's version, which write_file needs to replace it.`,
      inputSchema: z.object({
        path: z.string().min(1).describe('The note, as list_files gives it.'),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('The line to start at, from 1.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_READ_LINES)
          .optional()
          .describe(`The most lines to return, at most ${MAX_READ_LINES}.`),
      }),
      execute: async ({ path, offset, limit }): Promise<FileToolOutput> => {
        const roots = await attempt(() => api.roots());
        const file = await attempt(() => api.read(path));
        if (isOpenDocument(file.path, host.documentPath(), roots)) {
          return { ...(await readOpen(offset, limit)), path: file.path };
        }
        const total = documentLines(file.text).length;
        const read = readLines(file.text, offset, limit);
        return {
          text: `${file.path}, ${total} line${total === 1 ? '' : 's'}:\n${read.text}\n\n(version ${file.version})`,
          path: file.path,
        };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    search_files: tool({
      description:
        'Find the lines that hold some text across the notes you can read. Returns each with its note and line number.',
      inputSchema: z.object({
        query: z.string().min(1).describe('The text to look for.'),
        regex: z
          .boolean()
          .optional()
          .describe('Read the query as a regular expression (Rust syntax).'),
        case_sensitive: z
          .boolean()
          .optional()
          .describe('Match upper and lower case exactly. Off by default.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('The most lines to return; 100 when left out.'),
      }),
      execute: async ({
        query,
        regex,
        case_sensitive,
        limit,
      }): Promise<FileToolOutput> => {
        const roots = await attempt(() => api.roots());
        if (roots.length === 0) throw explained({ kind: 'no-workspace' });
        const found = await attempt(() =>
          api.search({ query, regex, caseSensitive: case_sensitive, limit })
        );
        const lines = found.matches.map((match) => {
          const name = roots.length === 1 ? match.relative : match.path;
          return `${name}:${match.line}\t${match.text}`;
        });
        const parts = [
          lines.length
            ? `${lines.length} line${lines.length === 1 ? '' : 's'} hold “${query}”:\n${lines.join('\n')}`
            : `No note holds “${query}”.`,
        ];
        if (found.truncated) {
          parts.push('There are more; narrow the search to see the rest.');
        }
        if (host.documentPath()) {
          parts.push(
            'The open document is searched as saved on disk; search_document searches it with its unsaved changes.'
          );
        }
        return { text: parts.join('\n\n'), count: lines.length };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    edit_file: tool({
      description:
        'Replace text in a note other than the open document. old_string has to match the note exactly, as read_file shows it but without the line numbers, and be found once unless replace_all is set. The user sees the change and allows it or not before it is written. For the open document, use edit_document.',
      inputSchema: z.object({
        path: z.string().min(1).describe('The note, as list_files gives it.'),
        old_string: z
          .string()
          .min(1)
          .describe('The text to replace, exactly as it is in the note.'),
        new_string: z
          .string()
          .describe('The text to put in its place; empty to delete it.'),
        replace_all: z
          .boolean()
          .optional()
          .describe('Replace every place old_string is found. Off by default.'),
      }),
      execute: async (
        { path, old_string, new_string, replace_all },
        { toolCallId, abortSignal }
      ): Promise<FileToolOutput | EditToolOutput> => {
        const roots = await attempt(() => api.roots());
        const file = await attempt(() => api.read(path));
        if (isOpenDocument(file.path, host.documentPath(), roots)) {
          return await editOpenDocument(host.edits, (text) =>
            replaceText(text, old_string, new_string, replace_all)
          );
        }
        let next: string;
        try {
          next = replaceText(
            file.text,
            old_string,
            new_string,
            replace_all
          ).next;
        } catch (error) {
          if (error instanceof EditError) {
            throw new Error(`${error.code}: ${error.message}`);
          }
          throw error;
        }
        const answer = await approvals.ask(
          toolCallId,
          {
            kind: 'write',
            path: file.path,
            created: false,
            diff: lineDiff(file.text, next),
          },
          abortSignal
        );
        if (!allowed(answer)) throw denied(`this change to ${path}`);
        const written = await attempt(() =>
          api.write({
            path: file.path,
            text: next,
            expectedVersion: file.version,
          })
        );
        return {
          text: `Changed ${written.path}. ${writtenLines(file.text, next)}\n\n(version ${written.version})`,
          path: written.path,
          status: 'written',
        };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    write_file: tool({
      description:
        'Write a note whole: a new one, or one already there in place of all its text (give the version read_file ended with). Folders in its path are made as needed. The user sees the note or the change and allows it or not before it is written. For the open document, use write_document.',
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            'Where the note goes: relative to the first folder, or in full. It has to end in .md, .markdown, .mdx or .txt.'
          ),
        text: z.string().describe('The whole note.'),
        version: z
          .string()
          .optional()
          .describe(
            'The version read_file gave, to replace a note already there.'
          ),
      }),
      execute: async (
        { path, text, version },
        { toolCallId, abortSignal }
      ): Promise<FileToolOutput> => {
        if (!NOTE_EXTENSIONS.test(path))
          throw explained({ kind: 'not-markdown' });
        const roots = await attempt(() => api.roots());
        if (roots.length === 0) throw explained({ kind: 'no-workspace' });
        let current: WorkspaceText | null = null;
        try {
          current = await api.read(path);
        } catch (error) {
          const missing =
            error instanceof WorkspaceError &&
            error.failure.kind === 'not-found';
          if (!missing) throw failure(error);
        }
        if (current) {
          if (isOpenDocument(current.path, host.documentPath(), roots)) {
            throw new Error(
              'open-document: This is the document open in the editor; write it with write_document.'
            );
          }
          if (!version) throw explained({ kind: 'exists' });
          if (version !== current.version) throw explained({ kind: 'changed' });
        }
        const answer = await approvals.ask(
          toolCallId,
          {
            kind: 'write',
            path: current?.path ?? path,
            created: !current,
            diff: lineDiff(current?.text ?? '', text),
          },
          abortSignal
        );
        if (!allowed(answer)) {
          throw denied(current ? `replacing ${path}` : `creating ${path}`);
        }
        const written = await attempt(() =>
          api.write(
            current
              ? { path: current.path, text, expectedVersion: current.version }
              : { path, text, create: true }
          )
        );
        return {
          text: `${current ? 'Replaced' : 'Created'} ${written.path}. (version ${written.version})`,
          path: written.path,
          status: current ? 'written' : 'created',
        };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),

    request_folder: tool({
      description:
        "Ask the user to give you another folder of notes to read and write, as when they mention notes outside the document's folder, or the document is not saved in one. They choose the folder themselves, or decline.",
      inputSchema: z.object({
        reason: z
          .string()
          .min(1)
          .describe('Why you need it, in a sentence the user will see.'),
      }),
      execute: async (
        { reason },
        { toolCallId, abortSignal }
      ): Promise<FileToolOutput> => {
        const answer = await approvals.ask(
          toolCallId,
          { kind: 'folder', reason },
          abortSignal
        );
        if (!allowed(answer)) throw denied('reaching another folder');
        const folder = await attempt(() => api.pickRoot());
        if (!folder) {
          throw new Error(
            'denied: The user closed the folder picker without choosing a folder.'
          );
        }
        return {
          text: `The user gave you ${folder}. The file tools reach its notes now.`,
          path: folder,
        };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),
  };
}
