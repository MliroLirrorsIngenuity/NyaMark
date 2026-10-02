import { describe, expect, test } from 'bun:test';
import { indentUnit } from '@codemirror/language';
import { EditorState as CodeState } from '@codemirror/state';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, type Transaction } from '@milkdown/kit/prose/state';
import {
  codeIndentUnit,
  codeLanguages,
  fenceLanguageWords,
  fenceWord,
} from '../src/editor/plugins/code-language';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { language: { default: '' } },
    },
    text: {},
  },
});

const language = (name: string) => {
  const found = codeLanguages.find((each) => each.name === name);
  if (!found) throw new Error(name);
  return found;
};

describe('the word a chosen language is fenced with', () => {
  test('is its name in lower case', () => {
    expect(fenceWord(language('Rust'))).toBe('rust');
    expect(fenceWord(language('C++'))).toBe('c++');
    expect(fenceWord(language('JavaScript'))).toBe('javascript');
  });

  test('for a name with a space, another of its names without one', () => {
    expect(fenceWord(language('Common Lisp'))).toBe('lisp');
    expect(fenceWord(language('Properties files'))).toBe('ini');
  });

  test('or else the name hyphenated, which the language answers to', () => {
    expect(fenceWord(language('MS SQL'))).toBe('ms-sql');
    expect(language('MS SQL').alias).toContain('ms-sql');
  });

  test('has no space, for every language listed', () => {
    for (const each of codeLanguages) {
      expect(fenceWord(each)).not.toMatch(/\s/);
      expect(each.alias).toContain(fenceWord(each));
    }
  });
});

describe('a fence word', () => {
  // As Crepe finds the block's language: the word among a language's names.
  const fenced = (word: string) =>
    codeLanguages.find((each) => each.alias.includes(word))?.name ?? null;

  test('that is a file extension names its language', () => {
    expect(fenced('py')).toBe('Python');
    expect(fenced('rs')).toBe('Rust');
    expect(fenced('md')).toBe('Markdown');
    expect(fenced('kt')).toBe('Kotlin');
    expect(fenced('h')).toBe('C');
  });

  test('keeps the language it named already', () => {
    expect(fenced('js')).toBe('JavaScript');
    expect(fenced('ts')).toBe('TypeScript');
    expect(fenced('sh')).toBe('Shell');
  });

  test('names none for an extension two languages share or one a fence means otherwise', () => {
    expect(fenced('m')).toBeNull();
    expect(fenced('text')).toBeNull();
    expect(fenced('1')).toBeNull();
  });
});

describe("a code block's indent", () => {
  const indentIn = async (name: string) =>
    CodeState.create({
      extensions: [await language(name).load(), codeIndentUnit],
    }).facet(indentUnit);

  test('is four spaces in Python and Rust, a tab in Go, two in the rest', async () => {
    expect(await indentIn('Python')).toBe('    ');
    expect(await indentIn('Rust')).toBe('    ');
    expect(await indentIn('Go')).toBe('\t');
    expect(await indentIn('JavaScript')).toBe('  ');
  });

  test('is two spaces in a block with no language', () => {
    expect(
      CodeState.create({ extensions: [codeIndentUnit] }).facet(indentUnit)
    ).toBe('  ');
  });
});

describe('a language chosen from the list', () => {
  const start = () =>
    EditorState.create({
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('a')]),
        schema.node('code_block', { language: 'python' }, [schema.text('x')]),
      ]),
    });
  const choose = (state: EditorState, name: string) =>
    state.tr.setNodeAttribute(3, 'language', name);
  const fencedAs = (state: EditorState, trs: Transaction[]) => {
    const next = trs.reduce((s, tr) => s.apply(tr), state);
    const fixed = fenceLanguageWords(trs, next);
    return (fixed ? next.apply(fixed) : next).doc.child(1).attrs.language;
  };

  test('goes into the fence by its word', () => {
    const state = start();
    expect(fencedAs(state, [choose(state, 'Common Lisp')])).toBe('lisp');
    expect(fencedAs(state, [choose(state, 'Rust')])).toBe('rust');
  });

  test('is found after a later change moved the block', () => {
    const state = start();
    const first = choose(state, 'TypeScript');
    const second = state.apply(first).tr.insertText('bb', 1);
    expect(fencedAs(state, [first, second])).toBe('typescript');
  });

  test('leaves a word that is no name in the list as it is', () => {
    const state = start();
    expect(fencedAs(state, [choose(state, 'js')])).toBe('js');
    expect(fencedAs(state, [choose(state, 'Whatever')])).toBe('Whatever');
  });
});
