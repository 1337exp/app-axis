/**
 * The quick search as the state of the page: one line shared by all views. It is not in the address and not kept between
 * visits. What it finds is `core/search.ts`; this only holds the line and the results for the views to read.
 *
 * Быстрый поиск как состояние страницы: одна строка на все виды. В адресе её нет, между посещениями она не хранится.
 * Что она находит, решает `core/search.ts`; здесь лишь строка и результаты, которые читают виды.
 */
import { computed, reactive } from 'vue';
import { findIds, parseSearch, withAncestors } from '@/core/search';
import { state } from './state';

export const search = reactive({
    line: '',
    /** Grows on Enter in the field: the map takes it as "bring the found cards into view". / Растёт по Enter в поле: карта понимает это как «покажи найденные карточки». */
    enter: 0,
});

/** The ids the line finds, or null when there is no line (everything counts as found). / Id найденного или null, если строки нет (найденным считается всё). */
export const found = computed(() => findIds(state.records, search.line));
/** A line is typed. / Строка набрана. */
export const searching = computed(() => found.value !== null);
export const query = computed(() => parseSearch(search.line));
/** What the tree keeps: the found with their ancestors; null when there is no line. / Что оставляет дерево: найденное с предками; null, если строки нет. */
export const kept = computed(() => (found.value ? withAncestors(state.records, found.value) : null));

/** Whether a record is in the result (always true when there is no line). / Входит ли запись в результат (всегда да, если строки нет). */
export const isFound = (id: string): boolean => found.value === null || found.value.has(id);

export function clearSearch(): void {
    search.line = '';
}
