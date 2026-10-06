import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseHTML } from 'linkedom';
import { renderHunk } from '../src/ai/edit/render';
import type { Hunk } from '../src/editor/plugins/ai-proposals';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    image: {
      group: 'inline',
      inline: true,
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt }],
    },
  },
});

const view = { state: { schema } } as unknown as EditorView;

const blank = () =>
  parseHTML('<!doctype html><html><body></body></html>')
    .document as unknown as Document;

const live = blank();
const madeByLive: string[] = [];
const saved = globalThis.document;

beforeAll(() => {
  const create = live.createElement.bind(live);
  Object.assign(live, {
    implementation: { createHTMLDocument: blank },
    createElement: (tag: string) => {
      madeByLive.push(tag.toLowerCase());
      return create(tag);
    },
  });
  globalThis.document = live;
});

afterAll(() => {
  globalThis.document = saved;
});

function hunkOf(...srcs: string[]): Hunk {
  const images = srcs.map((src) => schema.nodes.image.create({ src, alt: '' }));
  const paragraph = schema.nodes.paragraph.create(null, [
    schema.text('图 '),
    ...images,
  ]);
  const insert = new Slice(Fragment.from(paragraph), 0, 0);
  return {
    id: 1,
    edit: 'e',
    from: 0,
    to: 0,
    insert,
    base: Fragment.empty,
    kind: 'block',
  };
}

describe('a proposed image', () => {
  test('is drawn only once it resolves to a file on this computer', async () => {
    madeByLive.length = 0;
    const asked: string[] = [];
    let settle: (url: string | null) => void = () => undefined;
    const pending = new Promise<string | null>((resolve) => {
      settle = resolve;
    });
    const root = renderHunk(view, hunkOf('pic.png'), {
      accept: () => undefined,
      reject: () => undefined,
      localImage: (src) => {
        asked.push(src);
        return pending;
      },
    });
    expect(asked).toEqual(['pic.png']);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.ny-ai-ins__image')?.textContent).toBe(
      'pic.png'
    );
    settle('asset://localhost/doc/pic.png');
    await pending;
    await Promise.resolve();
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'asset://localhost/doc/pic.png'
    );
    expect(root.querySelector('.ny-ai-ins__image')).toBeNull();
    expect(madeByLive).not.toContain('img');
  });

  test('stays a stand-in when it lives on another computer', async () => {
    madeByLive.length = 0;
    const root = renderHunk(
      view,
      hunkOf('https://evil.example/x.png', '//server/share/y.png'),
      {
        accept: () => undefined,
        reject: () => undefined,
        localImage: async () => null,
      }
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('img')).toBeNull();
    expect(
      [...root.querySelectorAll('.ny-ai-ins__image')].map(
        (stand) => (stand as HTMLElement).title
      )
    ).toEqual(['https://evil.example/x.png', '//server/share/y.png']);
    expect(madeByLive).not.toContain('img');
  });
});
