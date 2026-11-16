/**
 * The page's side of the HTTP API. Every call either gives the answer or throws an `ApiError` with a text to show.
 * Сторона страницы в HTTP API. Каждый вызов либо даёт ответ, либо бросает `ApiError` с текстом для показа.
 */
import type { JournalEntry } from '@/core/journal';
import type { AxisProject, AxisRecord, ProjectSummary } from '@/core/model';

export class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`/api/${path}`, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError(0, 'offline');
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`);
    return data as T;
}

const enc = encodeURIComponent;

/** What the page may change in a record. / Что страница может менять в записи. */
export type RecordPatch = Partial<Pick<AxisRecord, 'type' | 'title' | 'body' | 'status' | 'parent' | 'due' | 'links' | 'images'>> & {
    /** After this sibling; null is first. / После этого соседа; null значит первым. */
    after?: string | null;
};

export const api = {
    projects: () => call<{ projects: ProjectSummary[] }>('GET', 'projects').then((r) => r.projects),
    createProject: (input: { title: string; description?: string; repo?: string }) => call<{ project: AxisProject }>('POST', 'projects', input).then((r) => r.project),
    project: (id: string) => call<{ project: AxisProject; records: AxisRecord[] }>('GET', `projects/${enc(id)}`),
    createRecord: (project: string, input: RecordPatch & { title: string }) =>
        call<{ record: AxisRecord }>('POST', `projects/${enc(project)}/records`, input).then((r) => r.record),
    updateRecord: (project: string, id: string, patch: RecordPatch) =>
        call<{ record: AxisRecord }>('PATCH', `projects/${enc(project)}/records/${enc(id)}`, patch).then((r) => r.record),
    deleteRecord: (project: string, id: string) => call<{ deleted: string[] }>('DELETE', `projects/${enc(project)}/records/${enc(id)}`).then((r) => r.deleted),
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
