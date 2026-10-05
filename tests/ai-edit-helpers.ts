/**
 * A small Markdown for the proposal tests: headings, paragraphs with bold,
 * quotes, tight bullet lists, code fences and rules, read into a schema
 * with the node names the editor uses. Enough of Markdown's ways to test
 * that edits are read back block by block, an unclosed fence among them.
 */

import { type Node, Schema } from '@milkdown/kit/prose/model';
import type { EditEnv } from '../src/ai/edit/propose';
import type { BlockSpan } from '../src/editor/source-caret';

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 }, id: { default: '' } },
    },
    blockquote: { group: 'block', content: 'block+' },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { spread: { default: false } },
    },
    list_item: {
      content: 'paragraph block*',
      attrs: {
        label: { default: '•' },
        spread: { default: false },
        checked: { default: null },
      },
    },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      marks: '',
      attrs: { language: { default: '' } },
    },
    hr: { group: 'block' },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
});

export function inline(text: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push(schema.text(text.slice(last, at)));
    out.push(schema.text(match[1], [schema.marks.strong.create()]));
    last = at + match[0].length;
  }
  if (last < text.length) out.push(schema.text(text.slice(last)));
  return out;
}

export const p = (text = '') => schema.node('paragraph', null, inline(text));
export const h = (level: number, text: string) =>
  schema.node('heading', { level, id: slug(text) }, inline(text));
export const quote = (...blocks: Node[]) =>
  schema.node('blockquote', null, blocks);
export const ul = (...items: string[]) =>
  schema.node(
    'bullet_list',
    null,
    items.map((item) => schema.node('list_item', null, [p(item)]))
  );
export const code = (text: string, language = '') =>
  schema.node('code_block', { language }, text ? schema.text(text) : []);
export const hr = () => schema.node('hr');
export const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

function slug(text: string) {
  return text.toLowerCase().replace(/\*/g, '').trim().replace(/\s+/g, '-');
}

type Line = { text: string; start: number; end: number };

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const part of text.split('\n')) {
    lines.push({ text: part, start, end: start + part.length });
    start += part.length + 1;
  }
  return lines;
}

const starts = (line: string) =>
  /^(#{1,6} |> ?|- |```|---$)/.test(line) || line.trim() === '';

function parseLines(lines: Line[]): { nodes: Node[]; spans: BlockSpan[] } {
  const nodes: Node[] = [];
  const spans: BlockSpan[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.text.trim() === '') {
      i++;
      continue;
    }
    const from = line.start;
    let to = line.end;
    if (line.text.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].text !== '```') {
        body.push(lines[i].text);
        to = lines[i].end;
        i++;
      }
      if (i < lines.length) to = lines[i].end;
      i++;
      // An unclosed fence runs to the end, its trailing blank lines dropped.
      while (body.length && body[body.length - 1] === '') body.pop();
      nodes.push(code(body.join('\n'), line.text.slice(3)));
    } else if (/^#{1,6} /.test(line.text)) {
      const level = line.text.indexOf(' ');
      nodes.push(h(level, line.text.slice(level + 1)));
      i++;
    } else if (line.text === '---') {
      nodes.push(hr());
      i++;
    } else if (line.text.startsWith('>')) {
      const inner: Line[] = [];
      while (i < lines.length && lines[i].text.startsWith('>')) {
        const text = lines[i].text.replace(/^> ?/, '');
        inner.push({ text, start: 0, end: text.length });
        to = lines[i].end;
        i++;
      }
      const parsed = parseLines(inner);
      nodes.push(quote(...(parsed.nodes.length ? parsed.nodes : [p()])));
    } else if (line.text.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].text.startsWith('- ')) {
        items.push(lines[i].text.slice(2));
        to = lines[i].end;
        i++;
      }
      nodes.push(ul(...items));
    } else {
      const words: string[] = [line.text];
      i++;
      while (i < lines.length && !starts(lines[i].text)) {
        words.push(lines[i].text);
        to = lines[i].end;
        i++;
      }
      nodes.push(p(words.join(' ')));
    }
    spans.push({ from, to });
  }
  return { nodes, spans };
}

export function parse(text: string): Node {
  const { nodes } = parseLines(linesOf(text));
  return doc(...(nodes.length ? nodes : [p()]));
}

function writeInline(node: Node): string {
  let out = '';
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const text = child.text ?? '';
    out += child.marks.length ? `**${text}**` : text;
  }
  return out;
}

function writeBlock(node: Node): string {
  switch (node.type.name) {
    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${writeInline(node)}`;
    case 'code_block':
      return `\`\`\`${node.attrs.language}\n${node.textContent}\n\`\`\``;
    case 'hr':
      return '---';
    case 'blockquote':
      return writeBlocks(node)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bullet_list': {
      const items: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        items.push(`- ${writeInline(node.child(i).firstChild as Node)}`);
      }
      return items.join('\n');
    }
    default:
      return writeInline(node);
  }
}

function writeBlocks(node: Node): string {
  const blocks: string[] = [];
  for (let i = 0; i < node.childCount; i++)
    blocks.push(writeBlock(node.child(i)));
  return blocks.join('\n\n');
}

export function serialize(node: Node): string {
  return `${writeBlocks(node)}\n`;
}

export const env: EditEnv = {
  parse,
  serialize,
  blockSpans: (text) => parseLines(linesOf(text)).spans,
};
