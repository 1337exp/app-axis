/**
 * The filter of the board is kept per project in `localStorage`: a choice made on one project does not leak
 * into another. The storage may be missing, full or blocked, so every call is wrapped and falls back to the default.
 *
 * Фильтр доски хранится по проектам в `localStorage`: выбор в одном проекте не попадает в другой.
 * Хранилища может не быть, оно может быть полным или закрытым, поэтому каждый вызов обёрнут и откатывается к умолчанию.
 */
import { BOARD_TYPES, DEFAULT_BOARD_TYPES } from '@/core/board';
import type { BoardFilter } from '@/core/board';
import { isId } from '@/core/model';
import type { RecordType } from '@/core/model';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const key = (projectId: string): string => `axis.board.${projectId}`;

/** The filter by default. / Фильтр по умолчанию. */
export const defaultFilter = (): { types: RecordType[]; root: string | null } => ({ types: [...DEFAULT_BOARD_TYPES], root: null });

/** What was saved for the project, made valid; the default when there is nothing or it is broken. / Сохранённое для проекта, приведённое к верному; умолчание, если ничего нет или оно испорчено. */
export function readFilter(projectId: string, store?: Store): { types: RecordType[]; root: string | null } {
    try {
        const raw = (store ?? localStorage).getItem(key(projectId));
        if (!raw) return defaultFilter();
        const data = JSON.parse(raw) as { types?: unknown; root?: unknown } | null;
        if (typeof data !== 'object' || data === null || !Array.isArray(data.types)) return defaultFilter();
        const types = BOARD_TYPES.filter((type) => (data.types as unknown[]).includes(type));
        return { types: [...types], root: isId(data.root) ? data.root : null };
    } catch {
        return defaultFilter();
    }
}

export function writeFilter(projectId: string, filter: BoardFilter, store?: Store): void {
    try {
        (store ?? localStorage).setItem(key(projectId), JSON.stringify({ types: filter.types, root: filter.root ?? null }));
    } catch {
        // private mode or a full disk: the filter just lives until the page is reloaded
    }
}
