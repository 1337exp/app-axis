/**
 * The journal: who changed what, when and why. It is the memory of the project: a line per change,
 * appended, never rewritten.
 *
 * Журнал: кто, что, когда и почему изменил. Это память проекта: строка на изменение, только дописывается.
 */
import { ratingOf } from './brainstorm.ts';
import { execText } from './model.ts';
import type { Author, AxisRecord } from './model.ts';
import { docToText } from './text.ts';

export type JournalKind = 'create' | 'update' | 'delete' | 'note';

/** The fields whose change is worth a line. / Поля, изменение которых стоит строки. */
export type TrackedField = 'title' | 'type' | 'status' | 'parent' | 'due' | 'body' | 'links' | 'images' | 'role' | 'rating' | 'remark' | 'handed' | 'exec';

export interface JournalEntry {
    /** When, ISO. / Когда. */
    t: string;
    by: Author;
    kind: JournalKind;
    /** The record, or null for a note about the whole project. / Запись или null для заметки обо всём проекте. */
    record: string | null;
    /** The title at that moment: the line still reads after the record is gone. / Заголовок на тот момент. */
    title: string;
    /** field → [before, after], short values only. / поле → [было, стало], только короткие значения. */
    changes?: Partial<Record<TrackedField, [string, string]>>;
    /** The reason, or the text of a note. / Причина или текст заметки. */
    text?: string;
}

const linksText = (record: AxisRecord): string => record.links.map((l) => `${l.kind}:${l.to}`).sort().join(' ');

/**
 * What differs between two states of a record. Long values (the body) are only marked as changed;
 * a move among siblings (`order`) is not news.
 *
 * Чем отличаются два состояния записи. Длинные значения (текст) только отмечаются как изменённые;
 * перестановка среди соседей (`order`) новостью не считается.
 */
export function diffRecord(before: AxisRecord, after: AxisRecord): JournalEntry['changes'] {
    const changes: NonNullable<JournalEntry['changes']> = {};
    const short = (field: 'title' | 'type' | 'status' | 'parent' | 'due'): void => {
        if (before[field] !== after[field]) changes[field] = [before[field] ?? '', after[field] ?? ''];
    };
    short('title');
    short('type');
    short('status');
    short('parent');
    short('due');
    if (docToText(before.body) !== docToText(after.body) || JSON.stringify(before.body) !== JSON.stringify(after.body)) changes.body = ['', ''];
    if (linksText(before) !== linksText(after)) changes.links = [linksText(before), linksText(after)];
    if (before.images.join(' ') !== after.images.join(' ')) changes.images = [String(before.images.length), String(after.images.length)];
    brainChanges(before, after, changes);
    // the recommended executor as `sonnet/high` / рекомендованный исполнитель как `sonnet/high`
    if (execText(before.exec) !== execText(after.exec)) changes.exec = [execText(before.exec), execText(after.exec)];
    return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * The brainstorm fields as short values: `role` (seed, variant, verdict or empty), `rating` (good, bad, disputed, neutral;
 * empty when the record is not a variant), `remark` (cut short), `handed` (`yes` or empty: the turn is with Claude).
 * Поля брейншторма короткими значениями: `role` (seed, variant, verdict или пусто), `rating` (good, bad, disputed, neutral;
 * пусто, если запись не вариант), `remark` (обрезана), `handed` (`yes` или пусто: ход у Claude).
 */
function brainChanges(before: AxisRecord, after: AxisRecord, changes: NonNullable<JournalEntry['changes']>): void {
    const rating = (r: AxisRecord): string => (r.brain?.role === 'variant' ? ratingOf(r) : '');
    const cut = (text: string): string => (text.length > 60 ? `${text.slice(0, 59)}…` : text);
    const handed = (r: AxisRecord): string => (r.brain?.handed ? 'yes' : '');
    const pairs: [Exclude<TrackedField, 'title' | 'type' | 'status' | 'parent' | 'due' | 'body' | 'links' | 'images' | 'exec'>, string, string][] = [
        ['role', before.brain?.role ?? '', after.brain?.role ?? ''],
        ['rating', rating(before), rating(after)],
        ['remark', before.brain?.remark ?? '', after.brain?.remark ?? ''],
        ['handed', handed(before), handed(after)],
    ];
    // compared whole, shown cut: a change past the cut is still a change
    for (const [field, was, now] of pairs) if (was !== now) changes[field] = field === 'remark' ? [cut(was), cut(now)] : [was, now];
}

/** A line of the journal file → an entry, or null for a broken line. / Строка файла журнала → запись или null. */
export function parseEntry(line: string): JournalEntry | null {
    try {
        const e = JSON.parse(line) as Partial<JournalEntry>;
        if (typeof e !== 'object' || e === null || typeof e.t !== 'string' || typeof e.kind !== 'string') return null;
        return {
            t: e.t,
            by: e.by === 'claude' ? 'claude' : 'user',
            kind: e.kind,
            record: typeof e.record === 'string' ? e.record : null,
            title: typeof e.title === 'string' ? e.title : '',
            ...(e.changes && typeof e.changes === 'object' ? { changes: e.changes } : {}),
            ...(typeof e.text === 'string' && e.text !== '' ? { text: e.text } : {}),
        };
    } catch {
        return null;
    }
}
