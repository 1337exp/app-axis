/**
 * The store: projects as folders of plain files. Files are the truth: the page, the MCP server and a hand
 * with a text editor all change the same files, and whoever watches the folder sees the change.
 *
 *   <data>/<project>/project.json
 *   <data>/<project>/records/<id>.json     one record per file
 *   <data>/<project>/journal.jsonl         a line per change, appended
 *   <data>/<project>/assets/<name>         pictures
 *   <data>/<project>/drafts/<id>.json       an unsaved text of a record: { body, base, at, by } (not in the journal)
 *   <data>/<project>/map.json              where the cards of the map sit and the camera: { v, positions, camera } (not in the journal)
 *   <data>/<project>/trash/<id>.json       what was deleted (nothing is unlinked)
 *   <data>/<project>/trash/<id>.draft.json the draft of a deleted record
 *
 * Хранилище: проекты как папки обычных файлов. Истина в файлах: страница, MCP-сервер и рука с текстовым
 * редактором меняют одни и те же файлы, а кто следит за папкой, видит изменение. Удалённое уходит в `trash/`.
 * Черновик текста записи лежит в `drafts/`, в журнал не попадает; черновик удалённой записи уходит в `trash/`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES, isEmptyDoc, normalizeDoc } from '@1337exp/taoeditor/core';
import type { Doc } from '@1337exp/taoeditor/core';
import { diffRecord, parseEntry } from '../src/core/journal.ts';
import type { JournalEntry } from '../src/core/journal.ts';
import {
    RECORD_VERSION,
    cleanRemark,
    cleanTitle,
    isAssetName,
    isBrainRole,
    isDay,
    isExecEffort,
    isExecModel,
    isId,
    isLinkKind,
    isRecordType,
    isStatus,
    normalizeBrain,
    normalizeExec,
    normalizeRecord,
    toAuthor,
} from '../src/core/model.ts';
import type { Author, AxisDraft, Brain, Exec, AxisProject, AxisRecord, ProjectSummary, RecordLink, RecordType, Status } from '../src/core/model.ts';
import { isCamera, isPoint, normalizeMap, patchMap } from '../src/core/map.ts';
import type { MapData, MapPatch } from '../src/core/map.ts';
import { textToDoc } from '../src/core/text.ts';
import { canMove, descendants, orderFor, progressOfAll } from '../src/core/tree.ts';

/**
 * A refusal with a reason the caller can show. `status` is the HTTP code it maps to; `data` is sent along with the
 * reason (a 409 on a stale save carries the current `record`).
 * Отказ с причиной для показа. `status` это HTTP-код; `data` уходит вместе с причиной
 * (409 на устаревшее сохранение несёт текущую `record`).
 */
export class AxisError extends Error {
    readonly status: number;
    readonly data: Record<string, unknown> | undefined;
    constructor(status: number, message: string, data?: Record<string, unknown>) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

/** What may be given for a new record or a change. `text` (light Markdown) is the agent's way to write the body. */
export interface RecordInput {
    type?: unknown;
    title?: unknown;
    body?: unknown;
    text?: unknown;
    status?: unknown;
    parent?: unknown;
    /** Put after this sibling; null puts first; absent puts last (for a new record or a new parent). */
    after?: unknown;
    due?: unknown;
    links?: unknown;
    images?: unknown;
    /**
     * The part in a brainstorm round: seed | variant | verdict; an empty string or null clears it. The way the agent sets
     * a role (it cannot set the rest of `brain`).
     * Роль в раунде брейншторма: seed | variant | verdict; пустая строка или null снимает. Так роль задаёт агент
     * (остальное в `brain` он задавать не может).
     */
    role?: unknown;
    /**
     * `{ role?, like?, dislike?, remark?, handed? }`: partial, only the keys passed change; `null` clears the whole field.
     * `like`, `dislike` and `remark` stick only to a variant, `handed` only to a seed, the rest is ignored. Only the person
     * sets all of it: from the agent only `role` is taken.
     * Частичный объект: меняются только переданные ключи; `null` снимает поле целиком. `like`, `dislike` и `remark`
     * держатся только у варианта, `handed` только у задумки, остальное игнорируется. Всё это ставит только человек:
     * от агента берётся лишь `role`.
     */
    brain?: unknown;
    /**
     * The recommended executor of a task: `{ model?, effort? }`, partial (only the keys passed change); `null` clears the
     * whole field, a key set to null or '' clears that part. Only a task keeps it. Both the person and the agent may set it.
     * Рекомендованный исполнитель задачи: `{ model?, effort? }`, частично (меняются только переданные ключи); `null` снимает
     * поле целиком, ключ null или '' снимает свою часть. Держит его только задача. Ставить могут и человек, и агент.
     */
    exec?: unknown;
    /** Shortcuts for `exec.model` and `exec.effort` (the agent's way); an empty string clears. / Короткие пути к `exec.model` и `exec.effort` (путь агента); пустая строка снимает. */
    model?: unknown;
    effort?: unknown;
    /** The reason: goes to the journal. / Причина: попадает в журнал. */
    why?: unknown;
    /**
     * The `updated` stamp the caller's change was made against (the page sends the base of its draft). If the record
     * has moved on, the change is refused with 409 and the current record. Callers that do not send it are not checked.
     * Штамп `updated`, против которого сделана правка (страница шлёт base своего черновика). Если запись ушла вперёд,
     * правка отклоняется кодом 409 с текущей записью. Кто `base` не шлёт, не проверяется.
     */
    base?: unknown;
}

/** What the page sends for a draft. / Что страница шлёт для черновика. */
export interface DraftInput {
    body?: unknown;
    base?: unknown;
}

export interface ProjectInput {
    id?: unknown;
    title?: unknown;
    description?: unknown;
    repo?: unknown;
}

const IMAGE_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
};
export const ASSET_MAX_BYTES = 15 * 1024 * 1024;

const CYRILLIC: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** A folder name from a title: latin, digits and dashes. / Имя папки из названия: латиница, цифры и дефисы. */
export function slugify(title: string): string {
    const latin = [...title.toLowerCase()].map((c) => CYRILLIC[c] ?? c).join('');
    return latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

const now = (): string => new Date().toISOString();
const newId = (): string => BigInt(`0x${randomBytes(5).toString('hex')}`).toString(36).padStart(8, '0').slice(0, 8);

function readJson(file: string): unknown {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

/** Write through a temporary file, so a reader never meets a half-written one. / Запись через временный файл. */
function writeJson(file: string, value: unknown): void {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
}

export interface Store {
    readonly root: string;
    projects(): ProjectSummary[];
    project(id: string): AxisProject;
    createProject(input: ProjectInput): AxisProject;
    updateProject(id: string, input: ProjectInput): AxisProject;
    records(project: string): AxisRecord[];
    record(project: string, id: string): AxisRecord;
    createRecord(project: string, input: RecordInput, by: Author): AxisRecord;
    updateRecord(project: string, id: string, input: RecordInput, by: Author): AxisRecord;
    /** Removes the record and everything under it; returns the removed ids. / Удаляет запись со всем вложенным. */
    deleteRecord(project: string, id: string, by: Author, why?: unknown): string[];
    /** The unsaved text of a record, or null when there is none. / Несохранённый текст записи или null. */
    draft(project: string, id: string): AxisDraft | null;
    /** Writes (replaces) the draft. Not in the journal. / Пишет (заменяет) черновик. В журнал не идёт. */
    saveDraft(project: string, id: string, input: DraftInput, by: Author): AxisDraft;
    /** Drops the draft; false when there was none. / Убирает черновик; false, если его не было. */
    deleteDraft(project: string, id: string): boolean;
    /** Ids of the records that have a draft. / Id записей, у которых есть черновик. */
    drafts(project: string): string[];
    /** The map of the project: where the cards sit and the camera. Places of records that are gone are dropped. / Карта проекта: где стоят карточки и камера. Места исчезнувших записей отбрасываются. */
    map(project: string): MapData;
    /** Applies a partial change to `map.json` (`null` removes a place or the camera). Not in the journal. / Применяет частичную правку к `map.json`. В журнал не идёт. */
    patchMap(project: string, input: unknown): MapData;
    journal(project: string, options?: { limit?: number; record?: string }): JournalEntry[];
    /** A free note in the journal. / Свободная заметка в журнале. */
    log(project: string, text: unknown, record: unknown, by: Author): JournalEntry;
    saveAsset(project: string, bytes: Uint8Array, mime: string): string;
    assetPath(project: string, name: string): string;
}

export function createStore(root: string): Store {
    mkdirSync(root, { recursive: true });

    const dir = (project: string): string => {
        if (!isId(project)) throw new AxisError(400, `Bad project id: ${String(project)}`);
        const path = join(root, project);
        if (!existsSync(join(path, 'project.json'))) throw new AxisError(404, `No project "${project}"`);
        return path;
    };

    const readProject = (id: string): AxisProject | null => {
        const raw = readJson(join(root, id, 'project.json')) as Partial<AxisProject> | undefined;
        if (!raw || typeof raw !== 'object') return null;
        return {
            v: 1,
            id,
            title: cleanTitle(raw.title) || id,
            description: typeof raw.description === 'string' ? raw.description : '',
            repo: typeof raw.repo === 'string' ? raw.repo : '',
            created: typeof raw.created === 'string' ? raw.created : now(),
        };
    };

    const readRecords = (project: string): AxisRecord[] => {
        const folder = join(dir(project), 'records');
        if (!existsSync(folder)) return [];
        const stamp = now();
        const out: AxisRecord[] = [];
        for (const name of readdirSync(folder)) {
            if (!name.endsWith('.json')) continue;
            const raw = readJson(join(folder, name));
            const record = normalizeRecord(raw, stamp);
            // the file name is the id: a copied file with a stale id inside does not shadow another record
            if (record && `${record.id}.json` === name) out.push(record);
        }
        return out;
    };

    const writeRecord = (project: string, record: AxisRecord): void => {
        const folder = join(dir(project), 'records');
        mkdirSync(folder, { recursive: true });
        writeJson(join(folder, `${record.id}.json`), record);
    };

    const append = (project: string, entry: JournalEntry): JournalEntry => {
        appendFileSync(join(dir(project), 'journal.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
        return entry;
    };

    const why = (value: unknown): { text?: string } => {
        const text = typeof value === 'string' ? value.trim().slice(0, 2000) : '';
        return text ? { text } : {};
    };

    /** A document through the editor's gate; an empty one is null. / Документ через ворота редактора; пустой это null. */
    const cleanBody = (doc: unknown): Doc | null => {
        if (doc === null || doc === undefined) return null;
        const clean = normalizeDoc(doc, PROFILES.article).doc;
        return isEmptyDoc(clean) ? null : clean;
    };

    /** The body from `body` (a document) or `text` (light Markdown), through the editor's gate. */
    const bodyOf = (input: RecordInput): Doc | null | undefined => {
        if (typeof input.text === 'string') return cleanBody(textToDoc(input.text));
        if (input.body !== undefined) return cleanBody(input.body);
        return undefined;
    };

    const draftFile = (project: string, id: string): string => {
        if (!isId(id)) throw new AxisError(400, `Bad record id: ${String(id)}`);
        return join(dir(project), 'drafts', `${id}.json`);
    };

    /** A draft from its file; one without a `base` is not a draft Axis wrote, so it is not one. */
    const readDraft = (project: string, id: string): AxisDraft | null => {
        const raw = readJson(draftFile(project, id)) as Partial<AxisDraft> | undefined;
        if (!raw || typeof raw !== 'object' || typeof raw.base !== 'string' || raw.base === '') return null;
        return { body: cleanBody(raw.body), base: raw.base, at: typeof raw.at === 'string' ? raw.at : now(), by: toAuthor(raw.by) };
    };

    const linksOf = (value: unknown, self: string, all: readonly AxisRecord[]): RecordLink[] => {
        if (!Array.isArray(value)) throw new AxisError(400, '"links" must be a list of { to, kind }');
        const out: RecordLink[] = [];
        for (const item of value) {
            const link = item as Partial<RecordLink> | null;
            if (!link || !isId(link.to) || !isLinkKind(link.kind)) throw new AxisError(400, 'A link is { to: id, kind: relates | depends | because }');
            if (link.to === self) throw new AxisError(400, 'A record cannot link to itself');
            if (!all.some((r) => r.id === link.to)) throw new AxisError(404, `No record "${link.to}" to link to`);
            if (!out.some((l) => l.to === link.to && l.kind === link.kind)) out.push({ to: link.to, kind: link.kind });
        }
        return out;
    };

    const imagesOf = (value: unknown, project: string): string[] => {
        if (!Array.isArray(value) || !value.every(isAssetName)) throw new AxisError(400, '"images" must be a list of asset names');
        for (const name of value) if (!existsSync(join(dir(project), 'assets', name))) throw new AxisError(404, `No asset "${name}"`);
        return [...new Set(value)];
    };

    /**
     * The brainstorm field after a change. `role` (or `brain.role`) sets or clears the part; the other keys of `brain`
     * change only what is passed, and only from the person. What does not fit the role is dropped by `normalizeBrain`.
     */
    const brainOf = (current: Brain | null, input: RecordInput, by: Author): Brain | null => {
        const { brain } = input;
        if (brain !== undefined && brain !== null && (typeof brain !== 'object' || Array.isArray(brain))) throw new AxisError(400, '"brain" is { role?, like?, dislike?, remark?, handed? } or null');
        const given = brain === undefined || brain === null ? {} : (brain as Record<string, unknown>);
        let next = current;
        if (brain === null) next = null;
        const role = input.role !== undefined ? input.role : given.role;
        if (role !== undefined) {
            if (role === null || role === '') next = null;
            else if (isBrainRole(role)) next = next?.role === role ? next : normalizeBrain({ ...(next ?? {}), role });
            else throw new AxisError(400, 'role: seed | variant | verdict (an empty string clears it)');
        }
        if (by === 'agent' || next === null) return next;
        const patch: Record<string, unknown> = { ...next };
        for (const key of ['like', 'dislike', 'handed'] as const) {
            if (given[key] === undefined) continue;
            if (typeof given[key] !== 'boolean') throw new AxisError(400, `brain.${key} is true or false`);
            patch[key] = given[key];
        }
        if (given.remark !== undefined) {
            if (typeof given.remark !== 'string') throw new AxisError(400, 'brain.remark is a text');
            patch.remark = cleanRemark(given.remark);
        }
        return normalizeBrain(patch);
    };

    /** The exec field after a change: only the parts passed change; unknown words are refused. */
    const execOf = (current: Exec | null, input: RecordInput): Exec | null => {
        const { exec } = input;
        if (exec !== undefined && exec !== null && (typeof exec !== 'object' || Array.isArray(exec))) throw new AxisError(400, '"exec" is { model?, effort? } or null');
        const given = exec === undefined || exec === null ? {} : (exec as Record<string, unknown>);
        let model = current?.model ?? null;
        let effort = current?.effort ?? null;
        if (exec === null) {
            model = null;
            effort = null;
        }
        const m = input.model !== undefined ? input.model : given.model;
        const e = input.effort !== undefined ? input.effort : given.effort;
        if (m !== undefined) {
            if (m === null || m === '') model = null;
            else if (isExecModel(m)) model = m;
            else throw new AxisError(400, 'model: haiku | sonnet | opus (an empty string clears it)');
        }
        if (e !== undefined) {
            if (e === null || e === '') effort = null;
            else if (isExecEffort(e)) effort = e;
            else throw new AxisError(400, 'effort: low | medium | high (an empty string clears it)');
        }
        return normalizeExec({ model, effort });
    };

    /**
     * A verdict (or a variant) added under a seed passes the turn back to the person: the seed's `handed` is cleared, with
     * a line in the journal. A variant does it too, or the seed would keep saying "waits for the agent" while the person rates.
     * Вердикт (или вариант) под задумкой возвращает ход человеку: у задумки снимается `handed`, в журнале строка.
     * Вариант тоже, иначе задумка писала бы «ждёт агента», пока человек оценивает.
     */
    const passTurnBack = (project: string, all: readonly AxisRecord[], child: AxisRecord, by: Author): void => {
        const role = child.brain?.role;
        if ((role !== 'verdict' && role !== 'variant') || child.parent === null) return;
        const seed = all.find((r) => r.id === child.parent);
        if (!seed || seed.brain?.role !== 'seed' || !seed.brain.handed) return;
        const after: AxisRecord = { ...seed, brain: { ...seed.brain, handed: false }, updated: now(), updatedBy: by };
        writeRecord(project, after);
        append(project, { t: after.updated, by, kind: 'update', record: seed.id, title: seed.title, changes: { handed: ['yes', ''] }, text: `${role} added, turn passed back to the person` });
    };

    return {
        root,

        projects() {
            const out: ProjectSummary[] = [];
            for (const name of readdirSync(root)) {
                if (!isId(name)) continue;
                const project = readProject(name);
                if (!project) continue;
                const records = readRecords(name);
                const updated = records.reduce((latest, r) => (r.updated > latest ? r.updated : latest), project.created);
                out.push({ ...project, progress: progressOfAll(records), records: records.length, updated });
            }
            return out.sort((a, b) => b.updated.localeCompare(a.updated));
        },

        project(id) {
            dir(id);
            return readProject(id)!;
        },

        createProject(input) {
            const title = cleanTitle(input.title);
            if (!title) throw new AxisError(400, 'A project needs a title');
            const asked = input.id !== undefined && input.id !== null && input.id !== '';
            if (asked && !isId(input.id)) throw new AxisError(400, 'A project id is lower latin letters, digits and dashes');
            const given = asked && isId(input.id) ? input.id : undefined;
            let id = given ?? (slugify(title) || `project-${newId().slice(0, 4)}`);
            if (!isId(id)) id = `project-${newId().slice(0, 4)}`;
            if (given === undefined) {
                const base = id;
                for (let n = 2; existsSync(join(root, id)); n += 1) id = `${base}-${n}`;
            } else if (existsSync(join(root, id))) throw new AxisError(409, `Project "${id}" already exists`);
            const project: AxisProject = {
                v: 1,
                id,
                title,
                description: typeof input.description === 'string' ? input.description.trim() : '',
                repo: typeof input.repo === 'string' ? input.repo.trim() : '',
                created: now(),
            };
            mkdirSync(join(root, id, 'records'), { recursive: true });
            writeJson(join(root, id, 'project.json'), project);
            return project;
        },

        updateProject(id, input) {
            const project = this.project(id);
            if (input.title !== undefined) {
                const title = cleanTitle(input.title);
                if (!title) throw new AxisError(400, 'A project needs a title');
                project.title = title;
            }
            if (typeof input.description === 'string') project.description = input.description.trim();
            if (typeof input.repo === 'string') project.repo = input.repo.trim();
            writeJson(join(dir(id), 'project.json'), project);
            return project;
        },

        records: readRecords,

        record(project, id) {
            const record = isId(id) ? normalizeRecord(readJson(join(dir(project), 'records', `${id}.json`)), now()) : null;
            if (!record || record.id !== id) throw new AxisError(404, `No record "${String(id)}" in "${project}"`);
            return record;
        },

        createRecord(project, input, by) {
            const all = readRecords(project);
            const title = cleanTitle(input.title);
            if (!title) throw new AxisError(400, 'A record needs a title');
            if (input.type !== undefined && !isRecordType(input.type)) throw new AxisError(400, 'type: area | task | idea | decision | question | note');
            const type: RecordType = isRecordType(input.type) ? input.type : 'note';
            if (input.status !== undefined && !isStatus(input.status)) throw new AxisError(400, 'status: open | active | done | dropped');
            // a decision that is written down is a decision made, unless said otherwise
            const status: Status = isStatus(input.status) ? input.status : type === 'decision' ? 'done' : 'open';
            const parent = input.parent === undefined || input.parent === null || input.parent === '' ? null : input.parent;
            if (parent !== null && (!isId(parent) || !all.some((r) => r.id === parent))) throw new AxisError(404, `No parent record "${String(parent)}"`);
            if (input.due !== undefined && input.due !== null && !isDay(input.due)) throw new AxisError(400, 'due is a day YYYY-MM-DD');
            const brain = brainOf(null, input, by);
            const exec = execOf(null, input); // checked for any type, kept by a task only
            let id = newId();
            while (all.some((r) => r.id === id)) id = newId();
            const after = input.after === null ? null : isId(input.after) ? input.after : undefined;
            const stamp = now();
            const record: AxisRecord = {
                v: RECORD_VERSION,
                id,
                type,
                title,
                body: bodyOf(input) ?? null,
                status,
                parent,
                order: orderFor(all, parent, after),
                links: input.links === undefined ? [] : linksOf(input.links, id, all),
                due: isDay(input.due) ? input.due : null,
                images: input.images === undefined ? [] : imagesOf(input.images, project),
                brain,
                exec: type === 'task' ? exec : null,
                created: stamp,
                updated: stamp,
                createdBy: by,
                updatedBy: by,
            };
            writeRecord(project, record);
            append(project, { t: stamp, by, kind: 'create', record: id, title, ...why(input.why) });
            passTurnBack(project, all, record, by);
            return record;
        },

        updateRecord(project, id, input, by) {
            const all = readRecords(project);
            const before = all.find((r) => r.id === id);
            if (!before) throw new AxisError(404, `No record "${String(id)}" in "${project}"`);
            // a change made against an older version of the record is refused, with the record as it is now
            if (input.base !== undefined) {
                if (typeof input.base !== 'string') throw new AxisError(400, '"base" is the "updated" stamp of the record the change was made against');
                if (input.base !== before.updated) throw new AxisError(409, 'The record was changed after you started: here is its current state', { record: before });
            }
            const after: AxisRecord = { ...before };
            if (input.title !== undefined) {
                const title = cleanTitle(input.title);
                if (!title) throw new AxisError(400, 'A record needs a title');
                after.title = title;
            }
            if (input.type !== undefined) {
                if (!isRecordType(input.type)) throw new AxisError(400, 'type: area | task | idea | decision | question | note');
                after.type = input.type;
            }
            if (input.status !== undefined) {
                if (!isStatus(input.status)) throw new AxisError(400, 'status: open | active | done | dropped');
                after.status = input.status;
            }
            if (input.due !== undefined) {
                if (input.due !== null && input.due !== '' && !isDay(input.due)) throw new AxisError(400, 'due is a day YYYY-MM-DD');
                after.due = isDay(input.due) ? input.due : null;
            }
            const body = bodyOf(input);
            if (body !== undefined) after.body = body;
            if (input.links !== undefined) after.links = linksOf(input.links, id, all);
            if (input.images !== undefined) after.images = imagesOf(input.images, project);
            if (input.role !== undefined || input.brain !== undefined) after.brain = brainOf(before.brain ?? null, input, by);
            if (input.exec !== undefined || input.model !== undefined || input.effort !== undefined) after.exec = execOf(before.exec ?? null, input);
            if (after.type !== 'task') after.exec = null; // only a task has an executor / исполнитель только у задачи
            const reparent = input.parent !== undefined;
            if (reparent) {
                const parent = input.parent === null || input.parent === '' ? null : input.parent;
                if (parent !== null && !isId(parent)) throw new AxisError(400, 'parent is a record id or null');
                if (!canMove(all, id, parent)) throw new AxisError(400, 'A record cannot move into itself, into what is under it, or into a missing record');
                after.parent = parent;
            }
            if (input.after !== undefined || (reparent && after.parent !== before.parent)) {
                const sibling = input.after === null ? null : isId(input.after) ? input.after : undefined;
                after.order = orderFor(all, after.parent, sibling, id);
            }
            const changes = diffRecord(before, after);
            if (!changes && after.order === before.order) return before;
            after.updated = now();
            after.updatedBy = by;
            writeRecord(project, after);
            // a reorder among the same siblings is not news; anything else gets a line
            if (changes) append(project, { t: after.updated, by, kind: 'update', record: id, title: after.title, changes, ...why(input.why) });
            // a record that became a verdict or a variant, or moved under another seed as one, passes the turn back
            if (after.brain?.role !== before.brain?.role || before.parent !== after.parent) passTurnBack(project, all, after, by);
            return after;
        },

        deleteRecord(project, id, by, reason) {
            const all = readRecords(project);
            const target = all.find((r) => r.id === id);
            if (!target) throw new AxisError(404, `No record "${String(id)}" in "${project}"`);
            const gone = [id, ...descendants(all, id)];
            const base = dir(project);
            mkdirSync(join(base, 'trash'), { recursive: true });
            for (const one of gone) {
                const from = join(base, 'records', `${one}.json`);
                if (existsSync(from)) renameSync(from, join(base, 'trash', `${one}.json`));
                // the draft of a deleted record goes to the trash beside it (it is not erased, as nothing is)
                const draft = join(base, 'drafts', `${one}.json`);
                if (existsSync(draft)) renameSync(draft, join(base, 'trash', `${one}.draft.json`));
            }
            // links that pointed at what is gone are taken away, quietly
            for (const record of all) {
                if (gone.includes(record.id) || !record.links.some((l) => gone.includes(l.to))) continue;
                writeRecord(project, { ...record, links: record.links.filter((l) => !gone.includes(l.to)) });
            }
            const extra = gone.length > 1 ? `+${gone.length - 1}` : '';
            const text = [why(reason).text, extra].filter(Boolean).join(' ');
            append(project, { t: now(), by, kind: 'delete', record: id, title: target.title, ...(text ? { text } : {}) });
            return gone;
        },

        draft: readDraft,

        saveDraft(project, id, input, by) {
            const file = draftFile(project, id); // 400 for an id that is not one
            const record = this.record(project, id); // 404 for a record that is not there
            if (input.body === undefined) throw new AxisError(400, '"body" is a document or null');
            let base: string;
            if (input.base !== undefined) {
                if (typeof input.base !== 'string' || input.base === '') throw new AxisError(400, '"base" is the "updated" stamp of the record the draft was started on');
                base = input.base;
            } else base = readDraft(project, id)?.base ?? record.updated; // the first write without a base starts on the record as it is
            const draft: AxisDraft = { body: cleanBody(input.body), base, at: now(), by };
            mkdirSync(join(dir(project), 'drafts'), { recursive: true });
            writeJson(file, draft);
            return draft;
        },

        deleteDraft(project, id) {
            const file = draftFile(project, id);
            if (!existsSync(file)) return false;
            rmSync(file, { force: true });
            return true;
        },

        drafts(project) {
            const folder = join(dir(project), 'drafts');
            if (!existsSync(folder)) return [];
            return readdirSync(folder)
                .filter((name) => name.endsWith('.json'))
                .map((name) => name.slice(0, -'.json'.length))
                .filter((id) => isId(id) && readDraft(project, id) !== null)
                .sort();
        },

        map(project) {
            const known = new Set(readRecords(project).map((r) => r.id));
            return normalizeMap(readJson(join(dir(project), 'map.json')), known);
        },

        patchMap(project, input) {
            if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AxisError(400, 'The body must be a JSON object');
            const body = input as { positions?: unknown; camera?: unknown };
            const patch: MapPatch = {};
            if (body.positions !== undefined) {
                if (typeof body.positions !== 'object' || body.positions === null || Array.isArray(body.positions)) throw new AxisError(400, '"positions" is { <recordId>: { x, y } | null }');
                patch.positions = {};
                for (const [id, point] of Object.entries(body.positions)) {
                    if (!isId(id)) throw new AxisError(400, `Bad record id: ${id}`);
                    if (point !== null && !isPoint(point)) throw new AxisError(400, `A place is { x, y } (numbers) or null: ${id}`);
                    patch.positions[id] = point;
                }
            }
            if (body.camera !== undefined) {
                if (body.camera !== null && !isCamera(body.camera)) throw new AxisError(400, '"camera" is { x, y, zoom } or null');
                patch.camera = body.camera;
            }
            const next = patchMap(this.map(project), patch);
            writeJson(join(dir(project), 'map.json'), next);
            return next;
        },

        journal(project, options = {}) {
            const file = join(dir(project), 'journal.jsonl');
            if (!existsSync(file)) return [];
            const limit = Math.min(Math.max(options.limit ?? 200, 1), 5000);
            const entries: JournalEntry[] = [];
            for (const line of readFileSync(file, 'utf8').split('\n')) {
                if (line.trim() === '') continue;
                const entry = parseEntry(line);
                if (entry && (options.record === undefined || entry.record === options.record)) entries.push(entry);
            }
            return entries.slice(-limit).reverse();
        },

        log(project, text, record, by) {
            const body = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
            if (!body) throw new AxisError(400, 'A journal note needs a text');
            let title = '';
            let id: string | null = null;
            if (record !== undefined && record !== null && record !== '') {
                const found = this.record(project, String(record));
                id = found.id;
                title = found.title;
            }
            return append(project, { t: now(), by, kind: 'note', record: id, title, text: body });
        },

        saveAsset(project, bytes, mime) {
            const ext = IMAGE_TYPES[mime.split(';')[0]!.trim().toLowerCase()];
            if (!ext) throw new AxisError(415, 'Pictures only: png, jpeg, gif, webp, avif');
            if (bytes.byteLength === 0) throw new AxisError(400, 'An empty file');
            if (bytes.byteLength > ASSET_MAX_BYTES) throw new AxisError(413, 'A picture is at most 15 MB');
            // the name is the hash of the content: the same picture pasted twice is one file
            const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${ext}`;
            const folder = join(dir(project), 'assets');
            mkdirSync(folder, { recursive: true });
            const file = join(folder, name);
            if (!existsSync(file)) {
                const tmp = `${file}.tmp-${process.pid}`;
                writeFileSync(tmp, bytes);
                renameSync(tmp, file);
            }
            return name;
        },

        assetPath(project, name) {
            if (!isAssetName(name)) throw new AxisError(400, 'Bad asset name');
            const file = join(dir(project), 'assets', name);
            if (!existsSync(file) || !statSync(file).isFile()) throw new AxisError(404, `No asset "${name}"`);
            return file;
        },
    };
}
