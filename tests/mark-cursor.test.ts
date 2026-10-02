import { describe, expect, test } from 'bun:test';
import { type Mark, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  clickedSide,
  outsideAfterPaste,
  outsideAtEdge,
  stepOver,
} from '../src/editor/plugins/mark-cursor';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    code: { code: true },
    link: { attrs: { href: {} } },
  },
});

const code = schema.mark('code');
const link = schema.mark('link', { href: 'https://e.com' });
const strong = schema.mark('strong');

/** A paragraph of `parts`, each text with its marks, the caret at `at`. */
function line(parts: [string, Mark[]][], at: number) {
  const doc = schema.node('doc', null, [
    schema.node(
      'paragraph',
      null,
      parts.map(([text, marks]) => schema.text(text, marks))
    ),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, at),
  });
}

const names = (marks: readonly Mark[] | null | undefined) =>
  marks?.map((mark) => mark.type.name);

/** Where the caret is and the marks typing takes after `keys`. */
function press(state: EditorState, ...keys: string[]) {
  let current = state;
  for (const key of keys) {
    const tr = stepOver(current, key);
    if (!tr) return null;
    current = current.apply(tr);
  }
  const { $head } = current.selection;
  return [$head.pos, names(current.storedMarks ?? $head.marks())];
}

// 运行 `npm` with the caret at the end of the line, in the code.
const codeAtEnd = line(
  [
    ['运行 ', []],
    ['npm', [code]],
  ],
  7
);

describe('stepOver', () => {
  test('steps out of code at the end of a line before it moves on', () => {
    expect(press(codeAtEnd, 'ArrowRight')).toEqual([7, []]);
    expect(
      stepOver(codeAtEnd.apply(codeAtEnd.tr.setStoredMarks([])), 'ArrowRight')
    ).toBeNull();
  });

  test('steps back in from outside', () => {
    expect(press(codeAtEnd, 'ArrowRight', 'ArrowLeft')).toEqual([7, ['code']]);
  });

  test('steps out of a mark that opens a line', () => {
    const state = line(
      [
        ['npm', [code]],
        [' 是', []],
      ],
      1
    );
    expect(press(state, 'ArrowLeft')).toEqual([1, []]);
  });

  test('lands on an edge on the side it came from', () => {
    const state = line(
      [
        ['a', []],
        ['b', [code]],
        ['cd', []],
      ],
      4
    );
    // Typed at 3 with no key pressed, the text would go into the code.
    expect(names(state.doc.resolve(3).marks())).toEqual(['code']);
    expect(press(state, 'ArrowLeft')).toEqual([3, []]);
  });

  test('keeps the marks of the one letter it goes over', () => {
    // 粗 bold, 后 plain, 码 code, 后 plain: a letter to each run.
    const state = (at: number) =>
      line(
        [
          ['粗', [strong]],
          ['后', []],
          ['码', [code]],
          ['后', []],
        ],
        at
      );
    expect(press(state(2), 'ArrowRight')).toEqual([3, []]);
    expect(press(state(5), 'ArrowLeft')).toEqual([4, []]);
  });

  test('leaves the edges of bold and links to the arrows', () => {
    const state = (mark: Mark, at: number) =>
      line(
        [
          ['a', []],
          ['b', [mark]],
          ['cd', []],
        ],
        at
      );
    for (const mark of [strong, link]) {
      for (const at of [2, 3]) {
        expect(press(state(mark, at), 'ArrowLeft')).toBeNull();
        expect(press(state(mark, at), 'ArrowRight')).toBeNull();
      }
      expect(press(state(mark, 4), 'ArrowLeft')).toBeNull();
      expect(press(state(mark, 1), 'ArrowRight')).toBeNull();
    }
  });
});

describe('outsideAtEdge', () => {
  test('puts the caret after code at the end of a line', () => {
    const tr = outsideAtEdge(codeAtEnd, 1);
    expect(names(tr?.storedMarks)).toEqual([]);
  });

  test('puts it before code opening a line', () => {
    const state = line(
      [
        ['npm', [code]],
        [' 是', []],
      ],
      1
    );
    expect(names(outsideAtEdge(state, -1)?.storedMarks)).toEqual([]);
  });

  test('leaves bold, links and lines that end in text alone', () => {
    expect(outsideAtEdge(line([['粗', [strong]]], 2), 1)).toBeNull();
    expect(outsideAtEdge(line([['官网', [link]]], 3), 1)).toBeNull();
    expect(outsideAtEdge(line([['文', []]], 2), 1)).toBeNull();
  });

  test('acts only at the edge of the line', () => {
    expect(outsideAtEdge(codeAtEnd, -1)).toBeNull();
  });
});

describe('clickedSide', () => {
  const on = (tag: string | null) =>
    ({
      closest: (selector: string) => (selector === tag ? {} : null),
    }) as unknown as Element;

  test('takes the code clicked on and leaves it for a click past it', () => {
    const $pos = codeAtEnd.selection.$head;
    expect(names(clickedSide($pos, on('code')))).toEqual(['code']);
    expect(names(clickedSide($pos, on(null)))).toEqual([]);
  });

  test('leaves a link to its mark, which takes nothing typed at its ends', () => {
    const state = line(
      [
        ['看', []],
        ['官网', [link]],
        ['吧', []],
      ],
      4
    );
    const $pos = state.selection.$head;
    expect(clickedSide($pos, on('a'))).toBeNull();
    expect(clickedSide($pos, on(null))).toBeNull();
  });

  test('leaves edges of other marks to the browser', () => {
    const state = line([['粗', [strong]]], 2);
    expect(clickedSide(state.selection.$head, on(null))).toBeNull();
  });
});

describe('outsideAfterPaste', () => {
  test('leaves the caret after a pasted link, in the bold around it', () => {
    const state = line(
      [
        ['见 ', [strong]],
        ['https://e.com', [strong, link]],
        ['后', [strong]],
      ],
      16
    );
    expect(names(outsideAfterPaste(state)?.storedMarks)).toEqual(['strong']);
  });

  test('leaves it where nothing pasted ends', () => {
    expect(outsideAfterPaste(line([['文', []]], 2))).toBeNull();
    expect(outsideAfterPaste(codeAtEnd.apply(codeAtEnd.tr))).not.toBeNull();
    expect(outsideAfterPaste(line([['粗', [strong]]], 2))).toBeNull();
  });
});
