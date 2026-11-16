/**
 * The page's copy of the map of the open project: where the cards sit (only those the person placed) and the camera.
 * Writes are debounced and go in one request per burst (a drag saves once, on the drop). The file is not a record and
 * not a journal line, so nothing here touches the records or the drafts.
 *
 * Копия страницы карты открытого проекта: где стоят карточки (только те, что поставил человек) и камера.
 * Записи откладываются и уходят одним запросом на всплеск (перенос сохраняется один раз, при отпускании). Файл это не
 * запись и не строка журнала, поэтому ничто здесь не трогает записи и черновики.
 */
import { reactive } from 'vue';
import { patchMap } from '@/core/map';
import type { MapCamera, MapPatch, MapPoint } from '@/core/map';
import { api } from './api';
import { onMapChanged } from './state';

export const mapState = reactive({
    project: '',
    /** The map of this project has been read. / Карта этого проекта прочитана. */
    loaded: false,
    /** Places the person set; a card without one is placed by the automatic layout. / Места, заданные человеком; карточку без места ставит автоматическая раскладка. */
    places: {} as Record<string, MapPoint>,
    camera: null as MapCamera | null,
});

const WRITE_DELAY = 250;
const ECHO_MS = 1500;

let pending: MapPatch = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWrite = 0;
let holding = 0;

const dirty = (): boolean => timer !== null || Object.keys(pending).length > 0;

/** While a card is dragged the file is not taken from disk: what is under the pointer must not jump. / Пока тащат карточку, файл с диска не берётся: то, что под указателем, не должно прыгать. */
export const holdMap = (on: boolean): void => {
    holding = Math.max(0, holding + (on ? 1 : -1));
};

function merge(into: MapPatch, patch: MapPatch): MapPatch {
    return {
        ...(into.positions || patch.positions ? { positions: { ...into.positions, ...patch.positions } } : {}),
        ...(patch.camera !== undefined ? { camera: patch.camera } : into.camera !== undefined ? { camera: into.camera } : {}),
    };
}

export async function flushMap(keepalive = false): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (Object.keys(pending).length === 0 || !mapState.project) return;
    const patch = pending;
    const project = mapState.project;
    pending = {};
    lastWrite = Date.now();
    try {
        await api.patchMap(project, patch, keepalive);
    } catch {
        // the file is a convenience: the page keeps what it has, and the next change writes it again
    }
    lastWrite = Date.now();
}

function queue(patch: MapPatch): void {
    pending = merge(pending, patch);
    timer ??= setTimeout(() => void flushMap(), WRITE_DELAY);
}

/** Reads the map of a project from the server. / Читает карту проекта с сервера. */
export async function loadMap(project: string): Promise<void> {
    if (mapState.project !== project) {
        mapState.project = project;
        mapState.loaded = false;
        mapState.places = {};
        mapState.camera = null;
        pending = {};
    }
    try {
        const map = await api.map(project);
        if (mapState.project !== project) return;
        mapState.places = map.positions;
        mapState.camera = map.camera ?? null;
    } catch {
        // no map yet or the server is away: the automatic layout shows everything
    }
    if (mapState.project === project) mapState.loaded = true;
}

/** Sets places (`null` forgets one): the page at once, the file after a short pause. / Ставит места (`null` забывает место): на странице сразу, в файле после короткой паузы. */
export function placeCards(changes: Record<string, MapPoint | null>): void {
    const next = patchMap({ v: 1, positions: mapState.places }, { positions: changes });
    mapState.places = next.positions;
    queue({ positions: changes });
}

export function saveCamera(camera: MapCamera): void {
    mapState.camera = camera;
    queue({ camera });
}

if (typeof window !== 'undefined') {
    // the last move still reaches the file when the page is closed / последний перенос доходит до файла и при закрытии страницы
    window.addEventListener('pagehide', () => void flushMap(true));
    onMapChanged((project) => {
        // another tab (or a hand) changed the file: take the places, never the camera, and never in the middle of our own write or a drag
        if (project !== mapState.project || holding > 0 || dirty() || Date.now() - lastWrite < ECHO_MS) return;
        void api
            .map(project)
            .then((map) => {
                if (project === mapState.project && holding === 0 && !dirty()) mapState.places = map.positions;
            })
            .catch(() => undefined);
    });
}
