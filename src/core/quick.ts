/**
 * Quick input: one line becomes a record. A mark or a word at the start says what it is:
 * `? when do we ship` is a question, `идея: тёмная тема` is an idea. No mark: the type chosen beside the field.
 *
 * Быстрый ввод: одна строка становится записью. Знак или слово в начале говорит, что это:
 * `? когда выпускаем` это вопрос, `идея: тёмная тема` это идея. Без знака: тип, выбранный рядом с полем.
 */
import { cleanTitle } from './model.ts';
import type { RecordType } from './model.ts';

const MARKS: Record<string, RecordType> = { '?': 'question', '!': 'decision', '*': 'idea', '#': 'area', '-': 'task', '~': 'note' };

const WORDS: Record<string, RecordType> = {
    раздел: 'area', area: 'area',
    задача: 'task', task: 'task', todo: 'task',
    идея: 'idea', idea: 'idea',
    решение: 'decision', decision: 'decision',
    вопрос: 'question', question: 'question',
    заметка: 'note', note: 'note',
};

export interface QuickInput {
    type: RecordType;
    title: string;
    /** The type came from the line itself, not from the default. / Тип взят из самой строки. */
    explicit: boolean;
}

/** Null when there is nothing to add. / Null, если добавлять нечего. */
export function parseQuick(line: string, fallback: RecordType): QuickInput | null {
    const text = line.trim();
    const mark = MARKS[text[0] ?? ''];
    // a lone mark is a line still being typed, not a record called "?"
    if (mark && (text.length === 1 || /\s/.test(text[1] ?? ''))) {
        const title = cleanTitle(text.slice(1));
        return title ? { type: mark, title, explicit: true } : null;
    }
    const word = /^([\p{L}]+)\s*:\s*(.*)$/u.exec(text);
    const type = word ? WORDS[word[1]!.toLowerCase()] : undefined;
    if (word && type) {
        const title = cleanTitle(word[2]);
        return title ? { type, title, explicit: true } : null;
    }
    const title = cleanTitle(text);
    return title ? { type: fallback, title, explicit: false } : null;
}
