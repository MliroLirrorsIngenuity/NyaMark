/**
 * A math or Mermaid block shows what it draws, and its source only while the
 * caret is in it, as in Typora.
 *
 * Crepe shows both, the source above the drawing, with a button to hide the
 * source by hand. A note with a few formulas read as a page of code with the
 * formulas tucked under it. Arrow keys and clicks that enter the block bring
 * the source back; leaving it puts it away again. A block picked up whole,
 * from its handle to be moved, keeps to its drawing: it opened under the hand
 * and grew by the height of its source as the drag began.
 *
 * The block holding the caret gets a node decoration rather than a class set
 * by a plugin view: the decoration is on the block before ProseMirror hands
 * the selection to the code block, which focuses CodeMirror, and a hidden
 * CodeMirror cannot take focus. Crepe's code block accepts the decoration in
 * `update()`, so CodeMirror is kept.
 */

import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const pluginKey = new PluginKey('nyamark/code-preview');

const EDITING_CLASS = 'ny-code-editing';

function editingRange(state: EditorState): [number, number] | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return null;
  const { $from, $to } = selection;
  if ($from.parent.type.name !== 'code_block' || !$from.sameParent($to)) {
    return null;
  }
  return [$from.before(), $from.after()];
}

const ARROWS: Record<string, ['up' | 'down' | 'left' | 'right', number]> = {
  ArrowUp: ['up', -1],
  ArrowDown: ['down', 1],
  ArrowLeft: ['left', -1],
  ArrowRight: ['right', 1],
};

/**
 * An arrow key at the edge of a textblock went into the code block next to it
 * by moving the browser's caret into CodeMirror. With the source hidden there
 * was nothing to move into, and the caret skipped the block. The selection
 * goes there instead, which brings the source back.
 */
function enterHiddenBlock(view: EditorView, event: KeyboardEvent) {
  const arrow = ARROWS[event.key];
  if (!arrow || event.shiftKey || event.altKey || event.metaKey) return false;
  const [direction, dir] = arrow;
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  if (!view.endOfTextblock(direction)) return false;
  const { $head } = selection;
  const side = view.state.doc.resolve(dir < 0 ? $head.before() : $head.after());
  const next = Selection.findFrom(side, dir);
  if (!(next instanceof TextSelection)) return false;
  if (next.$head.parent.type.name !== 'code_block') return false;
  const dom = view.nodeDOM(next.$head.before());
  if (
    !(dom instanceof HTMLElement) ||
    dom.classList.contains(EDITING_CLASS) ||
    !dom.querySelector(':scope > .preview-panel')
  ) {
    return false;
  }
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  return true;
}

export const codePreview = $prose(
  () =>
    new Plugin({
      key: pluginKey,
      props: {
        decorations(state) {
          const range = editingRange(state);
          if (!range) return DecorationSet.empty;
          return DecorationSet.create(state.doc, [
            Decoration.node(range[0], range[1], { class: EDITING_CLASS }),
          ]);
        },
        handleKeyDown: enterHiddenBlock,
      },
      view: (view) => {
        // The block swallows its own events (`stopEvent`), so a click on the
        // drawing never reached ProseMirror and did nothing.
        const onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement;
          const block = target.closest('.milkdown-code-block');
          if (
            !block ||
            block.classList.contains(EDITING_CLASS) ||
            !target.closest('.preview-panel')
          ) {
            return;
          }
          let end = -1;
          view.state.doc.descendants((node, pos) => {
            if (end >= 0) return false;
            if (
              node.type.name === 'code_block' &&
              view.nodeDOM(pos) === block
            ) {
              end = pos + 1 + node.content.size;
            }
            return true;
          });
          if (end < 0) return;
          event.preventDefault();
          view.focus();
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, end)
            )
          );
        };
        view.dom.addEventListener('mousedown', onMouseDown);
        return {
          destroy: () => view.dom.removeEventListener('mousedown', onMouseDown),
        };
      },
    })
);
