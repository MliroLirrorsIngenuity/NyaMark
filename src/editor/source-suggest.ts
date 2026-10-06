/**
 * The suggestions while writing, in the source pane: grey after the caret,
 * taken with Tab or Mod-→ and let go as in the editor (see
 * `plugins/ai-suggest.ts`). The Markdown is suggested as it is typed here.
 */

import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import {
  SPOT_AFTER,
  SPOT_BEFORE,
  type SuggestSpot,
  nextWord,
  suggestDriver,
} from './suggest';

type Suggestion = { pos: number; text: string };

/** Shows a suggestion; the driver's spots dispatch it. */
export const showSuggestion = StateEffect.define<Suggestion>();
const clearSuggestion = StateEffect.define<null>();

type TreeNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

/** Where the source is code, and no prose goes. */
const CODE = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'HTMLBlock',
  'BlockMath',
  'FrontMatter',
]);

class Ghost extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: Ghost) {
    return other.text === this.text;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'ny-ai-suggest';
    span.textContent = this.text;
    return span;
  }
}

/** What is left once `tr` typed the start of it, or null. */
function typedInto(tr: Transaction, suggestion: Suggestion): Suggestion | null {
  let typed: string | null = null;
  let changes = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes += 1;
    if (fromA === suggestion.pos && toA === suggestion.pos) {
      typed = inserted.toString();
    }
  });
  if (changes !== 1 || !typed) return null;
  const text: string = typed;
  if (!suggestion.text.startsWith(text)) return null;
  const rest = suggestion.text.slice(text.length);
  return rest ? { pos: suggestion.pos + text.length, text: rest } : null;
}

const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(showSuggestion)) return effect.value;
      if (effect.is(clearSuggestion)) return null;
    }
    if (!value) return null;
    const next = tr.docChanged ? typedInto(tr, value) : value;
    const { main } = tr.state.selection;
    if (!next || !main.empty || main.head !== next.pos) return null;
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) =>
      value
        ? Decoration.set([
            Decoration.widget({ widget: new Ghost(value.text), side: 1 }).range(
              value.pos
            ),
          ])
        : Decoration.none
    ),
});

/** The suggestion shown in the source pane, if any. */
export function sourceSuggestionOf(state: EditorState): Suggestion | null {
  return state.field(suggestionField, false) ?? null;
}

function spotIn(view: EditorView): SuggestSpot | null {
  const { state } = view;
  if (view.composing || !view.hasFocus) return null;
  if (state.field(suggestionField)) return null;
  const { main } = state.selection;
  if (!main.empty) return null;
  const head = main.head;
  let node: TreeNode | null = syntaxTree(state).resolveInner(head, -1);
  while (node) {
    if (CODE.has(node.name)) return null;
    node = node.parent;
  }
  const { doc } = state;
  const line = doc.lineAt(head);
  return {
    before: doc.sliceString(Math.max(0, head - SPOT_BEFORE), head),
    after: doc.sliceString(head, Math.min(doc.length, head + SPOT_AFTER)),
    line: line.text.slice(0, head - line.from),
    atEnd: !line.text.slice(head - line.from).trim(),
    markdown: true,
    show(text) {
      const now = view.state;
      if (now.doc !== doc || !view.hasFocus || view.composing) return;
      const { main: caret } = now.selection;
      if (!caret.empty || caret.head !== head) return;
      view.dispatch({ effects: showSuggestion.of({ pos: head, text }) });
    },
  };
}

function clear(view: EditorView) {
  if (!view.state.field(suggestionField)) return false;
  view.dispatch({ effects: clearSuggestion.of(null) });
  return true;
}

/** Puts `text` in at the suggestion, as typing it would. */
function take(view: EditorView, part: (text: string) => string) {
  const suggestion = view.state.field(suggestionField);
  if (!suggestion) return false;
  const text = part(suggestion.text);
  const pos = suggestion.pos + text.length;
  view.dispatch({
    changes: { from: suggestion.pos, insert: text },
    selection: { anchor: pos },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
  return true;
}

/** Its grey text is styled with the editor's, which is always there first. */
export function sourceSuggest(): Extension {
  return [
    suggestionField,
    // Ahead of Tab's indent and of Mod-→'s end of line.
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: (view) => take(view, (text) => text) },
        { key: 'Mod-ArrowRight', run: (view) => take(view, nextWord) },
        { key: 'Escape', run: clear },
      ])
    ),
    EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        clear(view);
        return false;
      },
      blur: (_event, view) => {
        clear(view);
        suggestDriver()?.stop();
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      const driver = suggestDriver();
      if (!driver) return;
      const typed = update.transactions.some(
        (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete')
      );
      if (!typed && !update.selectionSet) return;
      driver.changed(() => spotIn(update.view), typed);
    }),
  ];
}
