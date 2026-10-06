import { remarkCtx } from '@milkdown/kit/core';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { canSplit } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';
import type { Root } from 'mdast';
import { toString as plainText } from 'mdast-util-to-string';

export type Parse = (markdown: string) => Root;

const HOLE = '￼';

function beginsBlock(parse: Parse, line: string) {
  const [block, ...rest] = parse(line).children;
  return (
    !!block && !rest.length && block.type !== 'paragraph' && !plainText(block)
  );
}

export function lineAfterBreak(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  parse: Parse
): Transaction | null {
  const $from = state.doc.resolve(from);
  const line = $from.parent;
  if (line.type.name !== 'paragraph') return null;
  if (!$from.sameParent(state.doc.resolve(to))) return null;
  const start = $from.start();
  let opened = -1;
  let closed = -1;
  line.forEach((child, offset) => {
    if (child.type.name !== 'hardbreak' || child.attrs.isInline) return;
    const pos = start + offset;
    if (pos < from) opened = pos;
    else if (closed < 0 && pos >= to) closed = pos;
  });
  if (opened < 0) return null;
  const typed = state.doc.textBetween(opened + 1, from, undefined, HOLE);
  if (!beginsBlock(parse, typed + text)) return null;
  const tr = state.tr;
  const types = [{ type: line.type, attrs: line.attrs }];
  if (closed >= 0) {
    tr.delete(closed, closed + 1);
    if (!canSplit(tr.doc, closed, 1, types)) return null;
    tr.split(closed, 1, types);
  }
  tr.delete(opened, opened + 1);
  if (!canSplit(tr.doc, opened, 1, types)) return null;
  tr.split(opened, 1, types);
  if (opened === start) tr.delete(opened - 1, opened + 1);
  return tr.setSelection(
    TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to))
  );
}

export function typedBlocksPlugin(parse: Parse) {
  return new Plugin({
    key: new PluginKey('nyamark/typed-blocks'),
    props: {
      handleTextInput(view, from, to, text) {
        if (view.composing) return false;
        const split = lineAfterBreak(view.state, from, to, text, parse);
        if (!split) return false;
        view.dispatch(split);
        const at = split.mapping.map(from);
        const end = split.mapping.map(to);
        const insert = () => view.state.tr.insertText(text, at, end);
        if (
          view.someProp('handleTextInput', (handle) =>
            handle(view, at, end, text, insert)
          )
        ) {
          return true;
        }
        const join = view.state.tr;
        for (let index = split.steps.length - 1; index >= 0; index--) {
          join.step(split.steps[index].invert(split.docs[index]));
        }
        view.dispatch(
          join.setSelection(TextSelection.create(join.doc, from, to))
        );
        return false;
      },
    },
  });
}

export const typedBlocks = $prose((ctx) =>
  typedBlocksPlugin((markdown) => ctx.get(remarkCtx).parse(markdown))
);
