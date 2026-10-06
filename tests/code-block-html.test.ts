import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  codeText,
  formulaAsMath,
  languageFromClasses,
  markFences,
  writeCode,
} from '../src/editor/plugins/code-block-html';

type Fake = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: Fake[];
};

const text = (value: string): Fake => ({
  nodeType: 3,
  nodeName: '#text',
  nodeValue: value,
  childNodes: [],
});
const el = (name: string, ...children: Fake[]): Fake => ({
  nodeType: 1,
  nodeName: name,
  nodeValue: null,
  childNodes: children,
});

describe('languageFromClasses', () => {
  test('reads the classes pages name a language with', () => {
    expect(languageFromClasses(['language-js'])).toBe('js');
    expect(languageFromClasses(['hljs lang-python'])).toBe('python');
    expect(languageFromClasses(['highlight highlight-source-rust'])).toBe(
      'rust'
    );
    expect(languageFromClasses(['brush: ts notranslate'])).toBe('ts');
    expect(languageFromClasses(['language-c++'])).toBe('c++');
  });

  test('takes the first that names one', () => {
    expect(languageFromClasses([null, 'x', 'language-go', 'language-js'])).toBe(
      'go'
    );
  });

  test('is empty where none does', () => {
    expect(languageFromClasses([undefined, '', 'highlight notranslate'])).toBe(
      ''
    );
  });
});

describe('codeText', () => {
  test('keeps the text as it is', () => {
    const pre = el('PRE', el('CODE', text('a = 1\n  b = 2\n')));
    expect(codeText(pre)).toBe('a = 1\n  b = 2\n');
  });

  test('breaks the line at a <br>', () => {
    expect(codeText(el('PRE', text('a'), el('BR'), text('b')))).toBe('a\nb');
  });

  test('puts each line element on a line of its own', () => {
    const pre = el(
      'PRE',
      el('DIV', el('SPAN', text('a'))),
      el('DIV', el('BR')),
      el('DIV', text('b'))
    );
    expect(codeText(pre)).toBe('a\n\nb');
  });

  test('reads Windows line breaks as line breaks', () => {
    expect(codeText(el('PRE', text('a\r\nb\rc')))).toBe('a\nb\nc');
  });
});

describe('formulaAsMath', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'code_block+' },
      code_block: {
        content: 'text*',
        code: true,
        attrs: { language: { default: '' }, fenced: { default: false } },
      },
      text: {},
    },
  });
  const block = (language: string, value: string, fenced = false) =>
    schema.node(
      'code_block',
      { language, fenced },
      value ? schema.text(value) : []
    );
  const write = (node: ReturnType<typeof block>) => {
    const out: unknown[][] = [];
    const state = { addNode: (...args: unknown[]) => out.push(args) };
    const runner = formulaAsMath(() => out.push(['code']));
    runner(state as never, node);
    return out;
  };

  test('writes a formula as math, between $$ lines', () => {
    expect(write(block('LaTeX', 'x^2'))).toEqual([['math', undefined, 'x^2']]);
    expect(write(block('latex', ''))).toEqual([['math', undefined, '']]);
  });

  test('leaves other code to the code block', () => {
    expect(write(block('js', 'let a'))).toEqual([['code']]);
    expect(write(block('', 'x^2'))).toEqual([['code']]);
  });

  test('keeps LaTeX the file fenced as code', () => {
    expect(write(block('latex', 'x^2', true))).toEqual([['code']]);
  });
});

describe('markFences', () => {
  test('marks the code blocks of the file, and no formula', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(markFences);
    const markdown = '```latex\nx^2\n```\n\n$$\ny^2\n$$\n\n    indented\n';
    type Tree = {
      type: string;
      data?: { fenced?: boolean };
      children?: Tree[];
    };
    const tree = processor.runSync(processor.parse(markdown)) as Tree;
    expect(
      tree.children?.map((node) => [node.type, node.data?.fenced === true])
    ).toEqual([
      ['code', true],
      ['math', false],
      ['code', true],
    ]);
  });
});

describe('writeCode', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'code_block+' },
      code_block: {
        content: 'text*',
        code: true,
        attrs: { language: { default: '' }, meta: { default: '' } },
      },
      text: {},
    },
  });
  const write = (language: string, meta: string) => {
    const out: unknown[][] = [];
    const state = { addNode: (...args: unknown[]) => out.push(args) };
    const node = schema.node('code_block', { language, meta }, [
      schema.text('let a'),
    ]);
    writeCode(state as never, node);
    return out;
  };

  test('keeps what the fence names after the language', () => {
    expect(write('js', 'title="a.js" {1,3}')).toEqual([
      ['code', undefined, 'let a', { lang: 'js', meta: 'title="a.js" {1,3}' }],
    ]);
    expect(write('js', '')).toEqual([
      ['code', undefined, 'let a', { lang: 'js', meta: undefined }],
    ]);
  });
});
