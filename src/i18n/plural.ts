/**
 * Plural forms. The i18n of TaoUX has no plurals (a key is one string), so a counted phrase is a group of four keys,
 * `one`, `few`, `many` and `other`, and the language picks the form: Russian needs all four ("1 день, 2 дня, 5 дней,
 * 1,5 дня"), English two. The rules are the browser's own (`Intl.PluralRules`), nothing is written by hand here.
 *
 * Формы множественного числа. В i18n из TaoUX их нет (ключ это одна строка), поэтому фраза со счётом это группа из
 * четырёх ключей, `one`, `few`, `many` и `other`, а язык выбирает форму: русскому нужны все четыре («1 день, 2 дня,
 * 5 дней, 1,5 дня»), английскому две. Правила берутся у самого браузера (`Intl.PluralRules`), вручную тут ничего не пишется.
 */

/** The forms the dictionaries of the app have. A language that has more (`zero`, `two`) falls back to `other`. / Формы, что есть в словарях приложения. Язык, у которого их больше (`zero`, `two`), падает на `other`. */
export const PLURAL_FORMS = ['one', 'few', 'many', 'other'] as const;
export type PluralForm = (typeof PLURAL_FORMS)[number];

const rules = new Map<string, Intl.PluralRules>();

/** The form a language uses for a number: ru 1 → one, 2 → few, 5 → many, 21 → one, 1.5 → other. / Форма, которую язык берёт для числа. */
export function pluralForm(locale: string, n: number): PluralForm {
    let rule = rules.get(locale);
    if (!rule) {
        rule = new Intl.PluralRules(locale);
        rules.set(locale, rule);
    }
    const form = rule.select(n);
    return (PLURAL_FORMS as readonly string[]).includes(form) ? (form as PluralForm) : 'other';
}
