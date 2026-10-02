import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { caretAfterLink } from '../src/editor/plugins/link-edit-caret';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    link: { attrs: { href: {} } },
  },
});

const link = schema.mark('link', { href: 'https://e.com' });

/** `前面的字后面`, `的字` selected. */
function selected() {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('前面的字后面')]),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3, 5),
  });
}

/** The caret and the marks typing takes after `tr` and the plugin. */
function linked(
  state: EditorState,
  tr: ReturnType<EditorState['tr']['addMark']>
) {
  const next = state.apply(tr);
  const caret = caretAfterLink([tr], next);
  if (!caret) return null;
  const end = next.apply(caret);
  return {
    from: end.selection.from,
    to: end.selection.to,
    marks: end.storedMarks?.map((mark) => mark.type.name),
  };
}

describe('caretAfterLink', () => {
  test('puts the caret after a link put on the selection, outside it', () => {
    const state = selected();
    expect(linked(state, state.tr.addMark(3, 5, link))).toEqual({
      from: 5,
      to: 5,
      marks: [],
    });
  });

  test('leaves another mark put on the selection selected', () => {
    const state = selected();
    expect(
      linked(state, state.tr.addMark(3, 5, schema.mark('strong')))
    ).toBeNull();
  });

  test('leaves the selection when the link is put on other text', () => {
    const state = selected();
    expect(linked(state, state.tr.addMark(1, 3, link))).toBeNull();
  });
});
