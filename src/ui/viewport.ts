import { isMobilePlatform } from '../platform/detect';

export const COMPACT_QUERY =
  '(max-width: 760px), (pointer: coarse) and (max-width: 1200px)';

export function isCompactLayout() {
  return isMobilePlatform() && window.matchMedia(COMPACT_QUERY).matches;
}

/** Follow the visible area, not the part covered by the software keyboard. */
export function bindViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let expandedHeight = window.innerHeight;
  let width = window.innerWidth;
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
    root.style.setProperty('--ny-viewport-height', `${height}px`);
    root.style.setProperty(
      '--ny-viewport-top',
      `${viewport?.offsetTop ?? 0}px`
    );
    root.classList.toggle(
      'ny-keyboard-open',
      isCompactLayout() &&
        Math.max(expandedHeight, window.innerHeight) - height > 120
    );
  };
  update();
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => queueMicrotask(update));
}
