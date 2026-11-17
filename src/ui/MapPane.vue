<script setup lang="ts">
/**
 * The map: the records of the project as cards on a plane, a fourth view of the same data (not a second model). What
 * the map owns is only where a card sits and the camera (`map.json`, see `mapState`); the cards, the tree lines and the
 * typed links are drawn from the records as they are, so a change from outside repaints them by itself. The canvas
 * (pan, zoom, selection frame, dragging, dragging a link out, touch) is TaoUX's `TaoxCanvas`; this file is its host:
 * it says what the gestures mean here. A card without a saved place is placed by the automatic layout (`core/map.ts`).
 * A click selects a card, a double click or Enter opens it in the drawer on the right, the one the board uses.
 *
 * Карта: записи проекта карточками на плоскости, четвёртый вид тех же данных (не вторая модель). Карте принадлежит только
 * место карточки и камера (`map.json`, см. `mapState`); карточки, линии дерева и типизированные связи рисуются из записей
 * как они есть, поэтому правка снаружи перерисовывает их сама. Холст (панорама, масштаб, рамка выделения, перенос, протягивание
 * связи, сенсор) это `TaoxCanvas` из TaoUX; этот файл его хозяин: говорит, что жесты значат здесь. Карточку без сохранённого
 * места ставит автоматическая раскладка (`core/map.ts`). Клик выбирает карточку, двойной клик или Enter открывает её в панели
 * справа, в той же, что у доски.
 */
import { TaoButton, TaoEmpty, TaoInput, TaoMenu, confirm, toast } from '@1337exp/taoui';
import type { TaoMenuItem } from '@1337exp/taoui';
import { fitCamera, screenToWorld, worldToScreen, zoomAt } from '@1337exp/taoux/camera';
import type { Camera } from '@1337exp/taoux/camera';
import { TaoxCanvas } from '@1337exp/taoux/canvas';
import type { CanvasHost, CanvasOptions } from '@1337exp/taoux/canvas';
import { snapToGuides } from '@1337exp/taoux/guides';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { isFound, found, search } from '@/app/search';
import { addRecord, hasDraft, recordById, select, state, tree } from '@/app/state';
import { flushMap, holdMap, loadMap, mapState, placeCards, saveCamera } from '@/app/mapState';
import { readFlag, writeFlag } from '@/app/viewFilter';
import {
    autoLayout,
    boundsOf,
    branchOf,
    cardWidth,
    curve,
    drawnParents,
    estimateHeight,
    joinSides,
    labelSpot,
    mergePlaces,
    neighbour,
    pointOn,
    shiftPlaces,
    sideNear,
    treePath,
    visibleIds,
} from '@/core/map';
import type { Direction, LayoutItem, MapPoint, Rect, Side } from '@/core/map';
import { LINK_KINDS } from '@/core/model';
import type { LinkKind } from '@/core/model';
import { parseQuick } from '@/core/quick';
import { percent, progressOf, shares } from '@/core/tree';
import type { TreeNode } from '@/core/tree';
import { useI18n } from '@/i18n';
import FilterBar from './FilterBar.vue';
import { emptyPlaceAt } from './hit';
import MapCard from './MapCard.vue';
import { TaoxLinks } from '@1337exp/taoux/links';
import type { LinkLine } from '@1337exp/taoux/links';
import MapLines from './MapLines.vue';
import type { Guide, TreeLine, TypedLine } from './MapLines.vue';
import RecordDrawer from './RecordDrawer.vue';
import { changeLinks, offerUndo } from './undoable';
import { useViewFilter } from './useViewFilter';

const { t } = useI18n();

/** A handle on a card: the card and the side a link goes out of or into. / Ручка на карточке: карточка и сторона, откуда или куда идёт связь. */
interface Pin {
    node: string;
    side: Side;
}

// ───────────────────────────── the filter and the switches / фильтр и переключатели ─────────────────────────────

const { filter, root, rootId, areaOptions, typeOn, setType } = useViewFilter('map');

/** The first view of the project is set (the camera is saved only after that). / Первый вид проекта выставлен (камера сохраняется только после этого). */
const ready = ref(false);
const showDone = ref(true);
const treeLines = ref(true);
watch(
    () => state.projectId,
    (id) => {
        showDone.value = readFlag('map.done', id, true);
        treeLines.value = readFlag('map.tree', id, true);
        ready.value = false;
        void loadMap(id);
    },
    { immediate: true },
);
watch(showDone, (on) => writeFlag('map.done', state.projectId, on));
watch(treeLines, (on) => writeFlag('map.tree', state.projectId, on));

// ───────────────────────────── what is drawn and where / что рисуется и где ─────────────────────────────

const visible = computed(() => visibleIds(state.records, { types: filter.types, root: rootId.value, showDone: showDone.value }));
const shown = computed(() => state.records.filter((r) => visible.value.has(r.id)));
const parents = computed(() => drawnParents(state.records, visible.value));

// heights are measured in the DOM and fed to the layout; one pass per burst of changes (not one per card)
// высоты измеряются в DOM и идут в раскладку; один проход на всплеск изменений (а не по одному на карточку)
const heights = new Map<string, number>();
const measured = ref(0);
let frame = 0;
function onSize(id: string, height: number): void {
    if (Math.abs((heights.get(id) ?? -1) - height) < 0.5) return;
    heights.set(id, height);
    if (!frame) {
        // a timer, not an animation frame: a tab that is not shown has no frames, and the layout still has to catch up / таймер, а не кадр: у скрытой вкладки кадров нет, а раскладке всё равно нужно догнать
        frame = window.setTimeout(() => {
            frame = 0;
            measured.value += 1;
        }, 16);
    }
}

const items = computed<LayoutItem[]>(() => {
    void measured.value;
    return shown.value.map((r) => ({
        id: r.id,
        parent: parents.value.get(r.id) ?? null,
        order: r.order,
        w: cardWidth(r.type),
        h: heights.get(r.id) ?? estimateHeight(r.type, r.title),
    }));
});

const auto = computed(() => autoLayout(items.value));
/** The places while a drag is on (the file is written once, on the drop). / Места, пока идёт перенос (файл пишется один раз, при отпускании). */
const live = shallowRef<Record<string, MapPoint>>({});
const places = computed(() => mergePlaces(items.value, auto.value, { ...mapState.places, ...live.value }));
const rects = computed(() => {
    const map = new Map<string, Rect>();
    for (const item of items.value) {
        const at = places.value[item.id];
        if (at) map.set(item.id, { x: at.x, y: at.y, w: item.w, h: item.h });
    }
    return map;
});

/** The progress of every area (and any card that has children), as in the tree. / Прогресс каждого раздела (и любой карточки с детьми), как в дереве. */
const areaProgress = computed(() => {
    const map = new Map<string, { done: number; total: number; share: number; active: number }>();
    const walk = (nodes: readonly TreeNode[]): void => {
        for (const node of nodes) {
            if (node.children.length > 0) {
                const p = progressOf(node);
                map.set(node.record.id, { done: p.done, total: p.total, share: percent(p), active: shares(p).active });
            }
            walk(node.children);
        }
    };
    walk(tree.value);
    return map;
});

// ───────────────────────────── lines / линии ─────────────────────────────

const camera = reactive<Camera>({ x: 0, y: 0, z: 1 });
/** Its own computed: lines and labels change on a zoom, not on every step of a pan. / Свой computed: линии и подписи меняются при масштабе, а не на каждом шаге панорамы. */
const zoom = computed(() => camera.z);
const headSize = computed(() => Math.min(26, Math.max(9, 11 / zoom.value)));

const treeLineList = computed<TreeLine[]>(() => {
    if (!treeLines.value) return [];
    const out: TreeLine[] = [];
    const siblings = new Map<string, Rect[]>();
    for (const item of items.value) {
        const at = rects.value.get(item.id);
        if (item.parent && at) siblings.set(item.parent, [...(siblings.get(item.parent) ?? []), at]);
    }
    for (const item of items.value) {
        const a = item.parent ? rects.value.get(item.parent) : undefined;
        const b = rects.value.get(item.id);
        if (!a || !b || !item.parent) continue;
        out.push({ id: `${item.parent}>${item.id}`, d: treePath(a, b, siblings.get(item.parent) ?? [b]), dim: !isFound(item.id) || !isFound(item.parent) });
    }
    return out;
});

const linkId = (from: string, to: string, kind: LinkKind): string => `${from}|${to}|${kind}`;

const linkLineList = computed<TypedLine[]>(() => {
    const out: TypedLine[] = [];
    for (const record of shown.value) {
        for (const link of record.links) {
            const a = rects.value.get(record.id);
            const b = rects.value.get(link.to);
            if (!a || !b || link.to === record.id) continue;
            const { from, to } = joinSides(a, b);
            const line = curve(from, to, headSize.value);
            const label = t(`links.out.${link.kind}`);
            // the label goes on a free part of the line, not over a card (its size in world units follows the zoom) / подпись на свободной части линии, не над карточкой (её размер в мировых единицах следует за масштабом)
            const mid = labelSpot(line, rects.value.values(), (label.length * 7) / zoom.value, 16 / zoom.value);
            out.push({ id: linkId(record.id, link.to, link.kind), d: line.d, head: line.head, kind: link.kind, label, mid, dim: !isFound(record.id) || !isFound(link.to) });
        }
    }
    return out;
});

/**
 * The typed links for `TaoxLinks`: the line style tells the kind (depends solid, because dashed, relates dotted); a link the
 * search did not find fades (a colour with no weight in it).
 * Типизированные связи для `TaoxLinks`: вид читается по стилю линии («зависит» сплошная, «потому что» штрих, «связано» точки);
 * связь, которую поиск не нашёл, бледнеет (цвет почти без веса).
 */
const DASH = { depends: 'solid', because: 'dashed', relates: 'dotted' } as const;
const FADED = 'color-mix(in srgb, var(--tao-color-text-muted) 22%, transparent)';
const libraryLinks = computed<LinkLine[]>(() =>
    linkLineList.value.map((line) => ({ id: line.id, d: line.d, head: line.head, dash: DASH[line.kind], width: line.kind === 'relates' ? 2.2 : 1.6, ...(line.dim ? { color: FADED } : {}) })),
);

const selectedLink = ref<string | null>(null);
const selectedLine = computed(() => linkLineList.value.find((l) => l.id === selectedLink.value) ?? null);

// ───────────────────────────── selection / выбор ─────────────────────────────

const selection = ref<ReadonlySet<string>>(new Set());
const primary = ref<string | null>(null);

function setSelection(ids: Iterable<string>): void {
    const set = new Set(ids);
    selection.value = set;
    primary.value = set.size === 0 ? null : set.has(primary.value ?? '') ? primary.value : [...set].pop()!;
}

// a card that is filtered out or deleted leaves the selection / карточка, ушедшая под фильтр или удалённая, уходит из выбора
watch(visible, (ids) => {
    if ([...selection.value].some((id) => !ids.has(id))) setSelection([...selection.value].filter((id) => ids.has(id)));
    if (selectedLink.value && !linkLineList.value.some((l) => l.id === selectedLink.value)) selectedLink.value = null;
});

// ───────────────────────────── the camera / камера ─────────────────────────────

const viewport = ref({ w: 0, h: 0 });
let cameraTimer: ReturnType<typeof setTimeout> | null = null;

function setCamera(next: Camera): void {
    camera.x = next.x;
    camera.y = next.y;
    camera.z = next.z;
    if (!ready.value) return;
    if (cameraTimer) clearTimeout(cameraTimer);
    cameraTimer = setTimeout(() => saveCamera({ x: camera.x, y: camera.y, zoom: camera.z }), 500);
}

const LIMITS = { min: 0.1, max: 2 };
/** The smallest zoom the map opens at by itself. / Самый мелкий масштаб, с которого карта открывается сама. */
const READABLE = 0.5;

function fit(): void {
    setCamera(fitCamera(boundsOf([...rects.value.values()]), viewport.value, 48, { min: LIMITS.min, max: 1 }));
}

function zoomTo(factor: number | 'one'): void {
    const { w, h } = viewport.value;
    if (factor === 'one') setCamera(zoomAt(camera, w / 2, h / 2, 1 / camera.z, LIMITS));
    else setCamera(zoomAt(camera, w / 2, h / 2, factor, LIMITS));
}

// the first view of a project: the saved camera, or the whole map; after the cards were measured / первый вид проекта: сохранённая камера или вся карта; после измерения карточек
let starting = false;
async function start(): Promise<void> {
    if (starting || ready.value) return;
    starting = true;
    await nextTick();
    await new Promise<void>((done) => setTimeout(done, 80));
    const saved = mapState.camera;
    if (saved) {
        camera.x = saved.x;
        camera.y = saved.y;
        camera.z = saved.zoom;
    } else {
        // the whole map if it is readable; a tall map opens at a readable size from its top left ("Show all" fits it) / вся карта, если читается; высокая карта открывается читаемой, с левого верхнего угла («Показать всё» вписывает её)
        const at = boundsOf([...rects.value.values()]);
        const whole = fitCamera(at, viewport.value, 48, { min: LIMITS.min, max: 1 });
        if (at && whole.z < READABLE) setCamera({ z: READABLE, x: 48 - at.x * READABLE, y: 48 - at.y * READABLE });
        else setCamera(whole);
    }
    ready.value = true;
    starting = false;
}
watch(
    [() => mapState.loaded, () => viewport.value.w, ready],
    () => {
        if (mapState.loaded && mapState.project === state.projectId && viewport.value.w > 0 && !ready.value) void start();
    },
    { immediate: true },
);

const canvas = ref<{ root: HTMLElement | null } | null>(null);

/** Pans just enough to bring a card into view. / Сдвигает ровно настолько, чтобы карточка попала в кадр. */
function reveal(id: string): void {
    const r = rects.value.get(id);
    if (!r) return;
    const [x0, y0] = worldToScreen(camera, r.x, r.y);
    const [x1, y1] = worldToScreen(camera, r.x + r.w, r.y + r.h);
    const pad = 32;
    let dx = 0;
    let dy = 0;
    if (x0 < pad) dx = pad - x0;
    else if (x1 > viewport.value.w - pad) dx = viewport.value.w - pad - x1;
    if (y0 < pad) dy = pad - y0;
    else if (y1 > viewport.value.h - pad) dy = viewport.value.h - pad - y1;
    if (dx || dy) setCamera({ ...camera, x: camera.x + dx, y: camera.y + dy });
}

// ───────────────────────────── dragging cards / перенос карточек ─────────────────────────────

interface Drag {
    ids: string[];
    base: Record<string, MapPoint>;
    /** Saved places of the cards that are not drawn now but belong to the dragged branch. / Сохранённые места карточек, которых сейчас нет на экране, но они из переносимой ветки. */
    hidden: Record<string, MapPoint>;
    /** Descendants that stay where they are when an area is moved alone (Alt). / Потомки, остающиеся на месте, когда раздел переносят одного (Alt). */
    pinned: Record<string, MapPoint>;
    others: Rect[];
    primary: string;
    dx: number;
    dy: number;
    tx: number;
    ty: number;
}
let drag: Drag | null = null;
let alt = false;
const guides = ref<Guide[]>([]);

const trackAlt = (e: KeyboardEvent | PointerEvent): void => {
    alt = e.altKey;
};

function beginDrag(primaryId: string): void {
    const picked = selection.value.has(primaryId) ? [...selection.value] : [primaryId];
    const ids = new Set<string>();
    const pinned: Record<string, MapPoint> = {};
    for (const id of picked) {
        const record = recordById(id);
        if (record?.type === 'area' && !alt) for (const inner of branchOf(state.records, id)) ids.add(inner);
        else {
            ids.add(id);
            // moved alone: what is under it stays where it is (it would otherwise follow its parent) / переносят одного: то, что под ним, остаётся на месте (иначе оно поехало бы за родителем)
            if (record?.type === 'area') {
                for (const inner of branchOf(state.records, id)) {
                    const at = places.value[inner];
                    if (inner !== id && at && !mapState.places[inner] && !picked.includes(inner)) pinned[inner] = at;
                }
            }
        }
    }
    const base: Record<string, MapPoint> = {};
    const hidden: Record<string, MapPoint> = {};
    for (const id of ids) {
        const at = places.value[id];
        if (at && visible.value.has(id)) base[id] = at;
        else if (mapState.places[id]) hidden[id] = mapState.places[id]!;
    }
    const moving = new Set(Object.keys(base));
    const others: Rect[] = [];
    for (const [id, r] of rects.value) if (!moving.has(id)) others.push(r);
    drag = { ids: Object.keys(base), base, hidden, pinned, others, primary: primaryId, dx: 0, dy: 0, tx: 0, ty: 0 };
    holdMap(true);
}

function moveSelected(dx: number, dy: number, snap: boolean): void {
    if (!drag) return;
    drag.dx += dx;
    drag.dy += dy;
    let tx = drag.dx;
    let ty = drag.dy;
    guides.value = [];
    const first = drag.base[drag.primary];
    const size = rects.value.get(drag.primary);
    if (snap && first && size) {
        const g = snapToGuides({ x: first.x + tx, y: first.y + ty, w: size.w, h: size.h }, drag.others, 6 / camera.z);
        tx += g.dx;
        ty += g.dy;
        guides.value = g.lines;
    }
    drag.tx = tx;
    drag.ty = ty;
    live.value = { ...drag.pinned, ...shiftPlaces(drag.base, drag.ids, tx, ty) };
}

function endDrag(): void {
    const d = drag;
    drag = null;
    guides.value = [];
    if (d && (Math.abs(d.tx) > 0.5 || Math.abs(d.ty) > 0.5)) {
        placeCards({ ...d.pinned, ...shiftPlaces(d.base, d.ids, d.tx, d.ty), ...shiftPlaces(d.hidden, Object.keys(d.hidden), d.tx, d.ty) });
    }
    live.value = {};
    if (d) holdMap(false);
}

// ───────────────────────────── links: from a card's handle / связи: с ручки карточки ─────────────────────────────

interface Connect {
    origin: Pin;
    cursor: MapPoint;
    target: Pin | null;
}
const connect = shallowRef<Connect | null>(null);

const previewLine = computed(() => {
    const c = connect.value;
    const a = c ? rects.value.get(c.origin.node) : undefined;
    if (!c || !a) return null;
    const tr = c.target ? rects.value.get(c.target.node) : undefined;
    const end = c.target && tr && c.target.node !== c.origin.node ? pointOn(tr, c.target.side) : c.cursor;
    const line = curve(pointOn(a, c.origin.side), end, headSize.value);
    return { id: 'preview', d: line.d, head: line.head };
});

async function addLink(from: string, to: string, kind: LinkKind): Promise<void> {
    const record = recordById(from);
    const target = recordById(to);
    if (!record || !target || from === to || record.links.some((l) => l.to === to && l.kind === kind)) return;
    await changeLinks(record, [...record.links, { to, kind }], t('undo.linkAdded', [record.title, target.title, t(`links.out.${kind}`)]));
}

async function removeLink(id: string): Promise<void> {
    const [from, to, kind] = id.split('|');
    const record = from ? recordById(from) : undefined;
    if (!record) return;
    selectedLink.value = null;
    await changeLinks(
        record,
        record.links.filter((l) => !(l.to === to && l.kind === kind)),
        t('undo.linkRemoved', [record.title, (to && recordById(to)?.title) || '']),
    );
}

// ───────────────────────────── menus and the field for a new record / меню и поле новой записи ─────────────────────────────

interface MenuState {
    x: number;
    y: number;
    items: TaoMenuItem[];
    run: (id: string) => void;
}
const menu = ref<MenuState | null>(null);
/** The point the open menu hangs from (window coordinates). / Точка, от которой висит открытое меню (координаты окна). */
const menuAnchor = computed(() => ({ x: menu.value?.x ?? 0, y: menu.value?.y ?? 0 }));

interface Creating {
    x: number;
    y: number;
    world: MapPoint;
    parent: string | null;
    line: string;
}
const creating = ref<Creating | null>(null);
const field = ref<HTMLElement | null>(null);

async function startCreating(screen: MapPoint, world: MapPoint, parent: string | null): Promise<void> {
    menu.value = null;
    creating.value = { x: screen.x, y: screen.y, world, parent, line: '' };
    await nextTick();
    field.value?.querySelector('input')?.focus();
}

const parsed = computed(() => (creating.value ? parseQuick(creating.value.line, 'task') : null));

async function submitNew(): Promise<void> {
    const c = creating.value;
    const input = parsed.value;
    if (!c || !input) return;
    creating.value = null;
    try {
        const record = await addRecord({ type: input.type, title: input.title, parent: c.parent });
        // where it was dropped: a card made on the map stays where the person put it / где отпустили: карточка, созданная на карте, остаётся там, куда её поставили
        placeCards({ [record.id]: { x: c.world.x, y: c.world.y - 24 } });
        setSelection([record.id]);
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    }
}

const parentOfNew = computed(() => (creating.value?.parent ? recordById(creating.value.parent) : undefined));

function openMenu(screen: MapPoint, items: TaoMenuItem[], run: (id: string) => void): void {
    creating.value = null;
    // TaoMenu takes a point in window coordinates (TaoUI 5.49): the point of the canvas plus the place of the canvas / TaoMenu берёт точку в координатах окна (TaoUI 5.49): точка холста плюс место самого холста
    const at = canvas.value?.root?.getBoundingClientRect();
    menu.value = { x: screen.x + (at?.left ?? 0), y: screen.y + (at?.top ?? 0), items, run };
}

function putBack(id: string): void {
    const before = mapState.places[id];
    if (!before) return;
    placeCards({ [id]: null });
    offerUndo(t('undo.putBack', [recordById(id)?.title ?? '']), async () => placeCards({ [id]: before }));
}

// ───────────────────────────── the host of the canvas / хозяин холста ─────────────────────────────

const toScreen = (world: MapPoint): MapPoint => {
    const [x, y] = worldToScreen(camera, world.x, world.y);
    return { x, y };
};

const host: CanvasHost<Pin> = {
    get camera() {
        return camera;
    },
    setCamera,
    setViewport: (size) => {
        viewport.value = size;
    },

    get selection() {
        return selection.value;
    },
    setSelection,
    toggleSelected: (id) => {
        const next = new Set(selection.value);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        primary.value = next.has(id) ? id : null;
        setSelection(next);
    },
    selectConnection: (id) => {
        // only the typed links can be picked; a line that is not one (nothing is, today) is ignored / выбираются только типизированные связи
        selectedLink.value = id !== null && linkLineList.value.some((l) => l.id === id) ? id : null;
    },

    beginDrag,
    moveSelected,
    endDrag,

    // moving a card is not a change of the project: there is no history here, and the keys that would delete a card delete only a link
    // перенос карточки не правка проекта: истории тут нет, а клавиша, что удалила бы карточку, удаляет только связь
    commit: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    removeSelected: () => {
        if (selectedLink.value) void removeLink(selectedLink.value);
    },

    get paletteOpen() {
        return false;
    },
    // a link released over an empty place: a new record there, a child of the card the link came from / связь отпустили над пустым местом: новая запись там, ребёнок карточки, откуда тянули
    openPalette: (screen, world, origin) => void startCreating({ x: screen[0], y: screen[1] }, { x: world[0], y: world[1] }, origin?.node ?? null),
    closePalette: () => {
        creating.value = null;
        menu.value = null;
    },

    connect: {
        get origin() {
            return connect.value?.origin ?? null;
        },
        start: (pin, cursor) => {
            connect.value = { origin: pin, cursor: { x: cursor[0], y: cursor[1] }, target: null };
        },
        update: (cursor, target) => {
            if (connect.value) connect.value = { ...connect.value, cursor: { x: cursor[0], y: cursor[1] }, target };
        },
        finish: (target) => {
            const c = connect.value;
            connect.value = null;
            if (!c || !target || target.node === c.origin.node) return false;
            const at = toScreen(c.cursor);
            openMenu(at, LINK_KINDS.map((kind) => ({ id: kind, label: t(`links.out.${kind}`), icon: 'link' })), (kind) => void addLink(c.origin.node, target.node, kind as LinkKind));
            return true;
        },
        cancel: () => {
            connect.value = null;
        },
    },

    activate: (target) => {
        if (target.kind === 'handle') select(target.nodeId);
    },
    contextMenu: (screen, world, target) => {
        const at = { x: screen[0], y: screen[1] };
        if (target.kind === 'node') {
            const id = target.nodeId;
            if (!selection.value.has(id)) setSelection([id]);
            openMenu(
                at,
                [
                    { id: 'open', label: t('map.open'), icon: 'tao-edit' },
                    { id: 'back', label: t('map.putBack'), icon: 'tao-repeat', disabled: !mapState.places[id] },
                ],
                (action) => (action === 'open' ? select(id) : putBack(id)),
            );
        } else if (target.kind === 'link') {
            selectedLink.value = target.id;
            openMenu(at, [{ id: 'remove', label: t('map.removeLink'), icon: 'tao-trash' }], () => void removeLink(target.id));
        } else {
            openMenu(
                at,
                [
                    { id: 'new', label: t('map.newHere'), icon: 'tao-plus' },
                    { id: 'fit', label: t('map.fit'), icon: 'fit' },
                ],
                (action) => (action === 'new' ? void startCreating(at, { x: world[0], y: world[1] }, null) : fit()),
            );
        }
        return true;
    },

    // alignment guides against the other cards; Alt turns them off for a moment (it also moves an area alone) / направляющие по другим карточкам; Alt на время их отключает (и переносит раздел одного)
    snapEnabled: true,
};

/** The handle under the pointer; over a card's body the side it is nearest to. / Ручка под указателем; над телом карточки сторона, к которой указатель ближе. */
function pinAt(target: EventTarget | null): Pin | null {
    const pin = (target as Element | null)?.closest<HTMLElement>('[data-pin]');
    const node = pin?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    return pin && node ? { node, side: pin.dataset.pin as Side } : null;
}

function pinNear(e: { clientX: number; clientY: number }): Pin | null {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const pin = pinAt(under);
    if (pin) return pin;
    const el = under?.closest<HTMLElement>('[data-node-id]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { node: el.dataset.nodeId!, side: sideNear({ x: r.left, y: r.top, w: r.width, h: r.height }, { x: e.clientX, y: e.clientY }) };
}

// `keys: 'focus'`: the canvas takes Delete, Escape and the rest only from a press inside it, so the record pane and the dialogs beside it keep their keys / `keys: 'focus'`: холст берёт Delete, Escape и остальное только из нажатия внутри себя, так что панель записи и диалоги рядом сохраняют свои клавиши
const options: CanvasOptions<Pin> = { pinAt, pinNear, zoom: LIMITS, inertia: true, keys: 'focus' };

// ───────────────────────────── double click, keys / двойной клик, клавиши ─────────────────────────────

/** A double click on an empty place: a new top-level record there. / Двойной клик по пустому месту: новая запись верхнего уровня там. */
function onDouble(event: MouseEvent): void {
    const el = canvas.value?.root;
    // the point, not `event.target`: the canvas holds the pointer capture, so the target is always the canvas (see `hit.ts`) / точка, а не `event.target`: холст держит захват, и цель всегда он сам
    if (!el || !emptyPlaceAt(el, event.clientX, event.clientY)) return;
    const rect = el.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const [wx, wy] = screenToWorld(camera, sx, sy);
    void startCreating({ x: sx, y: sy }, { x: wx, y: wy }, null);
}

function focusCard(id: string): void {
    const el = canvas.value?.root?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    el?.focus({ preventScroll: true });
    const root = canvas.value?.root;
    if (root) {
        root.scrollLeft = 0;
        root.scrollTop = 0;
    }
}

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function onKeydown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target as HTMLElement | null)?.isContentEditable) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const dir = ARROWS[event.key];
    const focused = (event.target as Element | null)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null;
    if (dir) {
        event.preventDefault();
        const cards = [...rects.value].map(([id, r]) => ({ id, ...r }));
        const from = focused ?? primary.value;
        let to: string | null;
        if (from) to = neighbour(cards, from, dir);
        else to = [...cards].sort((a, b) => a.y - b.y || a.x - b.x)[0]?.id ?? null;
        if (to) {
            setSelection([to]);
            selectedLink.value = null;
            reveal(to);
            void nextTick(() => focusCard(to));
        }
    } else if (event.key === 'Enter') {
        const id = focused ?? primary.value;
        if (id) {
            event.preventDefault();
            select(id);
        }
    } else if (event.key === 'Escape') {
        setSelection([]);
        selectedLink.value = null;
    } else if (event.key === '+' || event.key === '=') zoomTo(1.25);
    else if (event.key === '-' || event.key === '_') zoomTo(1 / 1.25);
    else if (event.key === '1') zoomTo('one');
    else if (event.key === '0') fit();
}

// ───────────────────────────── tidy up / расставить заново ─────────────────────────────

async function tidy(): Promise<void> {
    if (Object.keys(mapState.places).length === 0) {
        fit();
        return;
    }
    const ok = await confirm().title(t('map.tidyTitle')).message(t('map.tidyText')).ok(t('map.tidyOk'));
    if (!ok) return;
    const before = { ...mapState.places };
    placeCards(Object.fromEntries(Object.keys(before).map((id) => [id, null])));
    offerUndo(t('undo.tidied'), async () => placeCards(before));
    await nextTick();
    fit();
}

// Enter in the search field: bring the found cards into view (nothing moves, only the camera) / Enter в поле поиска: показать найденные карточки (ничего не двигается, только камера)
watch(
    () => search.enter,
    () => {
        const ids = found.value;
        if (!ids || !ready.value) return;
        const at = boundsOf([...rects.value].filter(([id]) => ids.has(id)).map(([, r]) => r));
        if (at) setCamera(fitCamera(at, viewport.value, 64, { min: LIMITS.min, max: 1 }));
    },
);

// ───────────────────────────── life / жизнь ─────────────────────────────

onMounted(() => {
    window.addEventListener('keydown', trackAlt);
    window.addEventListener('keyup', trackAlt);
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', trackAlt);
    window.removeEventListener('keyup', trackAlt);
    if (cameraTimer) {
        clearTimeout(cameraTimer);
        if (ready.value) saveCamera({ x: camera.x, y: camera.y, zoom: camera.z });
    }
    if (frame) clearTimeout(frame);
    void flushMap();
});
</script>

<template>
    <section class="map-pane" :aria-label="t('map.label')">
        <FilterBar v-model:root="root" :type-on="typeOn" :area-options="areaOptions" compact @type="setType">
            <TaoButton v-model:pressed="showDone" variant="ghost" tone="neutral" icon="tao-check-circle" :aria-label="t('map.showDone')" :title="t('map.showDone')" />
            <TaoButton v-model:pressed="treeLines" variant="ghost" tone="neutral" icon="tree" :aria-label="t('map.treeLines')" :title="t('map.treeLines')" />
            <TaoButton variant="ghost" tone="neutral" icon="tidy" :aria-label="t('map.tidy')" :title="t('map.tidy')" @click="tidy" />
        </FilterBar>

        <div class="map-pane__stage" @keydown="onKeydown" @pointerdown.capture="trackAlt" @dblclick="onDouble">
            <TaoxCanvas ref="canvas" :host="host" :options="options" background="dots" role="application" :aria-label="t('map.canvas')">
                <MapLines :tree="treeLineList" :labels="linkLineList" :selected-id="selectedLink" :guides="guides" :zoom="zoom" />
                <TaoxLinks :lines="libraryLinks" :selected-id="selectedLink" :preview="previewLine" />

                <MapCard
                    v-for="record in shown"
                    :key="record.id"
                    :record="record"
                    :x="places[record.id]?.x ?? 0"
                    :y="places[record.id]?.y ?? 0"
                    :w="cardWidth(record.type)"
                    :selected="selection.has(record.id)"
                    :draft="hasDraft(record.id)"
                    :dim="!isFound(record.id)"
                    :progress="areaProgress.get(record.id) ?? null"
                    @size="onSize"
                />

                <!-- the button of the selected link sits in the world on its middle, drawn at the size of the screen / кнопка выбранной связи стоит в мире на её середине, размером с экран -->
                <div v-if="selectedLine" class="map-pane__remove map__ui" :style="{ transform: `translate(${selectedLine.mid.x}px, ${selectedLine.mid.y}px) scale(${1 / zoom}) translate(-50%, -50%)` }" @pointerdown.stop>
                    <TaoButton size="small" variant="secondary" tone="danger" icon="tao-trash" :aria-label="t('map.removeLink')" :title="t('map.removeLink')" @click="removeLink(selectedLine.id)" />
                </div>

                <template #overlay>
                    <TaoEmpty v-if="shown.length === 0" class="map-pane__empty" :title="t('map.empty')">{{ t('map.emptyText') }}</TaoEmpty>

                    <div class="map-pane__zoom map__ui" @pointerdown.stop @dblclick.stop>
                        <TaoButton variant="ghost" tone="neutral" size="small" icon="tao-minus" :aria-label="t('map.zoomOut')" :title="t('map.zoomOut')" @click="zoomTo(1 / 1.25)" />
                        <TaoButton variant="ghost" tone="neutral" size="small" :aria-label="t('map.zoom100')" :title="t('map.zoom100')" @click="zoomTo('one')">{{ Math.round(zoom * 100) }}%</TaoButton>
                        <TaoButton variant="ghost" tone="neutral" size="small" icon="tao-plus" :aria-label="t('map.zoomIn')" :title="t('map.zoomIn')" @click="zoomTo(1.25)" />
                        <TaoButton variant="ghost" tone="neutral" size="small" icon="fit" :aria-label="t('map.fit')" :title="t('map.fit')" @click="fit()" />
                    </div>

                    <form v-if="creating" ref="field" class="map-pane__new map__ui" :style="{ left: `${creating.x}px`, top: `${creating.y}px` }" @submit.prevent="submitNew" @keydown.esc.stop.prevent="creating = null" @pointerdown.stop @dblclick.stop>
                        <TaoInput v-model="creating.line" size="small" :placeholder="t('map.newPlaceholder')" :aria-label="t('map.newHere')" autocomplete="off" />
                        <p class="map-pane__hint">
                            <template v-if="parsed">
                                <strong>{{ t(`type.${parsed.type}`) }}</strong> · {{ parentOfNew ? t('map.newChildOf', [parentOfNew.title]) : t('map.newTop') }}
                            </template>
                            <template v-else>{{ parentOfNew ? t('map.newChildOf', [parentOfNew.title]) : t('map.newTop') }}</template>
                        </p>
                    </form>

                    <!-- always there, opened by `open`: a menu made already open is never placed / всегда на месте, открывается через `open`: меню, созданное сразу открытым, не получает места -->
                    <TaoMenu :items="menu?.items ?? []" :open="menu !== null" :anchor="menuAnchor" :label="t('map.label')" @select="(id: string) => menu?.run(id)" @close="menu = null" />
                </template>
            </TaoxCanvas>
        </div>

        <RecordDrawer />
    </section>
</template>

<style scoped>
.map-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.map-pane__stage {
    position: relative;
    flex: 1;
    min-height: 0;
}

/* the canvas takes the colours of the page: the grid is the quiet dots of the theme / холст берёт цвета страницы: сетка это тихие точки темы */
.map-pane__stage :deep(.tx-canvas) {
    --tx-canvas-bg: var(--tao-color-bg);
    /* half as strong as the theme's dots: enough to feel the canvas move while panning, not to flicker in the eyes / вдвое слабее точек темы: чтобы чувствовать движение холста при панораме, но не мельтешить в глазах */
    --tx-canvas-dot: color-mix(in srgb, var(--tao-color-text) 5%, transparent);
}

.map-pane__empty {
    position: absolute;
    inset: 0;
    margin: auto;
    height: fit-content;
    pointer-events: none;
}

.map-pane__zoom {
    position: absolute;
    right: var(--tao-space-3);
    bottom: var(--tao-space-3);
    display: flex;
    gap: var(--tao-space-1);
    padding: var(--tao-space-1);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-panel);
    background: var(--tao-color-surface-raised);
}

.map-pane__remove {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
}

.map-pane__new {
    position: absolute;
    z-index: 3;
    width: 260px;
    max-width: calc(100% - 16px);
    padding: var(--tao-space-2);
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-panel);
    background: var(--tao-color-surface-raised);
    box-shadow: var(--tao-shadow-overlay);
}

.map-pane__hint {
    margin: var(--tao-space-1) 0 0;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.map-pane__hint strong {
    color: var(--tao-color-text);
    font-weight: 600;
}
</style>
