/**
 * What the working views (the board, the timeline) pick from the project: records that have a status, of the chosen types,
 * optionally only under one area. One place for it, so the views cannot disagree about what "the same filter" means.
 *
 * Что берут из проекта рабочие виды (доска, лента): записи со статусом выбранных типов, при желании только под одним
 * разделом. Одно место на всех, чтобы виды не расходились в том, что такое «тот же фильтр».
 */
import { hasStatus } from './model.ts';
import type { AxisRecord, RecordType } from './model.ts';
import { buildTree, descendants, flatten } from './tree.ts';

/** Types a card or a row can be: the ones that have a status. / Какими бывают карточки и строки: типы со статусом. */
export const FILTER_TYPES: readonly RecordType[] = ['task', 'idea', 'decision', 'question'];

/** Types shown until the person chooses otherwise: what is to be done and what is to be answered. / Типы по умолчанию: что делать и на что ответить. */
export const DEFAULT_FILTER_TYPES: readonly RecordType[] = ['task', 'question'];

export interface RecordFilter {
    /** Types to show; a type with no status never gets through. / Какие типы показать; тип без статуса не проходит. */
    types: readonly RecordType[];
    /** An area: only its descendants are shown. Null or missing: the whole project. / Раздел: показать только то, что под ним. Null или нет: весь проект. */
    root?: string | null | undefined;
}

/**
 * The records that pass the filter, in the order of the tree. With a `root` only what is under that record is taken
 * (not the record itself); a root that is not in the list gives nothing, nothing is guessed.
 *
 * Записи, прошедшие фильтр, в порядке дерева. С `root` берётся только то, что под этой записью (не она сама);
 * неизвестный `root` ничего не даёт, ничего не угадывается.
 */
export function filterRecords(records: readonly AxisRecord[], filter: RecordFilter): AxisRecord[] {
    let inside: Set<string> | null = null;
    if (filter.root !== undefined && filter.root !== null) {
        inside = records.some((r) => r.id === filter.root) ? new Set(descendants(records, filter.root)) : new Set<string>();
    }

    const out: AxisRecord[] = [];
    for (const { record } of flatten(buildTree(records))) {
        if (!hasStatus(record.type) || !filter.types.includes(record.type)) continue;
        if (inside && !inside.has(record.id)) continue;
        out.push(record);
    }
    return out;
}
