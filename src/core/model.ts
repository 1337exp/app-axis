/**
 * The model of Axis: a project is a tree of typed records. Plain data, no DOM, no Node:
 * the server, the page and the MCP server all read the same shapes.
 *
 * Модель Axis: проект это дерево записей с типом. Только данные, без DOM и без Node:
 * сервер, страница и MCP-сервер читают одни и те же формы.
 */
import type { Doc } from '@1337exp/taoeditor/core';
import type { Progress } from './tree.ts';

/** Version of the stored record. / Версия хранимой записи. */
export const RECORD_VERSION = 1;

/**
 * What a record is. `area` is a branch (a part of the project, a milestone), the rest are leaves of thought:
 * a task to do, an idea to weigh, a decision with its reason, an open question, a note.
 *
 * Чем является запись. `area` это ветка (часть проекта, этап), остальное это единицы мысли:
 * задача, идея, решение с причиной, открытый вопрос, заметка.
 */
export const RECORD_TYPES = ['area', 'task', 'idea', 'decision', 'question', 'note'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const STATUSES = ['open', 'active', 'done', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * A link says how one record relates to another: `depends` (this one waits for that one),
 * `because` (that one is the reason of this one), `relates` (just near).
 *
 * Связь говорит, как запись относится к другой: `depends` (ждёт её), `because` (та причина этой), `relates` (рядом).
 */
export const LINK_KINDS = ['relates', 'depends', 'because'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Who did it: the person or Claude. / Кто сделал: человек или Claude. */
export const AUTHORS = ['user', 'claude'] as const;
export type Author = (typeof AUTHORS)[number];

export interface RecordLink {
    to: string;
    kind: LinkKind;
}

export interface AxisRecord {
    v: typeof RECORD_VERSION;
    id: string;
    type: RecordType;
    title: string;
    /** The text: a TaoEditor document, or null when there is none. / Текст: документ TaoEditor или null. */
    body: Doc | null;
    status: Status;
    /** Id of the parent record, null at the top. / Родитель, null на верхнем уровне. */
    parent: string | null;
    /** Place among the siblings, ascending. / Место среди соседей, по возрастанию. */
    order: number;
    links: RecordLink[];
    /** A calendar day `YYYY-MM-DD`. / Календарный день. */
    due: string | null;
    /** File names in the project's `assets/`. / Имена файлов в `assets/` проекта. */
    images: string[];
    created: string;
    updated: string;
    createdBy: Author;
    updatedBy: Author;
}

export interface AxisProject {
    v: 1;
    /** Also the folder name. / Оно же имя папки. */
    id: string;
    title: string;
    description: string;
    /** Path of the repository the project is about, if any. / Путь к репозиторию проекта, если есть. */
    repo: string;
    created: string;
}

/** A project in a list: with its progress and the time of the latest change. / Проект в списке: с прогрессом и временем последней правки. */
export interface ProjectSummary extends AxisProject {
    progress: Progress;
    records: number;
    updated: string;
}

/** Types whose status is shown and edited. An area has none: it shows the progress of what is inside. */
export const hasStatus = (type: RecordType): boolean => type !== 'area' && type !== 'note';

export const isRecordType = (value: unknown): value is RecordType => RECORD_TYPES.includes(value as RecordType);
export const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);
export const isLinkKind = (value: unknown): value is LinkKind => LINK_KINDS.includes(value as LinkKind);
export const isAuthor = (value: unknown): value is Author => AUTHORS.includes(value as Author);

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** A safe id: also a file or folder name, so nothing but lower latin, digits, `-` and `_`. */
export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day `YYYY-MM-DD`. / Настоящий календарный день. */
export function isDay(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const m = DAY.exec(value);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const TITLE_MAX = 300;

/** One line, trimmed, cut to the limit. / Одна строка без краёв, не длиннее предела. */
export const cleanTitle = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';

const ASSET = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|gif|webp|avif)$/;
export const isAssetName = (value: unknown): value is string => typeof value === 'string' && ASSET.test(value);

/**
 * A record read from a file (maybe edited by hand) made valid, or null when it cannot be one.
 * The body is passed through as is: the server puts it through the editor's own gate.
 *
 * Запись из файла (возможно, правленого руками) приводится к верной или отвергается (null).
 * Тело идёт как есть: сервер пропускает его через ворота редактора.
 */
export function normalizeRecord(raw: unknown, now: string): AxisRecord | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!isId(r.id)) return null;
    const type = isRecordType(r.type) ? r.type : 'note';
    const links: RecordLink[] = [];
    if (Array.isArray(r.links)) {
        for (const item of r.links) {
            const link = item as Partial<RecordLink> | null;
            if (link && isId(link.to) && link.to !== r.id && !links.some((l) => l.to === link.to && l.kind === link.kind)) {
                links.push({ to: link.to, kind: isLinkKind(link.kind) ? link.kind : 'relates' });
            }
        }
    }
    const day = (value: unknown): string => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : now);
    return {
        v: RECORD_VERSION,
        id: r.id,
        type,
        title: cleanTitle(r.title),
        body: typeof r.body === 'object' && r.body !== null ? (r.body as Doc) : null,
        status: isStatus(r.status) ? r.status : 'open',
        parent: isId(r.parent) && r.parent !== r.id ? r.parent : null,
        order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
        links,
        due: isDay(r.due) ? r.due : null,
        images: Array.isArray(r.images) ? [...new Set(r.images.filter(isAssetName))] : [],
        created: day(r.created),
        updated: day(r.updated),
        createdBy: isAuthor(r.createdBy) ? r.createdBy : 'user',
        updatedBy: isAuthor(r.updatedBy) ? r.updatedBy : 'user',
    };
}
