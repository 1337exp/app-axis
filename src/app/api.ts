/**
 * The page's side of the HTTP API. Every call either gives the answer or throws an `ApiError` with a text to show.
 * Сторона страницы в HTTP API. Каждый вызов либо даёт ответ, либо бросает `ApiError` с текстом для показа.
 */
import type { JournalEntry } from '@/core/journal';
import type { Doc } from '@1337exp/taoeditor/core';
import type { MapData, MapPatch } from '@/core/map';
import type { AxisDraft, AxisProject, AxisRecord, ProjectSummary } from '@/core/model';

export class ApiError extends Error {
    readonly status: number;
    /** What the server sent besides the reason: on 409 the current `record`. / Что сервер прислал кроме причины: при 409 текущая `record`. */
    readonly data: { record?: AxisRecord };
    constructor(status: number, message: string, data: { record?: AxisRecord } = {}) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

async function call<T>(method: string, path: string, body?: unknown, options: { keepalive?: boolean } = {}): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`/api/${path}`, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            keepalive: options.keepalive,
        });
    } catch {
        throw new ApiError(0, 'offline');
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; record?: AxisRecord };
    if (!response.ok) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`, data.record ? { record: data.record } : {});
    return data as T;
}

const enc = encodeURIComponent;

/** What the page may change in a record. / Что страница может менять в записи. */
export type RecordPatch = Partial<Pick<AxisRecord, 'type' | 'title' | 'body' | 'status' | 'parent' | 'due' | 'links' | 'images'>> & {
    /** After this sibling; null is first. / После этого соседа; null значит первым. */
    after?: string | null;
    /** The `updated` stamp the change was made against; a record that has moved on answers 409. / Штамп `updated`, против которого правка; ушедшая вперёд запись отвечает 409. */
    base?: string;
};

export const api = {
    projects: () => call<{ projects: ProjectSummary[] }>('GET', 'projects').then((r) => r.projects),
    createProject: (input: { title: string; description?: string; repo?: string }) => call<{ project: AxisProject }>('POST', 'projects', input).then((r) => r.project),
    project: (id: string) => call<{ project: AxisProject; records: AxisRecord[]; drafts?: string[] }>('GET', `projects/${enc(id)}`),
    draft: (project: string, id: string) => call<{ draft: AxisDraft | null }>('GET', `projects/${enc(project)}/records/${enc(id)}/draft`).then((r) => r.draft),
    /** `keepalive`: the last words typed before the page is closed still reach the server. / Последнее набранное доходит и при закрытии страницы. */
    putDraft: (project: string, id: string, input: { body: Doc | null; base: string }, keepalive = false) =>
        call<{ draft: AxisDraft }>('PUT', `projects/${enc(project)}/records/${enc(id)}/draft`, input, { keepalive }).then((r) => r.draft),
    deleteDraft: (project: string, id: string) => call<{ deleted: boolean }>('DELETE', `projects/${enc(project)}/records/${enc(id)}/draft`).then((r) => r.deleted),
    createRecord: (project: string, input: RecordPatch & { title: string }) =>
        call<{ record: AxisRecord }>('POST', `projects/${enc(project)}/records`, input).then((r) => r.record),
    updateRecord: (project: string, id: string, patch: RecordPatch) =>
        call<{ record: AxisRecord }>('PATCH', `projects/${enc(project)}/records/${enc(id)}`, patch).then((r) => r.record),
    deleteRecord: (project: string, id: string) => call<{ deleted: string[] }>('DELETE', `projects/${enc(project)}/records/${enc(id)}`).then((r) => r.deleted),
    map: (project: string) => call<{ map: MapData }>('GET', `projects/${enc(project)}/map`).then((r) => r.map),
    /** Where the cards sit and the camera; `keepalive` lets the last move reach the server as the page closes. / Где стоят карточки и камера; `keepalive` даёт последнему переносу дойти при закрытии страницы. */
    patchMap: (project: string, patch: MapPatch, keepalive = false) => call<{ map: MapData }>('PATCH', `projects/${enc(project)}/map`, patch, { keepalive }).then((r) => r.map),
    journal: (project: string, record?: string) =>
        call<{ journal: JournalEntry[] }>('GET', `projects/${enc(project)}/journal?limit=300${record ? `&record=${enc(record)}` : ''}`).then((r) => r.journal),
    log: (project: string, text: string, record?: string) =>
        call<{ entry: JournalEntry }>('POST', `projects/${enc(project)}/journal`, { text, record }).then((r) => r.entry),

    async upload(project: string, file: Blob): Promise<string> {
        let response: Response;
        try {
            response = await fetch(`/api/projects/${enc(project)}/assets`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        } catch {
            throw new ApiError(0, 'offline');
        }
        const data = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
        if (!response.ok || !data.name) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`);
        return data.name;
    },

    assetUrl: (project: string, name: string) => `/api/projects/${enc(project)}/assets/${enc(name)}`,
};
