import { i18next } from './index';

/** `data-i18n-<attribute>` keys and the attribute each one fills. */
const ATTRIBUTE_KEYS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
] as const;

export function translateDOM(root: HTMLElement | Document = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const translated = key && i18next.t(key);
    if (translated) el.textContent = translated;
  }

  for (const [source, target] of ATTRIBUTE_KEYS) {
    for (const el of root.querySelectorAll(`[${source}]`)) {
      const key = el.getAttribute(source);
      const translated = key && i18next.t(key);
      if (translated) el.setAttribute(target, translated);
    }
  }
}
