import { isMobilePlatform, isNativeShell } from '../platform/detect';

export const COMPACT_QUERY =
  '(max-width: 760px), (pointer: coarse) and (max-width: 1200px)';

export function isCompactLayout() {
  return isMobilePlatform() && window.matchMedia(COMPACT_QUERY).matches;
}

/** Follow the visible area, not the part covered by the software keyboard; around the native shell only the app's frame follows it. */
export function bindViewport() {
  const root = document.documentElement;
  const app = isNativeShell() ? document.getElementById('ny-app') : null;
  const viewport = window.visualViewport;
  let expandedHeight = window.innerHeight;
  let width = window.innerWidth;
  let frame = 0;
  // WebKit on iOS applies :active only on pages that listen for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });
  // Rewritten, a custom property on the root restyles the whole page, so it changes once a frame at most.
  const setProperty = (name: string, value: string) => {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  };
  const update = () => {
    // Pinch zoom must remain the browser's, rather than resizing the editor.
    if (viewport && viewport.scale !== 1) return;
    const height = viewport?.height ?? window.innerHeight;
    const editing = document.activeElement?.matches(
      'input, textarea, [contenteditable="true"]'
    );
    root.classList.toggle(
      'ny-document-editing',
      isCompactLayout() &&
        !!document.activeElement?.closest(
          '#ny-editor-container .ProseMirror, #ny-editor-container .cm-content'
        )
    );
    if (window.innerWidth !== width || !editing) {
      expandedHeight = window.innerHeight;
      width = window.innerWidth;
    }
    const top = `${viewport?.offsetTop ?? 0}px`;
    if (app) {
      app.style.top = top;
      app.style.height = `${height}px`;
    } else {
      setProperty('--ny-viewport-height', `${height}px`);
      setProperty('--ny-viewport-top', top);
    }
    // The native shell draws what follows the keyboard itself; the class restyles the whole document.
    if (app) return;
    root.classList.toggle(
      'ny-keyboard-open',
      isCompactLayout() &&
        Math.max(expandedHeight, window.innerHeight) - height > 120
    );
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => queueMicrotask(update));
}

/** WebKit zooms the page in on focusing text under 16px, as a code block's is; the app's page keeps its scale. */
export function holdPageScale() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta && !meta.content.includes('maximum-scale')) {
    meta.content = `${meta.content}, maximum-scale=1`;
  }
}
