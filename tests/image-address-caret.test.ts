import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  addressedImage,
  caretUnder,
} from '../src/editor/plugins/image-address-caret';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', code: true },
    'image-block': {
      group: 'block',
      atom: true,
      attrs: { src: { default: '' } },
    },
    blockquote: { group: 'block', content: 'block+' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const code = (text: string) =>
  schema.node('code_block', null, [schema.text(text)]);
const img = (src = '') => schema.node('image-block', { src });
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

const trOn = (start: Node) => EditorState.create({ doc: start }).tr;

describe('addressedImage', () => {
  test('finds an empty image given an address', () => {
    const tr = trOn(doc(p('a'), img())).setNodeAttribute(3, 'src', 'a.png');
    expect(addressedImage(tr)).toBe(3);
  });

  test('passes over an image whose address is changed', () => {
    const tr = trOn(doc(img('a.png'))).setNodeAttribute(0, 'src', 'b.png');
    expect(addressedImage(tr)).toBe(-1);
  });

  test('passes over an address left empty', () => {
    const tr = trOn(doc(img())).setNodeAttribute(0, 'src', '');
    expect(addressedImage(tr)).toBe(-1);
  });

  test('passes over an undo or a redo', () => {
    const tr = trOn(doc(img()))
      .setNodeAttribute(0, 'src', 'a.png')
      .setMeta('history$', {});
    expect(addressedImage(tr)).toBe(-1);
  });
});

describe('caretUnder', () => {
  const caret = (tr: ReturnType<typeof trOn>) => {
    const { $head } = tr.selection;
    return `${$head.parent.type.name}:${$head.parent.textContent}@${$head.parentOffset}`;
  };

  test('takes the line under the image', () => {
    const tr = caretUnder(trOn(doc(img(), p('b'))), 0);
    expect(tr.doc.eq(doc(img(), p('b')))).toBe(true);
    expect(caret(tr)).toBe('paragraph:b@0');
  });

  test('makes a line under the image at the end', () => {
    const tr = caretUnder(trOn(doc(p('a'), img())), 3);
    expect(tr.doc.eq(doc(p('a'), img(), p()))).toBe(true);
    expect(caret(tr)).toBe('paragraph:@0');
  });

  test('makes a line between the image and code', () => {
    const tr = caretUnder(trOn(doc(img(), code('x'))), 0);
    expect(tr.doc.eq(doc(img(), p(), code('x')))).toBe(true);
    expect(caret(tr)).toBe('paragraph:@0');
  });

  test('makes the line in the quote the image is in', () => {
    const tr = caretUnder(trOn(doc(quote(img()), p('b'))), 1);
    expect(tr.doc.eq(doc(quote(img(), p()), p('b')))).toBe(true);
    expect(caret(tr)).toBe('paragraph:@0');
  });
});
