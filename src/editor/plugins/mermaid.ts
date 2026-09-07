import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import type { EditorView } from 'prosemirror-view';

const FONT_FAMILY =
  'SF Pro Text, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, sans-serif';

/** Typing pause before a mermaid block is re-rendered. */
const RENDER_DELAY_MS = 300;

export function configureMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    // On a parse error mermaid otherwise draws its own error diagram; the
    // message is shown in place of the preview instead.
    suppressErrorRendering: true,
    themeVariables: {
      primaryColor: isDark ? '#243446' : '#eef2ff',
      primaryBorderColor: isDark ? '#8db4c8' : '#8b7cf6',
      primaryTextColor: isDark ? '#edf3f8' : '#1f2937',
      lineColor: isDark ? '#a5b8c9' : '#3f3f46',
      secondaryColor: isDark ? '#1c2733' : '#f5f3ff',
      tertiaryColor: isDark ? '#141a22' : '#fafaf9',
      fontFamily: FONT_FAMILY,
    },
  });
}

function genId() {
  return `mermaid-${Math.random().toString(36).slice(2, 11)}`;
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ] ?? ch
  );
}

/**
 * Render a diagram to the markup the preview shows: the SVG, or the parser's
 * message when the source does not parse. Mermaid renders inside a
 * temporary element under `<body>` and does not always remove it when it
 * throws, so a failed render cleans up after it.
 */
async function renderToMarkup(content: string): Promise<string> {
  const id = genId();
  try {
    const { svg } = await mermaid.render(id, content);
    return `<div class="nyamark-mermaid-preview">${svg}</div>`;
  } catch (error) {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    const message = error instanceof Error ? error.message : String(error);
    return `<div class="nyamark-mermaid-error">${escapeHtml(message)}</div>`;
  }
}

type PendingRender = { timer: number; sequence: number };

/**
 * Renders scheduled while typing, keyed on the CodeMirror editor being typed
 * in. Only one block is edited at a time, but a document can hold many, and
 * on load every block asks for its preview at once; the key keeps those
 * apart from each other and from the debounce.
 */
const pendingRenders = new Map<Element, PendingRender>();

function editorBeingTyped(): Element | null {
  const active = document.activeElement;
  return active?.closest('.milkdown-code-block .cm-editor') ?? null;
}

/**
 * `renderPreview` hook of Crepe's code block. Called with every change to
 * the block's text; rendering is asynchronous (returns `undefined`) and, while
 * the block is being typed in, waits for a pause so each keystroke does not
 * cost a full parse and layout. A render whose block changed again before
 * it finished is dropped rather than shown over the newer one.
 */
export function renderMermaidPreview(
  language: string,
  content: string,
  applyPreview: (value: string) => void
): null | undefined {
  if (language !== 'mermaid' || !content.trim()) return null;

  const editor = editorBeingTyped();
  if (!editor) {
    void renderToMarkup(content).then(applyPreview);
    return undefined;
  }

  const previous = pendingRenders.get(editor);
  if (previous) window.clearTimeout(previous.timer);
  const sequence = (previous?.sequence ?? 0) + 1;
  const timer = window.setTimeout(() => {
    void renderToMarkup(content).then((markup) => {
      if (pendingRenders.get(editor)?.sequence !== sequence) return;
      pendingRenders.delete(editor);
      applyPreview(markup);
    });
  }, RENDER_DELAY_MS);
  pendingRenders.set(editor, { timer, sequence });
  return undefined;
}

/**
 * Re-render every mermaid preview after a theme change. The colours are
 * baked into the SVG, so each diagram is drawn again from its source. The
 * source comes from the document node: CodeMirror only keeps the visible
 * lines in the DOM and its line elements carry no newlines, so reading the
 * editor's text would hand mermaid a truncated single line.
 */
export function reRenderMermaidPreviews(
  root: HTMLElement,
  view: EditorView | null
) {
  const previews = root.querySelectorAll(
    '.nyamark-mermaid-preview, .nyamark-mermaid-error'
  );
  if (!previews.length || !view) return;

  const previewByBlock = new Map<Element, Element>();
  previews.forEach((preview) => {
    const block = preview.closest('.milkdown-code-block');
    if (block) previewByBlock.set(block, preview);
  });

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof Element)) return false;
    for (const [block, preview] of previewByBlock) {
      if (dom !== block && !dom.contains(block)) continue;
      previewByBlock.delete(block);
      const content = node.textContent;
      if (!content.trim()) break;
      void renderToMarkup(content).then((markup) => {
        if (!preview.isConnected) return;
        preview.outerHTML = DOMPurify.sanitize(markup);
      });
      break;
    }
    return false;
  });
}

/**
 * Bind a theme-change listener. Returns an `unbind` function so callers can
 * detach when destroying the editor.
 */
export function bindMermaidThemeListener(
  root: HTMLElement,
  getView: () => EditorView | null
): () => void {
  const handler = () => {
    configureMermaid(document.documentElement.dataset.theme === 'dark');
    reRenderMermaidPreviews(root, getView());
  };
  window.addEventListener('nyamark:themechange', handler);
  return () => window.removeEventListener('nyamark:themechange', handler);
}
