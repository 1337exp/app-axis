/**
 * The state of the page: which project is open, its records, what is selected. The truth is on the server (in files);
 * the page keeps a copy and refreshes it whenever the server says something changed, whoever changed it.
 *
 * Состояние страницы: какой проект открыт, его записи, что выбрано. Истина на сервере (в файлах);
 * страница держит копию и обновляет её, когда сервер говорит, что что-то изменилось, кто бы это ни сделал.
 */
import { computed, reactive } from 'vue';
import type { Doc } from '@1337exp/taoeditor/core';
import { buildThreads, ideaFromText, waitingSeeds } from '@/core/brainstorm';
import type { AxisDraft, AxisProject, AxisRecord, Brain, ProjectSummary } from '@/core/model';
import { buildTree, descendants, progressOfAll } from '@/core/tree';
import { ApiError, api } from './api';
import type { RecordPatch } from './api';

export type View = 'tree' | 'board' | 'timeline' | 'map' | 'brainstorm' | 'journal';

export const state = reactive({
    /** The first load is over (with or without success). / Первая загрузка закончена. */
    ready: false,
    /** The server does not answer. / Сервер не отвечает. */
    offline: false,
    projects: [] as ProjectSummary[],
    projectId: '',
    project: null as AxisProject | null,
    records: [] as AxisRecord[],
    /** Ids of the records that have an unsaved draft of the text. / Id записей с несохранённым черновиком текста. */
    drafts: [] as string[],
    /** The record open in the current view: in the tree it is the selected row, on the board and the timeline the one in the drawer. / Открытая запись текущего вида: в дереве выбранная строка, на доске и в ленте запись в панели. */
    selected: null as string | null,
    view: 'tree' as View,
    /** Grows on every change of the open project: panes that load something of their own watch it. */
    tick: 0,
});

export const tree = computed(() => buildTree(state.records));
export const progress = computed(() => progressOfAll(state.records));
/** The threads of the brainstorm and how many rounds wait for the agent. / Нити брейншторма и сколько раундов ждут агента. */
export const threads = computed(() => buildThreads(state.records));
export const waiting = computed(() => waitingSeeds(state.records).length);
export const selectedRecord = computed(() => state.records.find((r) => r.id === state.selected) ?? null);
export const recordById = (id: string): AxisRecord | undefined => state.records.find((r) => r.id === id);
const draftIds = computed(() => new Set(state.drafts));
/** Whether the record has an unsaved draft of its text. / Есть ли у записи несохранённый черновик текста. */
export const hasDraft = (id: string): boolean => draftIds.value.has(id);

/**
 * The tree's own selection, kept while another view is open: going tree → board → tree brings the same row back,
 * and what is open in the drawer of the board or the timeline never turns into a selection of the tree.
 * Собственный выбор дерева, пока открыт другой вид: дерево → доска → дерево возвращает ту же строку,
 * а запись из панели доски или ленты не становится выбором дерева.
 */
let treeSelected: string | null = null;

// ───────────────────────────── the address / адрес ─────────────────────────────
// #/<project>                  the tree
// #/<project>/<record>          a record in the tree
// #/<project>/~board            the board
// #/<project>/~board/<record>   the board with that record open in the drawer
// #/<project>/~timeline            the timeline by due dates
// #/<project>/~timeline/<record>   the timeline with that record open in the drawer
// #/<project>/~map                 the map
// #/<project>/~map/<record>        the map with that record open in the drawer
// #/<project>/~brainstorm          the brainstorm: threads of rounds
// #/<project>/~brainstorm/<record> the brainstorm with that record open in the drawer
// #/<project>/~journal          the journal
// The view is part of the address, so a reload brings back the same screen. / Вид входит в адрес: после перезагрузки тот же экран.

/** The views that open a record in a drawer and name it in the address after the view. / Виды, которые открывают запись в панели и называют её в адресе после вида. */
const DRAWER_VIEWS = ['board', 'timeline', 'map', 'brainstorm'] as const;

function readHash(): { project: string; record: string | null; view: View } {
    const [project = '', rest = '', third = ''] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    const drawer = DRAWER_VIEWS.find((view) => rest === `~${view}`);
    if (drawer) return { project, record: third || null, view: drawer };
    if (rest === '~journal') return { project, record: null, view: 'journal' };
    return { project, record: rest && !rest.startsWith('~') ? rest : null, view: 'tree' };
}

function writeHash(): void {
    const tail =
        state.view === 'journal'
            ? '/~journal'
            : state.view === 'board' || state.view === 'timeline' || state.view === 'map' || state.view === 'brainstorm'
              ? `/~${state.view}${state.selected ? `/${state.selected}` : ''}`
              : state.selected
                ? `/${state.selected}`
                : '';
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
        state.drafts = [];
        state.selected = null;
        treeSelected = null;
        writeHash();
        return;
    }
    state.projectId = id;
    state.project = data.project;
    state.records = data.records;
    state.drafts = data.drafts ?? [];
    state.selected = record && data.records.some((r) => r.id === record) ? record : null;
    state.view = view;
    treeSelected = view === 'tree' ? state.selected : null;
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
    state.drafts = data.drafts ?? [];
    if (state.selected && !data.records.some((r) => r.id === state.selected)) state.selected = null;
    state.tick += 1;
    writeHash();
}

export function select(id: string | null): void {
    state.selected = id;
    // a record picked in the journal is shown in the tree; on the board and the timeline it opens in the drawer and the view stays
    if (id && state.view === 'journal') state.view = 'tree';
    writeHash();
}

export function setView(view: View): void {
    if (view === state.view) return;
    if (state.view === 'tree') treeSelected = state.selected;
    state.view = view;
    // on the board and the timeline a selected record means an open drawer: arriving there must not open one;
    // the tree gets its own row back (if the record is still there), the journal shows none
    state.selected = view === 'tree' && treeSelected && recordById(treeSelected) ? treeSelected : null;
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

/**
 * A new idea from typed text: a top-level `idea` with the role `seed` (or a child of `parent`), the first line as the
 * title and the text as the body. `handed` gives the turn to the agent at once (a reply to a verdict does).
 * Новая задумка из набранного текста: `idea` верхнего уровня с ролью `seed` (или ребёнок `parent`), первая строка это
 * заголовок, текст это тело. `handed` сразу передаёт ход агенту (так делает ответ на вердикт).
 */
export async function addSeed(text: string, options: { parent?: string; handed?: boolean } = {}): Promise<AxisRecord | null> {
    const idea = ideaFromText(text);
    if (!idea) return null;
    return addRecord({
        type: 'idea',
        title: idea.title,
        ...(idea.text === null ? {} : { text: idea.text }),
        ...(options.parent ? { parent: options.parent } : {}),
        brain: { role: 'seed', ...(options.handed ? { handed: true } : {}) },
    });
}

/** Changes the brainstorm fields of a record: only the keys passed. / Меняет поля брейншторма записи: только переданные ключи. */
export const patchBrain = (id: string, brain: Partial<Brain>): Promise<AxisRecord> => patchRecord(id, { brain });

export async function patchRecord(id: string, patch: RecordPatch): Promise<AxisRecord> {
    try {
        const record = await api.updateRecord(state.projectId, id, patch);
        put(record);
        return record;
    } catch (error) {
        // a refused stale save brings the record as it is now: the page takes it before it says anything
        if (error instanceof ApiError && error.status === 409 && error.data.record) put(error.data.record);
        throw error;
    }
}

// ───────────────────────────── drafts / черновики ─────────────────────────────
// The text typed in the editor is kept on the server as a draft (a file), not in the record and not in the journal,
// until the person presses Save. The page only learns from here which records have one.
// Набранный в редакторе текст лежит на сервере черновиком (файлом), не в записи и не в журнале, пока человек не
// нажмёт «Сохранить». Отсюда страница знает только, у каких записей он есть.

/**
 * Draft calls go through one queue, in order, for the whole page: a write sent when a pane goes away lands before the
 * next pane asks for the draft, and a delete never overtakes a write (which would bring the draft back).
 * Вызовы черновика идут через одну очередь по порядку на всю страницу: запись, отправленная при уходе панели,
 * ложится раньше, чем следующая панель попросит черновик, а удаление не обгоняет запись (она вернула бы черновик).
 */
let queue: Promise<unknown> = Promise.resolve();
function inQueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
}

/** The draft of a record, or null; after the writes that are on their way. / Черновик записи или null; после уже отправленных записей. */
export const loadDraft = (project: string, id: string): Promise<AxisDraft | null> => inQueue(() => api.draft(project, id));

/**
 * Writes the draft. The record is marked at once (the mark is where the draft will be when the queue is done).
 * `project` is passed in: the person may have moved to another one meanwhile.
 * Пишет черновик. Отметка ставится сразу (она показывает, где черновик будет, когда очередь пройдёт).
 */
export function writeDraft(project: string, id: string, body: Doc | null, base: string, keepalive = false): Promise<AxisDraft> {
    const here = project === state.projectId;
    const had = state.drafts.includes(id);
    if (here && !had) state.drafts.push(id);
    return inQueue(() => api.putDraft(project, id, { body, base }, keepalive)).catch((error: unknown) => {
        if (here && !had && project === state.projectId) state.drafts = state.drafts.filter((d) => d !== id);
        throw error;
    });
}

/** Drops the draft and the mark. / Убирает черновик и отметку. */
export function dropDraft(project: string, id: string): Promise<void> {
    if (project === state.projectId) state.drafts = state.drafts.filter((d) => d !== id);
    return inQueue(() => api.deleteDraft(project, id)).then(() => undefined);
}

export async function removeRecord(id: string): Promise<void> {
    const gone = await api.deleteRecord(state.projectId, id);
    state.records = state.records.filter((r) => !gone.includes(r.id));
    state.drafts = state.drafts.filter((d) => !gone.includes(d));
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
const mapListeners = new Set<(project: string) => void>();

/** `fn` is called when the map file of a project changed on disk (by another tab, say). Returns the way to stop. / Зовётся, когда файл карты проекта изменился на диске (например, из другой вкладки). */
export function onMapChanged(fn: (project: string) => void): () => void {
    mapListeners.add(fn);
    return () => mapListeners.delete(fn);
}
let pending: ReturnType<typeof setTimeout> | null = null;

function listen(): void {
    source?.close();
    source = new EventSource('/api/events');
    source.onmessage = (event) => {
        let projects: string[] = [];
        let maps: string[] = [];
        try {
            const data = JSON.parse(event.data as string) as { projects?: string[]; maps?: string[] };
            projects = data.projects ?? [];
            maps = data.maps ?? [];
        } catch {
            return;
        }
        // one refresh for a burst of file changes
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            // a change of `map.json` alone does not make the page take the project again: only the map hears of it
            if (maps.includes(state.projectId)) for (const fn of mapListeners) fn(state.projectId);
            if (projects.length === 0) return;
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
            if (state.view === 'tree') treeSelected = state.selected;
            state.selected = at.record && state.records.some((r) => r.id === at.record) ? at.record : null;
            state.view = at.view;
        }
    });
}
