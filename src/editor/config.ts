import { autocompletion } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { EditorView as CodeMirror, keymap, tooltips } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { type Crepe, CrepeFeature } from '@milkdown/crepe';
import { redo, undo } from '@milkdown/kit/prose/history';
import {
  AllSelection,
  type Command,
  Selection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { i18next } from '../i18n';
import { intoAiSlash, intoAiToolbar } from './plugins/ai-entry';
import { codeArrowsByRow } from './plugins/block-arrows';
import { intoKeys } from './plugins/block-keys';
import { codeClearOfBar } from './plugins/caret-scroll';
import { caretThroughColour } from './plugins/code-colour-caret';
import { closeFenceOnEnter } from './plugins/code-fence-exit';
import { codeIndentUnit, codeLanguages } from './plugins/code-language';
import { codeSearchMatches } from './plugins/code-search';
import { renderMermaidPreview } from './plugins/mermaid';
import { rememberCodeCopy } from './plugins/paste-code';
import { intoInsertedBlocks, intoSlashBlocks } from './plugins/toolbar-insert';
import { type Builder, intoToggles } from './plugins/toolbar-toggles';
import { intoHeadingSelector } from './plugins/top-bar-heading-code';
import { pasteApart } from './plugins/undo-lines';

export type CrepeConfigOptions = {
  root: HTMLElement;
  defaultValue: string;
  onUpload: (file: File) => Promise<string>;
  proxyDomURL: (src: string) => Promise<string> | string;
  getView: () => EditorView | null;
};

/**
 * Crepe hard-codes CodeMirror's `basicSetup` and appends whatever we pass here
 * after it, so this is the only place we get to re-decide any of it.
 *
 * `autocompletion()` inside basicSetup is constructed with no arguments, so its
 * config contributes no fields and `combineConfig` takes ours instead --
 * disabling the popup that fired on every keystroke. This is a deliberate
 * behaviour change, not a style one: without a language server the suggestions
 * are just keywords and words already on screen, which is noise in a note.
 * Ctrl+Space still opens it on demand.
 *
 * `tooltips({ parent })` is what keeps that manual popup usable at all: the
 * code block clips its own content to get rounded corners, and a tooltip
 * rendered inside would be cut off at the block's edge.
 *
 * A long line wraps at the block's edge. It ran on past it, cut off at the
 * rounded border with nothing to say more was there: the end of a long command
 * could be read only by scrolling a block that showed no scrollbar.
 */
function codeBlockExtensions(getView: () => EditorView | null) {
  return [
    CodeMirror.lineWrapping,
    codeArrowsByRow,
    autocompletion({ activateOnTyping: false }),
    tooltips({ parent: document.body }),
    codeBlockHistory(getView),
    codeBlockSelectAll(getView),
    codeBlockDocEdges(getView),
    closeFenceOnEnter(getView),
    codeSearchMatches,
    rememberCodeCopy(getView),
    codeClearOfBar,
    caretThroughColour,
    codeIndentUnit,
  ];
}

/**
 * Code colours that follow the app theme. Crepe's default theme is One Dark in
 * both themes, and on the light page its pale ink was close to unreadable: a
 * variable name in #abb2bf and a number in #e5c07b on a near-white block. The
 * tags are One Dark's; the colours come from `shared.css`, One Dark in the
 * dark theme and One Light in the light one. One Dark's editor theme stays for
 * the rest of the block, which the stylesheet already restyles.
 */
const codeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--ny-code-keyword)' },
  {
    tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
    color: 'var(--ny-code-name)',
  },
  {
    tag: [t.function(t.variableName), t.labelName],
    color: 'var(--ny-code-function)',
  },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: 'var(--ny-code-constant)',
  },
  { tag: [t.definition(t.name), t.separator], color: 'var(--ny-code-plain)' },
  {
    tag: [
      t.typeName,
      t.className,
      t.number,
      t.changed,
      t.annotation,
      t.modifier,
      t.self,
      t.namespace,
    ],
    color: 'var(--ny-code-type)',
  },
  {
    tag: [
      t.operator,
      t.operatorKeyword,
      t.url,
      t.escape,
      t.regexp,
      t.link,
      t.special(t.string),
    ],
    color: 'var(--ny-code-operator)',
  },
  { tag: [t.meta, t.comment], color: 'var(--ny-code-comment)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  {
    tag: t.link,
    color: 'var(--ny-code-comment)',
    textDecoration: 'underline',
  },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--ny-code-name)' },
  {
    tag: [t.atom, t.bool, t.special(t.variableName)],
    color: 'var(--ny-code-constant)',
  },
  {
    tag: [t.processingInstruction, t.string, t.inserted],
    color: 'var(--ny-code-string)',
  },
  { tag: t.invalid, color: 'var(--ny-code-invalid)' },
]);

/**
 * Undo and redo in a code block run ProseMirror's history, the one the rest
 * of the document uses. basicSetup gives every block a CodeMirror history of
 * its own, and the block handed Cmd+Z to ProseMirror only while ProseMirror
 * had something to undo; one Cmd+Z past that, CodeMirror undid what
 * ProseMirror had already undone and wrote it back. A paragraph merged into a
 * code block came back twice, in the block and below it.
 *
 * An undo that puts the caret outside the block focuses the document, so the
 * caret is where the undo put it; it stayed in the block before. A paste in
 * the block is a step of its own, as it is in text.
 */
function codeBlockHistory(getView: () => EditorView | null) {
  const run = (command: Command) => () => {
    const view = getView();
    if (view && command(view.state, view.dispatch)) view.focus();
    return true;
  };
  return Prec.highest([
    keymap.of([
      { key: 'Mod-z', run: run(undo) },
      { key: 'Shift-Mod-z', run: run(redo) },
      { key: 'Mod-y', run: run(redo) },
    ]),
    // Edit > Undo in the menu bar arrives as an input event.
    CodeMirror.domEventHandlers({
      paste: () => {
        const view = getView();
        if (view) pasteApart(view);
        return false;
      },
      beforeinput: (event) => {
        const command =
          event.inputType === 'historyUndo'
            ? undo
            : event.inputType === 'historyRedo'
              ? redo
              : null;
        if (!command) return false;
        event.preventDefault();
        return run(command)();
      },
    }),
  ]);
}

/**
 * Cmd+A in a code block selects its code, and pressed again with the code all
 * selected, the whole document, as it does from text. CodeMirror kept it to
 * the block however often it was pressed, and there was no way to select the
 * document from inside one.
 */
function codeBlockSelectAll(getView: () => EditorView | null) {
  return Prec.highest(
    keymap.of([
      {
        key: 'Mod-a',
        run: (cm) => {
          const { main } = cm.state.selection;
          if (main.from > 0 || main.to < cm.state.doc.length) return false;
          const view = getView();
          if (!view) return false;
          const { state } = view;
          view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
          view.focus();
          // Its own highlight stayed on the code, a shade over the document's.
          // Out of focus, CodeMirror passes the change on to no one.
          cm.dispatch({ selection: { anchor: main.head } });
          return true;
        },
      },
    ])
  );
}

/**
 * Cmd+Up in a code block goes to the start of its code, and pressed there, on
 * to the start of the document, as it does from text; Cmd+Down to the ends.
 * CodeMirror kept the caret in the block however often it was pressed.
 */
function codeBlockDocEdges(getView: () => EditorView | null) {
  const toEdge = (dir: 1 | -1) => (cm: CodeMirror) => {
    const { main } = cm.state.selection;
    const edge = dir > 0 ? cm.state.doc.length : 0;
    if (!main.empty || main.head !== edge) return false;
    const view = getView();
    if (!view) return false;
    const { state } = view;
    const target =
      dir > 0 ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
    view.dispatch(state.tr.setSelection(target).scrollIntoView());
    view.focus();
    return true;
  };
  return Prec.highest(
    keymap.of([
      { key: 'Mod-ArrowUp', run: toEdge(-1) },
      { key: 'Mod-ArrowDown', run: toEdge(1) },
    ])
  );
}

/** Blocks led by a line of text, and the blocks whose first line leads them. */
const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6';
const TEXT_LED = '.milkdown-list-item-block, blockquote';

/**
 * The first line of a block's text, across the block's width.
 *
 * `crepe-overrides.css` gives a paragraph its inter-block gap as `padding-top`
 * instead of `margin-top`, because a margin sits outside every border box and
 * leaves the band between two paragraphs owned by no block at all -- a click
 * in it can only resolve to a block boundary, never to the column under the
 * cursor. The measurements are in the comment there. So the text starts one
 * gap below the top of the box.
 */
function firstLine(el: HTMLElement): DOMRect | null {
  const text = el.matches(TEXT_BLOCK)
    ? el
    : el.matches(TEXT_LED)
      ? el.querySelector<HTMLElement>(TEXT_BLOCK)
      : null;
  if (!text) return null;
  const box = el.getBoundingClientRect();
  const rect = text.getBoundingClientRect();
  const style = getComputedStyle(text);
  const top = rect.top + (Number.parseFloat(style.paddingTop) || 0);
  const bottom = rect.bottom - (Number.parseFloat(style.paddingBottom) || 0);
  const line =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.2;
  return new DOMRect(box.left, top, box.width, Math.min(line, bottom - top));
}

/**
 * The block handle stands beside the first line of a paragraph, heading, list
 * item or quote, centred on it. Crepe centred it on the whole block, or, once
 * the block was taller than the handle, set their tops level: beside an item
 * with a list in it, a quote of two lines or a wrapped paragraph it stood
 * 5-6px below the line it was for. Blocks that draw a card -- code, table,
 * math, image -- keep Crepe's way, the handle level with the top of the card.
 */
function handleRect({ active }: { active: { el: HTMLElement } }) {
  return firstLine(active.el) ?? active.el.getBoundingClientRect();
}

function handlePlacement({
  active,
  blockDom,
}: {
  active: { el: HTMLElement };
  blockDom: HTMLElement;
}) {
  if (firstLine(active.el)) return 'left' as const;
  const block = active.el.getBoundingClientRect().height;
  return block > blockDom.getBoundingClientRect().height
    ? ('left-start' as const)
    : ('left' as const);
}

/**
 * Crepe ships its menus, placeholders and buttons in English. They are read
 * once when the editor is built, so a language switch reaches them the next
 * time a window opens.
 */
function blockLabel(key: string) {
  return i18next.t(`editor.blocks.${key}`);
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

function headingLabel(level: number) {
  return i18next.t('editor.blocks.heading', { level });
}

function localizedFeatureConfigs() {
  const [h1, h2, h3, h4, h5, h6] = HEADING_LEVELS.map((level) => ({
    label: headingLabel(level),
  }));
  return {
    [CrepeFeature.TopBar]: {
      buildTopBar: (builder: Builder) => {
        intoInsertedBlocks(builder);
        intoToggles(builder);
        intoKeys(builder);
        intoHeadingSelector(builder);
      },
      headingOptions: [
        { label: blockLabel('paragraph'), level: null },
        ...HEADING_LEVELS.map((level) => ({
          label: headingLabel(level),
          level,
        })),
      ],
    },
    [CrepeFeature.Toolbar]: {
      buildToolbar: intoAiToolbar,
    },
    [CrepeFeature.BlockEdit]: {
      buildMenu: (builder: Builder & Parameters<typeof intoAiSlash>[0]) => {
        intoSlashBlocks(builder);
        intoAiSlash(builder);
      },
      textGroup: {
        label: blockLabel('groupText'),
        text: { label: blockLabel('text') },
        h1,
        h2,
        h3,
        h4,
        h5,
        h6,
        quote: { label: blockLabel('quote') },
        divider: { label: blockLabel('divider') },
      },
      listGroup: {
        label: blockLabel('groupList'),
        bulletList: { label: blockLabel('bulletList') },
        orderedList: { label: blockLabel('orderedList') },
        taskList: { label: blockLabel('taskList') },
      },
      advancedGroup: {
        label: blockLabel('groupAdvanced'),
        image: { label: blockLabel('image') },
        codeBlock: { label: blockLabel('codeBlock') },
        table: { label: blockLabel('table') },
        math: { label: blockLabel('math') },
      },
    },
    [CrepeFeature.CodeMirror]: {
      searchPlaceholder: blockLabel('searchLanguage'),
      noResultText: blockLabel('noLanguage'),
      copyText: blockLabel('copy'),
      previewToggleText: (previewOnly: boolean) =>
        blockLabel(previewOnly ? 'editCode' : 'hideCode'),
      previewLabel: blockLabel('preview'),
      previewLoading: blockLabel('loading'),
    },
    [CrepeFeature.ImageBlock]: {
      inlineUploadButton: blockLabel('upload'),
      inlineUploadPlaceholderText: blockLabel('pasteImageLink'),
      blockUploadButton: blockLabel('uploadFile'),
      blockConfirmButton: blockLabel('confirm'),
      blockCaptionPlaceholderText: blockLabel('imageCaption'),
      blockUploadPlaceholderText: blockLabel('pasteImageLink'),
    },
    [CrepeFeature.LinkTooltip]: {
      inputPlaceholder: blockLabel('pasteLink'),
    },
  };
}

/**
 * The picture beside an image's address box goes while its address loads
 * none: one half typed, or a path from the file's folder, which the box reads
 * from the app's. It showed the browser's sign for a broken picture.
 */
function hideBrokenPreview(event: Event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const preview = image.closest('.image-preview');
  if (!preview) return;
  preview.classList.add('nyamark-preview-broken');
  image.addEventListener(
    'load',
    () => preview.classList.remove('nyamark-preview-broken'),
    { once: true }
  );
}

/**
 * Single source of truth for the Crepe builder config used by NyaEditor.
 * Anything that wants to tweak features goes here, not in `editor.ts`.
 *
 * `languages` from @codemirror/language-data, by way of `code-language.ts`,
 * wires up the dynamic loader so Crepe's CodeBlock feature can ask CodeMirror
 * to highlight whatever fenced language the user typed (lazy-loaded). Without
 * this list Crepe falls back to plain text rendering with no token colours at
 * all.
 */
export function buildCrepeConfig(
  opts: CrepeConfigOptions
): ConstructorParameters<typeof Crepe>[0] {
  const labels = localizedFeatureConfigs();
  return {
    root: opts.root,
    defaultValue: opts.defaultValue,
    features: {
      [CrepeFeature.Placeholder]: false,
      [CrepeFeature.TopBar]: true,
    },
    featureConfigs: {
      ...labels,
      // Drawn by mark-cursor, which also knows the edges of a line.
      [CrepeFeature.Cursor]: { virtual: false },
      [CrepeFeature.BlockEdit]: {
        ...labels[CrepeFeature.BlockEdit],
        blockHandle: {
          getOffset: () => 8,
          getPosition: handleRect,
          getPlacement: handlePlacement,
        },
      },
      [CrepeFeature.CodeMirror]: {
        ...labels[CrepeFeature.CodeMirror],
        theme: [oneDarkTheme, syntaxHighlighting(codeHighlight)],
        languages: codeLanguages,
        renderPreview: renderMermaidPreview,
        extensions: codeBlockExtensions(opts.getView),
      },
      [CrepeFeature.ImageBlock]: {
        ...labels[CrepeFeature.ImageBlock],
        onUpload: opts.onUpload,
        proxyDomURL: opts.proxyDomURL,
        onImageLoadError: hideBrokenPreview,
      },
    },
  };
}
