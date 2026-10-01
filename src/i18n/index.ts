import i18next from 'i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

const SUPPORTED_MATCHERS: Array<[RegExp, string]> = [
  [/^zh-(tw|hk|hant)/i, 'zh-TW'],
  [/^zh/i, 'zh-CN'],
  [/^en/i, 'en'],
];

export function resolveLanguage(pref: string): string {
  if (pref !== 'auto') return pref;

  const sysLangs = navigator.languages || [navigator.language];
  for (const lang of sysLangs) {
    const matched = SUPPORTED_MATCHERS.find(([pattern]) => pattern.test(lang));
    if (matched) return matched[1];
  }
  return 'en';
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
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
    },
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
