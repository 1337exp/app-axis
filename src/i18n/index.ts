import { localeEn, localeRu, setTaoLocale } from '@1337exp/taoui';
import { createI18n, type MessageArgs, type Paths } from '@1337exp/taoux/i18n';
import { watch } from 'vue';
import en from './en';
import { pluralForm } from './plural';
import ru from './ru';

export const LOCALES = { ru, en } as const;
export type LocaleCode = keyof typeof LOCALES;
export type MessageKey = Paths<typeof ru>;
export type { MessageArgs };

/** Names of the languages in the languages themselves. / Названия языков на самих языках. */
export const LOCALE_NAMES: Record<LocaleCode, string> = { ru: 'Русский', en: 'English' };

const i18n = createI18n<typeof LOCALES, MessageKey>({ locales: LOCALES, fallback: 'en', storageKey: 'axis.locale' });

export const { setLocale, translate, useI18n, current, codes } = i18n;

/** Keys of the counted phrases: each is a group of `one`, `few`, `many`, `other` in the dictionaries. / Ключи фраз со счётом: каждый это группа `one`, `few`, `many`, `other` в словарях. */
export type PluralKey = 'timeline.inDays' | 'timeline.lateDays';

/**
 * A counted phrase in the language at hand, in the right form: `plural('ru', 'timeline.inDays', 2)` is "через 2 дня".
 * The number goes into `{0}`. / Фраза со счётом на нужном языке в нужной форме; число подставляется в `{0}`.
 */
export const plural = (code: LocaleCode, key: PluralKey, n: number): string => translate(code, `${key}.${pluralForm(code, n)}` as MessageKey, [n]);

/** The same in the language the page speaks now: reactive, so a template redraws when the language changes. / То же на языке страницы: реактивно, шаблон перерисуется при смене языка. */
export const tn = (key: PluralKey, n: number): string => plural(current.value, key, n);

/**
 * Picks the language and keeps the texts of TaoUI itself (calendar, menus) in step with it.
 * Выбирает язык и держит тексты самого TaoUI (календарь, меню) в ногу с ним.
 */
export function initLocale(): void {
    i18n.initLocale();
    watch(current, (code) => setTaoLocale(code === 'ru' ? localeRu : localeEn), { immediate: true });
}
