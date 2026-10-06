/**
 * Everything Escape can close (dialogs, menus, dropdowns, floating panels)
 * registers here while it is open. Escape goes to the most recently opened
 * one alone, so a dropdown inside the settings dialog closes before the
 * dialog does.
 */

import { forInputMethod } from './ime';

export type EscapeLayer = {
  dismiss: () => void;
  /** Whether Escape may dismiss right now; the key is taken either way. */
  canDismiss?: () => boolean;
  /**
   * Escape comes once it has been through the page, and only if nothing in
   * it kept the key: a box that closes on Escape stops it there.
   */
  afterPage?: boolean;
};

const layers: EscapeLayer[] = [];

/** Escapes a menu listening on the window took before the page saw them. */
const takenFirst = new WeakSet<Event>();

const isEscape = (event: KeyboardEvent) =>
  event.key === 'Escape' && !forInputMethod(event);

function dismissTop(event: KeyboardEvent) {
  const top = layers[layers.length - 1];
  event.preventDefault();
  event.stopImmediatePropagation();
  if (top.canDismiss?.() ?? true) top.dismiss();
}

function onKeyDown(event: KeyboardEvent) {
  // Escape during an IME composition cancels the composition.
  if (!isEscape(event)) return;
  // Taken already, by a menu listening on the window (the slash menu).
  if (event.defaultPrevented) {
    takenFirst.add(event);
    return;
  }
  const top = layers[layers.length - 1];
  if (top && !top.afterPage) dismissTop(event);
}

/** The editor marks every Escape handled; one stopped never comes here. */
function onPassedPage(event: KeyboardEvent) {
  if (!isEscape(event) || takenFirst.has(event)) return;
  if (layers[layers.length - 1]?.afterPage) dismissTop(event);
}

/** Returns the release function; calling it more than once is harmless. */
export function pushEscapeLayer(layer: EscapeLayer): () => void {
  if (layers.length === 0) {
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onPassedPage);
  }
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index < 0) return;
    layers.splice(index, 1);
    if (layers.length === 0) {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keydown', onPassedPage);
    }
  };
}
