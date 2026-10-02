import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose, $view } from '@milkdown/kit/utils';
import DOMPurify, { type Config } from 'dompurify';
import { ensureStyle } from '../../style/register';

/**
 * Raw HTML blocks come straight from the opened markdown file, which may be
 * untrusted (e.g. a `.md` opened via file association). Sanitize before it ever
 * touches innerHTML so embedded scripts / event handlers cannot execute inside
 * the privileged Tauri webview.
 *
 * DOMPurify's defaults still let a `<style>` element through, and a stylesheet
 * applies to the whole document: a note could hide the title bar or paint a
 * fake dialog over the editor. Form controls are dropped as well; they cannot
 * submit anywhere (CSP `form-action 'none'`) and only serve phishing-style
 * mockups. Inline `style` attributes stay allowed because centred images and
 * sized tables are everyday Markdown; the preview container uses
 * `contain: paint`, which turns it into the containing block for fixed and
 * absolutely positioned descendants, so nothing inside can escape its box.
 */
const SANITIZE_OPTIONS: Config = {
  FORBID_TAGS: [
    'style',
    'link',
    'meta',
    'base',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'iframe',
    'object',
    'embed',
  ],
  // Default list minus exotic schemes, plus `asset:` for local images.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};

function sanitizeHtmlBlock(value: string): string {
  return DOMPurify.sanitize(value, SANITIZE_OPTIONS);
}

const css = `
/* The paragraph it sits in spaces it from the blocks around it, as every
   other block is spaced. */
.ny-html-block {
  position: relative;
  transition: background-color 0.2s;
}

/* What ProseMirror leaves after an atom that ends a line stood under the
   block as a blank line. The caret never rests beside the block. */
p:has(> .ny-html-block) > :is(.ProseMirror-separator, .ProseMirror-trailingBreak) {
  display: none !important;
}

.ny-html-preview {
  padding: 0.2rem 0;
  cursor: pointer;
  white-space: normal;
  line-height: normal;
  color: var(--ny-text-primary);
  /* Containing block for fixed/absolute children: untrusted HTML cannot
     overlay the surrounding UI. Wide content scrolls instead of clipping. */
  contain: paint;
  overflow-x: auto;
}

.ny-html-preview :where(p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote) {
  margin: 1em 0;
}

.ny-html-preview :where(h1, h2, h3, h4, h5, h6) {
  line-height: 1.2;
}

.ny-html-preview :where(p:first-child, h1:first-child, h2:first-child, h3:first-child, h4:first-child, h5:first-child, h6:first-child) {
  margin-top: 0;
}

.ny-html-preview :where(p:last-child, h1:last-child, h2:last-child, h3:last-child, h4:last-child, h5:last-child, h6:last-child) {
  margin-bottom: 0;
}

.ny-html-preview :where(img) {
  max-width: 100%;
  height: auto;
}

.ny-html-inline .ny-html-preview {
  padding: 0 0.2em;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.12);
  color: var(--ny-text-muted);
  font-family: var(--ny-font-mono);
  font-size: 0.88em;
  white-space: pre-wrap;
}

.ny-html-source .ny-html-preview {
  color: var(--ny-text-muted);
  font-family: var(--ny-font-mono);
  font-size: 0.88em;
  white-space: pre-wrap;
}

.ny-html-inline .ny-html-editor {
  display: inline-block;
  width: auto;
  min-height: 0;
  padding: 0 0.2em;
}

.ny-html-preview:hover {
  background: rgba(128, 128, 128, 0.05);
}

/* Sized as a code block is, a line of source as high as a line of code. */
.ny-html-editor {
  display: block;
  width: 100%;
  padding: 6px 12px;
  /* The surface of a code block, as the source it is. */
  border: 1px solid var(--ny-editor-codeblock-border);
  border-radius: 12px;
  background: var(--ny-editor-codeblock-bg);
  color: var(--ny-text-primary);
  font-family: var(--ny-font-mono);
  font-size: 13px;
  line-height: 1.4;
  resize: none;
  outline: none;
  overflow: hidden;
}
`;

export function registerHtmlBlockStyles() {
  ensureStyle('editor-html-block', css);
}

/**
 * Milkdown models every HTML node as an inline atom. An HTML block reaches the
 * document wrapped alone in a paragraph (`remarkHtmlTransformer`); anything else
 * is a single tag inside running text, such as the `<kbd>` of `<kbd>K</kbd>`,
 * which cannot render on its own and is shown as source instead.
 */
export function isHtmlBlock(node: ProseNode): boolean {
  return (
    node.type.name === 'paragraph' &&
    node.childCount === 1 &&
    node.firstChild?.type.name === 'html'
  );
}

/**
 * The HTML block in the paragraph at `pos`, selected. The block is chosen
 * over its paragraph: a letter typed over it takes its place in the line, and
 * over the paragraph it ran the lines above and below into one.
 */
export function selectHtmlBlockAt(doc: ProseNode, pos: number): NodeSelection {
  return NodeSelection.create(doc, pos + 1);
}

/** Whether `selection` is an HTML block selected whole. */
export function isHtmlBlockSelected(selection: Selection): boolean {
  return (
    selection instanceof NodeSelection &&
    selection.node.type.name === 'html' &&
    isHtmlBlock(selection.$from.parent)
  );
}

/**
 * A caret beside an HTML block, in the paragraph that holds it, as a click in
 * the gap above the block put it, selects the block instead. Text typed there
 * joined the block's paragraph and turned the block into its source.
 */
export const htmlBlockSelection = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/html-block-selection'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
        const { selection } = state;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return null;
        }
        const { $head } = selection;
        if (!isHtmlBlock($head.parent)) return null;
        return state.tr.setSelection(
          selectHtmlBlockAt(state.doc, $head.before())
        );
      },
    })
);

function isBlockHtml(view: EditorView, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return true;
  return isHtmlBlock(view.state.doc.resolve(pos).parent);
}

export const htmlBlockView = $view(htmlSchema.node, () => {
  return (initialNode, view, getPos) => {
    let node = initialNode;
    const block = isBlockHtml(view, getPos);
    const dom = document.createElement(block ? 'div' : 'span');
    dom.classList.add(block ? 'ny-html-block' : 'ny-html-inline');

    const preview = document.createElement(block ? 'div' : 'span');
    preview.classList.add('ny-html-preview');

    const editor = block
      ? document.createElement('textarea')
      : document.createElement('input');
    editor.classList.add('ny-html-editor');
    editor.spellcheck = false;

    const render = (value: string) => {
      if (!block) {
        preview.textContent = value;
        return;
      }
      preview.innerHTML = sanitizeHtmlBlock(value);
      // A comment, or a closing tag on its own such as the `</details>` after
      // the folded content, shows nothing: the block stood as a blank gap that
      // no click could find. It shows its source instead, as a tag in running
      // text does.
      const blank = !preview.querySelector('*') && !preview.textContent?.trim();
      dom.classList.toggle('ny-html-source', blank);
      if (blank) preview.textContent = value;
    };
    render(node.attrs.value);
    editor.value = node.attrs.value;

    let focused = false;

    dom.appendChild(preview);
    dom.appendChild(editor);

    const updateDisplay = () => {
      preview.style.display = focused ? 'none' : '';
      editor.style.display = focused ? '' : 'none';
    };

    const autoResize = () => {
      if (editor instanceof HTMLInputElement) {
        editor.size = Math.max(editor.value.length, 1);
        return;
      }
      // From one row, the textarea's two by default stood a blank line under
      // a line of source. The height takes in the border.
      editor.rows = 1;
      editor.style.height = 'auto';
      const border = editor.offsetHeight - editor.clientHeight;
      editor.style.height = `${editor.scrollHeight + border}px`;
    };

    editor.addEventListener('input', autoResize);

    /** The source written back; a block emptied of it goes with its line. */
    const commit = () => {
      if (editor.value === node.attrs.value) return;
      const pos = getPos();
      if (pos === undefined) return;
      const { tr } = view.state;
      if (editor.value.trim()) {
        tr.setNodeMarkup(pos, undefined, { value: editor.value });
      } else if (block) {
        const $pos = tr.doc.resolve(pos);
        tr.delete($pos.before(), $pos.after());
      } else {
        tr.delete(pos, pos + node.nodeSize);
      }
      view.dispatch(tr);
    };

    /**
     * Out of the source, back to the document: to the text past the block on
     * the side of `dir`, or with 0 onto the block, selected. A tag in running
     * text leaves the caret after it.
     */
    const leave = (dir: 1 | -1 | 0) => {
      const emptied = !editor.value.trim();
      editor.blur();
      const pos = getPos();
      if (!emptied && pos !== undefined) {
        const { doc } = view.state;
        const $pos = doc.resolve(pos);
        let target: Selection | null = null;
        if (!block) {
          target = TextSelection.create(doc, pos + node.nodeSize);
        } else if (dir !== 0) {
          const side = doc.resolve(dir > 0 ? $pos.after() : $pos.before());
          target = Selection.findFrom(side, dir, true);
        }
        target ??= selectHtmlBlockAt(doc, $pos.before());
        view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
      }
      view.focus();
    };

    // Escape, and Enter in a tag, end the editing; the arrows leave a block
    // past its first or last line, as they leave code.
    (editor as HTMLElement).addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape' || (!block && e.key === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        leave(0);
        return;
      }
      if (!block || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const { value } = editor;
      const from = editor.selectionStart ?? 0;
      const to = editor.selectionEnd ?? value.length;
      if (from !== to) return;
      const up =
        (e.key === 'ArrowUp' && !value.slice(0, from).includes('\n')) ||
        (e.key === 'ArrowLeft' && from === 0);
      const down =
        (e.key === 'ArrowDown' && !value.slice(to).includes('\n')) ||
        (e.key === 'ArrowRight' && to === value.length);
      if (!up && !down) return;
      e.preventDefault();
      leave(up ? -1 : 1);
    });

    editor.addEventListener('blur', () => {
      focused = false;
      updateDisplay();
      commit();
    });

    editor.addEventListener('focus', () => {
      focused = true;
      updateDisplay();
      autoResize();
    });

    preview.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a')) {
        // Never let the webview follow the link itself; that would navigate
        // the privileged window away and sever the IPC bridge. Ctrl/Cmd-click
        // bubbles to the editor container, which opens it via the opener.
        e.preventDefault();
        return;
      }
      if (target.closest('summary, audio, video')) {
        return;
      }

      focused = true;
      updateDisplay();
      editor.focus();
      autoResize();
    });

    updateDisplay();
    autoResize();

    return {
      dom,
      update: (updatedNode) => {
        if (updatedNode.type.name !== node.type.name) return false;
        // Text typed next to a block, or a block left alone in its paragraph,
        // needs the other rendering; returning false recreates the view.
        if (isBlockHtml(view, getPos) !== block) return false;
        node = updatedNode;
        render(updatedNode.attrs.value);
        if (!focused) {
          editor.value = updatedNode.attrs.value;
          autoResize();
        }
        return true;
      },
      // Keys and mouse inside the editor belong to the editor. Without this
      // ProseMirror's keymap sees Enter, Backspace and Mod-Z first and edits
      // the document around the node instead of the HTML in it.
      stopEvent: (event) => editor.contains(event.target as Node),
      selectNode: () => {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode: () => {
        dom.classList.remove('ProseMirror-selectednode');
      },
      ignoreMutation: () => true,
    };
  };
});
