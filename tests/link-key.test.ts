import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { linkKeySpan } from '../src/editor/plugins/link-key';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', code: true },
    text: {},
  },
  marks: {
    link: { attrs: { href: { default: '' } } },
    strong: {},
  },
});

const link = schema.marks.link.create({ href: 'https://a.com' });
const strong = schema.marks.strong.create();

// "ab" then "cd" and "ef" under one link, "e" bold too, then "gh": 1-3, 3-7, 7-9.
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [
    schema.text('ab'),
    schema.text('cd', [link]),
    schema.text('e', [link, strong]),
    schema.text('f', [link]),
    schema.text('gh'),
  ]),
  schema.node('code_block', null, [schema.text('x')]),
]);

function at(start: Node, anchor: number, head = anchor) {
  return linkKeySpan(
    EditorState.create({
      doc: start,
      selection: TextSelection.create(start, anchor, head),
    })
  );
}

describe('where Cmd+K puts a link', () => {
  test('the whole of the link the caret is in, at either end too', () => {
    for (const pos of [3, 5, 7]) {
      expect(at(doc, pos)).toMatchObject({ from: 3, to: 7, mark: link });
    }
  });

  test('the whole of the link the selection lies in', () => {
    expect(at(doc, 4, 6)).toMatchObject({ from: 3, to: 7, mark: link });
  });

  test('the selection, past the link or with none', () => {
    expect(at(doc, 2, 5)).toEqual({ from: 2, to: 5, mark: null });
    expect(at(doc, 1)).toEqual({ from: 1, to: 1, mark: null });
  });

  test('nowhere in code', () => {
    expect(at(doc, 12)).toBeNull();
  });
});
