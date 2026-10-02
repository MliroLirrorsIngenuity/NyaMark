/**
 * Behaviour every modal shares: the ARIA role and label, focus moved into
 * the dialog on open and handed back on release, Tab kept inside, Escape
 * and a click on the backdrop to dismiss. Markup and styling stay with each
 * dialog; this wires only the parts they all need the same way.
 *
 * Open modals form a stack and Tab stays in the top-most one. Escape goes
 * through `escape-layers`, so a confirmation opened over a dialog takes it
 * without closing its parent.
 */

import { pushEscapeLayer } from './escape-layers';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ModalOptions = {
  /** Backdrop element; a click directly on it dismisses. */
  overlay: HTMLElement;
  /** The panel that receives the role and holds focus. */
  dialog: HTMLElement;
  role?: 'dialog' | 'alertdialog';
  /** Id of the title; the first heading inside the dialog when omitted. */
  labelledBy?: string;
  /** Element focused on open; the first focusable control when omitted. */
  initialFocus?: HTMLElement | null;
  /** Whether Escape and the backdrop may dismiss right now; always by default. */
  canDismiss?: () => boolean;
  /** Set to `false` for dialogs whose changes a stray click must not discard. */
  dismissOnBackdrop?: boolean;
  onDismiss: () => void;
};

export type ModalHandle = {
  /** Detach the listeners and hand focus back. Safe to call twice. */
  release: () => void;
};

type Entry = {
  options: ModalOptions;
};

const stack: Entry[] = [];
let titleSequence = 0;

function focusableIn(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getClientRects().length > 0
  );
}

/** The controls Tab stops at, in order: a radio group once, at its choice. */
function tabStops(dialog: HTMLElement) {
  return focusableIn(dialog).filter((element) => {
    if (element.getAttribute('tabindex') === '-1') return false;
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio') {
      return true;
    }
    const group = Array.from(
      dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ).filter((radio) => radio.name === element.name);
    return element === (group.find((radio) => radio.checked) ?? group[0]);
  });
}

/**
 * Tab moves through the dialog's controls itself. Left to the webview, which
 * on macOS passes over buttons and checkboxes, it went from the last field to
 * nothing, and Shift+Tab from the first went to the page behind, where the
 * next key typed went into the document.
 */
function trapTab(event: KeyboardEvent, dialog: HTMLElement) {
  event.preventDefault();
  const stops = tabStops(dialog);
  if (!stops.length) {
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && dialog.contains(active);
  // From a control that is no stop, such as an option of an open list, the
  // stops before and after it in the dialog.
  const before = (stop: HTMLElement) =>
    inside &&
    (stop === active ||
      Boolean(
        stop.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING
      ));
  const last = stops[stops.length - 1];
  const next = event.shiftKey
    ? stops.filter((stop) => before(stop) && stop !== active).pop()
    : stops.find((stop) => !before(stop));
  (next ?? (event.shiftKey ? last : stops[0])).focus();
}

function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (top && event.key === 'Tab') trapTab(event, top.options.dialog);
}

/** Call once the dialog is attached to the document. */
export function openModal(options: ModalOptions): ModalHandle {
  const { overlay, dialog } = options;
  dialog.setAttribute('role', options.role ?? 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (options.labelledBy) {
    dialog.setAttribute('aria-labelledby', options.labelledBy);
  } else {
    const title = dialog.querySelector<HTMLElement>('h1, h2, h3, h4');
    if (title) {
      title.id ||= `ny-modal-title-${++titleSequence}`;
      dialog.setAttribute('aria-labelledby', title.id);
    }
  }
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;

  const restoreTo =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const onBackdropClick = (event: MouseEvent) => {
    if (event.target !== overlay || options.dismissOnBackdrop === false) return;
    if (options.canDismiss?.() ?? true) options.onDismiss();
  };
  overlay.addEventListener('click', onBackdropClick);
  if (stack.length === 0) {
    document.addEventListener('keydown', onKeyDown, true);
  }
  const entry: Entry = { options };
  stack.push(entry);
  const releaseEscape = pushEscapeLayer({
    dismiss: options.onDismiss,
    canDismiss: options.canDismiss,
  });

  (options.initialFocus ?? focusableIn(dialog)[0] ?? dialog).focus();

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      releaseEscape();
      overlay.removeEventListener('click', onBackdropClick);
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) {
        document.removeEventListener('keydown', onKeyDown, true);
      }
      // Focus goes back only while it is still in the closed dialog (or was
      // lost to the body), so a click elsewhere in the meantime keeps its
      // target.
      const active = document.activeElement;
      if (
        restoreTo?.isConnected &&
        (!active || active === document.body || dialog.contains(active))
      ) {
        restoreTo.focus();
      }
    },
  };
}

/**
 * Resolves once the animations running on `element` or inside it have
 * finished, so a closing dialog is removed exactly when its exit animation
 * ends, whatever the stylesheet (or reduced motion) made it last. Capped in
 * case an animation never ends.
 */
export async function animationsSettled(element: HTMLElement, capMs = 1000) {
  if (typeof element.getAnimations !== 'function') return;
  const animations = element
    .getAnimations({ subtree: true })
    .filter(
      (animation) =>
        animation.effect?.getComputedTiming().endTime !==
        Number.POSITIVE_INFINITY
    );
  if (!animations.length) return;
  await Promise.race([
    Promise.allSettled(animations.map((animation) => animation.finished)),
    new Promise<void>((resolve) => window.setTimeout(resolve, capMs)),
  ]);
}
