import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  blockSpans,
  docPosition,
  sourceOffset,
} from '../src/editor/source-caret';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    code_block: { group: 'block', content: 'text*', code: true },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    hardbreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
});

const p = (...content: Array<string | Node>) =>
  schema.node(
    'paragraph',
    null,
    content.map((part) => (typeof part === 'string' ? schema.text(part) : part))
  );
const strong = (text: string) => schema.text(text, [schema.mark('strong')]);
const br = () => schema.node('hardbreak');
const h = (text: string) => schema.node('heading', null, schema.text(text));
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const code = (text: string) =>
  schema.node('code_block', null, schema.text(text));
const item = (...blocks: Node[]) => schema.node('list_item', null, blocks);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

const spansOf = (markdown: string) =>
  blockSpans(unified().use(remarkParse).use(remarkGfm).parse(markdown));

/** Document position just after the first `text` in it. */
function endOf(start: Node, text: string) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text)) {
      at = pos + (node.text.indexOf(text) + text.length);
    }
    return at < 0;
  });
  return at;
}

/** Document position at the start of the textblock that begins with `text`. */
function startOf(start: Node, text: string) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent.startsWith(text)) {
      at = pos + 1;
    }
    return at < 0;
  });
  return at;
}

describe('sourceOffset', () => {
  test('steps over emphasis and link markup', () => {
    const markdown = '这是 **粗体** 和 [链接](https://example.com)。\n';
    const start = doc(p('这是 ', strong('粗体'), ' 和 链接。'));
    const spans = spansOf(markdown);
    expect(sourceOffset(start, endOf(start, '粗体'), markdown, spans)).toBe(
      markdown.indexOf('粗体') + 2
    );
    expect(sourceOffset(start, endOf(start, '链接'), markdown, spans)).toBe(
      markdown.indexOf('链接') + 2
    );
  });

  test('starts a selection after the markup it begins at', () => {
    const markdown = '这是 *斜体* 了\n';
    const start = doc(p('这是 ', strong('斜体'), ' 了'));
    const spans = spansOf(markdown);
    const before = endOf(start, '这是 ');
    expect(sourceOffset(start, before, markdown, spans)).toBe(3);
    expect(sourceOffset(start, before, markdown, spans, 1)).toBe(4);
  });

  test('puts the start of a block after its markers', () => {
    const markdown = '# 标题\n\n- [x] x 项\n- 二\n';
    const start = doc(h('标题'), list(item(p('x 项')), item(p('二'))));
    const spans = spansOf(markdown);
    expect(sourceOffset(start, startOf(start, '标题'), markdown, spans)).toBe(
      2
    );
    expect(sourceOffset(start, startOf(start, 'x 项'), markdown, spans)).toBe(
      markdown.indexOf('x 项')
    );
    expect(sourceOffset(start, startOf(start, '二'), markdown, spans)).toBe(
      markdown.indexOf('二')
    );
  });

  test('starts a code block after its fence', () => {
    const markdown = '```js\ns = 1;\n```\n';
    const start = doc(code('s = 1;'));
    expect(
      sourceOffset(start, startOf(start, 's'), markdown, spansOf(markdown))
    ).toBe(markdown.indexOf('s = 1'));
  });

  test('sends the empty paragraph after the last block to the end', () => {
    const markdown = '> 引用\n';
    const start = doc(quote(p('引用')), p());
    expect(
      sourceOffset(start, start.content.size - 1, markdown, spansOf(markdown))
    ).toBe(markdown.length);
  });
});

describe('docPosition', () => {
  const markdown = '- 一\n- 二\n';
  const start = doc(list(item(p('一')), item(p('二'))));
  const spans = spansOf(markdown);

  test('keeps a caret at the end of a line on that line', () => {
    expect(
      docPosition(start, markdown.indexOf('一') + 1, markdown, spans)
    ).toBe(endOf(start, '一'));
  });

  test('takes a caret among the markers to the start of the text', () => {
    const line = markdown.indexOf('- 二');
    expect(docPosition(start, line, markdown, spans)).toBe(
      startOf(start, '二')
    );
    expect(docPosition(start, line + 1, markdown, spans)).toBe(
      startOf(start, '二')
    );
  });

  test('goes to the end of the document past the last block', () => {
    expect(docPosition(start, markdown.length, markdown, spans)).toBe(
      endOf(start, '二')
    );
  });
});

test('every caret in the text survives the round trip', () => {
  const markdown = [
    '# 第一章 开始',
    '',
    '这是 **粗体** 一段，a\\',
    'b 换行。',
    '',
    '> 引用第一行',
    '> 引用第二行',
    '',
    '- 列表一',
    '- 列表二',
    '  - 子项',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
  ].join('\n');
  const start = doc(
    h('第一章 开始'),
    p('这是 ', strong('粗体'), ' 一段，a', br(), 'b 换行。'),
    quote(p('引用第一行\n引用第二行')),
    list(item(p('列表一')), item(p('列表二'), list(item(p('子项'))))),
    code('const a = 1;')
  );
  const spans = spansOf(markdown);
  start.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (let at = pos + 1; at <= pos + 1 + node.content.size; at++) {
      const offset = sourceOffset(start, at, markdown, spans);
      expect({ at, back: docPosition(start, offset, markdown, spans) }).toEqual(
        { at, back: at }
      );
    }
    return false;
  });
});
