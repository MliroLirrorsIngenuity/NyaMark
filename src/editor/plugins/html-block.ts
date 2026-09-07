import { $view } from '@milkdown/kit/utils';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
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

export const htmlBlockView = $view(htmlSchema.node, () => {
  return (node, view, getPos) => {
    const dom = document.createElement('div');
    dom.classList.add('ny-html-block');

    const preview = document.createElement('div');
    preview.classList.add('ny-html-preview');
    preview.innerHTML = sanitizeHtmlBlock(node.attrs.value);

    const textarea = document.createElement('textarea');
    textarea.classList.add('ny-html-editor');
    textarea.value = node.attrs.value;
    textarea.spellcheck = false;

    let focused = false;

    dom.appendChild(preview);
    dom.appendChild(textarea);

    const updateDisplay = () => {
      if (focused) {
        preview.style.display = 'none';
        textarea.style.display = 'block';
      } else {
        preview.style.display = 'block';
        textarea.style.display = 'none';
      }
    };

    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    textarea.addEventListener('input', autoResize);

    textarea.addEventListener('blur', () => {
      focused = false;
      updateDisplay();
      if (textarea.value !== node.attrs.value && typeof getPos === 'function') {
        const pos = getPos();
        if (pos !== undefined) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            value: textarea.value,
          });
          view.dispatch(tr);
        }
      }
    });

    textarea.addEventListener('focus', () => {
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
      textarea.focus();
      autoResize();
    });

    updateDisplay();
    autoResize();

    return {
      dom,
      update: (updatedNode) => {
        if (updatedNode.type.name !== node.type.name) return false;
        node = updatedNode;
        preview.innerHTML = sanitizeHtmlBlock(updatedNode.attrs.value);
        if (!focused) {
          textarea.value = updatedNode.attrs.value;
          autoResize();
        }
        return true;
      },
      ignoreMutation: () => true,
    };
  };
});
