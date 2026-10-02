import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { ruleFromLine } from '../src/editor/plugins/hr-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    hr: { group: 'block' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const hr = () => schema.node('hr');
const item = (...content: Node[]) => schema.node('list_item', null, content);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Enter at `offset` into the line `line`, at its end if none is given. */
function enterIn(start: Node, line: string, offset = line.length) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === line)
      at = pos + 1 + offset;
    return at < 0;
  });
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
  });
  const tr = ruleFromLine(state);
  if (!tr) return null;
  const { $head } = tr.selection;
  return { doc: tr.doc, caret: `${$head.parent.type.name}@${$head.depth}` };
}

describe('stars or underscores alone on a line, then Enter', () => {
  test('make a rule, the caret on a new line under it', () => {
    for (const marks of ['***', '___']) {
      const out = enterIn(doc(p('a'), p(marks)), marks);
      expect(out?.doc.eq(doc(p('a'), hr(), p()))).toBe(true);
      expect(out?.caret).toBe('paragraph@1');
    }
  });

  test('go under the item above in a list', () => {
    const out = enterIn(doc(list(item(p('a')), item(p('***')))), '***');
    expect(out?.doc.eq(doc(list(item(p('a'), hr(), p()))))).toBe(true);
  });

  test('stay text with more on the line or the caret before the end', () => {
    expect(enterIn(doc(p('***a')), '***a')).toBeNull();
    expect(enterIn(doc(p('**')), '**')).toBeNull();
    expect(enterIn(doc(p('***')), '***', 2)).toBeNull();
  });
});
