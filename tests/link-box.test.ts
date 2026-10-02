import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  caretAfterLink,
  linkAddress,
  linkAtCaret,
} from '../src/editor/plugins/link-box';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
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

/** `前面的字后面`, the caret after `的字`, typing in bold if `bold`. */
function atCaret(bold = false) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('前面的字后面')]),
  ]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 5),
  });
  return bold
    ? state.apply(state.tr.addStoredMark(schema.mark('strong')))
    : state;
}

describe('linkAtCaret', () => {
  test('puts the address in at the caret as its link, the caret after it', () => {
    const state = atCaret();
    const tr = linkAtCaret(state, 'https://d.com');
    expect(tr).not.toBeNull();
    const next = state.apply(tr as NonNullable<typeof tr>);
    const para = next.doc.firstChild;
    expect(para?.textContent).toBe('前面的字https://d.com后面');
    const added = para?.child(1);
    expect(added?.text).toBe('https://d.com');
    expect(
      added?.marks.map((mark) => [mark.type.name, mark.attrs.href])
    ).toEqual([['link', 'https://d.com']]);
    expect(next.selection.from).toBe(5 + 'https://d.com'.length);
    expect(next.storedMarks).toEqual([]);
  });

  test('reads as the address typed, to the address with its scheme', () => {
    const state = atCaret();
    const next = state.apply(
      linkAtCaret(state, 'https://d.com', 'd.com') as NonNullable<
        ReturnType<typeof linkAtCaret>
      >
    );
    const added = next.doc.firstChild?.child(1);
    expect(added?.text).toBe('d.com');
    expect(added?.marks[0].attrs.href).toBe('https://d.com');
    expect(next.selection.from).toBe(5 + 'd.com'.length);
  });

  test('keeps the marks being typed with on the link and after it', () => {
    const state = atCaret(true);
    const next = state.apply(
      linkAtCaret(state, 'https://d.com') as NonNullable<
        ReturnType<typeof linkAtCaret>
      >
    );
    expect(
      next.doc.firstChild?.child(1).marks.map((mark) => mark.type.name)
    ).toEqual(['strong', 'link']);
    expect(next.storedMarks?.map((mark) => mark.type.name)).toEqual(['strong']);
  });

  test('leaves selected text to the link box', () => {
    expect(linkAtCaret(selected(), 'https://d.com')).toBeNull();
  });

  test('puts nothing in for an empty address', () => {
    expect(linkAtCaret(atCaret(), '')).toBeNull();
  });

  test('puts nothing in in a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, [schema.text('const a')]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    expect(linkAtCaret(state, 'https://d.com')).toBeNull();
  });
});

describe('linkAddress', () => {
  test('gives a website typed bare its https', () => {
    expect(linkAddress('example.com')).toBe('https://example.com');
    expect(linkAddress(' www.a.org/b?c=1 ')).toBe('https://www.a.org/b?c=1');
    expect(linkAddress('github.com/a/b.md')).toBe('https://github.com/a/b.md');
    expect(linkAddress('a.cn:8080')).toBe('https://a.cn:8080');
  });

  test('gives an email address its mailto', () => {
    expect(linkAddress('me@a.moe')).toBe('mailto:me@a.moe');
  });

  test('leaves an address with a scheme, and a file, as typed', () => {
    for (const typed of [
      'https://a.com',
      'mailto:me@a.com',
      'notes.md',
      'img/a.png',
      './a.com',
      '#heading',
      'localhost:3000',
    ]) {
      expect(linkAddress(typed)).toBe(typed);
    }
  });
});
