/**
 * The keys a code block's language list answers to. It answered to none: Enter
 * in its search box chose nothing, the arrows did not reach the list, Enter on
 * a language left the list open over the code, and Escape only emptied the
 * box, so the list stayed till a click elsewhere, with nowhere for the next
 * key typed to go.
 *
 * Enter in the box chooses the first language listed, the arrows go down and
 * up the list, and Escape closes it. Either way the caret goes back into the
 * code.
 *
 * The arrows move a highlight and leave the caret in the box, where what is
 * typed goes on narrowing the list. They took the focus into the list, where
 * typing went nowhere, and the first press down only moved it onto the
 * language already marked as the one Enter chooses, so nothing seemed to
 * happen.
 */

import { pushEscapeLayer } from '../../ui/escape-layers';

const LANGUAGE = '.language-list-item[data-language]';
/** On the language the arrows have reached. */
const REACHED = 'data-ny-reached';

function codeIn(block: Element | null) {
  return block?.querySelector<HTMLElement>('.cm-content') ?? null;
}

/** Call once the editor is created. */
export function languagePickerKeys(root: HTMLElement) {
  root.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      if (event.isComposing || !(target instanceof HTMLElement)) return;
      const picker = target.closest('.milkdown-code-block .language-picker');
      if (!picker) return;
      const languages = Array.from(
        picker.querySelectorAll<HTMLElement>(LANGUAGE)
      );
      const box = picker.querySelector<HTMLElement>('.search-input');
      const marked = picker.querySelector<HTMLElement>(`[${REACHED}]`);
      const reached = marked ?? (languages.includes(target) ? target : null);
      const at = reached ? languages.indexOf(reached) : -1;
      if (event.key === 'Enter') {
        // Crepe's own Enter chose the language and left the list open.
        event.preventDefault();
        event.stopPropagation();
        const choice = reached ?? languages[0];
        if (!choice) return;
        const code = codeIn(picker.closest('.milkdown-code-block'));
        choice.click();
        code?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      // While a search is typed its first language is the one Enter chooses,
      // marked so already: down goes on to the second.
      const from =
        at < 0 && box instanceof HTMLInputElement && box.value ? 0 : at;
      const to =
        event.key === 'ArrowDown'
          ? Math.min(from + 1, languages.length - 1)
          : Math.max(from - 1, -1);
      marked?.removeAttribute(REACHED);
      const next = languages[to];
      next?.setAttribute(REACHED, '');
      next?.scrollIntoView({ block: 'nearest' });
      if (target !== box) box?.focus();
    },
    true
  );

  // Vue keeps the rows and changes what they hold, so a row marked stays
  // marked for whatever language the next search puts in it.
  root.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const picker = target.closest('.milkdown-code-block .language-picker');
      picker?.querySelector(`[${REACHED}]`)?.removeAttribute(REACHED);
    },
    true
  );

  const openButton = () =>
    root.querySelector<HTMLElement>(
      '.milkdown-code-block .language-button[data-expanded="true"]'
    );
  let release: (() => void) | null = null;
  new MutationObserver(() => {
    const open = openButton() !== null;
    if (open && !release) {
      release = pushEscapeLayer({
        dismiss: () => {
          const button = openButton();
          const code = codeIn(button?.closest('.milkdown-code-block') ?? null);
          // The button opens and closes the list it belongs to.
          button?.click();
          code?.focus();
        },
      });
    } else if (!open && release) {
      release();
      release = null;
    }
  }).observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-expanded'],
  });
}
