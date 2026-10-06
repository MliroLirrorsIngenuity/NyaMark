/**
 * Cmd+Z takes back a line at a time. ProseMirror keeps changes made within
 * half a second of each other as one step, and typed straight on, a
 * paragraph, the line under it and a code block after them went at a single
 * Cmd+Z. Enter now begins a step of its own, in text and in code: the line it
 * opens goes back with what was typed on it, and the lines above stay.
 *
 * A paste is a step of its own too. Cmd+Z after one took back what was typed
 * before it as well, and what was typed after it went back with the paste.
 *
 * Cmd+Z straight after Markdown typed was made into what it stands for, a
 * heading of `## `, a list of `- `, bold of `**…**`, gives back the characters
 * as they were typed, the way a Mac takes back an autocorrection. It took them
 * away with the rest of the line, and the heading or list could not be had as
 * text. The rule's own record of what it did is lost at once for a list or a
 * quote, to the empty line put in after them and the list's own setting of
 * the caret, so the record is kept here through those.
 */

import { closeHistory } from '@milkdown/kit/prose/history';
import { undoInputRule } from '@milkdown/kit/prose/inputrules';
import {
  EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { Transform } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** Makes what is about to be pasted in `view` a step of its own. */
export function pasteApart(view: EditorView) {
  view.dispatch(closeHistory(view.state.tr));
  // Once the paste is in, which happens within the same event.
  queueMicrotask(() => view.dispatch(closeHistory(view.state.tr)));
}

/**
 * The last rule's record, kept as its plugin wrote it, and the changes put in
 * after it at once.
 */
export type Typed = { rules: Plugin; record: unknown; after: Transform[] };

/**
 * The rule work Cmd+Z can still give back after `tr`: kept through changes
 * appended to it and through the caret set again where it is, gone with
 * anything typed or the caret moved.
 */
export function typedAfter(
  typed: Typed | null,
  tr: Transaction,
  old: EditorState,
  state: EditorState
): Typed | null {
  for (const rules of state.plugins) {
    if (!rules.spec.isInputRules) continue;
    const record: unknown = tr.getMeta(rules);
    if (record) return { rules, record, after: [] };
  }
  if (!typed) return null;
  if (tr.docChanged) {
    if (!tr.getMeta('appendedTransaction')) return null;
    return { ...typed, after: [...typed.after, tr] };
  }
  if (tr.selectionSet && !state.selection.eq(old.selection)) return null;
  return typed;
}

function takeBack(tr: Transaction, done: Transform) {
  for (let i = done.steps.length - 1; i >= 0; i--) {
    tr.step(done.steps[i].invert(done.docs[i]));
  }
}

/** Undoes the rule and what came with it, and puts back what was typed. */
export function giveBackTyped(
  state: EditorState,
  typed: Typed
): Transaction | null {
  const tr = state.tr;
  for (const done of [...typed.after].reverse()) takeBack(tr, done);
  const ruled = EditorState.create({
    doc: tr.doc,
    selection: tr.selection,
    plugins: [typed.rules],
  });
  let undone: Transaction | null = null;
  undoInputRule(
    ruled.apply(ruled.tr.setMeta(typed.rules, typed.record)),
    (next) => {
      undone = next;
    }
  );
  if (!undone) return null;
  for (const step of (undone as Transaction).steps) tr.step(step);
  return tr;
}

function isUndo(event: KeyboardEvent): boolean {
  if (event.shiftKey || event.altKey || event.isComposing) return false;
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
}

const key = new PluginKey<Typed | null>('nyamark/undo-by-line');

export const undoByLine = $prose(
  () =>
    new Plugin<Typed | null>({
      key,
      state: {
        init: () => null,
        apply: (tr, typed, old, state) => typedAfter(typed, tr, old, state),
      },
      props: {
        handleDOMEvents: {
          paste(view) {
            pasteApart(view);
            return false;
          },
          // Ahead of the history's own Cmd+Z.
          keydown(view, event) {
            const typed = key.getState(view.state);
            if (!typed || !isUndo(event)) return false;
            let tr: Transaction | null;
            try {
              tr = giveBackTyped(view.state, typed);
            } catch {
              return false;
            }
            if (!tr) return false;
            view.dispatch(tr);
            event.preventDefault();
            return true;
          },
        },
      },
      view(view) {
        // On the way down, ahead of the text's keys and a code block's.
        const begin = (event: KeyboardEvent) => {
          if (event.key !== 'Enter' || event.isComposing) return;
          if (event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
          if (event.altKey) return;
          view.dispatch(closeHistory(view.state.tr));
        };
        view.dom.addEventListener('keydown', begin, true);
        return {
          destroy: () => view.dom.removeEventListener('keydown', begin, true),
        };
      },
    })
);
