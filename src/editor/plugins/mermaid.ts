import mermaid from 'mermaid';

const FONT_FAMILY =
  'SF Pro Text, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, sans-serif';

export function configureMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
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

export function renderMermaidPreview(
  language: string,
  content: string,
  applyPreview: (value: any) => void
): null | undefined {
  if (language !== 'mermaid' || !content.trim()) return null;

  const id = genId();
  void mermaid
    .render(id, content)
    .then(({ svg }) => {
      applyPreview(`
        <div class="nyamark-mermaid-preview">
          ${svg}
        </div>
      `);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      applyPreview(`
        <div class="nyamark-mermaid-error">${message}</div>
      `);
    });
  return undefined;
}

/** Re-render visible mermaid previews after a theme change. */
export function reRenderMermaidPreviews(root: HTMLElement) {
  root.querySelectorAll('.nyamark-mermaid-preview').forEach((el) => {
    const container = el.closest('.milkdown-code-block');
    if (!container) return;
    const cmContent = container.querySelector('.cm-content');
    if (!cmContent) return;
    const content = cmContent.textContent ?? '';
    if (!content.trim()) return;

    void mermaid
      .render(genId(), content)
      .then(({ svg }) => {
        el.innerHTML = svg;
      })
      .catch(() => {
        // Keep previous preview on render error.
      });
  });
}

/**
 * Bind a theme-change listener. Returns an `unbind` function so callers can
 * detach when destroying the editor.
 */
export function bindMermaidThemeListener(root: HTMLElement): () => void {
  const handler = () => {
    configureMermaid(document.documentElement.dataset.theme === 'dark');
    reRenderMermaidPreviews(root);
  };
  window.addEventListener('nyamark:themechange', handler);
  return () => window.removeEventListener('nyamark:themechange', handler);
}
