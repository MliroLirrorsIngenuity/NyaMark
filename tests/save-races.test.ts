/**
 * Saves raced against another program writing the same file, in random
 * orders: edits, saves and auto-saves, writes and deletes from outside,
 * watcher reports that come late, twice or never, and answers to the reload
 * question. The disk below decides writes as the Rust side does.
 *
 * What counts as right is decided from what the user saw and answered,
 * never from the controller's own state:
 *
 * - A version another program wrote is replaced only once its text was
 *   shown in the editor or the reload question about it was answered, or
 *   by Save As. A version that cannot be read is never replaced otherwise.
 * - Edits that were never on disk are replaced only after the user chose
 *   to reload.
 * - Every save finishes.
 * - Once every change has been reported, a document marked saved matches
 *   the file, and a save puts the editor's text on disk.
 *
 * A failure names its seed; `FUZZ_SEED=<seed>` replays that run alone,
 * `FUZZ_RUNS=<n>` runs more of them and `FUZZ_STEPS=<n>` makes each longer.
 */

import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import * as realFiles from '../src/bridge/ipc/files';
import type { DocumentFormat, MarkdownDocument } from '../src/bridge/ipc/files';
import type { NyaEditor } from '../src/editor/editor';

type Bytes = { text: string; format: DocumentFormat; readable: boolean };

/** Named by the bytes alone, as the Rust side names a version by its hash. */
const versionOf = (bytes: Bytes) =>
  [
    bytes.readable ? 'utf8' : 'binary',
    bytes.format.bom ? 'bom' : '',
    bytes.format.lineEnding,
    bytes.text,
  ].join('|');

const sameFormat = (a: DocumentFormat, b: DocumentFormat) =>
  a.bom === b.bom && a.lineEnding === b.lineEnding;

type Call =
  | {
      kind: 'read';
      done: boolean;
      seen?: Bytes | null;
      resolve: (document: MarkdownDocument) => void;
      reject: (error: unknown) => void;
    }
  | {
      kind: 'write';
      done: boolean;
      text: string;
      format: DocumentFormat;
      expected: string | null;
      written?: string;
      resolve: (version: string) => void;
      reject: (error: unknown) => void;
    };

type Prompt = { answer: (reload: boolean) => void; readsBefore: number };

/** mulberry32: small, seedable, good enough to pick moves with. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Run {
  readonly rand: () => number;
  readonly path: string;
  disk: Bytes | null = null;
  calls: Call[] = [];
  /** Watcher reports yet to arrive; they carry nothing but the path. */
  reports = 0;
  prompts: Prompt[] = [];
  handler: (() => void) | null = null;
  /** Texts the reads handed to the controller, in order. */
  readsDelivered: string[] = [];
  /** Texts the user has had before them: typed, shown, or asked about. */
  known = new Set<string>();
  /** Texts some version of the file has held. */
  onDisk = new Set<string>();
  /** Set by Save As onto the file: the user agreed to replace it. */
  replaceAgreed = false;
  clock = 0;
  lastEdit = 0;
  lastReloadAnswer = 0;
  errorsShown = 0;
  texts = 0;
  readonly violations: string[] = [];
  readonly trace: string[] = [];
  /** How often each kind of event came up, to tell a run that tested little. */
  readonly counts: Record<string, number> = {};

  count(event: string) {
    this.counts[event] = (this.counts[event] ?? 0) + 1;
  }

  constructor(readonly seed: number) {
    this.rand = random(seed);
    this.path = `/fuzz/doc-${seed}.md`;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)] as T;
  }

  chance(p: number) {
    return this.rand() < p;
  }

  newText(prefix: string) {
    this.texts += 1;
    return `${prefix}${this.texts}\nline two`;
  }

  format(): DocumentFormat {
    return {
      bom: this.chance(0.3),
      lineEnding: this.chance(0.5) ? 'lf' : 'crlf',
    };
  }

  fail(message: string) {
    this.violations.push(message);
  }

  /** A change on disk, which the watcher may report once, twice or never. */
  changed() {
    const roll = this.rand();
    this.reports += roll < 0.15 ? 0 : roll < 0.85 ? 1 : 2;
  }

  /** The disk side of a call: a read takes the file as it is now. */
  carryOut(call: Call) {
    call.done = true;
    if (call.kind === 'read') {
      call.seen = this.disk && { ...this.disk };
      return;
    }
    const before = this.disk;
    if (
      call.expected !== null &&
      before !== null &&
      versionOf(before) !== call.expected
    ) {
      this.count('write refused: file changed');
      return;
    }
    this.count(before === null ? 'write recreated the file' : 'write');
    if (before !== null) {
      if (this.replaceAgreed) {
        this.replaceAgreed = false;
      } else if (!before.readable) {
        this.fail(`wrote over "${before.text}", which it cannot read`);
      } else if (!this.known.has(before.text)) {
        this.fail(`wrote over "${before.text}" unseen and unasked`);
      } else if (!sameFormat(before.format, call.format)) {
        this.fail(`wrote over the BOM or line endings of "${before.text}"`);
      }
    }
    this.disk = { text: call.text, format: { ...call.format }, readable: true };
    this.onDisk.add(call.text);
    call.written = versionOf(this.disk);
    this.changed();
  }

  /** The answer coming back over IPC. */
  answer(call: Call) {
    this.calls.splice(this.calls.indexOf(call), 1);
    if (call.kind === 'write') {
      if (call.written) call.resolve(call.written);
      else {
        call.reject(
          new realFiles.DocumentError('changed', this.path, null, 'changed')
        );
      }
      return;
    }
    const seen = call.seen;
    this.count(
      !seen ? 'read: missing' : seen.readable ? 'read' : 'read: unreadable'
    );
    if (!seen) {
      call.reject(
        new realFiles.DocumentError('missing', this.path, null, 'missing')
      );
    } else if (!seen.readable) {
      call.reject(
        new realFiles.DocumentError('not-utf8', this.path, null, 'not UTF-8')
      );
    } else {
      this.readsDelivered.push(seen.text);
      call.resolve({
        text: seen.text,
        format: { ...seen.format },
        version: versionOf(seen),
      });
    }
  }

  step(call: Call) {
    if (call.done) this.answer(call);
    else this.carryOut(call);
  }

  answerPrompt(prompt: Prompt, reload: boolean) {
    this.prompts.splice(this.prompts.indexOf(prompt), 1);
    // The question was about a version a read had handed over by then.
    for (const text of this.readsDelivered.slice(0, prompt.readsBefore)) {
      this.known.add(text);
    }
    this.count(reload ? 'answer: reload' : 'answer: keep');
    if (reload) this.lastReloadAnswer = ++this.clock;
    prompt.answer(reload);
  }
}

let run: Run;

mock.module('../src/bridge/ipc/files', () => ({
  ...realFiles,
  resolveCurrentWindowFile: async () => run.path,
  readMarkdown: () =>
    new Promise<MarkdownDocument>((resolve, reject) => {
      run.calls.push({ kind: 'read', done: false, resolve, reject });
    }),
  saveMarkdown: (
    _path: string,
    text: string,
    format: DocumentFormat,
    expectedVersion: string | null = null
  ) =>
    new Promise<string>((resolve, reject) => {
      run.calls.push({
        kind: 'write',
        done: false,
        text,
        format: { ...format },
        expected: expectedVersion,
        resolve,
        reject,
      });
    }),
  saveFileDialog: async () => {
    if (run.chance(0.2)) return null;
    run.replaceAgreed = true;
    return run.path;
  },
  errorDialog: async () => {
    run.errorsShown += 1;
    run.count('error shown');
  },
  confirmDialog: () =>
    new Promise<boolean>((resolve) => {
      run.prompts.push({
        answer: resolve,
        readsBefore: run.readsDelivered.length,
      });
    }),
  watchMarkdownFile: async (path: string, handler: () => void) => {
    if (path === run.path) run.handler = handler;
    return () => {
      if (run.handler === handler) run.handler = null;
    };
  },
  registerWindowDocument: async (path: string) => path,
}));

const { FileController } = await import('../src/features/file-controller');
const { store } = await import('../src/state/store');

/** Run everything the controller can do before it waits on the disk or user. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

class FakeEditor {
  #markdown = '';
  /** Keys the source pane has yet to hand the editor. */
  pending: string | null = null;

  constructor(private readonly run: Run) {}

  get markdown() {
    return this.#markdown;
  }

  set markdown(text: string) {
    this.#markdown = text;
    this.run.known.add(text);
  }

  getMarkdown() {
    return this.#markdown;
  }
}

const RUNS = Number(process.env.FUZZ_RUNS ?? 5000);
const STEPS = Number(process.env.FUZZ_STEPS ?? 60);

async function play(seed: number): Promise<Run> {
  run = new Run(seed);
  const current = run;
  const editor = new FakeEditor(current);
  // Each run's controller lets go of the store when the run ends; left
  // listening, thousands of them slowed every update.
  const subscribing = spyOn(store, 'subscribe');
  const controller = new FileController(() => editor as unknown as NyaEditor, {
    // What the app does with these, minus ProseMirror.
    syncEditorAfterSave: (content) => {
      if (content === editor.markdown) return;
      const unsaved = [editor.markdown, editor.pending].find(
        (text) => text !== null && text !== content && !current.onDisk.has(text)
      );
      if (unsaved && current.lastReloadAnswer < current.lastEdit) {
        current.fail(`replaced unsaved "${unsaved}" without asking`);
      }
      editor.markdown = content;
      editor.pending = null;
    },
    flushPendingEdits: () => flush(),
  });
  const unsubscribe = subscribing.mock.results[0]?.value as () => void;
  subscribing.mockRestore();
  const flush = () => {
    const text = editor.pending;
    if (text === null) return;
    editor.pending = null;
    if (text === editor.markdown) return;
    editor.markdown = text;
    store.update({ isDirty: true });
  };
  const operations: Array<{ name: string; settled: boolean }> = [];
  const start = (name: string, operation: Promise<unknown>) => {
    const entry = { name, settled: false };
    operations.push(entry);
    void operation.finally(() => {
      entry.settled = true;
    });
  };

  // Opened as the app opens a file.
  current.disk = {
    text: current.newText('o'),
    format: current.format(),
    readable: true,
  };
  current.onDisk.add(current.disk.text);
  const opening = controller.resolveInitialDocument();
  await settle();
  for (const call of [...current.calls]) {
    current.step(call);
    current.step(call);
  }
  const initial = await opening;
  editor.markdown = initial.markdown;
  store.update({ filePath: initial.filePath, isDirty: false });
  await settle();

  const edit = (text: string, inSourcePane: boolean) => {
    current.lastEdit = ++current.clock;
    if (inSourcePane) {
      editor.pending = text;
      current.known.add(text);
    } else {
      editor.markdown = text;
    }
    // The source pane marks the document unsaved at the first key, too.
    store.update({ isDirty: true });
  };

  const moves: Array<[number, () => string | null]> = [
    [
      3,
      () => {
        // The reload question is modal: no typing or saving under it.
        if (current.prompts.length > 0) return null;
        const inSourcePane = current.chance(0.3);
        edit(current.newText('e'), inSourcePane);
        return inSourcePane ? 'type in the source pane' : 'type';
      },
    ],
    [
      1,
      () => {
        flush();
        return 'source pane hands over its keys';
      },
    ],
    [
      2,
      () => {
        if (current.prompts.length > 0) return null;
        start('save', controller.saveFile());
        return 'save';
      },
    ],
    [
      2,
      () => {
        start('auto-save', controller.autoSaveFile());
        return 'auto-save';
      },
    ],
    [
      0.5,
      () => {
        if (current.prompts.length > 0) return null;
        start('save as', controller.saveFileAs());
        return 'save as';
      },
    ],
    [
      2,
      () => {
        const roll = current.rand();
        const disk = current.disk;
        if (roll < 0.45 || !disk) {
          current.disk = {
            text: current.newText('x'),
            format: current.format(),
            readable: true,
          };
          current.onDisk.add(current.disk.text);
        } else if (roll < 0.6) {
          current.disk = {
            ...disk,
            format: {
              ...disk.format,
              lineEnding: disk.format.lineEnding === 'lf' ? 'crlf' : 'lf',
            },
          };
        } else if (roll < 0.7) {
          current.disk = {
            text: current.newText('bin'),
            format: disk.format,
            readable: false,
          };
        } else if (roll < 0.8) {
          current.disk = null;
        } else if (roll < 0.9) {
          current.disk = {
            text: current.pick([...current.onDisk]),
            format: current.format(),
            readable: true,
          };
        } else {
          current.disk = { ...disk };
        }
        current.changed();
        return `other program: ${current.disk ? JSON.stringify(current.disk) : 'delete'}`;
      },
    ],
    [
      5,
      () => {
        if (current.calls.length === 0) return null;
        const call = current.pick(current.calls);
        const phase = call.done ? 'answers' : 'runs';
        current.step(call);
        return `${call.kind} ${phase}`;
      },
    ],
    [
      2,
      () => {
        if (current.reports === 0) return null;
        current.reports -= 1;
        current.handler?.();
        return 'watcher reports';
      },
    ],
    [
      2,
      () => {
        if (current.prompts.length === 0) return null;
        const reload = current.chance(0.5);
        current.answerPrompt(current.pick(current.prompts), reload);
        return reload ? 'answer: reload' : 'answer: keep';
      },
    ],
  ];
  const total = moves.reduce((sum, [weight]) => sum + weight, 0);

  const move = () => {
    for (;;) {
      let roll = current.rand() * total;
      for (const [weight, act] of moves) {
        roll -= weight;
        if (roll >= 0) continue;
        const done = act();
        if (done !== null) return done;
        break;
      }
    }
  };

  /** Let every report arrive and every call answer; `reload` answers the question. */
  const drain = async (reload: () => boolean) => {
    for (let round = 0; round < 500; round += 1) {
      await settle();
      if (current.calls.length > 0) {
        current.step(current.calls[0] as Call);
        continue;
      }
      if (current.prompts.length > 0) {
        current.answerPrompt(current.prompts[0] as Prompt, reload());
        continue;
      }
      if (current.reports > 0) {
        current.reports -= 1;
        current.handler?.();
        continue;
      }
      if (operations.every((operation) => operation.settled)) return;
    }
    const stuck = operations.filter((operation) => !operation.settled);
    current.fail(`never finished: ${stuck.map((op) => op.name).join(', ')}`);
  };

  for (
    let index = 0;
    index < STEPS && current.violations.length === 0;
    index += 1
  ) {
    current.trace.push(move());
    await settle();
  }

  // Every change reported at last, and the latest one once more.
  await drain(() => current.chance(0.5));
  flush();
  current.reports += 1;
  await drain(() => current.chance(0.5));
  current.trace.push('— all reported —');

  const disk = current.disk;
  const dirty = store.getState().isDirty;
  if (!disk && !dirty) current.fail('a deleted file counts as saved');
  if (disk?.readable && !dirty && disk.text !== editor.markdown) {
    current.fail(
      `marked saved, but "${editor.markdown}" ≠ disk "${disk.text}"`
    );
  }

  // A save now, keeping the edits here, puts them on disk.
  const errorsBefore = current.errorsShown;
  start('final save', controller.saveFile());
  await drain(() => false);
  const after = current.disk;
  if (disk && !disk.readable) {
    if (dirty && current.errorsShown === errorsBefore) {
      current.fail('a save over an unreadable version failed silently');
    }
  } else if (after?.text !== editor.markdown || store.getState().isDirty) {
    current.fail(
      `after a save, disk "${after?.text}" ≠ editor "${editor.markdown}"`
    );
  }
  unsubscribe();
  return current;
}

let consoleError: ReturnType<typeof spyOn>;

beforeEach(() => {
  // Failed saves are logged on purpose; only the kind of error matters.
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

test(`${RUNS} random races between saves and another program`, async () => {
  const seeds = process.env.FUZZ_SEED
    ? [Number(process.env.FUZZ_SEED)]
    : Array.from({ length: RUNS }, (_, index) => index + 1);
  const failures: string[] = [];
  const counts: Record<string, number> = {};
  for (const seed of seeds) {
    consoleError.mockClear();
    const result = await play(seed);
    for (const args of consoleError.mock.calls) {
      const error = args.find((arg: unknown) => arg instanceof Error);
      if (error && !(error instanceof realFiles.DocumentError)) {
        result.fail(`threw ${String(error)}`);
      }
    }
    if (result.violations.length > 0) {
      failures.push(
        [
          `seed ${seed}: ${result.violations.join('; ')}`,
          ...result.trace.slice(-25).map((line) => `    ${line}`),
        ].join('\n')
      );
    }
    for (const [event, n] of Object.entries(result.counts)) {
      counts[event] = (counts[event] ?? 0) + n;
    }
    if (failures.length >= 3) break;
  }
  if (process.env.FUZZ_STATS) console.log(counts);
  expect(failures).toEqual([]);
}, 120_000);
