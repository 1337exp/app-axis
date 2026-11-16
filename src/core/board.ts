/**
 * The board by status: the same records as in the tree, grouped into four columns. Pure grouping, no DOM, no Vue;
 * the page only draws what this returns.
 *
 * Доска по статусам: те же записи, что в дереве, разложенные по четырём колонкам. Чистая группировка,
 * без DOM и Vue; страница только рисует то, что отсюда вернулось.
 */
import { DEFAULT_FILTER_TYPES, FILTER_TYPES, filterRecords } from './filter.ts';
import type { RecordFilter } from './filter.ts';
import { STATUSES } from './model.ts';
import type { AxisRecord, RecordType, Status } from './model.ts';

/**
 * The columns, left to right. Status words differ by type (a decision is "Accepted", a task is "Done"),
 * so a column is named by the neutral status, not by those words.
 *
 * Колонки слева направо. Слова статуса у типов свои («Принято» у решения, «Готова» у задачи),
 * поэтому колонка называется нейтральным статусом, а не этими словами.
 */
export const BOARD_STATUSES: readonly Status[] = STATUSES;

/** Types a card can be: the ones that have a status. / Какими бывают карточки: типы со статусом. */
export const BOARD_TYPES: readonly RecordType[] = FILTER_TYPES;

/** Types shown until the person chooses otherwise: what is to be done and what is to be answered. / Типы по умолчанию: что делать и на что ответить. */
export const DEFAULT_BOARD_TYPES: readonly RecordType[] = DEFAULT_FILTER_TYPES;

/** The filter of the board is the filter of the working views, see `filter.ts`. / Фильтр доски это общий фильтр рабочих видов, см. `filter.ts`. */
export type BoardFilter = RecordFilter;

export interface BoardColumn {
    status: Status;
    records: AxisRecord[];
}

/**
 * The four columns (open, active, done, dropped) with their records in the order of the tree.
 * Records with no status (areas, notes) are left out. With a `root` only what is under that record is taken
 * (not the record itself); a root that is not in the list gives empty columns, nothing is guessed.
 *
 * Четыре колонки (open, active, done, dropped) с записями в порядке дерева. Записи без статуса
 * (разделы, заметки) не попадают. С `root` берётся только то, что под этой записью (не она сама);
 * неизвестный `root` даёт пустые колонки, ничего не угадывается.
 */
export function groupByStatus(records: readonly AxisRecord[], filter: BoardFilter): BoardColumn[] {
    const columns: BoardColumn[] = BOARD_STATUSES.map((status) => ({ status, records: [] }));
    const at = new Map(columns.map((column) => [column.status, column]));
    for (const record of filterRecords(records, filter)) at.get(record.status)?.records.push(record);
    return columns;
}
