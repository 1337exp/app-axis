import { describe, expect, it } from 'vitest';
import { FILTER_TYPES } from '../src/core/filter.ts';
import type { AxisRecord } from '../src/core/model.ts';
import { NODATE_TYPES, addDays, buildTimeline, countItems, dayFromNumber, dayNumber, daysBetween, weekdayIndex } from '../src/core/timeline.ts';
import type { TimelineFilter, TimelineSection } from '../src/core/timeline.ts';
import { readFilter, readFlag, writeFilter, writeFlag } from '../src/app/viewFilter.ts';
import { untilMidnight } from '../src/app/today.ts';
import { plural } from '../src/i18n/index.ts';
import { PLURAL_FORMS, pluralForm } from '../src/i18n/plural.ts';
import en from '../src/i18n/en.ts';
import ru from '../src/i18n/ru.ts';

const NOW = '2026-11-16T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

const ALL: TimelineFilter = { types: FILTER_TYPES, showDone: false };
const ids = (section: TimelineSection | undefined): string[] => (section?.items ?? []).map((item) => item.record.id);
const sectionIds = (sections: readonly TimelineSection[]): string[] => sections.map((s) => s.id);
const by = (sections: readonly TimelineSection[], id: string): TimelineSection | undefined => sections.find((s) => s.id === id);

/** The id of the one section a task with this due date falls into, when `today` is the given day. / Секция, куда попадает задача с этим сроком при заданном «сегодня». */
function placed(today: string, due: string): string {
    const sections = buildTimeline([rec('x', { due })], ALL, today);
    expect(sections).toHaveLength(1);
    return sections[0]!.id;
}

// the calendar of this test: 2026-11-16 is a Monday
// Mon 16 Nov 2026 · Sun 22 Nov · Sun 29 Nov · Mon 30 Nov · Thu 31 Dec 2026 · Fri 1 Jan 2027

describe('days: arithmetic on day strings', () => {
    it('numbers days from 1970-01-01 and back, whatever the zone', () => {
        expect(dayNumber('1970-01-01')).toBe(0);
        expect(dayNumber('1970-01-02')).toBe(1);
        expect(dayFromNumber(0)).toBe('1970-01-01');
        for (let n = dayNumber('2024-01-01'); n <= dayNumber('2030-01-01'); n += 1) expect(dayNumber(dayFromNumber(n))).toBe(n);
    });

    it('moves a day across a month, a year and a leap day', () => {
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
        expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
        expect(addDays('2026-11-16', 0)).toBe('2026-11-16');
        expect(addDays('2026-11-16', 365)).toBe('2027-11-16');
    });

    it('counts days between two days, signed', () => {
        expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0);
        expect(daysBetween('2026-11-16', '2026-11-17')).toBe(1);
        expect(daysBetween('2026-11-16', '2026-11-13')).toBe(-3);
        expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
        expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
        expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    });

    it('is exactly one day from one day to the next, also over the nights the clocks change', () => {
        // EU: 2026-03-29 and 2026-10-25; US: 2026-03-08 and 2026-11-01
        for (const start of ['2026-03-27', '2026-03-07', '2026-10-24', '2026-10-31']) {
            for (let i = 0; i < 4; i += 1) {
                const day = addDays(start, i);
                expect(daysBetween(day, addDays(day, 1))).toBe(1);
                expect(weekdayIndex(addDays(day, 1))).toBe((weekdayIndex(day) + 1) % 7);
            }
        }
        expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
        expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    });

    it('knows the weekday, Monday is 0', () => {
        expect(weekdayIndex('2026-11-16')).toBe(0); // Monday
        expect(weekdayIndex('2026-11-17')).toBe(1);
        expect(weekdayIndex('2026-11-22')).toBe(6); // Sunday
        expect(weekdayIndex('2026-01-01')).toBe(3); // Thursday
        expect(weekdayIndex('2028-02-29')).toBe(1); // Tuesday
    });
});

describe('timeline sections: where a date falls', () => {
    it('Monday as today: yesterday, today, tomorrow, the rest of the week, next week, the month', () => {
        const today = '2026-11-16';
        expect(placed(today, '2026-11-15')).toBe('overdue');
        expect(placed(today, '2026-01-01')).toBe('overdue');
        expect(placed(today, '2026-11-16')).toBe('today');
        expect(placed(today, '2026-11-17')).toBe('tomorrow');
        expect(placed(today, '2026-11-18')).toBe('week');
        expect(placed(today, '2026-11-22')).toBe('week'); // Sunday: the last day of this week
        expect(placed(today, '2026-11-23')).toBe('nextWeek'); // Monday: the week turns
        expect(placed(today, '2026-11-29')).toBe('nextWeek');
        expect(placed(today, '2026-11-30')).toBe('month:2026-11');
        expect(placed(today, '2026-12-01')).toBe('month:2026-12');
    });

    it('Sunday as today: tomorrow is already next week, but it is tomorrow; "This week" is empty', () => {
        const today = '2026-11-22';
        expect(placed(today, '2026-11-21')).toBe('overdue');
        expect(placed(today, '2026-11-22')).toBe('today');
        expect(placed(today, '2026-11-23')).toBe('tomorrow');
        expect(placed(today, '2026-11-24')).toBe('nextWeek');
        expect(placed(today, '2026-11-29')).toBe('nextWeek'); // Sunday of the next week
        expect(placed(today, '2026-11-30')).toBe('month:2026-11');
        const all = buildTimeline(['2026-11-23', '2026-11-24'].map((due, i) => rec(`r${i}`, { due })), ALL, today);
        expect(sectionIds(all)).toEqual(['tomorrow', 'nextWeek']);
    });

    it('Saturday as today: tomorrow is the Sunday, the next week starts on Monday', () => {
        const today = '2026-11-21';
        expect(placed(today, '2026-11-22')).toBe('tomorrow');
        expect(placed(today, '2026-11-23')).toBe('nextWeek');
        expect(placed(today, '2026-11-29')).toBe('nextWeek');
        expect(placed(today, '2026-11-30')).toBe('month:2026-11');
    });

    it('a Wednesday: the end of the week is the Sunday', () => {
        const today = '2026-11-18';
        expect(placed(today, '2026-11-19')).toBe('tomorrow');
        expect(placed(today, '2026-11-20')).toBe('week');
        expect(placed(today, '2026-11-22')).toBe('week');
        expect(placed(today, '2026-11-23')).toBe('nextWeek');
        expect(placed(today, '2026-11-29')).toBe('nextWeek');
        expect(placed(today, '2026-11-30')).toBe('month:2026-11');
    });

    it('the turn of a month: the week and the next week run over into the new month, then a month section', () => {
        const today = '2026-11-30'; // Monday
        expect(placed(today, '2026-12-01')).toBe('tomorrow');
        expect(placed(today, '2026-12-02')).toBe('week');
        expect(placed(today, '2026-12-06')).toBe('week'); // Sunday
        expect(placed(today, '2026-12-07')).toBe('nextWeek');
        expect(placed(today, '2026-12-13')).toBe('nextWeek');
        expect(placed(today, '2026-12-14')).toBe('month:2026-12');
    });

    it('the turn of a year: December into January, and the months go in time order across the year', () => {
        const today = '2026-12-31'; // Thursday
        expect(placed(today, '2027-01-01')).toBe('tomorrow');
        expect(placed(today, '2027-01-03')).toBe('week'); // Sunday
        expect(placed(today, '2027-01-04')).toBe('nextWeek');
        expect(placed(today, '2027-01-10')).toBe('nextWeek');
        expect(placed(today, '2027-01-11')).toBe('month:2027-01');
        expect(placed(today, '2027-02-01')).toBe('month:2027-02');

        const records = ['2027-02-03', '2026-12-10', '2027-01-05', '2026-11-30', '2027-01-04', '2026-12-31'].map((due, i) => rec(`m${i}`, { due }));
        const sections = buildTimeline(records, ALL, '2026-11-16');
        expect(sectionIds(sections)).toEqual(['month:2026-11', 'month:2026-12', 'month:2027-01', 'month:2027-02']);
        expect(sections.map((s) => s.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
        expect(ids(by(sections, 'month:2027-01'))).toEqual(['m4', 'm2']); // by date inside a month
    });

    it('a leap day is a day like any other', () => {
        expect(placed('2028-02-28', '2028-02-29')).toBe('tomorrow');
        expect(placed('2028-02-28', '2028-03-01')).toBe('week'); // Wednesday
        expect(placed('2028-02-28', '2028-03-05')).toBe('week'); // Sunday
        expect(placed('2028-02-28', '2028-03-12')).toBe('nextWeek');
        expect(placed('2028-02-28', '2028-03-13')).toBe('month:2028-03');
        expect(placed('2027-02-28', '2027-03-01')).toBe('tomorrow'); // no 29 Feb in 2027
    });

    it('is not shifted by the nights the clocks change', () => {
        expect(placed('2026-03-28', '2026-03-29')).toBe('tomorrow'); // Saturday, EU spring forward on the Sunday
        expect(placed('2026-03-28', '2026-03-30')).toBe('nextWeek');
        expect(placed('2026-10-24', '2026-10-25')).toBe('tomorrow'); // Saturday, EU fall back on the Sunday
        expect(placed('2026-10-24', '2026-10-26')).toBe('nextWeek');
        expect(placed('2026-10-31', '2026-11-01')).toBe('tomorrow'); // Saturday, US fall back on the Sunday
        expect(placed('2026-11-01', '2026-10-31')).toBe('overdue');
    });

    it('gives the sections in their order and leaves the empty ones out', () => {
        const due = ['2026-11-10', '2026-11-16', '2026-11-17', '2026-11-19', '2026-11-25', '2026-12-20', '2027-03-01'];
        const records = [...due.map((d, i) => rec(`d${i}`, { due: d })), rec('nodate')];
        const sections = buildTimeline(records, ALL, '2026-11-16');
        expect(sectionIds(sections)).toEqual(['overdue', 'today', 'tomorrow', 'week', 'nextWeek', 'month:2026-12', 'month:2027-03', 'none']);
        expect(sections.map((s) => s.kind)).toEqual(['overdue', 'today', 'tomorrow', 'week', 'nextWeek', 'month', 'month', 'none']);
        expect(buildTimeline([rec('a', { due: '2026-11-17' })], ALL, '2026-11-16').map((s) => s.id)).toEqual(['tomorrow']);
        expect(new Set(sectionIds(sections)).size).toBe(sections.length);
    });

    it('returns nothing for no records, and nothing for a today that is not a day', () => {
        expect(buildTimeline([], ALL, '2026-11-16')).toEqual([]);
        expect(buildTimeline([rec('a', { due: '2026-11-17' })], ALL, 'tomorrow')).toEqual([]);
        expect(buildTimeline([rec('a', { due: '2026-11-17' })], ALL, '2026-02-30')).toEqual([]);
    });

    it('gives each row its distance in days from today', () => {
        const dues = { a: '2026-11-13', b: '2026-11-16', c: '2026-11-17', d: '2026-11-20', e: '2027-01-01' };
        const records = Object.entries(dues).map(([id, due]) => rec(id, { due }));
        const days = Object.fromEntries(buildTimeline(records, ALL, '2026-11-16').flatMap((s) => s.items.map((i) => [i.record.id, i.days])));
        expect(days).toEqual({ a: -3, b: 0, c: 1, d: 4, e: 46 });
        expect(buildTimeline([rec('n')], ALL, '2026-11-16')[0]!.items[0]!.days).toBeNull();
    });
});

describe('timeline: overdue and done', () => {
    // two weeks of lateness and a done one, all from before today (2026-11-16)
    const records = [
        rec('late-old', { due: '2026-11-01' }),
        rec('late-new', { due: '2026-11-15', status: 'active' }),
        rec('done-late', { due: '2026-11-10', status: 'done' }),
        rec('dropped-late', { due: '2026-11-12', status: 'dropped' }),
        rec('done-today', { due: '2026-11-16', status: 'done' }),
        rec('done-soon', { due: '2026-11-19', status: 'done' }),
        rec('open-soon', { due: '2026-11-19' }),
    ];
    const today = '2026-11-16';

    it('overdue holds what is behind and not finished, oldest first', () => {
        const sections = buildTimeline(records, ALL, today);
        expect(ids(by(sections, 'overdue'))).toEqual(['late-old', 'late-new']);
    });

    it('a done or dropped record is never overdue and is hidden without showDone', () => {
        const sections = buildTimeline(records, ALL, today);
        expect(sectionIds(sections)).toEqual(['overdue', 'week']);
        expect(ids(by(sections, 'week'))).toEqual(['open-soon']);
        expect(sections.flatMap((s) => ids(s))).not.toContain('done-late');
        expect(sections.flatMap((s) => ids(s))).not.toContain('dropped-late');
    });

    it('showDone brings them back into their date sections; the finished ones from the past go to "earlier", not to "overdue"', () => {
        const sections = buildTimeline(records, { ...ALL, showDone: true }, today);
        expect(sectionIds(sections)).toEqual(['overdue', 'earlier', 'today', 'week']);
        expect(ids(by(sections, 'overdue'))).toEqual(['late-old', 'late-new']);
        expect(ids(by(sections, 'earlier'))).toEqual(['done-late', 'dropped-late']);
        expect(ids(by(sections, 'today'))).toEqual(['done-today']);
        expect(ids(by(sections, 'week'))).toEqual(['done-soon', 'open-soon']); // same date: the order of the list is the order of the tree
    });

    it('a record is no longer late the moment it is done (and late again when reopened)', () => {
        const mine = rec('t', { due: '2026-11-10' });
        expect(ids(by(buildTimeline([mine], ALL, today), 'overdue'))).toEqual(['t']);
        expect(buildTimeline([{ ...mine, status: 'done' }], ALL, today)).toEqual([]);
        expect(ids(by(buildTimeline([{ ...mine, status: 'open' }], ALL, today), 'overdue'))).toEqual(['t']);
    });

    it('a record due today is not overdue until tomorrow', () => {
        const mine = rec('t', { due: '2026-11-16' });
        expect(sectionIds(buildTimeline([mine], ALL, '2026-11-16'))).toEqual(['today']);
        expect(sectionIds(buildTimeline([mine], ALL, '2026-11-17'))).toEqual(['overdue']);
    });
});

describe('timeline filters', () => {
    // a: area ─ a1 task (due 11-17), a-idea idea (11-17), a-q question (11-18)
    // b: area ─ b1 task (11-17), b-sub area ─ bs1 task (11-17), b-note note (11-17)
    const records = [
        rec('a', { type: 'area', order: 1 }),
        rec('a1', { parent: 'a', order: 1, due: '2026-11-17' }),
        rec('a-idea', { parent: 'a', order: 2, type: 'idea', due: '2026-11-17' }),
        rec('a-q', { parent: 'a', order: 3, type: 'question', due: '2026-11-18' }),
        rec('b', { type: 'area', order: 2 }),
        rec('b1', { parent: 'b', order: 1, due: '2026-11-17' }),
        rec('bsub', { parent: 'b', order: 2, type: 'area' }),
        rec('bs1', { parent: 'bsub', due: '2026-11-17' }),
        rec('b-note', { parent: 'b', order: 3, type: 'note', due: '2026-11-17' }),
    ];
    const everything = (filter: Partial<TimelineFilter>, list = records): string[] =>
        buildTimeline(list, { ...ALL, ...filter }, '2026-11-16').flatMap((s) => ids(s));

    it('shows the chosen types only', () => {
        expect(everything({ types: ['task'] }).sort()).toEqual(['a1', 'b1', 'bs1']);
        expect(everything({ types: ['idea', 'question'] }).sort()).toEqual(['a-idea', 'a-q']);
        expect(everything({ types: [] })).toEqual([]);
    });

    it('never shows an area or a note, even when asked for them', () => {
        const got = everything({ types: ['area', 'note', ...FILTER_TYPES] });
        expect(got).not.toContain('b-note');
        expect(got).not.toContain('a');
        expect(got).not.toContain('bsub');
    });

    it('with a root shows only what is under it, at any depth, and not the root', () => {
        expect(everything({ root: 'a' }).sort()).toEqual(['a-idea', 'a-q', 'a1']);
        expect(everything({ root: 'b' }).sort()).toEqual(['b1', 'bs1']);
        expect(everything({ root: 'bsub' })).toEqual(['bs1']);
        expect(everything({ root: 'a1' })).toEqual([]);
    });

    it('combines the type and the branch, and treats a null or missing root as the whole project', () => {
        expect(everything({ types: ['question'], root: 'a' })).toEqual(['a-q']);
        const whole = everything({});
        expect(everything({ root: null })).toEqual(whole);
        expect(everything({ root: undefined })).toEqual(whole);
    });

    it('a root that does not exist gives nothing, in the date sections and in the backlog', () => {
        const withBacklog = [...records, rec('loose')];
        expect(everything({ root: 'gone' }, withBacklog)).toEqual([]);
        expect(everything({ root: 'gone', showDone: true }, withBacklog)).toEqual([]);
    });

    it('does not lose a record whose parent is gone: it comes up to the top, like in the tree', () => {
        expect(everything({}, [rec('x', { parent: 'missing', due: '2026-11-17' })])).toEqual(['x']);
    });
});

describe('timeline: no date', () => {
    const today = '2026-11-16';
    const records = [
        rec('z-task', { order: 3 }),
        rec('a-question', { order: 1, type: 'question' }),
        rec('active-task', { order: 2, status: 'active' }),
        rec('idea', { order: 4, type: 'idea' }),
        rec('decision', { order: 5, type: 'decision' }),
        rec('done-task', { order: 6, status: 'done' }),
        rec('dropped-question', { order: 7, type: 'question', status: 'dropped' }),
        rec('dated', { order: 8, due: '2026-11-17' }),
        rec('note', { order: 9, type: 'note' }),
        rec('area', { order: 10, type: 'area' }),
    ];

    it('holds the tasks and the questions that are not finished and have no date, in the order of the tree', () => {
        const section = by(buildTimeline(records, ALL, today), 'none');
        expect(ids(section)).toEqual(['a-question', 'active-task', 'z-task']);
        expect(section?.kind).toBe('none');
        expect(NODATE_TYPES).toEqual(['task', 'question']);
    });

    it('is the last section, after the months', () => {
        const sections = buildTimeline([...records, rec('far', { due: '2027-05-05' })], ALL, today);
        expect(sectionIds(sections).at(-1)).toBe('none');
        expect(sectionIds(sections)).toEqual(['tomorrow', 'month:2027-05', 'none']);
    });

    it('does not take a finished record even with showDone, nor an idea or a decision', () => {
        const section = by(buildTimeline(records, { ...ALL, showDone: true }, today), 'none');
        expect(ids(section)).toEqual(['a-question', 'active-task', 'z-task']);
    });

    it('follows the type filter and the branch', () => {
        expect(ids(by(buildTimeline(records, { ...ALL, types: ['question'] }, today), 'none'))).toEqual(['a-question']);
        expect(ids(by(buildTimeline(records, { ...ALL, types: ['idea', 'decision'] }, today), 'none'))).toEqual([]);
        const tree = [rec('p', { type: 'area' }), rec('in', { parent: 'p' }), rec('out')];
        expect(ids(by(buildTimeline(tree, { ...ALL, root: 'p' }, today), 'none'))).toEqual(['in']);
    });

    it('is not drawn when there is nothing for it', () => {
        expect(buildTimeline([rec('d', { due: '2026-11-17' })], ALL, today).map((s) => s.id)).toEqual(['tomorrow']);
    });

    it('takes a due that is not a real day for no date', () => {
        const odd = rec('odd');
        odd.due = '2026-13-45';
        const sections = buildTimeline([odd], ALL, today);
        expect(sectionIds(sections)).toEqual(['none']);
        expect(sections[0]!.items[0]!.days).toBeNull();
    });
});

describe('timeline ordering', () => {
    it('goes by date inside a section, and by the order of the tree among the same date', () => {
        // listed in a scrambled way: the tree order is the `order` field
        const records = [
            rec('c', { order: 3, due: '2026-11-19' }),
            rec('e', { order: 1, due: '2026-11-20' }),
            rec('a', { order: 2, due: '2026-11-19' }),
            rec('b', { order: 4, due: '2026-11-18' }),
            rec('d', { order: 0, due: '2026-11-20' }),
        ];
        expect(ids(by(buildTimeline(records, ALL, '2026-11-16'), 'week'))).toEqual(['b', 'a', 'c', 'd', 'e']);
    });

    it('lists the overdue oldest first, whatever their order in the tree', () => {
        const records = [rec('new', { order: 1, due: '2026-11-14' }), rec('old', { order: 2, due: '2026-10-02' }), rec('mid', { order: 3, due: '2026-11-01' })];
        expect(ids(by(buildTimeline(records, ALL, '2026-11-16'), 'overdue'))).toEqual(['old', 'mid', 'new']);
    });

    it('keeps the tree order across areas for the same date', () => {
        const records = [
            rec('area2', { type: 'area', order: 2 }),
            rec('area1', { type: 'area', order: 1 }),
            rec('in2', { parent: 'area2', due: '2026-11-17' }),
            rec('in1', { parent: 'area1', due: '2026-11-17' }),
        ];
        expect(ids(by(buildTimeline(records, ALL, '2026-11-16'), 'tomorrow'))).toEqual(['in1', 'in2']);
    });

    it('counts the rows of all sections', () => {
        const sections = buildTimeline([rec('a', { due: '2026-11-17' }), rec('b', { due: '2026-11-17' }), rec('c')], ALL, '2026-11-16');
        expect(countItems(sections)).toBe(3);
        expect(countItems([])).toBe(0);
    });
});

describe('saved choices of the views', () => {
    const fake = (initial: Record<string, string> = {}) => {
        const data = { ...initial };
        return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    };

    it('keeps the filter of the timeline apart from the board, and per project', () => {
        const store = fake();
        writeFilter('board', 'p', { types: ['idea'], root: 'a' }, store);
        writeFilter('timeline', 'p', { types: ['task', 'decision'], root: null }, store);
        writeFilter('timeline', 'q', { types: ['question'], root: 'b' }, store);
        expect(readFilter('board', 'p', store)).toEqual({ types: ['idea'], root: 'a' });
        expect(readFilter('timeline', 'p', store)).toEqual({ types: ['task', 'decision'], root: null });
        expect(readFilter('timeline', 'q', store)).toEqual({ types: ['question'], root: 'b' });
        expect(readFilter('board', 'q', store)).toEqual({ types: ['task', 'question'], root: null });
        expect(Object.keys(store.data).sort()).toEqual(['axis.board.p', 'axis.timeline.p', 'axis.timeline.q']);
    });

    it('reads a filter the board saved before the timeline existed', () => {
        const store = fake({ 'axis.board.axis': JSON.stringify({ types: ['task'], root: 'x1' }) });
        expect(readFilter('board', 'axis', store)).toEqual({ types: ['task'], root: 'x1' });
        expect(readFilter('timeline', 'axis', store)).toEqual({ types: ['task', 'question'], root: null });
    });

    it('keeps the flags per project, with a default, and survives garbage and a storage that throws', () => {
        const store = fake();
        expect(readFlag('timeline.done', 'p', false, store)).toBe(false);
        expect(readFlag('timeline.nodate', 'p', true, store)).toBe(true);
        writeFlag('timeline.done', 'p', true, store);
        writeFlag('timeline.nodate', 'p', false, store);
        expect(readFlag('timeline.done', 'p', false, store)).toBe(true);
        expect(readFlag('timeline.nodate', 'p', true, store)).toBe(false);
        expect(readFlag('timeline.done', 'q', false, store)).toBe(false);
        expect(readFlag('timeline.done', 'p', false, fake({ 'axis.timeline.done.p': 'yes' }))).toBe(false);
        const broken = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('full');
            },
        };
        expect(readFlag('timeline.done', 'p', true, broken)).toBe(true);
        expect(() => writeFlag('timeline.done', 'p', true, broken)).not.toThrow();
    });
});

describe('"today" and the clock', () => {
    it('counts the time to the next local midnight, also over the end of a month and a year', () => {
        expect(untilMidnight(new Date(2026, 10, 16, 23, 59, 30))).toBe(30_000);
        expect(untilMidnight(new Date(2026, 10, 16, 0, 0, 0))).toBe(24 * 3600 * 1000);
        expect(untilMidnight(new Date(2026, 10, 30, 12, 0, 0))).toBe(12 * 3600 * 1000);
        expect(untilMidnight(new Date(2026, 11, 31, 23, 0, 0))).toBe(3600 * 1000);
    });
});

describe('plural forms', () => {
    const ruIn = (n: number): string => plural('ru', 'timeline.inDays', n);
    const ruLate = (n: number): string => plural('ru', 'timeline.lateDays', n);

    it('picks the right Russian form: 1 день, 2 дня, 5 дней, 11 дней, 21 день', () => {
        expect(ruIn(1)).toBe('через 1 день');
        expect(ruIn(2)).toBe('через 2 дня');
        expect(ruIn(3)).toBe('через 3 дня');
        expect(ruIn(4)).toBe('через 4 дня');
        expect(ruIn(5)).toBe('через 5 дней');
        expect(ruIn(11)).toBe('через 11 дней');
        expect(ruIn(12)).toBe('через 12 дней');
        expect(ruIn(14)).toBe('через 14 дней');
        expect(ruIn(21)).toBe('через 21 день');
        expect(ruIn(22)).toBe('через 22 дня');
        expect(ruIn(25)).toBe('через 25 дней');
        expect(ruIn(101)).toBe('через 101 день');
        expect(ruIn(111)).toBe('через 111 дней');
        expect(ruLate(1)).toBe('просрочено на 1 день');
        expect(ruLate(3)).toBe('просрочено на 3 дня');
        expect(ruLate(7)).toBe('просрочено на 7 дней');
        expect(ruLate(32)).toBe('просрочено на 32 дня');
    });

    it('picks the English form: one and the rest', () => {
        expect(plural('en', 'timeline.inDays', 1)).toBe('in 1 day');
        expect(plural('en', 'timeline.inDays', 2)).toBe('in 2 days');
        expect(plural('en', 'timeline.lateDays', 1)).toBe('1 day late');
        expect(plural('en', 'timeline.lateDays', 3)).toBe('3 days late');
        expect(plural('en', 'timeline.lateDays', 21)).toBe('21 days late');
    });

    it('has every form in both dictionaries, so no number falls into a missing key', () => {
        for (const dictionary of [ru, en]) {
            for (const group of [dictionary.timeline.inDays, dictionary.timeline.lateDays]) {
                for (const form of PLURAL_FORMS) expect(group[form]).toContain('{0}');
            }
        }
        for (const n of Array.from({ length: 130 }, (_, i) => i)) {
            for (const code of ['ru', 'en'] as const) {
                expect(PLURAL_FORMS).toContain(pluralForm(code, n));
                expect(plural(code, 'timeline.inDays', n)).toContain(String(n));
                expect(plural(code, 'timeline.lateDays', n)).not.toContain('timeline.');
            }
        }
    });
});
