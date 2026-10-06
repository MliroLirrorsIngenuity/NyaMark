import { remarkCtx } from '@milkdown/kit/core';
import { isHistoryTransaction } from '@milkdown/kit/prose/history';
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { Mapping } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { ORIGIN_META, proposalKey } from './ai-proposals';

export interface Syntax {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Syntax[];
}

export type Parse = (markdown: string) => Syntax;

export interface Span {
  mark: string;
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
}

type Range = readonly [number, number];

export interface Pending {
  base: ProseNode;
  mapping: Mapping;
  ranges: readonly Range[];
  open: boolean;
  held: boolean;
}

interface TypedState {
  pending: Pending | null;
  undo: { tr: Transaction; head: number } | null;
}

const MARKS: Record<string, string> = {
  emphasis: 'emphasis',
  strong: 'strong',
  delete: 'strike_through',
  inlineCode: 'inlineCode',
};

const HOLE = '￼';
const DELIMITERS = '`*_~';
const HAS_DELIMITER = /[`*_~]/;

export const FLUSH = 'flush';
const DONE = 'done';
const HOLD = 'hold';
const REVERT = 'revert';

export const typedMarksKey = new PluginKey<TypedState>('nyamark/typed-marks');

const offsetOf = (point?: { offset?: number }) => point?.offset;

function codeSpan(
  node: Syntax,
  raw: string,
  from: number,
  to: number
): Span | null {
  const ticks = /^`+/.exec(raw.slice(from, to))?.[0].length ?? 0;
  if (!ticks || raw.slice(to - ticks, to) !== '`'.repeat(ticks)) return null;
  let textFrom = from + ticks;
  let textTo = to - ticks;
  const text = raw.slice(textFrom, textTo);
  if (text !== node.value) {
    const padded =
      text.length > 2 && text.startsWith(' ') && text.endsWith(' ');
    if (!padded || text.slice(1, -1) !== node.value) return null;
    textFrom += 1;
    textTo -= 1;
  }
  if (textFrom >= textTo || raw.slice(textFrom, textTo).includes(HOLE)) {
    return null;
  }
  return { mark: 'inlineCode', from, to, textFrom, textTo };
}

function wrapSpan(
  node: Syntax,
  raw: string,
  mark: string,
  from: number,
  to: number
): Span | null {
  const children = node.children ?? [];
  const textFrom = offsetOf(children[0]?.position?.start);
  const textTo = offsetOf(children[children.length - 1]?.position?.end);
  if (textFrom == null || textTo == null || textFrom >= textTo) return null;
  const delimiter = mark === 'strike_through' ? /^~+$/ : /^[*_]+$/;
  if (
    !delimiter.test(raw.slice(from, textFrom)) ||
    !delimiter.test(raw.slice(textTo, to))
  ) {
    return null;
  }
  return { mark, from, to, textFrom, textTo };
}

export function spansOf(raw: string, parse: Parse): Span[] {
  const spans: Span[] = [];
  const visit = (node: Syntax) => {
    node.children?.forEach(visit);
    const mark = MARKS[node.type];
    const from = offsetOf(node.position?.start);
    const to = offsetOf(node.position?.end);
    if (!mark || from == null || to == null) return;
    const span =
      mark === 'inlineCode'
        ? codeSpan(node, raw, from, to)
        : wrapSpan(node, raw, mark, from, to);
    if (span) spans.push(span);
  };
  visit(parse(raw));
  return spans;
}

interface Line {
  block: ProseNode;
  from: number;
  to: number;
  raw: string;
}

function linesOf(block: ProseNode, start: number): Line[] {
  const lines: Line[] = [];
  let from = start;
  let raw = '';
  block.forEach((child, offset) => {
    const pos = start + offset;
    if (child.type.name === 'hardbreak') {
      lines.push({ block, from, to: pos, raw });
      from = pos + 1;
      raw = '';
    } else if (child.isText && !child.marks.length) {
      raw += child.text ?? '';
    } else {
      raw += HOLE.repeat(child.nodeSize);
    }
  });
  lines.push({ block, from, to: start + block.content.size, raw });
  return lines;
}

function linesAt(doc: ProseNode, ranges: readonly Range[]): Line[] {
  const found = new Map<number, Line>();
  for (const [a, b] of ranges) {
    const from = Math.max(0, a - 1);
    const to = Math.min(doc.content.size, b + 1);
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (node.type.spec.code) return false;
      for (const line of linesOf(node, pos + 1)) {
        if (line.from <= b && line.to >= a) found.set(line.from, line);
      }
      return false;
    });
  }
  return [...found.values()];
}

const touches = (span: Span, [a, b]: Range) =>
  a < b ? a < span.to && b > span.from : span.from < a && a < span.to;

function waits(raw: string, at: number, spans: Span[], parse: Parse) {
  const typed = raw[at - 1];
  if (!typed || !DELIMITERS.includes(typed)) return false;
  const more = raw.slice(0, at) + typed + raw.slice(at);
  const back = (offset: number) => (offset > at ? offset - 1 : offset);
  return spansOf(more, parse).some(
    (span) =>
      ((at >= span.from && at < span.textFrom) ||
        (at >= span.textTo && at < span.to)) &&
      !spans.some(
        (known) =>
          known.mark === span.mark &&
          known.textFrom === back(span.textFrom) &&
          known.textTo === back(span.textTo)
      )
  );
}

function spansBefore(pending: Pending, line: Line, parse: Parse) {
  const back = pending.mapping.invert();
  const range: Range = [back.map(line.from, -1), back.map(line.to, 1)];
  const spans: { mark: string; from: number; to: number }[] = [];
  for (const old of linesAt(pending.base, [range])) {
    if (!HAS_DELIMITER.test(old.raw)) continue;
    for (const span of spansOf(old.raw, parse)) {
      spans.push({
        mark: span.mark,
        from: pending.mapping.map(old.from + span.from, 1),
        to: pending.mapping.map(old.from + span.to, -1),
      });
    }
  }
  return spans;
}

interface Made {
  mark: Mark;
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
}

export function typedMarks(
  state: EditorState,
  pending: Pending,
  parse: Parse
): Transaction | null {
  const { schema, selection } = state;
  const head = selection.empty ? selection.head : -1;
  const made: Made[] = [];
  let waiting = false;
  for (const line of linesAt(state.doc, pending.ranges)) {
    if (!HAS_DELIMITER.test(line.raw)) continue;
    const edits = pending.ranges
      .filter(([a, b]) => a <= line.to && b >= line.from)
      .map(
        ([a, b]): Range => [
          Math.max(a, line.from) - line.from,
          Math.min(b, line.to) - line.from,
        ]
      );
    const spans = spansOf(line.raw, parse);
    const touched = spans.filter((span) =>
      edits.some((edit) => touches(span, edit))
    );
    if (!touched.length) continue;
    if (
      head >= line.from &&
      head <= line.to &&
      waits(line.raw, head - line.from, spans, parse)
    ) {
      waiting = true;
      continue;
    }
    const before = spansBefore(pending, line, parse);
    for (const span of touched) {
      const from = line.from + span.from;
      const to = line.from + span.to;
      const known = before.some(
        (old) => old.mark === span.mark && old.from === from && old.to === to
      );
      const type = schema.marks[span.mark];
      if (known || !type || !line.block.type.allowsMarkType(type)) continue;
      made.push({
        mark: type.create({ marker: line.raw[span.from] }),
        from,
        to,
        textFrom: line.from + span.textFrom,
        textTo: line.from + span.textTo,
      });
    }
  }
  if (!made.length) {
    return waiting ? state.tr.setMeta(typedMarksKey, HOLD) : null;
  }
  const tr = state.tr.setMeta(typedMarksKey, DONE);
  const cuts = made
    .flatMap((span): Range[] => [
      [span.from, span.textFrom],
      [span.textTo, span.to],
    ])
    .sort((x, y) => y[0] - x[0]);
  for (const [from, to] of cuts) tr.delete(from, to);
  for (const span of made) {
    const { mapping } = tr;
    tr.addMark(mapping.map(span.textFrom), mapping.map(span.textTo), span.mark);
  }
  if (head < 0) return tr;
  const caret = tr.selection.head;
  let marks: readonly Mark[] | null = null;
  for (const span of made) {
    const textFrom = tr.mapping.map(span.textFrom);
    const textTo = tr.mapping.map(span.textTo);
    const inside = head > span.textFrom && head <= span.textTo;
    const at = inside
      ? caret > textFrom && caret <= textTo
      : caret === textFrom || caret === textTo;
    if (!at) continue;
    marks ??= tr.doc.resolve(caret).marks();
    marks = inside ? span.mark.addToSet(marks) : span.mark.removeFromSet(marks);
  }
  if (marks) tr.setStoredMarks(marks);
  return tr;
}

function edited(tr: Transaction) {
  if (!tr.docChanged || tr.getMeta(typedMarksKey)) return false;
  if (tr.getMeta('appendedTransaction') || isHistoryTransaction(tr)) {
    return false;
  }
  if (tr.getMeta('addToHistory') === false) return false;
  if (tr.getMeta(ORIGIN_META) || tr.getMeta(proposalKey)) return false;
  const event = tr.getMeta('uiEvent');
  return event !== 'paste' && event !== 'drop';
}

function changed(tr: Transaction): Range[] {
  const ranges: Range[] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_from, _to, from, to) => {
      ranges.push([rest.map(from, -1), rest.map(to, 1)]);
    });
  });
  return ranges;
}

function extend(
  pending: Pending,
  tr: Transaction,
  ranges: readonly Range[],
  open: boolean
): Pending {
  return {
    base: pending.base,
    mapping: new Mapping([...pending.mapping.maps, ...tr.mapping.maps]),
    ranges: [
      ...pending.ranges.map(
        ([a, b]): Range => [tr.mapping.map(a, -1), tr.mapping.map(b, 1)]
      ),
      ...ranges,
    ],
    open,
    held: false,
  };
}

export function revertTyped(state: EditorState): Transaction | null {
  const undo = typedMarksKey.getState(state)?.undo;
  if (!undo) return null;
  const tr = state.tr;
  for (let index = undo.tr.steps.length - 1; index >= 0; index -= 1) {
    tr.step(undo.tr.steps[index].invert(undo.tr.docs[index]));
  }
  return tr
    .setSelection(TextSelection.create(tr.doc, undo.head))
    .setMeta(typedMarksKey, REVERT);
}

export function typedMarksPlugin(parse: Parse) {
  let current: EditorView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Plugin<TypedState>({
    key: typedMarksKey,
    state: {
      init: () => ({ pending: null, undo: null }),
      apply(tr, value, old) {
        const meta = tr.getMeta(typedMarksKey);
        if (meta === DONE) {
          return { pending: null, undo: { tr, head: old.selection.head } };
        }
        if (meta === REVERT) return { pending: null, undo: null };
        const undo = tr.docChanged || tr.selectionSet ? null : value.undo;
        const { pending } = value;
        if (meta === FLUSH) {
          return { pending: pending && { ...pending, open: false }, undo };
        }
        if (meta === HOLD) {
          return { pending: pending && { ...pending, held: true }, undo };
        }
        if (!tr.docChanged) {
          if (tr.selectionSet && pending?.held) {
            return { pending: { ...pending, held: false }, undo };
          }
          return undo === value.undo ? value : { ...value, undo };
        }
        if (edited(tr)) {
          const open = !!tr.getMeta('composition');
          const start: Pending =
            pending?.open || pending?.held
              ? pending
              : {
                  base: old.doc,
                  mapping: new Mapping(),
                  ranges: [],
                  open,
                  held: false,
                };
          return { pending: extend(start, tr, changed(tr), open), undo };
        }
        return {
          pending: pending && extend(pending, tr, [], pending.open),
          undo,
        };
      },
    },
    appendTransaction(trs, _old, state) {
      if (current?.composing) return null;
      const typed = trs.some(
        (tr) =>
          tr.getMeta(typedMarksKey) === FLUSH ||
          (edited(tr) && !tr.getMeta('composition'))
      );
      if (!typed) return null;
      const pending = typedMarksKey.getState(state)?.pending;
      if (!pending || pending.open) return null;
      return typedMarks(state, pending, parse);
    },
    view(view) {
      current = view;
      return {
        destroy() {
          clearTimeout(timer);
          current = null;
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' || event.isComposing) return false;
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        const tr = revertTyped(view.state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleDOMEvents: {
        compositionend(view) {
          clearTimeout(timer);
          // Once ProseMirror has taken the event, as its input rules wait.
          timer = setTimeout(() => {
            if (view.isDestroyed || view.composing) return;
            if (!typedMarksKey.getState(view.state)?.pending?.open) return;
            view.dispatch(view.state.tr.setMeta(typedMarksKey, FLUSH));
          });
          return false;
        },
      },
    },
  });
}

export const typedMarksInput = $prose((ctx) =>
  typedMarksPlugin((markdown) => ctx.get(remarkCtx).parse(markdown))
);
