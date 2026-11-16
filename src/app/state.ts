/**
 * The state of the page: which project is open, its records, what is selected. The truth is on the server (in files);
 * the page keeps a copy and refreshes it whenever the server says something changed, whoever changed it.
 *
 * Состояние страницы: какой проект открыт, его записи, что выбрано. Истина на сервере (в файлах);
 * страница держит копию и обновляет её, когда сервер говорит, что что-то изменилось, кто бы это ни сделал.
 */
import { computed, reactive } from 'vue';
import type { AxisProject, AxisRecord, ProjectSummary } from '@/core/model';
import { buildTree, descendants, progressOfAll } from '@/core/tree';
import { ApiError, api } from './api';
import type { RecordPatch } from './api';

export type View = 'tree' | 'journal';

export const state = reactive({
    /** The first load is over (with or without success). / Первая загрузка закончена. */
    ready: false,
    /** The server does not answer. / Сервер не отвечает. */
    offline: false,
    projects: [] as ProjectSummary[],
    projectId: '',
    project: null as AxisProject | null,
    records: [] as AxisRecord[],
    selected: null as string | null,
    view: 'tree' as View,
    /** Grows on every change of the open project: panes that load something of their own watch it. */
    tick: 0,
});

export const tree = computed(() => buildTree(state.records));
export const progress = computed(() => progressOfAll(state.records));
export const selectedRecord = computed(() => state.records.find((r) => r.id === state.selected) ?? null);
export const recordById = (id: string): AxisRecord | undefined => state.records.find((r) => r.id === id);

// ───────────────────────────── the address / адрес ─────────────────────────────
// #/<project>            the tree
// #/<project>/<record>   a record
// #/<project>/~journal   the journal

function readHash(): { project: string; record: string | null; view: View } {
    const [project = '', rest = ''] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    return { project, record: rest && !rest.startsWith('~') ? rest : null, view: rest === '~journal' ? 'journal' : 'tree' };
}

function writeHash(): void {
    const tail = state.view === 'journal' ? '/~journal' : state.selected ? `/${state.selected}` : '';
    const hash = state.projectId ? `#/${state.projectId}${tail}` : '';
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
}

// ───────────────────────────── loading / загрузка ─────────────────────────────

async function guarded<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
        const result = await work();
        state.offline = false;
        return result;
    } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
            state.offline = true;
            return undefined;
        }
        throw error;
    }
}

export async function loadProjects(): Promise<void> {
    const projects = await guarded(() => api.projects());
    if (projects) state.projects = projects;
}

export async function openProject(id: string, record: string | null = null, view: View = 'tree'): Promise<void> {
    const data = await guarded(() => api.project(id)).catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
        throw error;
    });
    if (data === undefined) return;
    if (data === null) {
        // the project in the address is gone: fall back to the first one
        const first = state.projects.find((p) => p.id !== id);
        if (first) return openProject(first.id);
        state.projectId = '';
        state.project = null;
        state.records = [];
        state.selected = null;
        writeHash();
        return;
    }
    state.projectId = id;
    state.project = data.project;
    state.records = data.records;
    state.selected = record && data.records.some((r) => r.id === record) ? record : null;
    state.view = view;
    state.tick += 1;
    writeHash();
}

/** Takes the open project again from the server; the selection stays if the record is still there. */
export async function refresh(): Promise<void> {
    if (!state.projectId) return;
    const data = await guarded(() => api.project(state.projectId)).catch(() => undefined);
    if (!data) return;
    state.project = data.project;
    state.records = data.records;
    if (state.selected && !data.records.some((r) => r.id === state.selected)) state.selected = null;
    state.tick += 1;
    writeHash();
}

export function select(id: string | null): void {
    state.selected = id;
    if (id) state.view = 'tree';
    writeHash();
}

export function setView(view: View): void {
    state.view = view;
    writeHash();
}

// ───────────────────────────── changes / изменения ─────────────────────────────

function put(record: AxisRecord): void {
    const at = state.records.findIndex((r) => r.id === record.id);
    if (at === -1) state.records.push(record);
    else state.records[at] = record;
}

export async function createProject(input: { title: string; description?: string; repo?: string }): Promise<void> {
    const project = await api.createProject(input);
    await loadProjects();
    await openProject(project.id);
}

export async function addRecord(input: RecordPatch & { title: string }): Promise<AxisRecord> {
    const record = await api.createRecord(state.projectId, input);
    put(record);
    return record;
}

export async function patchRecord(id: string, patch: RecordPatch): Promise<AxisRecord> {
    const record = await api.updateRecord(state.projectId, id, patch);
    put(record);
    return record;
}

export async function removeRecord(id: string): Promise<void> {
    const gone = await api.deleteRecord(state.projectId, id);
    state.records = state.records.filter((r) => !gone.includes(r.id));
    if (state.selected && gone.includes(state.selected)) select(null);
}

/** How many records sit under this one. / Сколько записей под этой. */
export const countInside = (id: string): number => descendants(state.records, id).length;

/** Moves a record one step among its siblings. / Двигает запись на шаг среди соседей. */
export async function moveStep(id: string, step: -1 | 1): Promise<void> {
    const record = recordById(id);
    if (!record) return;
    const siblings = state.records.filter((r) => r.parent === record.parent).sort((a, b) => a.order - b.order || a.created.localeCompare(b.created));
    const at = siblings.findIndex((r) => r.id === id);
    const to = at + step;
    if (at === -1 || to < 0 || to >= siblings.length) return;
    // up: after the one before the previous (or first); down: after the next
    const after = step === 1 ? siblings[to]!.id : (siblings[to - 1]?.id ?? null);
    await patchRecord(id, { after });
}

/** Lifts a record out of its parent, right after it. / Поднимает запись из родителя, ставит сразу после него. */
export async function outdent(id: string): Promise<void> {
    const record = recordById(id);
    const parent = record?.parent ? recordById(record.parent) : undefined;
    if (!record || !parent) return;
    await patchRecord(id, { parent: parent.parent, after: parent.id });
}


// ───────────────────────────── live / вживую ─────────────────────────────

let source: EventSource | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

function listen(): void {
    source?.close();
    source = new EventSource('/api/events');
    source.onmessage = (event) => {
        let projects: string[] = [];
        try {
            projects = (JSON.parse(event.data as string) as { projects?: string[] }).projects ?? [];
        } catch {
            return;
        }
        // one refresh for a burst of file changes
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            void loadProjects();
            if (projects.includes(state.projectId)) void refresh();
        }, 80);
    };
    source.onopen = () => {
        // after a break the page may have missed changes: take everything again
        if (state.offline) void start();
    };
    source.onerror = () => {
        state.offline = true; // the browser reconnects by itself
    };
}

/** The first load: the list, then the project from the address (or the latest one). */
export async function start(): Promise<void> {
    await loadProjects();
    if (!state.offline) {
        const at = readHash();
        const id = state.projects.some((p) => p.id === at.project) ? at.project : state.projects[0]?.id;
        if (id) await openProject(id, id === at.project ? at.record : null, id === at.project ? at.view : 'tree');
    }
    state.ready = true;
}

export function init(): void {
    void start();
    listen();
    window.addEventListener('hashchange', () => {
        const at = readHash();
        if (!at.project || !state.projects.some((p) => p.id === at.project)) return;
        if (at.project !== state.projectId) void openProject(at.project, at.record, at.view);
        else {
            state.selected = at.record && state.records.some((r) => r.id === at.record) ? at.record : null;
            state.view = at.view;
        }
    });
}
