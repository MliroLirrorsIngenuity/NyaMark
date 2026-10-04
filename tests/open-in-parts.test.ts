import { describe, expect, test } from 'bun:test';
import { Fragment, type Node, Schema } from '@milkdown/kit/prose/model';
import { splitOpening } from '../src/editor/open-in-parts';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code: { group: 'block', content: 'text*' },
    text: {},
  },
});

const p = (text: string) => schema.node('paragraph', null, schema.text(text));
const code = (text: string) => schema.node('code', null, schema.text(text));
const doc = (blocks: Node[]) => schema.node('doc', null, blocks);
const endsOpen = (last: Node) => last.type.name !== 'paragraph';

/** `count` blocks of a hundred positions each. */
const lines = (count: number, block = p) =>
  Array.from({ length: count }, (_, index) =>
    block(`${String(index).padStart(3, '0')} ${'x'.repeat(94)}`)
  );

describe('splitOpening', () => {
  test('draws a short document at once', () => {
    expect(splitOpening(doc(lines(200)), endsOpen)).toBeNull();
  });

  test('opens a long one on its first blocks, the rest to follow', () => {
    const whole = doc(lines(400));
    const opening = splitOpening(whole, endsOpen);
    expect(opening).not.toBeNull();
    if (!opening) return;
    expect(opening.first.childCount).toBe(120);
    expect(opening.rest).toHaveLength(280);
    const joined = opening.first.content.append(Fragment.from(opening.rest));
    expect(joined.eq(whole.content)).toBe(true);
  });

  test('ends the opening on a block the trailing plugin leaves alone', () => {
    const whole = doc([...lines(110), ...lines(30, code), ...lines(300)]);
    const opening = splitOpening(whole, endsOpen);
    expect(opening?.first.childCount).toBe(141);
    expect(opening?.first.lastChild?.type.name).toBe('paragraph');
  });

  test('draws at once a document with no such block past its opening', () => {
    const whole = doc([...lines(100), ...lines(300, code)]);
    expect(splitOpening(whole, endsOpen)).toBeNull();
  });
});
