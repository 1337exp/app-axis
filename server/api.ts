/**
 * The HTTP door: a JSON API over the store, pictures, and a stream of "something changed" events.
 * It watches the data folder, so a change made by the MCP server or by hand reaches the page too.
 * Local only: requests whose Host or Origin is not this machine are refused.
 *
 * HTTP-дверь: JSON API поверх хранилища, картинки и поток событий «что-то изменилось».
 * Следит за папкой данных, поэтому правка от MCP-сервера или руками тоже доходит до страницы.
 * Только локально: запросы с чужим Host или Origin отклоняются.
 */
import { createReadStream, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAuthor, isId } from '../src/core/model.ts';
import type { Author } from '../src/core/model.ts';
import { ASSET_MAX_BYTES, AxisError } from './store.ts';
import type { DraftInput, ProjectInput, RecordInput, Store } from './store.ts';

const JSON_MAX_BYTES = 4 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };

export interface Api {
    /** Answers the request if it is for `/api/`; false when it is not ours. / Отвечает на запрос к `/api/`; false, если запрос не наш. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    close(): void;
}

const hostName = (value: string): string => value.replace(/:\d+$/, '').toLowerCase();

function isLocal(req: IncomingMessage): boolean {
    if (!LOCAL_HOSTS.has(hostName(req.headers.host ?? ''))) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
        return LOCAL_HOSTS.has(new URL(origin).host.replace(/:\d+$/, '').toLowerCase());
    } catch {
        return false;
    }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                reject(new AxisError(413, 'The request is too big'));
                req.destroy();
            } else chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    // a JSON content type cannot be sent by a plain form of another site: the browser asks first, and we do not answer
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new AxisError(415, 'Send JSON (Content-Type: application/json)');
    const raw = (await readBody(req, JSON_MAX_BYTES)).toString('utf8');
    let parsed: unknown;
    try {
        parsed = raw.trim() === '' ? {} : JSON.parse(raw);
    } catch {
        throw new AxisError(400, 'The body is not JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AxisError(400, 'The body must be a JSON object');
    return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
}

export function createApi(store: Store): Api {
    const listeners = new Set<ServerResponse>();
    const pending = new Set<string>();
    /**
     * What changed in a burst, per project: `map.json` (and its temporary file), or anything else. A project where only the map
     * changed does not make the page take the whole project again.
     * Что менялось за всплеск, по проектам: `map.json` (и его временный файл) или что-то другое. Проект, где менялась только
     * карта, не заставляет страницу брать проект целиком.
     */
    const mapSeen = new Set<string>();
    const otherSeen = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;

    const flush = (): void => {
        timer = null;
        const mapOnly = (p: string): boolean => mapSeen.has(p) && !otherSeen.has(p);
        const projects = [...pending].filter((p) => !mapOnly(p));
        const maps = [...pending].filter(mapOnly);
        pending.clear();
        mapSeen.clear();
        otherSeen.clear();
        const data = `data: ${JSON.stringify({ projects, maps })}\n\n`;
        for (const res of listeners) res.write(data);
    };

    try {
        watcher = watch(store.root, { recursive: true }, (_event, file) => {
            if (!file) return;
            // the first part of the path is the project folder; a new or removed project changes the list itself
            const project = String(file).split(/[\\/]/)[0] ?? '';
            if (!isId(project)) return;
            const name = String(file).split(/[\\/]/).slice(1).join('/');
            const isMap = name === 'map.json' || name.startsWith('map.json.tmp-');
            // the folder of the project itself (its entry changes whenever a file inside does) says nothing: the files say what changed
            if (isMap) mapSeen.add(project);
            else if (name !== '') otherSeen.add(project);
            pending.add(project);
            timer ??= setTimeout(flush, 60);
        });
        watcher.on('error', () => {});
    } catch {
        watcher = null; // no watching on this system: the page still refreshes on its own actions
    }

    const beat = setInterval(() => {
        for (const res of listeners) res.write(': beat\n\n');
    }, 25_000);
    beat.unref();

    const author = (req: IncomingMessage): Author => {
        const by = req.headers['x-axis-by'];
        return isAuthor(by) ? by : 'user';
    };

    async function route(req: IncomingMessage, res: ServerResponse, path: string[], url: URL): Promise<void> {
        const method = req.method ?? 'GET';
        const [head, project, section, item] = path;

        if (head === 'events' && method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.write(': hello\n\n');
            listeners.add(res);
            req.on('close', () => listeners.delete(res));
            return;
        }

        if (head !== 'projects') throw new AxisError(404, 'No such address');

        if (project === undefined) {
            if (method === 'GET') return send(res, 200, { projects: store.projects() });
            if (method === 'POST') return send(res, 201, { project: store.createProject((await readJsonBody(req)) as ProjectInput) });
            throw new AxisError(405, 'GET or POST');
        }

        if (section === undefined) {
            if (method === 'GET') return send(res, 200, { project: store.project(project), records: store.records(project), drafts: store.drafts(project) });
            if (method === 'PATCH') return send(res, 200, { project: store.updateProject(project, (await readJsonBody(req)) as ProjectInput) });
            throw new AxisError(405, 'GET or PATCH');
        }

        if (section === 'records') {
            if (item === undefined) {
                if (method === 'POST') return send(res, 201, { record: store.createRecord(project, (await readJsonBody(req)) as RecordInput, author(req)) });
                throw new AxisError(405, 'POST');
            }
            if (path[4] === 'draft') {
                // the unsaved text of the record: kept as a file, not in the record and not in the journal
                if (method === 'GET') return send(res, 200, { draft: store.draft(project, item) });
                if (method === 'PUT') return send(res, 200, { draft: store.saveDraft(project, item, (await readJsonBody(req)) as DraftInput, author(req)) });
                if (method === 'DELETE') return send(res, 200, { deleted: store.deleteDraft(project, item) });
                throw new AxisError(405, 'GET, PUT or DELETE');
            }
            if (path[4] !== undefined) throw new AxisError(404, 'No such address');
            if (method === 'GET') return send(res, 200, { record: store.record(project, item), journal: store.journal(project, { record: item, limit: 100 }) });
            if (method === 'PATCH') return send(res, 200, { record: store.updateRecord(project, item, (await readJsonBody(req)) as RecordInput, author(req)) });
            if (method === 'DELETE') {
                const why = url.searchParams.get('why') ?? undefined;
                return send(res, 200, { deleted: store.deleteRecord(project, item, author(req), why) });
            }
            throw new AxisError(405, 'GET, PATCH or DELETE');
        }

        if (section === 'map') {
            // where the cards of the map sit: a file of its own, not a record and not a journal line
            if (method === 'GET') return send(res, 200, { map: store.map(project) });
            if (method === 'PATCH') return send(res, 200, { map: store.patchMap(project, await readJsonBody(req)) });
            throw new AxisError(405, 'GET or PATCH');
        }

        if (section === 'journal') {
            if (method === 'GET') {
                const limit = Number(url.searchParams.get('limit')) || undefined;
                const record = url.searchParams.get('record') ?? undefined;
                return send(res, 200, { journal: store.journal(project, { limit, record }) });
            }
            if (method === 'POST') {
                const body = await readJsonBody(req);
                return send(res, 201, { entry: store.log(project, body.text, body.record, author(req)) });
            }
            throw new AxisError(405, 'GET or POST');
        }

        if (section === 'assets') {
            if (item === undefined) {
                if (method !== 'POST') throw new AxisError(405, 'POST');
                const bytes = await readBody(req, ASSET_MAX_BYTES + 1);
                return send(res, 201, { name: store.saveAsset(project, bytes, req.headers['content-type'] ?? '') });
            }
            if (method !== 'GET') throw new AxisError(405, 'GET');
            const file = store.assetPath(project, item);
            const type = MIME[item.split('.').pop() ?? ''] ?? 'application/octet-stream';
            // the name is the hash of the content, so the file under it never changes
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
            createReadStream(file).pipe(res);
            return;
        }

        throw new AxisError(404, 'No such address');
    }

    return {
        async handle(req, res) {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return false;
            try {
                if (!isLocal(req)) throw new AxisError(403, 'Axis answers this machine only');
                const path = url.pathname.split('/').slice(2).filter((part) => part !== '').map(decodeURIComponent);
                await route(req, res, path, url);
            } catch (error) {
                const status = error instanceof AxisError ? error.status : 500;
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (status === 500) console.error('[axis]', error);
                // a refusal may carry data (409: the current record); `error` always wins over a key of the same name
                if (!res.headersSent) send(res, status, { ...(error instanceof AxisError ? error.data : undefined), error: message });
                else res.end();
            }
            return true;
        },
        close() {
            clearInterval(beat);
            if (timer) clearTimeout(timer);
            watcher?.close();
            for (const res of listeners) res.end();
            listeners.clear();
        },
    };
}
