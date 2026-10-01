/**
 * Everything Escape can close (dialogs, menus, dropdowns, floating panels)
 * registers here while it is open. Escape goes to the most recently opened
 * one alone, so a dropdown inside the settings dialog closes before the
 * dialog does.
 */

export type EscapeLayer = {
  dismiss: () => void;
  /** Whether Escape may dismiss right now; the key is taken either way. */
  canDismiss?: () => boolean;
};

const layers: EscapeLayer[] = [];

function onKeyDown(event: KeyboardEvent) {
  // Escape during an IME composition cancels the composition.
  if (event.key !== 'Escape' || event.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (top.canDismiss?.() ?? true) top.dismiss();
}

/** Returns the release function; calling it more than once is harmless. */
export function pushEscapeLayer(layer: EscapeLayer): () => void {
  if (layers.length === 0) {
    document.addEventListener('keydown', onKeyDown, true);
  }
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index < 0) return;
    layers.splice(index, 1);
    if (layers.length === 0) {
      document.removeEventListener('keydown', onKeyDown, true);
    }
  };
}
