import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { linkSelection, pastedAddress } from '../src/editor/plugins/paste-link';

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

const strong = schema.marks.strong.create();

// "点这里看" with "这里" bold, "https://a.com", then code: 1-5, 7-20, 22-25.
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [
    schema.text('点'),
    schema.text('这里', [strong]),
    schema.text('看'),
  ]),
  schema.node('paragraph', null, [schema.text('https://a.com')]),
  schema.node('code_block', null, [schema.text('abc')]),
]);

function paste(start: Node, anchor: number, head: number, href: string) {
  return linkSelection(
    EditorState.create({
      doc: start,
      selection: TextSelection.create(start, anchor, head),
    }),
    href
  );
}

function clipboard(text: string, files = 0) {
  return {
    files: { length: files },
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as unknown as DataTransfer;
}

describe('an address pasted over text', () => {
  test('makes the text a link, bold kept, the caret after it', () => {
    const tr = paste(doc, 2, 5, 'https://b.com');
    expect(tr).not.toBeNull();
    const line = tr?.doc.child(0);
    expect(line?.textContent).toBe('点这里看');
    const linked: string[] = [];
    for (const child of line?.children ?? []) {
      const link = schema.marks.link.isInSet(child.marks);
      if (link) linked.push(`${child.text}:${link.attrs.href}`);
    }
    expect(linked).toEqual(['这里:https://b.com', '看:https://b.com']);
    expect(
      line?.child(1).marks.some((m) => m.type === schema.marks.strong)
    ).toBe(true);
    expect(tr?.selection.empty && tr.selection.from).toBe(5);
  });

  test('goes in as text over an address, past a line or in code', () => {
    expect(paste(doc, 7, 20, 'https://b.com')).toBeNull();
    expect(paste(doc, 2, 9, 'https://b.com')).toBeNull();
    expect(paste(doc, 22, 24, 'https://b.com')).toBeNull();
    expect(paste(doc, 3, 3, 'https://b.com')).toBeNull();
  });
});

describe('what counts as an address on the clipboard', () => {
  test('one web or mail address alone, spaces round it trimmed', () => {
    expect(pastedAddress(clipboard(' https://e.com/a?b=1 '))).toBe(
      'https://e.com/a?b=1'
    );
    expect(pastedAddress(clipboard('mailto:me@e.com'))).toBe('mailto:me@e.com');
  });

  test('nothing else', () => {
    expect(pastedAddress(clipboard('see https://e.com'))).toBeNull();
    expect(pastedAddress(clipboard('https://e.com\nhttps://f.com'))).toBeNull();
    expect(pastedAddress(clipboard('e.com'))).toBeNull();
    expect(pastedAddress(clipboard('https://e.com/a.png', 1))).toBeNull();
    expect(pastedAddress(null)).toBeNull();
  });
});
