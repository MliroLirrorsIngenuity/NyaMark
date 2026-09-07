/**
 * Behaviour every modal shares: the ARIA role and label, focus moved into
 * the dialog on open and handed back on release, Tab kept inside, Escape
 * and a click on the backdrop to dismiss. Markup and styling stay with each
 * dialog; this wires only the parts they all need the same way.
 *
 * Open modals form a stack and keys reach the top-most one, so a
 * confirmation opened over a dialog takes Escape without closing its parent.
 */

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
  onBackdropClick: (event: MouseEvent) => void;
};

const stack: Entry[] = [];
let titleSequence = 0;

function focusableIn(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getClientRects().length > 0
  );
}

function trapTab(event: KeyboardEvent, dialog: HTMLElement) {
  const items = focusableIn(dialog);
  if (!items.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && dialog.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (top.options.canDismiss?.() ?? true) top.options.onDismiss();
    return;
  }
  if (event.key === 'Tab') trapTab(event, top.options.dialog);
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
  const entry: Entry = { options, onBackdropClick };
  stack.push(entry);

  (options.initialFocus ?? focusableIn(dialog)[0] ?? dialog).focus();

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
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
