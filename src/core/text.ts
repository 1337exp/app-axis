/**
 * The agent's door to the text of a record. People write in the editor; the agent reads and writes light
 * Markdown. The conversion itself is TaoEditor's (`markdownToDoc`, `docToMarkdown`); what stays here is
 * Axis's own rules around it: the profile the store normalises with, "no text" is `null`, and the short
 * excerpt for lists. The editor never converts Markdown by itself; this is a separate, explicit door.
 *
 * Дверь агента к тексту записи. Люди пишут в редакторе; агент читает и пишет лёгкий Markdown. Само
 * превращение делает TaoEditor; здесь остались правила Axis вокруг него: профиль, по которому стор
 * приводит документы в порядок, «нет текста» это `null`, и короткая выдержка для списков.
 */
import { PROFILES, docToMarkdown, isEmptyDoc, markdownToDoc, toPlainText } from '@1337exp/taoeditor/core';
import type { Doc } from '@1337exp/taoeditor/core';

/** Light Markdown → a document of the article profile. Empty text gives null. / Лёгкий Markdown → документ; пустой текст даёт null. */
export function textToDoc(text: string): Doc | null {
    const doc = markdownToDoc(text, PROFILES.article);
    return isEmptyDoc(doc) ? null : doc;
}

/** A document → light Markdown, what `textToDoc` reads back. No document gives ''. / Документ → лёгкий Markdown; нет документа даёт ''. */
export function docToText(doc: Doc | null): string {
    return doc ? docToMarkdown(doc, { profile: PROFILES.article }) : '';
}

/** A document as bare text without any marks (no escapes either): for search. / Документ голым текстом, без разметки и экранирования: для поиска. */
export const plainText = (doc: Doc | null): string => (doc ? toPlainText(doc) : '');

/** The start of a text as one line, for lists and search results. / Начало текста одной строкой: для списков и поиска. */
export function preview(doc: Doc | null, max = 140): string {
    const flat = plainText(doc).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
