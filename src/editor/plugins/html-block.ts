import { $view } from '@milkdown/kit/utils';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import { ensureStyle } from '../../style/register';

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
    preview.innerHTML = node.attrs.value;

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
      if (target.closest('a, button, input, select, textarea')) {
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
        preview.innerHTML = updatedNode.attrs.value;
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
