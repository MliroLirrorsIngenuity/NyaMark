import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  frontMatterOf,
  frontMatterOnTop,
  pastFrontMatter,
} from '../src/editor/plugins/front-matter';

type Tree = { type: string; value?: string; children?: Tree[] };

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkStringify, { rule: '-' });

const write = (tree: Tree) =>
  processor.stringify(frontMatterOnTop(tree) as never);

describe('frontMatterOnTop', () => {
  test('writes front matter at the top back between its fences', () => {
    const markdown = '---\ntitle: 测试\ntags: [a, b]\n---\n\n# 标题\n';
    expect(write(processor.parse(markdown) as Tree)).toBe(markdown);
    const toml = '+++\ntitle = "x"\n+++\n\n正文\n';
    expect(write(processor.parse(toml) as Tree)).toBe(toml);
  });

  test('writes it as a code block anywhere else', () => {
    const tree = processor.parse('# 标题\n') as Tree;
    tree.children?.push({ type: 'yaml', value: 'title: x' });
    expect(write(tree)).toBe('# 标题\n\n```yaml\ntitle: x\n```\n');
  });
});

describe('pastFrontMatter', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*' },
      code_block: {
        group: 'block',
        content: 'text*',
        code: true,
        attrs: { frontMatter: { default: '' } },
      },
      text: {},
    },
  });
  const code = (frontMatter: string) =>
    schema.node('code_block', { frontMatter }, [schema.text('title: x')]);
  const caret = (...blocks: ReturnType<typeof code>[]) => {
    const state = EditorState.create({ doc: schema.node('doc', null, blocks) });
    const { $head } = pastFrontMatter(state.tr).selection;
    return [$head.parent.type.name, $head.parentOffset];
  };
  const p = schema.node('paragraph', null, [schema.text('正文')]);

  test('starts the caret on the first line of text', () => {
    expect(caret(code('yaml'), p)).toEqual(['paragraph', 0]);
  });

  test('leaves it in a code block that opens the page', () => {
    expect(caret(code(''), p)).toEqual(['code_block', 0]);
    expect(caret(code('yaml'))).toEqual(['code_block', 0]);
  });
});

describe('frontMatterOf', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*' },
      code_block: {
        group: 'block',
        content: 'text*',
        code: true,
        attrs: { frontMatter: { default: '' }, language: { default: '' } },
      },
      text: {},
    },
  });
  const code = (frontMatter: string, language: string) =>
    schema.node('code_block', { frontMatter, language }, [
      schema.text('title: x'),
    ]);
  const p = schema.node('paragraph', null, [schema.text('正文')]);
  const of = (...blocks: ReturnType<typeof code>[]) =>
    frontMatterOf(schema.node('doc', null, blocks));

  test('reads the front matter the file opens with', () => {
    expect(of(code('yaml', 'yaml'), p)).toEqual({
      kind: 'yaml',
      source: 'title: x',
    });
  });

  test('reads none from what is saved as a code block', () => {
    expect(of(code('yaml', 'json'), p)).toBeNull();
    expect(of(code('', 'yaml'), p)).toBeNull();
    expect(of(p, code('yaml', 'yaml'))).toBeNull();
  });
});
