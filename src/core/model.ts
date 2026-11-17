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

/**
 * The part a record plays in a brainstorm round: `seed` (the person's starting thought), `variant` (what Claude
 * offers under a seed), `verdict` (Claude's summary under a seed after the person rated the variants).
 *
 * Роль записи в раунде брейншторма: `seed` (задумка человека), `variant` (вариант Claude под задумкой),
 * `verdict` (вердикт Claude под задумкой после оценок человека).
 */
export const BRAIN_ROLES = ['seed', 'variant', 'verdict'] as const;
export type BrainRole = (typeof BRAIN_ROLES)[number];

/** The longest remark of the person on a variant. / Самая длинная заметка человека к варианту. */
export const BRAIN_REMARK_MAX = 1000;

/**
 * The brainstorm field of a record. `like`, `dislike` and `remark` mean something only on a `variant`, `handed`
 * only on a `seed` (the turn is passed to Claude); on other roles they are always off/empty.
 *
 * Поле брейншторма у записи. `like`, `dislike` и `remark` имеют смысл только у `variant`, `handed` только у `seed`
 * (ход передан Claude); у других ролей они всегда выключены/пусты.
 */
export interface Brain {
    role: BrainRole;
    like: boolean;
    dislike: boolean;
    remark: string;
    handed: boolean;
}

export const isBrainRole = (value: unknown): value is BrainRole => BRAIN_ROLES.includes(value as BrainRole);

/** A remark: trimmed, cut to the limit. / Заметка: без краёв, не длиннее предела. */
export const cleanRemark = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, BRAIN_REMARK_MAX).trim() : '');

/**
 * A brain field made valid: what does not fit the role is dropped; no or an unknown role gives null.
 * Поле брейншторма приводится к верному: что не подходит роли, отбрасывается; нет роли или она чужая это null.
 */
export function normalizeBrain(raw: unknown): Brain | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const b = raw as Record<string, unknown>;
    if (!isBrainRole(b.role)) return null;
    const variant = b.role === 'variant';
    return {
        role: b.role,
        like: variant && b.like === true,
        dislike: variant && b.dislike === true,
        remark: variant ? cleanRemark(b.remark) : '',
        handed: b.role === 'seed' && b.handed === true,
    };
}

/**
 * Who should do a task and how hard to think: a recommendation, not a command. Claude sets it when it breaks work down,
 * the person may change it. `haiku` is for trivial and mechanical work, `sonnet` for most implementation, `opus` for hard
 * design or risky work.
 *
 * Кто должен делать задачу и как усердно думать: рекомендация, не приказ. Claude ставит её при разборе работы,
 * человек может поправить. `haiku` для простого и механического, `sonnet` для большей части реализации, `opus` для
 * трудного проектирования и рискованной работы.
 */
export const EXEC_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type ExecModel = (typeof EXEC_MODELS)[number];
export const EXEC_EFFORTS = ['low', 'medium', 'high'] as const;
export type ExecEffort = (typeof EXEC_EFFORTS)[number];

export interface Exec {
    model: ExecModel | null;
    effort: ExecEffort | null;
}

export const isExecModel = (value: unknown): value is ExecModel => EXEC_MODELS.includes(value as ExecModel);
export const isExecEffort = (value: unknown): value is ExecEffort => EXEC_EFFORTS.includes(value as ExecEffort);

/**
 * An exec field made valid: a part that is not one of the known words is dropped; with both parts empty it is null.
 * Поле exec приводится к верному: часть с чужим словом отбрасывается; когда обе части пусты, это null.
 */
export function normalizeExec(raw: unknown): Exec | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const e = raw as Record<string, unknown>;
    const model = isExecModel(e.model) ? e.model : null;
    const effort = isExecEffort(e.effort) ? e.effort : null;
    return model === null && effort === null ? null : { model, effort };
}

/** An exec as a short value: `sonnet/high`, `sonnet` (no effort), `/high` (no model), '' (none). / Exec короткой строкой. */
export const execText = (exec: Exec | null | undefined): string => (exec ? `${exec.model ?? ''}${exec.effort ? `/${exec.effort}` : ''}` : '');

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
    /**
     * The brainstorm part, or null/absent for an ordinary record. `normalizeRecord` always sets it (null when none),
     * so a record read from the store has it; it is optional only for code that builds a record by hand.
     * Роль в брейншторме; null или нет поля у обычной записи. `normalizeRecord` задаёт его всегда (null, если нет),
     * поэтому у записи из хранилища оно есть; необязательно оно только для кода, собирающего запись руками.
     */
    brain?: Brain | null;
    /**
     * The recommended executor of a task, or null/absent. Only a `task` has one: `normalizeRecord` drops it from other
     * types and always sets it (null when none); it is optional only for code that builds a record by hand.
     * Рекомендованный исполнитель задачи или null/нет поля. Он только у `task`: `normalizeRecord` убирает его у других
     * типов и задаёт всегда (null, если нет); необязательно оно только для кода, собирающего запись руками.
     */
    exec?: Exec | null;
    created: string;
    updated: string;
    createdBy: Author;
    updatedBy: Author;
}

/**
 * A draft of the text of a record: what is being typed and not yet saved to the record. One per record,
 * `drafts/<recordId>.json`. It is not in the journal and not in the record until the person presses Save.
 * `base` is the `updated` stamp of the record at the moment editing started: the version the draft was written against.
 *
 * Черновик текста записи: то, что печатается и ещё не сохранено в запись. Один на запись, `drafts/<id записи>.json`.
 * В журнале и в записи его нет, пока человек не нажмёт «Сохранить». `base` — штамп `updated` записи в момент начала
 * правки: версия, против которой писался черновик.
 */
export interface AxisDraft {
    body: Doc | null;
    base: string;
    /** When the draft was last written, ISO. / Когда черновик записан в последний раз. */
    at: string;
    by: Author;
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

/** Finished for good: done or dropped. Such a record is no longer late and leaves the working views by default. / Закончена: готова или отброшена. */
export const isClosed = (status: Status): boolean => status === 'done' || status === 'dropped';

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
        brain: normalizeBrain(r.brain),
        exec: type === 'task' ? normalizeExec(r.exec) : null,
        created: day(r.created),
        updated: day(r.updated),
        createdBy: isAuthor(r.createdBy) ? r.createdBy : 'user',
        updatedBy: isAuthor(r.updatedBy) ? r.updatedBy : 'user',
    };
}
