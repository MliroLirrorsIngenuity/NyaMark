/**
 * Puts the block handle back at the end of the page once it has faded out.
 *
 * Crepe hides the handle by fading it out where it last stood. When the
 * document then got shorter -- select all and type, delete the last
 * paragraphs, open a smaller file -- the invisible handle still stood past
 * the new end and held the page open: it scrolled on into blank space, and
 * the sticky format bar slid off the top with the shortened document.
 *
 * Once the fade is over its offsets are cleared, which rests it on the bottom
 * edge (see `crepe-overrides.css`). Shown again, it appears at its block
 * instead of sliding in from the one it last stood by.
 */

/** Call once the editor is created. Crepe adds the handle on its first update. */
export function restHiddenBlockHandle(root: HTMLElement) {
  new MutationObserver((records) => {
    for (const { target } of records) {
      if (!(target instanceof HTMLElement)) continue;
      if (!target.classList.contains('milkdown-block-handle')) continue;
      if (target.dataset.show !== 'false') continue;
      // The fade is Crepe's transition: it runs out, or is cut short when the
      // handle shows again. A later fade still running waits for itself.
      const fading = target.getAnimations().map(({ finished }) => finished);
      void Promise.allSettled(fading).then(() => {
        if (target.dataset.show !== 'false') return;
        if (target.getAnimations().length > 0) return;
        target.removeAttribute('style');
      });
    }
  }).observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-show'],
  });
}
