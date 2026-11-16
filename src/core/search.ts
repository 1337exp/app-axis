/**
 * Quick search: which records a typed line finds. Pure: records and a line in, ids out. Case does not matter, `ё` is `е`,
 * several words must all be found (AND), in the title or in the plain text of the body. A type mark at the start of the line
 * (`? телефон`, `идея: тема`: the marks of quick input) narrows the search to that type.
 *
 * Быстрый поиск: какие записи находит набранная строка. Чистая функция: на входе записи и строка, на выходе id.
 * Регистр не важен, `ё` это `е`, несколько слов должны найтись все (И), в заголовке или в простом тексте записи.
 * Знак типа в начале строки (`? телефон`, `идея: тема`: знаки быстрого ввода) сужает поиск до этого типа.
 */
import type { AxisRecord, RecordType } from './model.ts';
import { parseQuick } from './quick.ts';
import { plainText } from './text.ts';

export interface SearchQuery {
    /** Folded words, all of which must be found. / Слова в сложенном виде, найтись должны все. */
    words: string[];
    /** The type the line asked for with a mark, or null. / Тип, который строка запросила знаком, или null. */
    type: RecordType | null;
}

/** Lower case and `ё` → `е`; the length of the text does not change (a highlight is cut from the original by these positions). / Нижний регистр и `ё` → `е`; длина текста не меняется (подсветка режется из оригинала по этим позициям). */
export const fold = (text: string): string => text.toLowerCase().replaceAll('ё', 'е');

const wordsOf = (text: string): string[] => fold(text).split(/\s+/).filter(Boolean);

/** What a line asks for. A line that is only a mark has no type yet (it is still being typed). / Что просит строка. Строка из одного знака ещё без типа (её ещё набирают). */
export function parseSearch(line: string): SearchQuery {
    const quick = parseQuick(line, 'task');
    if (quick?.explicit) return { words: wordsOf(quick.title), type: quick.type };
    return { words: wordsOf(line), type: null };
}

export const isEmptyQuery = (query: SearchQuery): boolean => query.words.length === 0 && query.type === null;

/** Every word is in the title or in the text of the body. / Каждое слово есть в заголовке или в тексте записи. */
export function matchesWords(record: AxisRecord, words: readonly string[]): boolean {
    if (words.length === 0) return true;
    const hay = fold(`${record.title}\n${plainText(record.body)}`);
    return words.every((word) => hay.includes(word));
}

export const matchesQuery = (record: AxisRecord, query: SearchQuery): boolean => (query.type === null || record.type === query.type) && matchesWords(record, query.words);

/** Ids of the records the line finds; null when the line is empty (everything is "found"). / Id записей, что находит строка; null, если строка пуста (находится всё). */
export function findIds(records: readonly AxisRecord[], line: string): Set<string> | null {
    const query = parseSearch(line);
    if (isEmptyQuery(query)) return null;
    return new Set(records.filter((record) => matchesQuery(record, query)).map((r) => r.id));
}

/** The found records and every ancestor of them: what the tree keeps on screen. / Найденные записи и все их предки: то, что дерево оставляет на экране. */
export function withAncestors(records: readonly AxisRecord[], found: ReadonlySet<string>): Set<string> {
    const byId = new Map(records.map((r) => [r.id, r]));
    const keep = new Set<string>();
    for (const id of found) {
        for (let at = byId.get(id); at && !keep.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) keep.add(at.id);
    }
    return keep;
}

/** The pieces of a title the words fall on, as [from, to) pairs, merged and in order. / Куски заголовка, на которые пришлись слова, парами [от, до), слитые и по порядку. */
export function markRanges(title: string, words: readonly string[]): [number, number][] {
    const hay = fold(title);
    if (hay.length !== title.length) return [];
    const spans: [number, number][] = [];
    for (const word of words) {
        if (!word) continue;
        for (let at = hay.indexOf(word); at !== -1; at = hay.indexOf(word, at + word.length)) spans.push([at, at + word.length]);
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else merged.push([span[0], span[1]]);
    }
    return merged;
}
