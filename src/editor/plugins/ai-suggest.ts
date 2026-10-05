/**
 * The words suggested at the caret while the user writes, drawn grey after
 * it. They are no part of the document until taken: Tab takes them all and
 * Mod-→ the next word, each as typing would put them in. Escape, moving the
 * caret, or typing something else lets them go; typing what they start with
 * takes that much off their front and leaves the rest.
 *
 * What to suggest, and when, comes from the driver in `../suggest`, loaded
 * with the assistant once suggestions are on; this tells it of each change.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { ReplaceStep } from '@milkdown/kit/prose/transform';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { isMacOS } from '../../platform/detect';
import { ensureStyle } from '../../style/register';
import {
  SPOT_AFTER,
  SPOT_BEFORE,
  type SuggestSpot,
  nextWord,
  suggestDriver,
  suggestStyles,
} from '../suggest';
import { ORIGIN_META, proposalKey } from './ai-proposals';

type Suggestion = { pos: number; text: string };

type SuggestState = {
  suggestion: Suggestion | null;
  /** Counts the changes the user typed, for the view to tell them apart. */
  typed: number;
};

type SuggestMeta =
  | { type: 'show'; pos: number; text: string }
  | { type: 'clear' };

const suggestKey = new PluginKey<SuggestState>('nyamark/ai-suggest');

/** A change the user made in the text, by typing, pasting or deleting. */
function typedBy(tr: Transaction) {
  return (
    tr.docChanged &&
    !tr.getMeta('appendedTransaction') &&
    !tr.getMeta(ORIGIN_META) &&
    tr.getMeta('addToHistory') !== false &&
    // Undo and redo, by the history plugin's key.
    !tr.getMeta('history$') &&
    !tr.getMeta(proposalKey)
  );
}

/**
 * The suggestion left once `tr` typed the start of it at its place, or null
 * when `tr` did anything else.
 */
function typedInto(tr: Transaction, suggestion: Suggestion): Suggestion | null {
  if (tr.steps.length !== 1) return null;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) return null;
  if (step.from !== suggestion.pos || step.to !== suggestion.pos) return null;
  const { content, openStart, openEnd } = step.slice;
  if (openStart || openEnd) return null;
  let typed = '';
  for (let index = 0; index < content.childCount; index += 1) {
    const child = content.child(index);
    if (!child.isText || !child.text) return null;
    typed += child.text;
  }
  if (!typed || !suggestion.text.startsWith(typed)) return null;
  const text = suggestion.text.slice(typed.length);
  return text ? { pos: suggestion.pos + typed.length, text } : null;
}

function nextSuggestion(
  tr: Transaction,
  suggestion: Suggestion | null,
  state: EditorState
): Suggestion | null {
  if (!suggestion) return null;
  let next: Suggestion | null = suggestion;
  if (tr.docChanged) {
    next = typedInto(tr, suggestion);
    // What other plugins change after a key, a heading's id or a mark, moves
    // it along.
    if (!next && tr.getMeta('appendedTransaction')) {
      const mapped = tr.mapping.mapResult(suggestion.pos, -1);
      next = mapped.deleted ? null : { ...suggestion, pos: mapped.pos };
    }
  }
  const { selection } = state;
  if (!next || !selection.empty || selection.head !== next.pos) return null;
  return next;
}

/** Text as the model reads it: a line break as one, other leaves as none. */
const leafText = (leaf: ProseNode) =>
  leaf.type.name === 'hardbreak' ? '\n' : '';

/** The suggestion shown, if any. */
export function suggestionOf(state: EditorState): Suggestion | null {
  return suggestKey.getState(state)?.suggestion ?? null;
}

/** Where the caret is, for the driver; null where nothing is suggested. */
export function spotIn(view: EditorView): SuggestSpot | null {
  const { state } = view;
  if (!view.editable || view.composing || !view.hasFocus()) return null;
  if (suggestKey.getState(state)?.suggestion) return null;
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $head = selection.$head;
  const { parent } = $head;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($head.marks().some((mark) => mark.type.spec.code)) return null;
  const head = selection.head;
  const line = parent.textBetween(0, $head.parentOffset, '\n', leafText);
  const rest = parent.textBetween(
    $head.parentOffset,
    parent.content.size,
    '\n',
    leafText
  );
  const before = doc.textBetween(
    Math.max(0, head - SPOT_BEFORE * 2),
    head,
    '\n\n',
    leafText
  );
  const after = doc.textBetween(
    head,
    Math.min(doc.content.size, head + SPOT_AFTER * 2),
    '\n\n',
    leafText
  );
  return {
    before: before.slice(-SPOT_BEFORE),
    after: after.slice(0, SPOT_AFTER),
    line,
    atEnd: !rest.trim(),
    markdown: false,
    show(text) {
      const now = view.state;
      if (now.doc !== doc || !now.selection.empty) return;
      if (now.selection.head !== head || !view.hasFocus() || view.composing) {
        return;
      }
      const meta: SuggestMeta = { type: 'show', pos: head, text };
      view.dispatch(now.tr.setMeta(suggestKey, meta));
    },
  };
}

function clear(view: EditorView) {
  if (!suggestKey.getState(view.state)?.suggestion) return;
  const meta: SuggestMeta = { type: 'clear' };
  view.dispatch(view.state.tr.setMeta(suggestKey, meta));
}

/** Puts `text` in at the suggestion, as typing it would. */
function take(view: EditorView, text: string) {
  const suggestion = suggestKey.getState(view.state)?.suggestion;
  if (!suggestion || !text) return;
  view.dispatch(
    view.state.tr.insertText(text, suggestion.pos).scrollIntoView()
  );
}

function ghost(text: string) {
  const span = document.createElement('span');
  span.className = 'ny-ai-suggest';
  span.textContent = text;
  return span;
}

const plainKey = (event: KeyboardEvent) =>
  !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;

/** Mod-→: Cmd on a Mac, Ctrl elsewhere. */
const wordKey = (event: KeyboardEvent) =>
  event.key === 'ArrowRight' &&
  !event.shiftKey &&
  !event.altKey &&
  (isMacOS()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey);

export function suggestPlugin() {
  return new Plugin<SuggestState>({
    key: suggestKey,
    state: {
      init: () => ({ suggestion: null, typed: 0 }),
      apply(tr, value, _old, state) {
        const typed = typedBy(tr) ? value.typed + 1 : value.typed;
        const meta = tr.getMeta(suggestKey) as SuggestMeta | undefined;
        const suggestion = meta
          ? meta.type === 'show'
            ? { pos: meta.pos, text: meta.text }
            : null
          : nextSuggestion(tr, value.suggestion, state);
        if (suggestion === value.suggestion && typed === value.typed) {
          return value;
        }
        return { suggestion, typed };
      },
    },
    props: {
      decorations(state) {
        const suggestion = suggestKey.getState(state)?.suggestion;
        if (!suggestion) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(suggestion.pos, () => ghost(suggestion.text), {
            side: 1,
            key: `ny-ai-suggest:${suggestion.text}`,
            ignoreSelection: true,
          }),
        ]);
      },
      // Ahead of every other key handler: Tab indents, and Mod-→ goes to
      // the end of the line, only where nothing is suggested.
      handleDOMEvents: {
        keydown(view, event) {
          const suggestion = suggestKey.getState(view.state)?.suggestion;
          if (!suggestion || event.isComposing || view.composing) {
            return false;
          }
          if (event.key === 'Tab' && plainKey(event)) {
            take(view, suggestion.text);
          } else if (wordKey(event)) {
            take(view, nextWord(suggestion.text));
          } else if (event.key === 'Escape' && plainKey(event)) {
            clear(view);
          } else {
            return false;
          }
          event.preventDefault();
          return true;
        },
        // Grey text beside the caret is where WebKit puts what an input
        // method composes.
        compositionstart(view) {
          clear(view);
          return false;
        },
        blur(view) {
          clear(view);
          suggestDriver()?.stop();
          return false;
        },
      },
    },
    view() {
      return {
        update(view, previous) {
          const driver = suggestDriver();
          if (!driver) return;
          const typed =
            suggestKey.getState(view.state)?.typed !==
            suggestKey.getState(previous)?.typed;
          if (!typed && view.state.selection.eq(previous.selection)) return;
          driver.changed(() => spotIn(view), typed);
        },
        destroy() {
          suggestDriver()?.stop();
        },
      };
    },
  });
}

export const aiSuggest = $prose(() => {
  ensureStyle('ny-ai-suggest', suggestStyles);
  return suggestPlugin();
});
