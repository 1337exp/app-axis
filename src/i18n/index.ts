import { localeEn, localeRu, setTaoLocale } from '@1337exp/taoui';
import { createI18n, type MessageArgs, type Paths } from '@1337exp/taoux/i18n';
import { watch } from 'vue';
import en from './en';
import ru from './ru';

export const LOCALES = { ru, en } as const;
export type LocaleCode = keyof typeof LOCALES;
export type MessageKey = Paths<typeof ru>;
export type { MessageArgs };

/** Names of the languages in the languages themselves. / Названия языков на самих языках. */
export const LOCALE_NAMES: Record<LocaleCode, string> = { ru: 'Русский', en: 'English' };

const i18n = createI18n<typeof LOCALES, MessageKey>({ locales: LOCALES, fallback: 'en', storageKey: 'axis.locale' });

export const { setLocale, translate, useI18n, current, codes } = i18n;

/**
 * Picks the language and keeps the texts of TaoUI itself (calendar, menus) in step with it.
 * Выбирает язык и держит тексты самого TaoUI (календарь, меню) в ногу с ним.
 */
export function initLocale(): void {
    i18n.initLocale();
    watch(current, (code) => setTaoLocale(code === 'ru' ? localeRu : localeEn), { immediate: true });
}
