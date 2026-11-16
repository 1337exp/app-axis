/**
 * The timeline by due dates: what is due when, and what is already late. A dated list, not a Gantt chart: a record has
 * one date (`due`, a day), no start and no duration. Pure grouping, no DOM, no Vue, and no clock: "today" is passed in,
 * so the page decides what day it is and the tests can pick any. Dates are days as strings and all the arithmetic is
 * done in UTC on whole day numbers, so no time zone and no change of summer time can shift a day.
 *
 * Лента по срокам: что на когда назначено и что уже опоздало. Список по датам, не диаграмма Ганта: у записи одна дата
 * (`due`, день), ни начала, ни длительности. Чистая группировка, без DOM, без Vue и без часов: «сегодня» передают
 * снаружи, так страница решает, какой сегодня день, а тесты берут любой. Даты это строки-дни, вся арифметика идёт в UTC
 * по целым номерам дней, поэтому ни пояс, ни переход на летнее время не сдвинут день.
 */
import { filterRecords } from './filter.ts';
import type { RecordFilter } from './filter.ts';
import { isClosed, isDay } from './model.ts';
import type { AxisRecord, RecordType } from './model.ts';

// ───────────────────────────── days / дни ─────────────────────────────

const DAY_MS = 86_400_000;

/** Whole days since 1970-01-01 (UTC) of a day `YYYY-MM-DD`. / Целых суток от 1970-01-01 (UTC) до дня `YYYY-MM-DD`. */
export function dayNumber(day: string): number {
    const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** The day `YYYY-MM-DD` of a number of days since 1970-01-01. / День по номеру суток от 1970-01-01. */
export function dayFromNumber(n: number): string {
    const date = new Date(n * DAY_MS);
    const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A day moved by a number of days (negative: back). / День, сдвинутый на число суток (минус: назад). */
export const addDays = (day: string, days: number): string => dayFromNumber(dayNumber(day) + days);

/** How many days from `from` to `to`: positive when `to` is later. / Сколько суток от `from` до `to`: плюс, если `to` позже. */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

/** The day of the week, 0 is Monday … 6 is Sunday: the week of the project starts on Monday. / День недели: 0 понедельник … 6 воскресенье; неделя проекта начинается с понедельника. */
export const weekdayIndex = (day: string): number => (new Date(dayNumber(day) * DAY_MS).getUTCDay() + 6) % 7;

// ───────────────────────────── sections / секции ─────────────────────────────

/**
 * Types that get into "No date": what can wait in a backlog and be forgotten, tasks and questions. An idea or a decision
 * with no date is not a reminder of anything.
 *
 * Типы, попадающие в «Без срока»: то, что может лежать в запасе и забыться, задачи и вопросы. Идея или решение без срока
 * ни о чём не напоминают.
 */
export const NODATE_TYPES: readonly RecordType[] = ['task', 'question'];

export type TimelineKind = 'overdue' | 'earlier' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'month' | 'none';

export interface TimelineFilter extends RecordFilter {
    /** Show done and dropped records too, in their date sections. / Показать и готовые, и отброшенные записи, в их секциях по датам. */
    showDone: boolean;
}

export interface TimelineItem {
    record: AxisRecord;
    /** Days from today to the due date: negative when it is behind, 0 today. Null with no date. / Суток от сегодня до срока: минус, если позади, 0 сегодня. Null без срока. */
    days: number | null;
}

export interface TimelineSection {
    /** Unique among the sections of one result, stable between runs: `overdue`, `month:2026-12`, `none`… / Уникален среди секций одного результата и стабилен между запусками. */
    id: string;
    kind: TimelineKind;
    /** `YYYY-MM` of a `month` section. / `YYYY-MM` секции `month`. */
    month?: string;
    items: TimelineItem[];
}

/**
 * The sections, in this order, empty ones left out:
 * `overdue` (due before today, not done and not dropped, oldest first), `earlier` (done or dropped records from before
 * today: only with `showDone`), `today`, `tomorrow`, `week` (the rest of the current week, Monday to Sunday),
 * `nextWeek` (the whole next week), then a `month` section for every month after that, in time order, and `none`
 * (tasks and questions with no date that are not finished). Inside a section records go by date, and by the order of the
 * tree among the same date. Only records with a status take part; done and dropped ones only with `showDone`
 * (and never in `none`). A day that is both tomorrow and next week (today is Sunday) is tomorrow.
 *
 * Секции в этом порядке, пустые не возвращаются: `overdue` (срок до сегодня, не готовы и не отброшены, старые первыми),
 * `earlier` (готовые и отброшенные записи со сроком до сегодня: только с `showDone`), `today`, `tomorrow`, `week` (остаток
 * текущей недели, понедельник…воскресенье), `nextWeek` (вся следующая неделя), дальше секция `month` на каждый следующий
 * месяц по порядку времени и `none` (задачи и вопросы без срока, не закрытые). Внутри секции записи идут по дате, а при
 * равной дате по порядку дерева. Участвуют только записи со статусом; готовые и отброшенные только с `showDone`
 * (и никогда в `none`). День, который и завтра, и следующая неделя (сегодня воскресенье), это завтра.
 */
export function buildTimeline(records: readonly AxisRecord[], filter: TimelineFilter, today: string): TimelineSection[] {
    if (!isDay(today)) return [];
    const base = dayNumber(today);
    const weekEnd = 6 - weekdayIndex(today); // days from today to this Sunday / суток до этого воскресенья
    const nextWeekEnd = weekEnd + 7;

    const buckets: Record<'overdue' | 'earlier' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'none', TimelineItem[]> = {
        overdue: [],
        earlier: [],
        today: [],
        tomorrow: [],
        week: [],
        nextWeek: [],
        none: [],
    };
    const months = new Map<string, TimelineItem[]>();

    for (const record of filterRecords(records, filter)) {
        const closed = isClosed(record.status);
        if (!isDay(record.due)) {
            if (!closed && NODATE_TYPES.includes(record.type)) buckets.none.push({ record, days: null });
            continue;
        }
        if (closed && !filter.showDone) continue;
        const days = dayNumber(record.due) - base;
        const item = { record, days };
        if (days < 0) (closed ? buckets.earlier : buckets.overdue).push(item);
        else if (days === 0) buckets.today.push(item);
        else if (days === 1) buckets.tomorrow.push(item);
        else if (days <= weekEnd) buckets.week.push(item);
        else if (days <= nextWeekEnd) buckets.nextWeek.push(item);
        else {
            const month = record.due.slice(0, 7);
            const list = months.get(month);
            if (list) list.push(item);
            else months.set(month, [item]);
        }
    }

    // the records came in the order of the tree, and a stable sort keeps it among the same dates
    const byDate = (a: TimelineItem, b: TimelineItem): number => (a.days ?? 0) - (b.days ?? 0);
    const sections: TimelineSection[] = [];
    const add = (id: string, kind: TimelineKind, items: TimelineItem[], month?: string): void => {
        if (items.length > 0) sections.push({ id, kind, ...(month === undefined ? {} : { month }), items: kind === 'none' ? items : items.sort(byDate) });
    };
    add('overdue', 'overdue', buckets.overdue);
    add('earlier', 'earlier', buckets.earlier);
    add('today', 'today', buckets.today);
    add('tomorrow', 'tomorrow', buckets.tomorrow);
    add('week', 'week', buckets.week);
    add('nextWeek', 'nextWeek', buckets.nextWeek);
    for (const month of [...months.keys()].sort()) add(`month:${month}`, 'month', months.get(month)!, month);
    add('none', 'none', buckets.none);
    return sections;
}

/** How many records the sections hold. / Сколько записей в секциях. */
export const countItems = (sections: readonly TimelineSection[]): number => sections.reduce((sum, section) => sum + section.items.length, 0);
