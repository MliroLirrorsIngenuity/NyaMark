import { updateMacosMenu } from '../bridge/ipc/menu';
import { i18next, resolveLanguage } from '../i18n';
import { translateDOM } from '../i18n/dom';
import { isMacOS } from '../platform/detect';
import { subscribeSettings } from '../state/settings';

/**
 * Keeps the UI language in step with the language setting and, while that
 * is `auto`, with the system language, including a change made while
 * NyaMark runs.
 */
export function bindLanguageSetting(initialPreference: string) {
  let preference = initialPreference;

  const apply = () => {
    const language = resolveLanguage(preference);
    if (language === i18next.language) return;
    void i18next.changeLanguage(language).then(() => {
      translateDOM(document.body);
      syncMacosMenu();
    });
  };

  subscribeSettings((settings) => {
    if (settings.general.language === preference) return;
    preference = settings.general.language;
    apply();
  });
  window.addEventListener('languagechange', () => {
    if (preference === 'auto') apply();
  });
}

/** The native menu bar is built in Rust; hand it the current strings. */
export function syncMacosMenu() {
  if (!isMacOS()) return;
  void updateMacosMenu(
    i18next.getResourceBundle(i18next.language, 'translation').menu
  ).catch((error) => console.warn('Failed to update the macOS menu', error));
}
