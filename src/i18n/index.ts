import i18next from 'i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
};

/** A tag's language and script, as CLDR's likely subtags fill them in. */
function likely(tag: string) {
  try {
    const { language, script } = new Intl.Locale(tag).maximize();
    return `${language}-${script}`;
  } catch {
    return null;
  }
}

/**
 * The first of `languages` a locale here is in: the one of the same language
 * and script, so `zh-MO` reads as Traditional Chinese. The menu bar picks
 * its language by the same rule before the page loads.
 */
export function systemLanguage(languages: readonly string[]): string | null {
  for (const language of languages) {
    const wanted = likely(language);
    const locale =
      wanted &&
      Object.keys(resources).find((locale) => likely(locale) === wanted);
    if (locale) return locale;
  }
  return null;
}

export function resolveLanguage(pref: string): string {
  if (pref !== 'auto') return pref;
  return systemLanguage(navigator.languages || [navigator.language]) ?? 'en';
}

export async function initI18n(initialLanguage: string) {
  // index.html ships with lang="en"; keep it in step with the UI so CJK text
  // gets the right glyph variants and line breaking.
  i18next.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  await i18next.init({
    lng: resolveLanguage(initialLanguage),
    fallbackLng: 'en',
    resources,
    interpolation: {
      // Translations only reach the page through textContent, setAttribute or
      // native dialogs, which never parse HTML; escaping here would show
      // `&amp;` literally. tests/i18n-sinks.test.ts keeps t() out of
      // innerHTML templates so this stays true.
      escapeValue: false,
    },
  });
}

export { i18next };
