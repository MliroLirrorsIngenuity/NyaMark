import { describe, expect, test } from 'bun:test';
import {
  codeText,
  languageFromClasses,
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
