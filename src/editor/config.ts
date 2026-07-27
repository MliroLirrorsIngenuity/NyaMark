import { autocompletion } from '@codemirror/autocomplete';
import { languages as codeLanguages } from '@codemirror/language-data';
import { tooltips } from '@codemirror/view';
import { type Crepe, CrepeFeature } from '@milkdown/crepe';
import { renderMermaidPreview } from './plugins/mermaid';

export type CrepeConfigOptions = {
  root: HTMLElement;
  defaultValue: string;
  onUpload: (file: File) => Promise<string>;
  proxyDomURL: (src: string) => Promise<string> | string;
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
const codeBlockExtensions = [
  autocompletion({ activateOnTyping: false }),
  tooltips({ parent: document.body }),
];

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
  return {
    root: opts.root,
    defaultValue: opts.defaultValue,
    features: {
      [CrepeFeature.Placeholder]: false,
      [CrepeFeature.TopBar]: true,
    },
    featureConfigs: {
      [CrepeFeature.BlockEdit]: {
        blockHandle: { getOffset: () => 8, getPosition: textBoxRect },
      },
      [CrepeFeature.CodeMirror]: {
        languages: codeLanguages,
        renderPreview: renderMermaidPreview,
        extensions: codeBlockExtensions,
      },
      [CrepeFeature.ImageBlock]: {
        onUpload: opts.onUpload,
        proxyDomURL: opts.proxyDomURL,
      },
    },
  };
}
