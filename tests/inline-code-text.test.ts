import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { uncodeLeaves } from '../src/editor/plugins/inline-code-text';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    hard_break: { group: 'inline', inline: true },
  },
  marks: { code: { code: true }, strong: {} },
});

describe('uncodeLeaves', () => {
  test('takes the code mark off a line break and leaves the text in code', () => {
    const code = schema.mark('code');
    const strong = schema.mark('strong');
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('a', [code]),
        schema.node('hard_break', null, null, [code, strong]),
        schema.text('b', [code]),
      ]),
    ]);
    const state = EditorState.create({ doc });
    const line = uncodeLeaves(state, 0, doc.content.size)?.doc.firstChild;
    expect(line?.child(0).marks).toEqual([code]);
    expect(line?.child(1).marks).toEqual([strong]);
    expect(line?.child(2).marks).toEqual([code]);
  });

  test('changes nothing where only text is in code', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('a', [schema.mark('code')]),
        schema.node('hard_break'),
      ]),
    ]);
    const state = EditorState.create({ doc });
    expect(uncodeLeaves(state, 0, doc.content.size)).toBeNull();
  });
});
