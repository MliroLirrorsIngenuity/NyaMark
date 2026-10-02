/**
 * The word a language chosen from a code block's list goes into the fence as.
 * Crepe wrote the name the list shows, so the fence read ```Rust, and one
 * with a space, ```Common Lisp, came back from the file as "Common", the rest
 * of the line read as something else. The fence gets the name in lower case;
 * a name with a space, the first of its other names without one, or failing
 * that the name hyphenated, which `codeLanguages` adds to the language's names
 * so the block is still highlighted.
 *
 * A fence typed or read from a file keeps the word it has.
 */

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  type EditorState,
  Plugin,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { AttrStep } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';

type Language = { name: string; alias: readonly string[] };

/** The word `language` is written into a fence as. */
export function fenceWord(language: Language) {
  const name = language.name.toLowerCase();
  if (!/\s/.test(name)) return name;
  return (
    language.alias.find((alias) => !/\s/.test(alias)) ??
    name.replace(/\s+/g, '-')
  );
}

/**
 * Extensions a fence names its language by, as ```py, ```rs and ```md do.
 * language-data had them only as file extensions, and such a block was left
 * plain, its Python unindented after a colon. Taken: an extension one language
 * has and no other has as a name. Left: Troff's numbers, and words a fence
 * means something else by, as ```text is plain text and LaTeX's extension.
 */
const OTHER_MEANING = new Set(['text', 'in', 'cfg', 'map', 'build', 'spec']);

const NAMES = new Set(
  languages.flatMap((language) => [
    language.name.toLowerCase(),
    ...language.alias,
  ])
);

const EXTENSION_COUNT = new Map<string, number>();
for (const language of languages) {
  for (const extension of new Set(
    language.extensions.map((each) => each.toLowerCase())
  )) {
    EXTENSION_COUNT.set(extension, (EXTENSION_COUNT.get(extension) ?? 0) + 1);
  }
}

function fenceExtensions(language: LanguageDescription) {
  return Array.from(
    new Set(language.extensions.map((each) => each.toLowerCase()))
  ).filter(
    (extension) =>
      EXTENSION_COUNT.get(extension) === 1 &&
      !NAMES.has(extension) &&
      !OTHER_MEANING.has(extension) &&
      !/^\d+$|\./.test(extension)
  );
}

/** The languages code is highlighted in, each known by its fence word. */
export const codeLanguages = languages.map((language) => {
  const known = [...language.alias, ...fenceExtensions(language)];
  const word = fenceWord({ name: language.name, alias: known });
  const alias = known.includes(word) ? known : [...known, word];
  if (alias.length === language.alias.length) return language;
  return LanguageDescription.of({
    name: language.name,
    alias,
    extensions: language.extensions,
    filename: language.filename,
    load: () => language.load(),
  });
});

const WORDS = new Map(
  codeLanguages.map((language) => [language.name, fenceWord(language)])
);

/** The fence words for the languages `transactions` chose by name. */
export function fenceLanguageWords(
  transactions: readonly Transaction[],
  state: EditorState
): Transaction | null {
  let tr: Transaction | null = null;
  transactions.forEach((transaction, index) => {
    transaction.steps.forEach((step, at) => {
      if (!(step instanceof AttrStep) || step.attr !== 'language') return;
      const word = WORDS.get(String(step.value));
      if (!word || word === step.value) return;
      let mapped = transaction.mapping.slice(at + 1).mapResult(step.pos);
      for (const later of transactions.slice(index + 1)) {
        if (mapped.deleted) return;
        mapped = later.mapping.mapResult(mapped.pos);
      }
      if (mapped.deleted) return;
      const node = state.doc.nodeAt(mapped.pos);
      if (node?.attrs.language !== step.value) return;
      tr ??= state.tr;
      tr.setNodeAttribute(mapped.pos, 'language', word);
    });
  });
  return tr;
}

export const fenceLanguageWord = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, _old, state) =>
        fenceLanguageWords(transactions, state),
    })
);
