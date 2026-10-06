import { describe, expect, test } from 'bun:test';
import {
  type ApprovalAnswer,
  type ApprovalRequest,
  Approvals,
} from '../src/ai/agent/approvals';
import {
  type FileToolOutput,
  type WorkspaceApi,
  workspaceTools,
} from '../src/ai/agent/tools/workspace';
import type { EditController } from '../src/ai/edit/controller';
import type { TextEdit } from '../src/ai/edit/text-edit';
import { WorkspaceError, type WorkspaceText } from '../src/bridge/ipc/ai';

const ROOT = '/notes';
const OPEN = `${ROOT}/open.md`;

type Note = { text: string; version: string };

/** The app's file commands over notes kept in memory, failing as it does. */
function fakeApi(notes: Record<string, string>, roots = [ROOT]) {
  const files = new Map<string, Note>();
  let versions = 0;
  const stamp = () => `v${++versions}`;
  for (const [path, text] of Object.entries(notes)) {
    files.set(path, { text, version: stamp() });
  }
  const full = (path: string) =>
    path.startsWith('/') ? path : `${roots[0]}/${path}`;
  const writes: Parameters<WorkspaceApi['write']>[0][] = [];
  let picked: string | null = null;
  const api: WorkspaceApi = {
    roots: async () => [...roots],
    pickRoot: async () => {
      if (picked) roots.push(picked);
      return picked;
    },
    list: async () => ({
      files: [...files.keys()].map((path) => ({
        path,
        relative: path.slice(roots[0].length + 1),
        size: files.get(path)?.text.length ?? 0,
        modified: null,
      })),
      truncated: false,
    }),
    read: async (path) => {
      const found = files.get(full(path));
      if (!found) throw new WorkspaceError({ kind: 'not-found' });
      return { path: full(path), ...found } satisfies WorkspaceText;
    },
    search: async ({ query }) => ({
      matches: [...files].flatMap(([path, note]) =>
        note.text.split('\n').flatMap((text, index) =>
          text.includes(query)
            ? [
                {
                  path,
                  relative: path.slice(roots[0].length + 1),
                  line: index + 1,
                  text,
                },
              ]
            : []
        )
      ),
      truncated: false,
    }),
    write: async (options) => {
      writes.push(options);
      const path = full(options.path);
      const found = files.get(path);
      if (options.create && found) throw new WorkspaceError({ kind: 'exists' });
      if (!options.create && !found)
        throw new WorkspaceError({ kind: 'not-found' });
      if (found && options.expectedVersion !== found.version)
        throw new WorkspaceError({ kind: 'changed' });
      const version = stamp();
      files.set(path, { text: options.text, version });
      return { path, version };
    },
  };
  return {
    api,
    writes,
    text: (path: string) => files.get(full(path))?.text,
    version: (path: string) => files.get(full(path))?.version,
    /** Someone else changes the note on disk. */
    touch: (path: string) => {
      const found = files.get(full(path));
      if (found) found.version = stamp();
    },
    pick: (folder: string | null) => {
      picked = folder;
    },
  };
}

const NOTES = {
  [`${ROOT}/a.md`]: 'alpha\nbeta\ngamma\n',
  [`${ROOT}/sub/b.md`]: 'one\ntwo\n',
  [OPEN]: 'saved text\n',
};

type Tool = {
  execute?: (input: never, options: never) => unknown;
};

/** The tools on fake notes, with the user answering each question. */
function setup(
  options: {
    notes?: Record<string, string>;
    roots?: string[];
    documentPath?: string | null;
    answer?: ApprovalAnswer | null;
  } = {}
) {
  const files = fakeApi(options.notes ?? NOTES, options.roots);
  const approvals = new Approvals();
  const asked: ApprovalRequest[] = [];
  const calls: string[] = [];
  const answer = options.answer === undefined ? 'allow' : options.answer;
  approvals.subscribe(() => {
    for (const id of calls) {
      const request = approvals.request(id);
      if (!request || asked.includes(request)) continue;
      asked.push(request);
      if (answer) queueMicrotask(() => approvals.answer(id, answer));
    }
  });
  const edits: TextEdit[] = [];
  const controller = {
    edit: async (make: (text: string) => TextEdit) => {
      const made = make('live text\n');
      edits.push(made);
      return {
        report: {
          status: 'proposed',
          edit: 'e1',
          changes: 1,
          from: 1,
          to: 1,
          text: `1\t${made.next}`,
        },
        notices: null,
      };
    },
  } as unknown as EditController;
  const tools = workspaceTools({
    api: files.api,
    approvals,
    documentPath: () =>
      options.documentPath === undefined ? OPEN : options.documentPath,
    readDocument: async () => ({
      text: 'live text\nwith edits\n',
      selection: null,
    }),
    edits: controller,
  });
  let next = 0;
  const run = async (
    tool: Tool,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ) => {
    const toolCallId = `c${++next}`;
    calls.push(toolCallId);
    return (await tool.execute?.(
      input as never,
      { toolCallId, messages: [], abortSignal: signal } as never
    )) as FileToolOutput & { edit?: string };
  };
  return { ...files, approvals, asked, edits, tools, run };
}

describe('the assistant listing and reading notes', () => {
  test('lists the notes in its folders and marks the open document', async () => {
    const { tools, run } = setup();
    const output = await run(tools.list_files, {});
    expect(output.count).toBe(3);
    expect(output.text).toContain(
      "Folders you may use:\n- /notes (the open document's folder)"
    );
    expect(output.text).toContain('3 files:\na.md (17 B)\nsub/b.md (8 B)');
    expect(output.text).toContain('open.md (11 B) (open in the editor)');
  });

  test('knows the open document by its name in the folder the app resolved', async () => {
    const { tools, run } = setup({
      roots: ['/real/notes'],
      notes: { '/real/notes/open.md': 'text\n' },
      documentPath: '/linked/notes/open.md',
    });
    const output = await run(tools.list_files, {});
    expect(output.text).toContain('open.md (5 B) (open in the editor)');
  });

  test('tells it there is no folder while the document is unsaved', async () => {
    const { tools, run } = setup({ roots: [], documentPath: null });
    await expect(run(tools.list_files, {})).rejects.toThrow(
      /^no-workspace: No folder is open to you/
    );
  });

  test('reads a note with numbered lines and its version', async () => {
    const { tools, run, version } = setup();
    const output = await run(tools.read_file, { path: 'a.md' });
    expect(output.path).toBe(`${ROOT}/a.md`);
    expect(output.text).toBe(
      `/notes/a.md, 3 lines:\n1\talpha\n2\tbeta\n3\tgamma\n\n(version ${version('a.md')})`
    );
  });

  test('reads the open document as the editor has it', async () => {
    const { tools, run } = setup();
    const output = await run(tools.read_file, { path: 'open.md' });
    expect(output.text).toContain('This is the document open in the editor');
    expect(output.text).toContain('1\tlive text\n2\twith edits');
    expect(output.text).not.toContain('saved text');
  });

  test('explains a note that is not there', async () => {
    const { tools, run } = setup();
    await expect(run(tools.read_file, { path: 'gone.md' })).rejects.toThrow(
      'not-found: There is no such file. list_files shows what there is.'
    );
  });

  test('finds lines across the notes and says how the open one is searched', async () => {
    const { tools, run } = setup();
    const output = await run(tools.search_files, { query: 'ta' });
    expect(output.count).toBe(1);
    expect(output.text).toContain('1 line hold “ta”:\na.md:2\tbeta');
    expect(output.text).toContain('search_document searches it');
  });
});

describe('the assistant changing notes', () => {
  test('writes a change the user allows, at the version it read', async () => {
    const { tools, run, asked, writes, text, version } = setup();
    const read = version('a.md');
    const output = await run(tools.edit_file, {
      path: 'a.md',
      old_string: 'beta',
      new_string: 'BETA',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/a.md`,
      created: false,
      diff: { added: 1, removed: 1 },
    });
    expect(writes).toEqual([
      {
        path: `${ROOT}/a.md`,
        text: 'alpha\nBETA\ngamma\n',
        expectedVersion: read,
      },
    ]);
    expect(text('a.md')).toBe('alpha\nBETA\ngamma\n');
    expect(output.status).toBe('written');
    expect(output.text).toBe(
      `Changed /notes/a.md. Lines 1–3 now read:\n1\talpha\n2\tBETA\n3\tgamma\n\n(version ${version('a.md')})`
    );
  });

  test('leaves the note alone when the user turns the change down', async () => {
    const { tools, run, writes, text } = setup({ answer: 'deny' });
    await expect(
      run(tools.edit_file, {
        path: 'a.md',
        old_string: 'beta',
        new_string: 'BETA',
      })
    ).rejects.toThrow(/^denied: The user did not allow this change to a\.md/);
    expect(writes).toEqual([]);
    expect(text('a.md')).toBe('alpha\nbeta\ngamma\n');
  });

  test('asks no more once the user allows every write', async () => {
    const { tools, run, asked, text } = setup({ answer: 'always' });
    await run(tools.edit_file, {
      path: 'a.md',
      old_string: 'beta',
      new_string: 'BETA',
    });
    await run(tools.write_file, { path: 'new.md', text: 'new\n' });
    expect(asked).toHaveLength(1);
    expect(text('new.md')).toBe('new\n');
  });

  test('says what it could not find, and asks nothing', async () => {
    const { tools, run, asked } = setup();
    await expect(
      run(tools.edit_file, {
        path: 'a.md',
        old_string: 'delta',
        new_string: '',
      })
    ).rejects.toThrow(/^not_found: /);
    expect(asked).toEqual([]);
  });

  test('explains a note changed on disk while the user looked', async () => {
    const files = setup({ answer: null });
    const pending = files.run(files.tools.edit_file, {
      path: 'a.md',
      old_string: 'beta',
      new_string: 'BETA',
    });
    await Bun.sleep(0);
    files.touch('a.md');
    files.approvals.answer('c1', 'allow');
    await expect(pending).rejects.toThrow(
      /^changed: The file changed on disk since you read it/
    );
  });

  test('edits the open document as a proposal in the editor', async () => {
    const { tools, run, asked, writes, edits } = setup();
    const output = await run(tools.edit_file, {
      path: 'open.md',
      old_string: 'live',
      new_string: 'LIVE',
    });
    expect(edits.map((edit) => edit.next)).toEqual(['LIVE text\n']);
    expect(output.edit).toBe('e1');
    expect(asked).toEqual([]);
    expect(writes).toEqual([]);
  });

  test('turns the change down when the turn is stopped while it waits', async () => {
    const { tools, run, approvals, writes } = setup({ answer: null });
    const stop = new AbortController();
    const pending = run(
      tools.edit_file,
      { path: 'a.md', old_string: 'beta', new_string: 'BETA' },
      stop.signal
    );
    await Bun.sleep(0);
    expect(approvals.request('c1')).not.toBeNull();
    stop.abort();
    await expect(pending).rejects.toThrow(/^denied: /);
    expect(approvals.request('c1')).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe('the assistant writing notes whole', () => {
  test('creates a new note the user allows', async () => {
    const { tools, run, asked, writes } = setup();
    const output = await run(tools.write_file, {
      path: 'drafts/new.md',
      text: 'hello\n',
    });
    expect(asked[0]).toMatchObject({
      kind: 'write',
      path: 'drafts/new.md',
      created: true,
      diff: { added: 1, removed: 0 },
    });
    expect(writes).toEqual([
      { path: 'drafts/new.md', text: 'hello\n', create: true },
    ]);
    expect(output.status).toBe('created');
    expect(output.text).toMatch(
      /^Created \/notes\/drafts\/new\.md\. \(version v\d+\)$/
    );
  });

  test('replaces a note only at the version it read', async () => {
    const { tools, run, asked, version, text } = setup();
    await expect(
      run(tools.write_file, { path: 'a.md', text: 'new\n' })
    ).rejects.toThrow(/^exists: /);
    await expect(
      run(tools.write_file, { path: 'a.md', text: 'new\n', version: 'v0' })
    ).rejects.toThrow(/^changed: /);
    expect(asked).toEqual([]);
    const output = await run(tools.write_file, {
      path: 'a.md',
      text: 'new\n',
      version: version('a.md'),
    });
    expect(asked[0]).toMatchObject({ created: false });
    expect(output.status).toBe('written');
    expect(text('a.md')).toBe('new\n');
  });

  test('sends a whole open document to the document tools', async () => {
    const { tools, run, writes } = setup();
    await expect(
      run(tools.write_file, { path: 'open.md', text: 'x\n', version: 'v3' })
    ).rejects.toThrow(/^open-document: .*write_document/);
    expect(writes).toEqual([]);
  });

  test('writes only Markdown and text notes', async () => {
    const { tools, run, asked } = setup();
    await expect(
      run(tools.write_file, { path: 'script.sh', text: 'rm -rf ~\n' })
    ).rejects.toThrow(/^not-markdown: /);
    expect(asked).toEqual([]);
  });
});

describe('the assistant asking for a folder', () => {
  test('gets the folder the user picks', async () => {
    const files = setup();
    files.pick('/elsewhere');
    const output = await files.run(files.tools.request_folder, {
      reason: 'Your drafts are there.',
    });
    expect(files.asked).toEqual([
      { kind: 'folder', reason: 'Your drafts are there.' },
    ]);
    expect(output.path).toBe('/elsewhere');
    expect(await files.api.roots()).toEqual([ROOT, '/elsewhere']);
  });

  test('is told when the user declines or closes the picker', async () => {
    const declined = setup({ answer: 'deny' });
    await expect(
      declined.run(declined.tools.request_folder, { reason: 'Drafts.' })
    ).rejects.toThrow(
      /^denied: The user did not allow reaching another folder/
    );
    const closed = setup();
    closed.pick(null);
    await expect(
      closed.run(closed.tools.request_folder, { reason: 'Drafts.' })
    ).rejects.toThrow(/^denied: The user closed the folder picker/);
  });
});

describe('the questions waiting on the user', () => {
  test('a new conversation turns down what waits and asks again', async () => {
    const approvals = new Approvals();
    const write: ApprovalRequest = {
      kind: 'write',
      path: 'a.md',
      created: false,
      diff: { rows: [], added: 0, removed: 0, truncated: false },
    };
    const first = approvals.ask('c1', write);
    approvals.answer('c1', 'always');
    expect(await first).toBe('always');
    expect(await approvals.ask('c2', write)).toBe('allow');
    const waiting = approvals.ask('c3', { kind: 'folder', reason: 'x' });
    approvals.reset();
    expect(await waiting).toBe('deny');
    const again = approvals.ask('c4', write);
    expect(approvals.request('c4')).toBe(write);
    approvals.answer('c4', 'allow');
    expect(await again).toBe('allow');
  });
});
