import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
  type Step,
  canSplit,
} from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const MAX_LINE = 32;

function inlineStep(step: Step, doc: ProseNode) {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    return true;
  }
  if (!(step instanceof ReplaceStep)) return false;
  const { slice, from, to } = step;
  if (slice.openStart || slice.openEnd) return false;
  if (!slice.content.content.every((node) => node.isInline)) return false;
  const $from = doc.resolve(from);
  return $from.parent.isTextblock && $from.sameParent(doc.resolve(to));
}

export function blockAfterBreak(
  state: EditorState,
  from: number,
  to: number,
  text: string
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
  if (state.doc.textBetween(opened + 1, from).length > MAX_LINE) return null;
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
  const at = tr.mapping.map(from);
  const end = tr.mapping.map(to);
  const temp = EditorState.create({
    doc: tr.doc,
    selection: TextSelection.create(tr.doc, at, end),
  });
  const out: { tr?: Transaction; by?: Plugin } = {};
  const view = {
    state: temp,
    composing: false,
    dispatch: (next: Transaction) => {
      out.tr = next;
    },
  } as unknown as EditorView;
  for (const plugin of state.plugins) {
    if (!plugin.spec.isInputRules) continue;
    const handle = plugin.props.handleTextInput;
    if (!handle) continue;
    const insert = () => temp.tr.insertText(text, at, end);
    if (handle.call(plugin, view, at, end, text, insert) && out.tr) {
      out.by = plugin;
      break;
    }
  }
  const rule = out.tr;
  if (!rule || !out.by) return null;
  if (rule.steps.every((step, index) => inlineStep(step, rule.docs[index]))) {
    return null;
  }
  for (const step of rule.steps) tr.step(step);
  tr.setSelection(Selection.fromJSON(tr.doc, rule.selection.toJSON()));
  if (rule.storedMarks) tr.setStoredMarks(rule.storedMarks);
  if (rule.getMeta(out.by)) {
    tr.setMeta(out.by, { transform: tr, from, to, text });
  }
  return tr.scrollIntoView();
}

export const typedBlocks = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/typed-blocks'),
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false;
          const tr = blockAfterBreak(view.state, from, to, text);
          if (!tr) return false;
          view.dispatch(tr);
          return true;
        },
      },
    })
);
