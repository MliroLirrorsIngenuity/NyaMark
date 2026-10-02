/**
 * The keys a code block's language list answers to. It answered to none: Enter
 * in its search box chose nothing, the arrows did not reach the list, Enter on
 * a language left the list open over the code, and Escape only emptied the
 * box, so the list stayed till a click elsewhere, with nowhere for the next
 * key typed to go.
 *
 * Enter in the box chooses the first language listed, the arrows go down and
 * up the list and from its top back to the box, and Escape closes it. Either
 * way the caret goes back into the code.
 */

import { pushEscapeLayer } from '../../ui/escape-layers';

const LANGUAGE = '.language-list-item[data-language]';

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
      const at = languages.indexOf(target);
      if (event.key === 'Enter') {
        // Crepe's own Enter chose the language and left the list open.
        event.preventDefault();
        event.stopPropagation();
        const choice = at >= 0 ? target : languages[0];
        if (!choice) return;
        const code = codeIn(picker.closest('.milkdown-code-block'));
        choice.click();
        code?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const box = picker.querySelector<HTMLElement>('.search-input');
      const next =
        event.key === 'ArrowDown'
          ? languages[at + 1]
          : at > 0
            ? languages[at - 1]
            : box;
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
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
