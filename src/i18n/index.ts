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
  await i18next.init({
    lng: resolveLanguage(initialLanguage),
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
    },
    interpolation: {
      escapeValue: false,
    },
  });
}

export { i18next };
