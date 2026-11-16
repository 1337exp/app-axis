/**
 * The journal: who changed what, when and why. It is the memory of the project: a line per change,
 * appended, never rewritten.
 *
 * Журнал: кто, что, когда и почему изменил. Это память проекта: строка на изменение, только дописывается.
 */
import type { Author, AxisRecord } from './model.ts';
import { docToText } from './text.ts';

export type JournalKind = 'create' | 'update' | 'delete' | 'note';

/** The fields whose change is worth a line. / Поля, изменение которых стоит строки. */
export type TrackedField = 'title' | 'type' | 'status' | 'parent' | 'due' | 'body' | 'links' | 'images';

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
    return Object.keys(changes).length > 0 ? changes : undefined;
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
