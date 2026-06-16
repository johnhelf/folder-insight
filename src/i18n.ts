import zh from './locales/zh';
import en from './locales/en';
import ja from './locales/ja';
import ko from './locales/ko';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import zh_tw from './locales/zh_tw';
import ru from './locales/ru';
import ar from './locales/ar';
import it from './locales/it';

export type Locale = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'zh_tw' | 'ru' | 'ar' | 'it';
export type LanguageMode = 'auto' | Locale;

const STORAGE_KEY = 'languageMode';

const normalizeLocale = (lang: string | null | undefined): Locale => {
  const value = (lang ?? '').toLowerCase();
  if (value === 'zh-tw' || value === 'zh-hk' || value === 'zh-mo') return 'zh_tw';
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('ko')) return 'ko';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('de')) return 'de';
  if (value.startsWith('ru')) return 'ru';
  if (value.startsWith('ar')) return 'ar';
  if (value.startsWith('it')) return 'it';
  return 'en';
};

export const detectSystemLocale = (): Locale => normalizeLocale(navigator.language);

export const resolveLocale = (mode: LanguageMode, systemLocale: Locale): Locale =>
  mode === 'auto' ? systemLocale : mode;

/**
 * 判断当前语言是否为 RTL (从右向左)
 * Check if the locale is RTL (Right-to-Left)
 */
export const isRTLLocale = (locale: Locale): boolean => locale === 'ar';

export const getInitialLanguageMode = (): LanguageMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === 'auto' ||
      stored === 'zh' ||
      stored === 'en' ||
      stored === 'ja' ||
      stored === 'ko' ||
      stored === 'es' ||
      stored === 'fr' ||
      stored === 'de' ||
      stored === 'zh_tw' ||
      stored === 'ru' ||
      stored === 'ar' ||
      stored === 'it'
    ) {
      return stored as LanguageMode;
    }
  } catch {
    return 'auto';
  }
  return 'auto';
};

export const persistLanguageMode = (mode: LanguageMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  }
};

export const getLocaleNativeName = (locale: Locale) => {
  switch (locale) {
    case 'zh':
      return '中文';
    case 'en':
      return 'English';
    case 'ja':
      return '日本語';
    case 'ko':
      return '한국어';
    case 'es':
      return 'Español';
    case 'fr':
      return 'Français';
    case 'de':
      return 'Deutsch';
    case 'zh_tw':
      return '繁體中文';
    case 'ru':
      return 'Русский';
    case 'ar':
      return 'العربية';
    case 'it':
      return 'Italiano';
  }
};

const MESSAGES: Record<Locale, Record<string, string>> = {
  zh,
  en,
  ja,
  ko,
  es,
  fr,
  de,
  zh_tw,
  ru,
  ar,
  it,
};

/**
 * 创建一个翻译函数
 * Creates a translator function for the given locale
 * @param locale The locale to use for translation
 */
export const createTranslator =
  (locale: Locale) =>
  (key: string, params?: Record<string, string | number>) => {
    const template = MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
  };
