import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { buildInstructions } from '../src/ai/agent/instructions';
import { ChatSession, withInserted } from '../src/ai/agent/session';
import {
  type ImageHost,
  dataUrlBlob,
  imageTools,
} from '../src/ai/agent/tools/image';
import {
  type ChatImage,
  ImageError,
  MAX_IMAGES,
  fitWithin,
  imageType,
  isSendableType,
  userMessage,
} from '../src/ai/images/image';
import { ImageReadError, type ImageReadFailure } from '../src/bridge/ipc/ai';

type StreamPart = Awaited<
  ReturnType<MockLanguageModelV4['doStream']>
>['stream'] extends ReadableStream<infer Part>
  ? Part
  : never;
type Prompt = Parameters<MockLanguageModelV4['doStream']>[0]['prompt'];

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

const say = (text: string): StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
];

const call = (id: string, name: string, input: object): StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input),
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

const image = (name: string, width = 40, height = 30): ChatImage => ({
  name,
  mediaType: 'image/png',
  data: PNG,
  width,
  height,
});

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('images as the services take them', () => {
  test('tells the type from the first bytes', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg'
    );
    expect(imageType(bytesOf('GIF89a...'))).toBe('image/gif');
    expect(imageType(bytesOf('GIF87a...'))).toBe('image/gif');
    expect(imageType(bytesOf('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe(
      'image/webp'
    );
    expect(imageType(bytesOf(`BM${'\u0000'.repeat(24)}`))).toBe('image/bmp');
    // Two letters alone are no bitmap; a RIFF file may be a sound.
    expect(imageType(bytesOf('BM'))).toBeNull();
    expect(
      imageType(bytesOf('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))
    ).toBeNull();
    expect(imageType(bytesOf('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(
      null
    );
    expect(imageType(new Uint8Array())).toBeNull();
  });

  test('sends PNG, JPEG and WebP as they are', () => {
    expect(isSendableType('image/png')).toBe(true);
    expect(isSendableType('image/jpeg')).toBe(true);
    expect(isSendableType('image/webp')).toBe(true);
    expect(isSendableType('image/gif')).toBe(false);
    expect(isSendableType('image/bmp')).toBe(false);
    expect(isSendableType(null)).toBe(false);
  });

  test('scales down to the longest side, keeping the proportions', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3136, 1568)).toEqual({ width: 1568, height: 784 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 392, height: 1568 });
    expect(fitWithin(100_000, 10)).toEqual({ width: 1568, height: 1 });
    expect(fitWithin(200, 100, 50)).toEqual({ width: 50, height: 25 });
  });

  test('puts the images before the words of a message', () => {
    expect(userMessage('Hi')).toEqual({ role: 'user', content: 'Hi' });
    const message = userMessage('What is this?', [image('a.png')]);
    expect(message).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'a.png',
          data: { type: 'data', data: PNG },
        },
        { type: 'text', text: 'What is this?' },
      ],
    });
    const bare = userMessage('', [image('a.png'), image('b.png')]);
    expect(bare.content).toHaveLength(2);
    expect(
      (bare.content as Array<{ type: string }>).map((part) => part.type)
    ).toEqual(['file', 'file']);
  });

  test('reads data URLs, encoded either way', async () => {
    const base64 = await dataUrlBlob('data:image/png;base64,iVBO\nRw0K');
    expect(base64?.type).toBe('image/png');
    expect([...new Uint8Array((await base64?.arrayBuffer()) ?? [])]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
    ]);
    const svg = await dataUrlBlob(
      'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E'
    );
    expect(svg?.type).toBe('image/svg+xml;charset=utf-8');
    expect(await svg?.text()).toBe('<svg></svg>');
    // A % that starts no escape stays as it is.
    const percent = await dataUrlBlob('data:text/plain,100%25 and 5%');
    expect(await percent?.text()).toBe('100% and 5%');
    expect(await dataUrlBlob('data:image/png;base64,***')).toBeNull();
    expect(await dataUrlBlob('not a data url')).toBeNull();
    expect(await dataUrlBlob('https://example.com/a.png')).toBeNull();
  });
});

describe('messages put among a turn', () => {
  const m = (text: string): ModelMessage => ({ role: 'user', content: text });

  test('go after the messages before them, in the order they came', () => {
    const response = [m('a'), m('b'), m('c')];
    expect(
      withInserted(response, [
        { at: 2, message: m('x') },
        { at: 0, message: m('w') },
        { at: 2, message: m('y') },
        { at: 3, message: m('z') },
      ]).map((message) => message.content)
    ).toEqual(['w', 'a', 'b', 'x', 'y', 'c', 'z']);
  });

  test('past the end, still go last', () => {
    expect(
      withInserted([m('a')], [{ at: 5, message: m('x') }]).map(
        (message) => message.content
      )
    ).toEqual(['a', 'x']);
    expect(withInserted([m('a')], [])).toEqual([m('a')]);
  });
});

describe('the assistant told whether it sees images', () => {
  const base = { documentPath: null, custom: '' };

  test('says how to look, or to work from the alt text', () => {
    expect(buildInstructions({ ...base, vision: true })).toContain(
      'open it with view_image'
    );
    expect(buildInstructions({ ...base, vision: false })).toContain(
      'cannot see images'
    );
    const silent = buildInstructions(base);
    expect(silent).not.toContain('view_image');
    expect(silent).not.toContain('cannot see images');
  });
});

type FakeHost = ImageHost & {
  shown: Array<{ caption: string; images: ChatImage[] }>;
  reads: string[];
  prepared: Array<{ source: Blob | Uint8Array; name: string }>;
};

function fakeHost(
  options: {
    files?: Record<string, Uint8Array | ImageReadFailure>;
    documentFolder?: string | null;
    prepare?: (source: Blob | Uint8Array, name: string) => Promise<ChatImage>;
  } = {}
): FakeHost {
  const files = options.files ?? {};
  const folder =
    options.documentFolder === undefined ? '/notes' : options.documentFolder;
  const host: FakeHost = {
    shown: [],
    reads: [],
    prepared: [],
    resolve: async (src) => {
      if (src.startsWith('/') || /^[a-z]:[\\/]/i.test(src)) return src;
      if (src.startsWith('file:')) return src.slice('file://'.length);
      return folder ? `${folder}/${src}` : null;
    },
    read: async (path) => {
      host.reads.push(path);
      const file = files[path];
      if (file == null) throw new ImageReadError({ kind: 'not-found' });
      if (!(file instanceof Uint8Array)) throw new ImageReadError(file);
      return file;
    },
    prepare: async (source, name) => {
      host.prepared.push({ source, name });
      if (options.prepare) return options.prepare(source, name);
      return image(name, 640, 480);
    },
    show: (caption, images) => host.shown.push({ caption, images }),
  };
  return host;
}

async function view(host: ImageHost, src: string) {
  const { view_image } = imageTools(host);
  return view_image.execute?.({ src }, {
    toolCallId: 'v1',
    messages: [],
    context: {},
  } as never);
}

describe('view_image', () => {
  test('opens an image beside the document and shows it to the model', async () => {
    const host = fakeHost({ files: { '/notes/img/a.png': PNG } });
    const output = await view(host, ' img/a.png ');
    expect(host.reads).toEqual(['/notes/img/a.png']);
    expect(host.prepared[0].name).toBe('a.png');
    expect(output).toMatchObject({
      src: 'img/a.png',
      text: expect.stringContaining('Opened img/a.png (640×480)'),
      image: { name: 'a.png' },
    });
    expect(host.shown).toHaveLength(1);
    expect(host.shown[0].caption).toContain('img/a.png');
    expect(host.shown[0].caption).toContain('not the user');
  });

  test('opens full paths, Windows ones and file URLs', async () => {
    const host = fakeHost({
      files: {
        '/pics/b.png': PNG,
        'C:\\pics\\c.png': PNG,
        '/pics/d.png': PNG,
      },
    });
    const { view_image } = imageTools(host);
    const run = (src: string) =>
      view_image.execute?.({ src }, {
        toolCallId: src,
        messages: [],
        context: {},
      } as never);
    await run('/pics/b.png');
    await run('C:\\pics\\c.png');
    await run('file:///pics/d.png');
    expect(host.reads).toEqual([
      '/pics/b.png',
      'C:\\pics\\c.png',
      '/pics/d.png',
    ]);
    expect(host.prepared.map((p) => p.name)).toEqual([
      'b.png',
      'c.png',
      'd.png',
    ]);
  });

  test('reads a data URL without the disk', async () => {
    const host = fakeHost();
    await view(host, 'data:image/png;base64,iVBORw0KGgo=');
    expect(host.reads).toEqual([]);
    const source = host.prepared[0].source;
    expect(source).toBeInstanceOf(Blob);
    expect((source as Blob).type).toBe('image/png');
    expect(host.shown).toHaveLength(1);
  });

  test('explains what it cannot open', async () => {
    const reject = (host: ImageHost, src: string) =>
      expect(view(host, src)).rejects.toThrow();
    const host = fakeHost({
      files: {
        '/notes/secret.png': { kind: 'forbidden' },
        '/notes/huge.png': { kind: 'too-large' },
        '/notes/odd.png': { kind: 'io', message: 'socket closed' },
      },
    });
    await reject(host, 'https://example.com/a.png');
    await expect(view(host, 'https://example.com/a.png')).rejects.toThrow(
      /^remote: .*alt text/
    );
    await expect(view(host, '//example.com/a.png')).rejects.toThrow(
      /^remote: /
    );
    await expect(view(host, 'blob:abc')).rejects.toThrow(/^unsupported: /);
    await expect(view(host, 'asset://localhost/a.png')).rejects.toThrow(
      /^unsupported: /
    );
    await expect(view(host, 'missing.png')).rejects.toThrow(
      /^not-found: There is no file/
    );
    await expect(view(host, 'secret.png')).rejects.toThrow(
      /^forbidden: .*outside the folders/
    );
    await expect(view(host, 'huge.png')).rejects.toThrow(/^too-large: /);
    await expect(view(host, 'odd.png')).rejects.toThrow(
      /^io: .*\(socket closed\)/
    );
    await expect(view(host, 'data:image/png;base64,***')).rejects.toThrow(
      /^not-an-image: /
    );
    const unsaved = fakeHost({ documentFolder: null });
    await expect(view(unsaved, 'a.png')).rejects.toThrow(/^no-file: .*saved/);
    const unreadable = fakeHost({
      files: { '/notes/a.png': PNG },
      prepare: async () => {
        throw new ImageError('not-an-image');
      },
    });
    await expect(view(unreadable, 'a.png')).rejects.toThrow(
      /^not-an-image: The file is no image/
    );
    expect(host.shown).toEqual([]);
  });

  test('shows an image once a turn, and only so many', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index <= MAX_IMAGES; index++) {
      files[`/notes/${index}.png`] = PNG;
    }
    const host = fakeHost({ files });
    const { view_image } = imageTools(host);
    const run = (src: string) =>
      view_image.execute?.({ src }, {
        toolCallId: src,
        messages: [],
        context: {},
      } as never);
    await run('0.png');
    const again = await run('0.png');
    expect(again).toMatchObject({ text: expect.stringContaining('earlier') });
    expect(again).not.toHaveProperty('image');
    expect(host.shown).toHaveLength(1);
    for (let index = 1; index < MAX_IMAGES; index++) await run(`${index}.png`);
    expect(host.shown).toHaveLength(MAX_IMAGES);
    await expect(run(`${MAX_IMAGES}.png`)).rejects.toThrow(/^too-many: /);
  });

  test('gives the model words; the image goes in a message', async () => {
    const { view_image } = imageTools(fakeHost());
    const output = await view_image.toModelOutput?.({
      toolCallId: 'v1',
      input: { src: 'a.png' },
      output: { text: 'Opened a.png', src: 'a.png', image: image('a.png') },
    });
    expect(output).toEqual({ type: 'text', value: 'Opened a.png' });
  });
});

describe('a conversation with images', () => {
  test('sends the images with the message, and keeps them in it', async () => {
    const prompts: Prompt[] = [];
    const model = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt);
        return reply(say('A cat.'), 'stop');
      },
    });
    const session = new ChatSession(() => ({
      model,
      modelLabel: 'mock',
      instructions: '',
    }));

    await session.send('   ', []);
    expect(session.entries).toHaveLength(0);

    await session.send('', [image('cat.png')]);
    expect(session.entries[0]).toMatchObject({
      role: 'user',
      text: '',
      images: [{ name: 'cat.png' }],
    });
    const sent = prompts[0].find((message) => message.role === 'user');
    expect(sent?.content).toEqual([
      expect.objectContaining({ type: 'file', mediaType: 'image/png' }),
    ]);
    expect(session.messages[0]).toEqual(userMessage('', [image('cat.png')]));
  });

  test('shows the model what view_image opened before its next step', async () => {
    const prompts: Prompt[] = [];
    let turn = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt);
        turn++;
        if (turn === 1) {
          return reply(
            [call('v1', 'view_image', { src: 'a.png' })],
            'tool-calls'
          );
        }
        if (turn === 2) return reply(say('It is a chart.'), 'stop');
        return reply(say('Still a chart.'), 'stop');
      },
    });
    const host = fakeHost({ files: { '/notes/a.png': PNG } });
    let session: ChatSession | null = null;
    const tools = () =>
      imageTools({
        ...host,
        show: (caption, images) => session?.showModel(caption, images),
      });
    session = new ChatSession(() => ({
      model,
      modelLabel: 'mock',
      instructions: '',
      tools: tools(),
    }));

    await session.send('What does a.png show?');

    const second = prompts[1];
    const roles = second.map((message) => message.role);
    expect(roles.slice(-3)).toEqual(['assistant', 'tool', 'user']);
    const shown = second[second.length - 1];
    expect(shown.content).toEqual([
      expect.objectContaining({ type: 'file', mediaType: 'image/png' }),
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('view_image opened from a.png'),
      }),
    ]);

    // Kept in the conversation where it was shown, for the turns after.
    expect(session.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
      'assistant',
    ]);
    await session.send('And now?');
    const third = prompts[2].filter((message) => message.role !== 'system');
    expect(third.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
      'assistant',
      'user',
    ]);
  });

  test('outside a turn, nothing is shown', () => {
    const session = new ChatSession(() => ({
      model: new MockLanguageModelV4({}),
      modelLabel: 'mock',
      instructions: '',
    }));
    session.showModel('An image', [image('a.png')]);
    expect(session.messages).toEqual([]);
  });
});
