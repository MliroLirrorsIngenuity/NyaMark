import { autocompletion } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages as codeLanguages } from '@codemirror/language-data';
import { Prec } from '@codemirror/state';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { EditorView as CodeMirror, keymap, tooltips } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { type Crepe, CrepeFeature } from '@milkdown/crepe';
import { redo, undo } from '@milkdown/kit/prose/history';
import { AllSelection, type Command } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { i18next } from '../i18n';
import { codeClearOfBar } from './plugins/caret-scroll';
import { closeFenceOnEnter } from './plugins/code-fence-exit';
import { codeSearchMatches } from './plugins/code-search';
import { renderMermaidPreview } from './plugins/mermaid';
import { rememberCodeCopy } from './plugins/paste-code';

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
 */
function codeBlockExtensions(getView: () => EditorView | null) {
  return [
    autocompletion({ activateOnTyping: false }),
    tooltips({ parent: document.body }),
    codeBlockHistory(getView),
    codeBlockSelectAll(getView),
    closeFenceOnEnter(getView),
    codeSearchMatches,
    rememberCodeCopy(getView),
    codeClearOfBar,
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
 * caret is where the undo put it; it stayed in the block before.
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
 * Anchors the block handle to the text rather than to the border box.
 *
 * `crepe-overrides.css.ts` gives a paragraph its inter-block gap as
 * `padding-top` instead of `margin-top`, because a margin sits outside every
 * border box and leaves the band between two paragraphs owned by no block at
 * all -- a click in it can only resolve to a block boundary, never to the
 * column under the cursor. The measurements are in the comment there.
 *
 * The side effect is that a paragraph's border box now starts one gap above
 * its first line, and floating-ui centres the handle on that box: 5.04px above
 * the text it points at, measured. `getPosition` is the supported way to hand
 * it a different reference rect, so the handle is centred on the content box
 * instead. Crepe's own `getPlacement` already subtracts padding when it
 * decides centre-vs-top-align, so this agrees with how it meant to place it.
 *
 * Scoped to `p` on purpose: it exists to undo one specific stylesheet rule.
 * Blocks that draw a card -- code, table, image -- own their padding as part
 * of the frame, and their handle should stay centred on the frame.
 */
function textBoxRect({ active }: { active: { el: HTMLElement } }) {
  const el = active.el;
  const rect = el.getBoundingClientRect();
  if (el.tagName !== 'P') return rect;

  const style = getComputedStyle(el);
  const top = rect.top + (Number.parseFloat(style.paddingTop) || 0);
  const bottom = rect.bottom - (Number.parseFloat(style.paddingBottom) || 0);
  return {
    x: rect.x,
    y: top,
    top,
    bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: bottom - top,
  };
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
      headingOptions: [
        { label: blockLabel('paragraph'), level: null },
        ...HEADING_LEVELS.map((level) => ({
          label: headingLabel(level),
          level,
        })),
      ],
    },
    [CrepeFeature.BlockEdit]: {
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
 * Single source of truth for the Crepe builder config used by NyaEditor.
 * Anything that wants to tweak features goes here, not in `editor.ts`.
 *
 * `languages` from @codemirror/language-data wires up the dynamic loader so
 * Crepe's CodeBlock feature can ask CodeMirror to highlight whatever fenced
 * language the user typed (lazy-loaded). Without this list Crepe falls back
 * to plain text rendering with no token colours at all.
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
        blockHandle: { getOffset: () => 8, getPosition: textBoxRect },
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
      },
    },
  };
}
