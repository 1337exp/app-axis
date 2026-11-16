/**
 * Dates for people: a day as "today / yesterday / 5 November", a moment as a time of day.
 * Даты для людей: день как «сегодня / вчера / 5 ноября», момент как время суток.
 */
import type { LocaleCode } from '@/i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day of a moment, `YYYY-MM-DD`. / Локальный календарный день момента. */
export function dayOf(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = (): string => dayOf(new Date().toISOString());

export function yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dayOf(d.toISOString());
}

/** "5 ноября" / "5 November", with the year when it is not this one. */
export function formatDay(day: string, locale: LocaleCode): string {
    const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const sameYear = y === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}

export const formatTime = (iso: string, locale: LocaleCode): string => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** A short date for a row: "5 нояб." / "5 Nov". */
export function formatShort(day: string, locale: LocaleCode): string {
    const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

/** A date with its weekday for the timeline: "ср, 18 нояб." / "Wed, Nov 18". */
export function formatWeekdayDay(day: string, locale: LocaleCode): string {
    const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

/** A month `YYYY-MM` as a header: "Декабрь 2026" / "December 2026" (the month alone and the year, without Russian "г."). */
export function formatMonth(month: string, locale: LocaleCode): string {
    const [y = 1970, m = 1] = month.split('-').map(Number);
    const parts = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).formatToParts(new Date(y, m - 1, 1));
    const text = parts
        .filter((part) => part.type === 'month' || part.type === 'year' || (part.type === 'literal' && part.value.trim() === ''))
        .map((part) => part.value)
        .join('')
        .trim();
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
