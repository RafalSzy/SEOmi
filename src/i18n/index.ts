import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import { readStorage, writeStorage } from '@/services/storage';

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', nativeName: '简体中文', dir: 'ltr' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
] as const;

export type SupportedLanguage = (typeof LANGUAGES)[number]['code'];

type TranslationTree = Record<string, unknown>;
type LocaleModule = TranslationTree;

const localeLoaders = import.meta.glob(['./locales/*.json', '!./locales/en.json'], {
  import: 'default',
}) as Record<string, () => Promise<LocaleModule>>;


const completeLocale = (locale: TranslationTree, fallback: TranslationTree): TranslationTree => {
  const result: TranslationTree = { ...fallback, ...locale };
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const localeValue = locale[key];
    if (
      fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)
      && localeValue && typeof localeValue === 'object' && !Array.isArray(localeValue)
    ) {
      result[key] = completeLocale(localeValue as TranslationTree, fallbackValue as TranslationTree);
    }
  }
  return result;
};

const localePath = (code: string): string => `./locales/${code}.json`;

/** English is the only startup resource; other languages are loaded on demand. */
export const localeResources = { en: { translation: en } };

const localePromises = new Map<string, Promise<TranslationTree>>();

export const loadLocale = (code: string): Promise<TranslationTree> => {
  const normalized = code.toLowerCase().split('-')[0];
  if (normalized === 'en') return Promise.resolve(en);
  const existing = localePromises.get(normalized);
  if (existing) return existing;
  const loader = localeLoaders[localePath(normalized)];
  const promise = loader
    ? loader().then((locale) => completeLocale(locale, en))
    : Promise.resolve(en);
  localePromises.set(normalized, promise);
  return promise;
};

const savedLang = readStorage('seomi_language') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: localeResources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// i18next's normal backend is intentionally not used here: desktop builds
// have no HTTP translation endpoint. Wrap the public method so direct callers
// and react-i18next both receive the selected chunk before the language flips.
const nativeChangeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = (async (...args: any[]) => {
  const requested = typeof args[0] === 'string' ? args[0] : i18n.language;
  const normalized = requested.toLowerCase().split('-')[0];
  const translation = await loadLocale(normalized);
  if (normalized !== 'en') {
    i18n.addResourceBundle(normalized, 'translation', translation, true, true);
  }
  return nativeChangeLanguage(...args);
}) as typeof i18n.changeLanguage;

// Apply document text direction
export const setLanguageDirection = (langCode: string): Promise<void> => {
  const langConfig = LANGUAGES.find((l) => l.code === langCode);
  const dir = langConfig?.dir || 'ltr';
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    document.documentElement.lang = langCode;
  }
  // Keep the resource selected by i18next in lock-step with the persisted
  // setting. Updating only the DOM direction leaves the UI rendered in the
  // previous language until a full restart.
  writeStorage('seomi_language', langCode);
  if (i18n.language !== langCode) return i18n.changeLanguage(langCode).then(() => undefined);
  return Promise.resolve();
};

// Initial run. The entrypoint awaits this promise so a persisted non-English
// locale cannot render one frame of English UI before its resource chunk loads.
export const languageReady = setLanguageDirection(savedLang).finally(() => {
  writeStorage('seomi_language', savedLang);
});

export default i18n;
