/**
 * What a working view remembers is kept per project and per view in `localStorage`: a choice made on one project does not
 * leak into another, and the board and the timeline keep their own filters. The storage may be missing, full or blocked,
 * so every call is wrapped and falls back to the default.
 *
 * Что помнит рабочий вид, хранится по проектам и по видам в `localStorage`: выбор в одном проекте не попадает в другой,
 * а у доски и ленты свои фильтры. Хранилища может не быть, оно может быть полным или закрытым, поэтому каждый вызов
 * обёрнут и откатывается к умолчанию.
 */
import { DEFAULT_FILTER_TYPES, FILTER_TYPES } from '@/core/filter';
import type { RecordFilter } from '@/core/filter';
import { isId } from '@/core/model';
import type { RecordType } from '@/core/model';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The views that have a filter. / Виды, у которых есть фильтр. */
export type ViewScope = 'board' | 'timeline';

export interface SavedFilter {
    types: RecordType[];
    root: string | null;
}

// the board's key has always been `axis.board.<project>`: a filter saved before the timeline came still works
const key = (scope: ViewScope, projectId: string): string => `axis.${scope}.${projectId}`;

/** The filter by default. / Фильтр по умолчанию. */
export const defaultFilter = (): SavedFilter => ({ types: [...DEFAULT_FILTER_TYPES], root: null });

/** What was saved for the view in the project, made valid; the default when there is nothing or it is broken. / Сохранённое для вида в проекте, приведённое к верному; умолчание, если ничего нет или оно испорчено. */
export function readFilter(scope: ViewScope, projectId: string, store?: Store): SavedFilter {
    try {
        const raw = (store ?? localStorage).getItem(key(scope, projectId));
        if (!raw) return defaultFilter();
        const data = JSON.parse(raw) as { types?: unknown; root?: unknown } | null;
        if (typeof data !== 'object' || data === null || !Array.isArray(data.types)) return defaultFilter();
        const types = FILTER_TYPES.filter((type) => (data.types as unknown[]).includes(type));
        return { types: [...types], root: isId(data.root) ? data.root : null };
    } catch {
        return defaultFilter();
    }
}

export function writeFilter(scope: ViewScope, projectId: string, filter: RecordFilter, store?: Store): void {
    try {
        (store ?? localStorage).setItem(key(scope, projectId), JSON.stringify({ types: filter.types, root: filter.root ?? null }));
    } catch {
        // private mode or a full disk: the filter just lives until the page is reloaded
    }
}

// ───────────────────────────── flags / флажки ─────────────────────────────
// A switch of a view that is not a filter: "show done", "the backlog is open". One key per flag and per project.
// Переключатель вида, который не фильтр: «показать готовое», «запас раскрыт». Один ключ на флажок и проект.

const flagKey = (name: string, projectId: string): string => `axis.${name}.${projectId}`;

export function readFlag(name: string, projectId: string, fallback: boolean, store?: Store): boolean {
    try {
        const raw = (store ?? localStorage).getItem(flagKey(name, projectId));
        return raw === '1' ? true : raw === '0' ? false : fallback;
    } catch {
        return fallback;
    }
}

export function writeFlag(name: string, projectId: string, value: boolean, store?: Store): void {
    try {
        (store ?? localStorage).setItem(flagKey(name, projectId), value ? '1' : '0');
    } catch {
        // see writeFilter
    }
}
