import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';
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
.ny-html-block {
  position: relative;
  margin: 0.5rem 0;
  transition: background-color 0.2s;
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

.ny-html-editor {
  display: block;
  width: 100%;
  min-height: 50px;
  padding: 0.5rem;
  border: 1px solid var(--ny-border);
  border-radius: 4px;
  background: var(--ny-bg-secondary);
  color: var(--ny-text-primary);
  font-family: var(--ny-font-mono);
  font-size: 13px;
  line-height: 1.6;
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
function isBlockHtml(view: EditorView, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return true;
  const { parent } = view.state.doc.resolve(pos);
  return parent.type.name === 'paragraph' && parent.childCount === 1;
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
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    };

    editor.addEventListener('input', autoResize);

    if (!block) {
      (editor as HTMLElement).addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          editor.blur();
        }
      });
    }

    editor.addEventListener('blur', () => {
      focused = false;
      updateDisplay();
      if (editor.value !== node.attrs.value) {
        const pos = getPos();
        if (pos !== undefined) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            value: editor.value,
          });
          view.dispatch(tr);
        }
      }
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
