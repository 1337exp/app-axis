import { describe, expect, it } from 'vitest';
import type { AxisRecord } from '../src/core/model.ts';
import { fold, findIds, isEmptyQuery, markRanges, matchesWords, parseSearch, withAncestors } from '../src/core/search.ts';
import { textToDoc } from '../src/core/text.ts';

const NOW = '2026-11-16T10:00:00.000Z';
function rec(id: string, title: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

const records = [
    rec('a', 'Основа', { type: 'area' }),
    rec('t1', 'Данные лежат файлами', { parent: 'a' }),
    rec('t2', 'Всё ещё в работе', { parent: 'a', body: textToDoc('Подробности про ТЁМНУЮ тему') }),
    rec('q1', 'Нужен ли вход с телефона', { parent: 'a', type: 'question' }),
    rec('n1', 'Заметка про телефон', { parent: 'a', type: 'note' }),
    rec('b', 'Виды', { type: 'area' }),
    rec('i1', 'Доска показывает Телефон', { parent: 'b', type: 'idea' }),
];
const ids = (line: string): string[] => [...(findIds(records, line) ?? [])].sort();

describe('quick search', () => {
    it('an empty line finds everything (null), spaces too', () => {
        expect(findIds(records, '')).toBeNull();
        expect(findIds(records, '   ')).toBeNull();
        expect(isEmptyQuery(parseSearch(''))).toBe(true);
    });

    it('ignores case, and ё is е', () => {
        expect(ids('ДАННЫЕ')).toEqual(['t1']);
        expect(ids('все еще')).toEqual(['t2']);
        expect(ids('всё ЕЩЁ')).toEqual(['t2']);
        expect(fold('ЁжиК')).toBe('ежик');
    });

    it('needs every word, in any order', () => {
        expect(ids('файлами данные')).toEqual(['t1']);
        expect(ids('данные телефон')).toEqual([]);
    });

    it('looks in the plain text of the body too', () => {
        expect(ids('темную')).toEqual(['t2']);
        expect(ids('подробности')).toEqual(['t2']);
        expect(matchesWords(records[2]!, ['тему'])).toBe(true);
    });

    it('a type mark at the start narrows the search to that type', () => {
        expect(ids('телефон')).toEqual(['i1', 'n1', 'q1']);
        expect(ids('? телефон')).toEqual(['q1']);
        expect(ids('~ телефон')).toEqual(['n1']);
        expect(ids('идея: телефон')).toEqual(['i1']);
        expect(parseSearch('? телефон')).toEqual({ words: ['телефон'], type: 'question' });
    });

    it('a lone mark, or a mark glued to a word, is still plain text', () => {
        expect(parseSearch('?')).toEqual({ words: ['?'], type: null });
        expect(parseSearch('?телефон')).toEqual({ words: ['?телефон'], type: null });
        expect(ids('?')).toEqual([]);
    });
});

describe('what the tree keeps', () => {
    it('the found records with every ancestor', () => {
        const found = findIds(records, '? телефон')!;
        expect([...withAncestors(records, found)].sort()).toEqual(['a', 'q1']);
        expect([...withAncestors(records, findIds(records, 'телефон')!)].sort()).toEqual(['a', 'b', 'i1', 'n1', 'q1']);
        expect(withAncestors(records, new Set()).size).toBe(0);
    });

    it('survives a cycle in the parents', () => {
        const loop = [rec('x', 'один', { parent: 'y' }), rec('y', 'два', { parent: 'x' })];
        expect([...withAncestors(loop, new Set(['x']))].sort()).toEqual(['x', 'y']);
    });
});

describe('the highlight of a title', () => {
    it('gives the pieces the words fall on, merged and in order', () => {
        expect(markRanges('Нужен ли вход с телефона', ['вход', 'телефон'])).toEqual([[9, 13], [16, 23]]);
        expect(markRanges('ёлка и Елка', ['елка'])).toEqual([[0, 4], [7, 11]]);
        expect(markRanges('abcabc', ['abc', 'bca'])).toEqual([[0, 6]]);
        expect(markRanges('abc', [])).toEqual([]);
        expect(markRanges('abc', ['zzz'])).toEqual([]);
    });
});
