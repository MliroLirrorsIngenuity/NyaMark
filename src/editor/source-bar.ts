import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { i18next } from '../i18n';
import { requireElement } from '../ui/require-element';
import { barIcons } from './plugins/mobile-top-bar';

/** A finger that moves further than this between down and up is scrolling. */
const TAP_SLOP_PX = 10;

const COMMANDS = [
  ['undo', barIcons.undo, undo],
  ['redo', barIcons.redo, redo],
  ['indent', barIcons.indent, indentMore],
  ['outdent', barIcons.outdent, indentLess],
] as const;

/** The Markdown symbols on the keyboard's second and third pages. */
const SYMBOLS = ['#', '*', '_', '`', '-', '>', '[', ']', '(', ')', '|', '!'];

/** Runs one of the bar's commands by its key; false for a key it does not have. */
export function runSourceCommand(view: EditorView, key: string) {
  const command = COMMANDS.find(([name]) => name === key)?.[2];
  return command ? command(view) : false;
}

/** Types `text` over the selection, as a key of the bar does. */
export function typeInSource(view: EditorView, text: string) {
  view.dispatch({
    ...view.state.replaceSelection(text),
    scrollIntoView: true,
    userEvent: 'input.type',
  });
}

type Control = { label: () => string; run: (view: EditorView) => void };
type Press = { button: HTMLElement; x: number; y: number; moved: boolean };

/** Adds the bar above the keyboard that source mode types with. */
export function bindSourceBar(getView: () => EditorView | null) {
  const bar = document.createElement('div');
  bar.id = 'ny-source-bar';
  bar.className = 'ny-source-bar';
  bar.setAttribute('role', 'toolbar');
  const controls = new Map<HTMLElement, Control>();

  const addButton = (control: Control) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ny-source-bar__button';
    controls.set(button, control);
    bar.append(button);
    return button;
  };

  for (const [key, icon, command] of COMMANDS) {
    const button = addButton({
      label: () => i18next.t(`mobileBar.${key}`),
      run: command,
    });
    button.innerHTML = icon;
  }
  const divider = document.createElement('span');
  divider.className = 'ny-source-bar__divider';
  divider.setAttribute('aria-hidden', 'true');
  bar.append(divider);
  for (const text of SYMBOLS) {
    const button = addButton({
      label: () => i18next.t('mobileBar.insert', { text }),
      run: (view) => typeInSource(view, text),
    });
    button.textContent = text;
  }

  const relabel = () => {
    bar.setAttribute('aria-label', i18next.t('mobileBar.label'));
    for (const [button, { label }] of controls) {
      button.setAttribute('aria-label', label());
    }
  };
  relabel();
  i18next.on('languageChanged', relabel);

  // iOS moves the focus on the mouse events it derives from a tap.
  bar.addEventListener('mousedown', (event) => event.preventDefault());
  let press: Press | null = null;
  const drifted = (tap: Press, event: PointerEvent) =>
    Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX;
  bar.addEventListener('pointerdown', (event) => {
    // Keeps the editor's selection and keyboard while a button is pressed.
    event.preventDefault();
    const button = (event.target as Element).closest<HTMLElement>('button');
    press = button && {
      button,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  });
  bar.addEventListener('pointermove', (event) => {
    if (press && drifted(press, event)) press.moved = true;
  });
  bar.addEventListener('pointercancel', () => {
    press = null;
  });
  bar.addEventListener('pointerup', (event) => {
    const tap = press;
    press = null;
    if (!tap || tap.moved || drifted(tap, event)) return;
    if (!tap.button.contains(event.target as Node)) return;
    const view = getView();
    if (view) controls.get(tap.button)?.run(view);
  });

  requireElement(document, '#ny-app').append(bar);
}
