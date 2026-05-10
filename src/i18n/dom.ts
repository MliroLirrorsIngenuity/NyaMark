import { i18next } from './index';

export function translateDOM(root: HTMLElement | Document = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const translated = i18next.t(key);
      if (translated) {
        el.textContent = translated;
      }
    }
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const translated = i18next.t(key);
      if (translated) {
        el.setAttribute('title', translated);
      }
    }
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      const translated = i18next.t(key);
      if (translated) {
        el.setAttribute('aria-label', translated);
      }
    }
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const translated = i18next.t(key);
      if (translated) {
        el.setAttribute('placeholder', translated);
      }
    }
  });
}
