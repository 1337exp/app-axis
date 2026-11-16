/**
 * The store: projects as folders of plain files. Files are the truth: the page, the MCP server and a hand
 * with a text editor all change the same files, and whoever watches the folder sees the change.
 *
 *   <data>/<project>/project.json
 *   <data>/<project>/records/<id>.json     one record per file
 *   <data>/<project>/journal.jsonl         a line per change, appended
 *   <data>/<project>/assets/<name>         pictures
 *   <data>/<project>/trash/<id>.json       what was deleted (nothing is unlinked)
 *
 * Хранилище: проекты как папки обычных файлов. Истина в файлах: страница, MCP-сервер и рука с текстовым
 * редактором меняют одни и те же файлы, а кто следит за папкой, видит изменение. Удалённое уходит в `trash/`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES, isEmptyDoc, normalizeDoc } from '@1337exp/taoeditor/core';
import type { Doc } from '@1337exp/taoeditor/core';
import { diffRecord, parseEntry } from '../src/core/journal.ts';
import type { JournalEntry } from '../src/core/journal.ts';
import {
    RECORD_VERSION,
    cleanTitle,
    isAssetName,
    isDay,
    isId,
    isLinkKind,
    isRecordType,
    isStatus,
    normalizeRecord,
} from '../src/core/model.ts';
import type { Author, AxisProject, AxisRecord, ProjectSummary, RecordLink, RecordType, Status } from '../src/core/model.ts';
import { textToDoc } from '../src/core/text.ts';
import { canMove, descendants, orderFor, progressOfAll } from '../src/core/tree.ts';

/** A refusal with a reason the caller can show. `status` is the HTTP code it maps to. / Отказ с причиной для показа. */
export class AxisError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
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
    /** The reason: goes to the journal. / Причина: попадает в журнал. */
    why?: unknown;
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

    /** The body from `body` (a document) or `text` (light Markdown), through the editor's gate. */
    const bodyOf = (input: RecordInput): Doc | null | undefined => {
        let doc: unknown;
        if (typeof input.text === 'string') doc = textToDoc(input.text);
        else if (input.body !== undefined) doc = input.body;
        else return undefined;
        if (doc === null) return null;
        const clean = normalizeDoc(doc, PROFILES.article).doc;
        return isEmptyDoc(clean) ? null : clean;
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
                created: stamp,
                updated: stamp,
                createdBy: by,
                updatedBy: by,
            };
            writeRecord(project, record);
            append(project, { t: stamp, by, kind: 'create', record: id, title, ...why(input.why) });
            return record;
        },

        updateRecord(project, id, input, by) {
            const all = readRecords(project);
            const before = all.find((r) => r.id === id);
            if (!before) throw new AxisError(404, `No record "${String(id)}" in "${project}"`);
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
