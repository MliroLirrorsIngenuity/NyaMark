import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, type Transaction } from '@milkdown/kit/prose/state';
import {
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
