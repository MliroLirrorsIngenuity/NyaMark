import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import {
  type DocumentSnapshot,
  MAX_READ_CHARS,
  documentLines,
  headings,
  lineAt,
  numberedText,
  outlineText,
  readLines,
  readSection,
  readSelection,
  searchLines,
} from '../src/ai/agent/document-text';
import {
  INLINE_DOCUMENT_CHARS,
  buildInstructions,
} from '../src/ai/agent/instructions';
import { ChatSession, type ToolPart } from '../src/ai/agent/session';
import { documentTools } from '../src/ai/agent/tools/document';

const DOC = `---
title: Notes
# not a heading
---

# Intro

Some words here.

## Setup

\`\`\`sh
# a comment, not a heading
npm install
\`\`\`

## Use **it**

$$
# also not a heading
$$

# Intro

Again.
`;

describe('documentLines', () => {
  test('drops the newline that ends the last line', () => {
    expect(documentLines('a\nb\n')).toEqual(['a', 'b']);
    expect(documentLines('a\nb')).toEqual(['a', 'b']);
    expect(documentLines('a\n\n')).toEqual(['a', '']);
    expect(documentLines('')).toEqual([]);
  });
});

describe('readLines', () => {
  const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');

  test('numbers lines to the width of the last', () => {
    const read = readLines(text, 9, 2);
    expect(read).toMatchObject({ from: 9, to: 10, total: 12 });
    expect(read.text.split('\n').slice(0, 2)).toEqual([
      ' 9\tline 9',
      '10\tline 10',
    ]);
    expect(read.text).toContain('read on with offset 11');
  });

  test('reads to the end without a note', () => {
    const read = readLines(text);
    expect(read).toMatchObject({ from: 1, to: 12, total: 12 });
    expect(read.text).not.toContain('read on');
  });

  test('says an empty document is empty', () => {
    expect(readLines('').text).toBe('The document is empty.');
  });

  test('refuses an offset past the end', () => {
    expect(() => readLines(text, 13)).toThrow('12 lines');
  });

  test('stops before a read grows too long', () => {
    const long = Array.from({ length: 100 }, () => 'x'.repeat(1000)).join('\n');
    const read = readLines(long);
    expect(read.to).toBeLessThan(100);
    expect(read.text.length).toBeLessThan(MAX_READ_CHARS + 200);
    expect(read.text).toContain(`Stopped at line ${read.to}`);
  });

  test('cuts a very long line short', () => {
    const read = readLines('y'.repeat(5000));
    expect(read.text).toContain('[3000 more characters on this line]');
  });
});

describe('headings', () => {
  test('skips front matter, code and math', () => {
    expect(headings(DOC)).toEqual([
      { line: 6, level: 1, text: 'Intro' },
      { line: 10, level: 2, text: 'Setup' },
      { line: 17, level: 2, text: 'Use **it**' },
      { line: 23, level: 1, text: 'Intro' },
    ]);
  });

  test('takes closing hashes off', () => {
    expect(headings('## Title ##\n#\n#hashtag')).toEqual([
      { line: 1, level: 2, text: 'Title' },
      { line: 2, level: 1, text: '' },
    ]);
  });

  test('lists the outline indented by level', () => {
    expect(outlineText(headings(DOC), 2)).toBe(
      '# Intro (line 6)\n  ## Setup (line 10)\n… and 2 more headings.'
    );
    expect(outlineText([])).toBe('The document has no headings.');
  });
});

describe('readSection', () => {
  test('reads down to the next heading of its level', () => {
    const read = readSection(DOC, 'setup');
    expect(read.heading.line).toBe(10);
    expect(read).toMatchObject({ from: 10, to: 16 });
    expect(read.text).toContain('npm install');
    expect(read.text).not.toContain('Use **it**');
  });

  test('matches the words without their markup', () => {
    expect(readSection(DOC, 'Use it').heading.line).toBe(17);
    expect(readSection(DOC, '## Use it').heading.line).toBe(17);
  });

  test('asks which of several headings is meant', () => {
    expect(() => readSection(DOC, 'Intro')).toThrow('line 6');
    const read = readSection(DOC, 'Intro', 23);
    expect(read).toMatchObject({ from: 23, to: 25 });
  });

  test('lists the headings when none matches', () => {
    expect(() => readSection(DOC, 'Missing')).toThrow('## Setup (line 10)');
  });
});

describe('searchLines', () => {
  test('finds text whatever its case', () => {
    const found = searchLines(DOC, 'intro');
    expect(found.count).toBe(2);
    expect(found.text).toContain(' 6\t# Intro');
    expect(found.text).toContain('23\t# Intro');
  });

  test('can match case and patterns', () => {
    expect(searchLines(DOC, 'intro', { caseSensitive: true }).count).toBe(0);
    expect(searchLines(DOC, '^#{2} ', { regex: true }).count).toBe(2);
    expect(() => searchLines(DOC, '(', { regex: true })).toThrow(
      'regular expression'
    );
  });

  test('shows a long line around its match', () => {
    const line = `${'a'.repeat(500)}needle${'b'.repeat(500)}`;
    const found = searchLines(line, 'needle');
    expect(found.text).toContain('…');
    expect(found.text.length).toBeLessThan(400);
  });
});

describe('readSelection', () => {
  const text = 'one\ntwo\nthree\n';

  test('gives the lines and the text exactly', () => {
    const snapshot: DocumentSnapshot = {
      text,
      selection: { from: 5, to: 10 },
    };
    const read = readSelection(snapshot);
    expect(read).toMatchObject({ from: 2, to: 3, selected: 'wo\nth' });
    expect(read?.text).toContain('2\ttwo\n3\tthree');
  });

  test('a selection ending at a line start ends on the line before', () => {
    const read = readSelection({ text, selection: { from: 4, to: 8 } });
    expect(read).toMatchObject({ from: 2, to: 2 });
  });

  test('nothing selected reads as null', () => {
    expect(readSelection({ text, selection: null })).toBeNull();
    expect(readSelection({ text, selection: { from: 3, to: 3 } })).toBeNull();
  });

  test('lineAt counts newlines before an offset', () => {
    expect(lineAt(text, 0)).toBe(1);
    expect(lineAt(text, 4)).toBe(2);
    expect(lineAt(text, 99)).toBe(4);
  });
});

describe('buildInstructions with the document', () => {
  const today = new Date(2026, 9, 5);

  test('gives a short document whole, numbered', () => {
    const text = buildInstructions({
      documentPath: null,
      custom: '',
      today,
      document: { text: '# Hi\n\nThere\n', selection: null },
    });
    expect(text).toContain(`<document>\n${numberedText('# Hi\n\nThere\n')}`);
    expect(text).toContain('Nothing is selected');
  });

  test('gives a long document as its outline', () => {
    const body = `# Big\n\n${'word '.repeat(INLINE_DOCUMENT_CHARS / 5)}\n\n## Part\n`;
    const text = buildInstructions({
      documentPath: null,
      custom: '',
      today,
      document: { text: body, selection: null },
    });
    expect(text).not.toContain('<document>');
    expect(text).toContain('# Big (line 1)');
    expect(text).toContain('## Part (line 5)');
  });

  test('says how edits reach the document, and what became of earlier ones', () => {
    const base = { documentPath: null, custom: '', today };
    expect(buildInstructions(base)).toContain('accept or reject');
    const auto = buildInstructions({ ...base, editMode: 'auto' });
    expect(auto).toContain('go into the document right away');
    expect(auto).not.toContain('accept or reject, change by change');
    const told = buildInstructions({
      ...base,
      notices: 'Since you last looked at the document:\n- something',
      document: { text: 'one\n', selection: null },
    });
    expect(told.indexOf('Since you last looked')).toBeLessThan(
      told.indexOf('<document>')
    );
  });

  test('quotes the selection', () => {
    const text = buildInstructions({
      documentPath: null,
      custom: '',
      today,
      document: { text: 'one\ntwo\n', selection: { from: 4, to: 7 } },
    });
    expect(text).toContain(
      'The user has selected text on line 2:\n<selection>\ntwo\n</selection>'
    );
  });

  test('says an empty document is empty', () => {
    const text = buildInstructions({
      documentPath: null,
      custom: '',
      today,
      document: { text: '\n', selection: null },
    });
    expect(text).toContain('The document is empty.');
  });
});

type StreamPart = Awaited<
  ReturnType<MockLanguageModelV4['doStream']>
>['stream'] extends ReadableStream<infer Part>
  ? Part
  : never;

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function reply(parts: StreamPart[], reason: 'stop' | 'tool-calls') {
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        for (const part of parts) controller.enqueue(part);
        controller.enqueue({
          type: 'finish',
          usage,
          finishReason: { unified: reason, raw: reason },
        });
        controller.close();
      },
    }),
  };
}

const call = (id: string, name: string, input: object): StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input),
});

function toolSession(model: MockLanguageModelV4, text = DOC) {
  return new ChatSession(() => ({
    model,
    modelLabel: 'mock',
    instructions: '',
    tools: documentTools(async () => ({ text, selection: null })),
  }));
}

describe('the assistant reading through tools', () => {
  test('shows each call and sends its result back to the model', async () => {
    let turn = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        turn++ === 0
          ? reply([call('c1', 'read_outline', {})], 'tool-calls')
          : reply(
              [
                { type: 'text-start', id: 't' },
                { type: 'text-delta', id: 't', delta: 'Four headings.' },
                { type: 'text-end', id: 't' },
              ],
              'stop'
            ),
    });
    const session = toolSession(model);
    await session.send('How is it laid out?');

    const entry = session.entries[1];
    if (entry?.role !== 'assistant') throw new Error('no reply');
    expect(entry.status).toBe('done');
    expect(entry.ending).toBeUndefined();
    const tool = entry.parts[0] as ToolPart;
    expect(tool).toMatchObject({
      type: 'tool',
      id: 'c1',
      name: 'read_outline',
      state: 'done',
      output: { count: 4 },
    });
    expect(entry.parts[1]).toEqual({ type: 'text', text: 'Four headings.' });

    const second = model.doStreamCalls[1]?.prompt ?? [];
    const result = second.find((message) => message.role === 'tool');
    expect(JSON.stringify(result)).toContain('# Intro (line 6)');
    expect(session.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  test('a failed call tells the model why', async () => {
    let turn = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        turn++ === 0
          ? reply(
              [call('c1', 'read_section', { heading: 'Nowhere' })],
              'tool-calls'
            )
          : reply([], 'stop'),
    });
    const session = toolSession(model);
    await session.send('Read Nowhere');
    const entry = session.entries[1];
    if (entry?.role !== 'assistant') throw new Error('no reply');
    const tool = entry.parts[0] as ToolPart;
    expect(tool.state).toBe('error');
    expect(tool.error).toContain('No heading matches');
    const second = model.doStreamCalls[1]?.prompt ?? [];
    expect(JSON.stringify(second)).toContain('No heading matches');
  });

  test('says when a reply ran out of steps', async () => {
    let id = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        reply([call(`c${id++}`, 'read_outline', {})], 'tool-calls'),
    });
    const session = toolSession(model, '# A\n');
    await session.send('Loop');
    const entry = session.entries[1];
    if (entry?.role !== 'assistant') throw new Error('no reply');
    expect(entry.status).toBe('done');
    expect(entry.ending).toBe('step-limit');
    expect(model.doStreamCalls.length).toBe(40);
  });
});
