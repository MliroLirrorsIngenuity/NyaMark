/** The format bar above a phone keyboard, laid out for typing with thumbs. */

import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { headingSchema, listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { NodeType } from '@milkdown/kit/prose/model';
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list';
import {
  type Command,
  type EditorState,
  Selection,
} from '@milkdown/kit/prose/state';
import { i18next } from '../../i18n';

type Run = (ctx: Ctx) => void;
type Item = { icon: string; active: (ctx: Ctx) => boolean; onRun?: Run };
type Builder = {
  build: () => {
    key: string;
    items: (Item & {
      key: string;
      selector?: { options: { onSelect: Run }[] };
    })[];
  }[];
  clear: () => unknown;
  addGroup: (
    key: string,
    label: string
  ) => { addItem: (key: string, item: Item) => unknown };
};

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A titled icon gives its button an accessible name. */
const svg = (shapes: string, label?: string) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    ${label ? `<title>${escapeText(label)}</title>` : ''}
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${shapes}
    </g>
  </svg>
`;

const SHAPES = {
  undo: '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />',
  redo: '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />',
  heading: '<path d="M6 4v16M18 4v16M6 12h12" />',
  indent: '<path d="M21 6H11M21 12H11M21 18H11" /><path d="m3 8 4 4-4 4" />',
  outdent: '<path d="M21 6H11M21 12H11M21 18H11" /><path d="m7 8-4 4 4 4" />',
  left: '<path d="M19 12H5" /><path d="m12 19-7-7 7-7" />',
  right: '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
};

type Shape = keyof typeof SHAPES;

export const barIcons = Object.fromEntries(
  Object.entries(SHAPES).map(([key, shapes]) => [key, svg(shapes)])
) as Record<Shape, string>;

const LABELS: Record<Shape, string> = {
  undo: 'mobileBar.undo',
  redo: 'mobileBar.redo',
  heading: 'mobileBar.heading',
  indent: 'mobileBar.indent',
  outdent: 'mobileBar.outdent',
  left: 'mobileBar.moveLeft',
  right: 'mobileBar.moveRight',
};

const namedIcon = (shape: Shape) =>
  svg(SHAPES[shape], i18next.t(LABELS[shape]));

const LAYOUT: [group: string, keys: string[]][] = [
  ['history', ['undo', 'redo']],
  [
    'block',
    [
      'heading',
      'bullet-list',
      'task-list',
      'ordered-list',
      'indent',
      'outdent',
    ],
  ],
  ['formatting', ['bold', 'italic', 'strikethrough', 'code', 'link']],
  ['insert', ['image', 'table', 'code-block', 'math', 'quote', 'hr']],
  ['caret', ['caret-left', 'caret-right']],
];

/** The level a block goes to, by the level it has; 0 is body text. */
const NEXT_LEVEL = [1, 2, 3, 0];

function headingLevel(ctx: Ctx): number {
  const { parent } = ctx.get(editorViewCtx).state.selection.$from;
  return parent.type === headingSchema.type(ctx) ? parent.attrs.level : 0;
}

function headingItem(options: { onSelect: Run }[]): Item {
  return {
    icon: namedIcon('heading'),
    active: (ctx) => headingLevel(ctx) > 0,
    // The heading list's options are body text, then levels 1 to 6.
    onRun: (ctx) => options[NEXT_LEVEL[headingLevel(ctx)] ?? 0]?.onSelect(ctx),
  };
}

const historyItem = (icon: string, command: typeof undoCommand): Item => ({
  icon,
  active: () => false,
  onRun: (ctx) => ctx.get(commandsCtx).call(command.key),
});

const listMoveItem = (
  icon: string,
  move: (type: NodeType) => Command
): Item => ({
  icon,
  active: () => false,
  onRun: (ctx) => {
    const view = ctx.get(editorViewCtx);
    move(listItemSchema.type(ctx))(view.state, view.dispatch);
  },
});

/** A selection collapses to the side the key points to; a caret moves a position. */
function caretTarget({ doc, selection }: EditorState, dir: -1 | 1) {
  if (!selection.empty) return dir < 0 ? selection.from : selection.to;
  return Math.min(Math.max(selection.head + dir, 0), doc.content.size);
}

const caretItem = (icon: string, dir: -1 | 1): Item => ({
  icon,
  active: () => false,
  onRun: (ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const at = state.doc.resolve(caretTarget(state, dir));
    view.dispatch(
      state.tr.setSelection(Selection.near(at, dir)).scrollIntoView()
    );
  },
});

/** The bar's items as last laid out, by key; the native bar above the keyboard runs them. */
export const mobileBarItems = new Map<string, Item>();

/** Lays the bar out for a phone, keeping the items Crepe and NyaMark built. */
export function intoMobileBar(builder: Builder) {
  const built = new Map(
    builder
      .build()
      .flatMap((group) => group.items.map((item) => [item.key, item] as const))
  );
  const options = built.get('heading-selector')?.selector?.options;
  const added: Record<string, Item | undefined> = {
    undo: historyItem(namedIcon('undo'), undoCommand),
    redo: historyItem(namedIcon('redo'), redoCommand),
    heading: options && headingItem(options),
    indent: listMoveItem(namedIcon('indent'), sinkListItem),
    outdent: listMoveItem(namedIcon('outdent'), liftListItem),
    'caret-left': caretItem(namedIcon('left'), -1),
    'caret-right': caretItem(namedIcon('right'), 1),
  };
  builder.clear();
  mobileBarItems.clear();
  for (const [key, keys] of LAYOUT) {
    const group = builder.addGroup(key, key);
    for (const itemKey of keys) {
      const item = added[itemKey] ?? built.get(itemKey);
      if (!item) continue;
      group.addItem(itemKey, item);
      mobileBarItems.set(itemKey, item);
    }
  }
}
