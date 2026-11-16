/**
 * The map: records as cards on a plane. The only thing the map owns is where a card sits (and the camera); everything
 * else on it is a record, a tree relation or a typed link that already exists. This file is the pure part: the file
 * format of `map.json`, the automatic layout, the merge of saved and automatic places, moving a branch, which sides a
 * line leaves from, the keyboard neighbour. No DOM, no Vue, no Node.
 *
 * Карта: записи карточками на плоскости. Карте принадлежит только место карточки (и камера); всё остальное на ней
 * это запись, связь дерева или типизированная связь, которые уже есть. Здесь чистая часть: формат файла `map.json`,
 * автоматическая раскладка, слияние сохранённых мест с автоматическими, перенос ветки, с каких сторон выходит линия,
 * сосед по клавише. Без DOM, без Vue, без Node.
 */
import { hasStatus, isClosed } from './model.ts';
import type { AxisRecord, RecordType } from './model.ts';

// ───────────────────────────── the file / файл ─────────────────────────────

export interface MapPoint {
    x: number;
    y: number;
}

export interface MapCamera {
    x: number;
    y: number;
    zoom: number;
}

/** `<data>/<project>/map.json`. Not in the record files and not in the journal: moving a card is not a change of the project. / Не в файлах записей и не в журнале: перенос карточки не правка проекта. */
export interface MapData {
    v: 1;
    positions: Record<string, MapPoint>;
    camera?: MapCamera;
}

/** A partial change: `null` removes a position or the camera. / Частичная правка: `null` убирает место или камеру. */
export interface MapPatch {
    positions?: Record<string, MapPoint | null>;
    camera?: MapCamera | null;
}

const LIMIT = 1_000_000;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMIT;

export function isPoint(value: unknown): value is MapPoint {
    return typeof value === 'object' && value !== null && finite((value as MapPoint).x) && finite((value as MapPoint).y);
}

export function isCamera(value: unknown): value is MapCamera {
    const c = value as MapCamera | null;
    return typeof c === 'object' && c !== null && finite(c.x) && finite(c.y) && finite(c.zoom) && c.zoom >= ZOOM_MIN && c.zoom <= ZOOM_MAX;
}

const round = (n: number): number => Math.round(n * 10) / 10;

export const emptyMap = (): MapData => ({ v: 1, positions: {} });

/**
 * What a file (or a request) said, made valid. With `known` the places of records that are gone are dropped.
 * Что сказал файл (или запрос), приведённое к верному. С `known` места исчезнувших записей отбрасываются.
 */
export function normalizeMap(raw: unknown, known?: ReadonlySet<string>): MapData {
    const out = emptyMap();
    if (typeof raw !== 'object' || raw === null) return out;
    const data = raw as { positions?: unknown; camera?: unknown };
    if (typeof data.positions === 'object' && data.positions !== null && !Array.isArray(data.positions)) {
        for (const [id, point] of Object.entries(data.positions)) {
            if (known && !known.has(id)) continue;
            if (isPoint(point)) out.positions[id] = { x: round(point.x), y: round(point.y) };
        }
    }
    if (isCamera(data.camera)) out.camera = { x: round(data.camera.x), y: round(data.camera.y), zoom: Math.round(data.camera.zoom * 1000) / 1000 };
    return out;
}

/** Applies a partial change to the map; the input is not modified. / Применяет частичную правку; вход не меняется. */
export function patchMap(map: MapData, patch: MapPatch): MapData {
    const out: MapData = { v: 1, positions: { ...map.positions } };
    if (map.camera) out.camera = map.camera;
    for (const [id, point] of Object.entries(patch.positions ?? {})) {
        if (point === null) delete out.positions[id];
        else if (isPoint(point)) out.positions[id] = { x: round(point.x), y: round(point.y) };
    }
    if (patch.camera === null) delete out.camera;
    else if (isCamera(patch.camera)) out.camera = { x: round(patch.camera.x), y: round(patch.camera.y), zoom: Math.round(patch.camera.zoom * 1000) / 1000 };
    return out;
}

// ───────────────────────────── cards / карточки ─────────────────────────────

export const CARD_W = 224;
export const AREA_W = 288;
const GAP_X = 72;
const GAP_Y = 18;
const GAP_ROOT = 64;

export const cardWidth = (type: RecordType): number => (type === 'area' ? AREA_W : CARD_W);

/**
 * A height before the card is measured in the DOM (and for the cards a filter keeps out of the DOM): a title of up to
 * three lines under the head of the card. The measured height replaces it.
 * Высота, пока карточка не измерена в DOM (и для карточек, которые фильтр не пускает в DOM): заголовок до трёх строк под
 * шапкой карточки. Измеренная высота её заменяет.
 */
export function estimateHeight(type: RecordType, title: string): number {
    if (type === 'area') return 64;
    const lines = Math.min(3, Math.max(1, Math.ceil(title.length / 24)));
    return 40 + lines * 18;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
    if (rects.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.w);
        y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ───────────────────────────── what is drawn / что рисуется ─────────────────────────────

export interface MapFilter {
    types: readonly RecordType[];
    root?: string | null | undefined;
    showDone: boolean;
}

/**
 * Ids of the records the map draws. Areas and notes are always cards (they are the structure); the other types go by
 * the filter; a finished record only with `showDone`; with a `root` only that area and what is under it.
 * Id записей, которые рисует карта. Разделы и заметки всегда карточки (это структура); остальные типы по фильтру;
 * законченная запись только с `showDone`; с `root` только этот раздел и всё под ним.
 */
export function visibleIds(records: readonly AxisRecord[], filter: MapFilter): Set<string> {
    const byId = new Map(records.map((r) => [r.id, r]));
    const inside = (record: AxisRecord): boolean => {
        if (!filter.root) return true;
        const seen = new Set<string>();
        for (let at: AxisRecord | undefined = record; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
            if (at.id === filter.root) return true;
            seen.add(at.id);
        }
        return false;
    };
    const out = new Set<string>();
    for (const record of records) {
        if (hasStatus(record.type)) {
            if (!filter.types.includes(record.type)) continue;
            if (!filter.showDone && isClosed(record.status)) continue;
        }
        if (inside(record)) out.add(record.id);
    }
    return out;
}

/** The nearest ancestor that is drawn, or null: where a card hangs when its own parent is filtered out. / Ближайший нарисованный предок или null: куда вешается карточка, если её родитель отфильтрован. */
export function drawnParents(records: readonly AxisRecord[], visible: ReadonlySet<string>): Map<string, string | null> {
    const byId = new Map(records.map((r) => [r.id, r]));
    const out = new Map<string, string | null>();
    for (const id of visible) {
        let up: string | null = null;
        const seen = new Set<string>([id]);
        for (let at = byId.get(id)?.parent ?? null; at && !seen.has(at); at = byId.get(at)?.parent ?? null) {
            seen.add(at);
            if (visible.has(at)) {
                up = at;
                break;
            }
        }
        out.set(id, up);
    }
    return out;
}

// ───────────────────────────── the automatic layout / автоматическая раскладка ─────────────────────────────

export interface LayoutItem {
    id: string;
    parent: string | null;
    /** Place among the siblings. / Место среди соседей. */
    order: number;
    w: number;
    h: number;
}

/** A parent with more children than this wraps them into several columns. / Родитель с большим числом детей раскладывает их в несколько столбцов. */
export const WRAP_AFTER = 8;
/** At most this many top-level blocks in a row. / Не больше стольких блоков верхнего уровня в ряду. */
const ROW_MAX = 5;
/** The shape the layout aims at: width / height of everything. / Форма, к которой стремится раскладка: ширина / высота всего. */
const ASPECT = 1.6;

/**
 * An automatic layout in blocks. A block is a record with its whole subtree: the children of a card stand in a column
 * to the right of it, the card centred on them; a parent with more than `WRAP_AFTER` children gets several columns side
 * by side (top to bottom, then left to right), each column as wide as its widest subtree. The top-level blocks stand in
 * a row, top-aligned with a gap, and the row wraps into more rows when that brings the whole picture nearer to 16:10
 * (never more than five blocks in a row). Nothing overlaps; deterministic: the same input gives the same places.
 * An item whose parent is not in the list is a top-level one.
 *
 * Автоматическая раскладка блоками. Блок это запись со всем её поддеревом: дети карточки стоят столбцом справа, она по их
 * центру; у родителя, у которого детей больше `WRAP_AFTER`, несколько столбцов рядом (сверху вниз, потом слева направо),
 * каждый шириной в самое широкое поддерево. Блоки верхнего уровня стоят рядом в ряд, по верхнему краю, с зазором, и ряд
 * переносится на новые, если так вся картина ближе к 16:10 (не больше пяти блоков в ряду). Ничего не перекрывается;
 * детерминирована: тот же вход даёт те же места. Элемент, чьего родителя нет в списке, верхнего уровня.
 */
export function autoLayout(items: readonly LayoutItem[]): Record<string, MapPoint> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const kids = new Map<string | null, LayoutItem[]>();
    for (const item of items) {
        const key = item.parent && byId.has(item.parent) && item.parent !== item.id ? item.parent : null;
        const list = kids.get(key) ?? [];
        list.push(item);
        kids.set(key, list);
    }
    const byOrder = (a: LayoutItem, b: LayoutItem): number => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const list of kids.values()) list.sort(byOrder);

    interface Block {
        w: number;
        h: number;
        cols: LayoutItem[][];
        colW: number[];
        childrenH: number;
    }
    const blocks = new Map<string, Block>();
    const busy = new Set<string>();

    const measure = (item: LayoutItem): Block => {
        const cached = blocks.get(item.id);
        if (cached) return cached;
        if (busy.has(item.id)) return { w: item.w, h: item.h, cols: [], colW: [], childrenH: 0 }; // a cycle ends here / цикл заканчивается здесь
        busy.add(item.id);
        const list = (kids.get(item.id) ?? []).filter((k) => k.id !== item.id && !busy.has(k.id));
        const count = Math.max(1, Math.ceil(list.length / WRAP_AFTER));
        const per = Math.ceil(list.length / count);
        const cols: LayoutItem[][] = [];
        for (let c = 0; c < count; c++) if (list.length > c * per) cols.push(list.slice(c * per, (c + 1) * per));
        const colW = cols.map((col) => Math.max(...col.map((k) => measure(k).w)));
        const colH = cols.map((col) => col.reduce((sum, k, i) => sum + measure(k).h + (i > 0 ? GAP_Y : 0), 0));
        const childrenH = Math.max(0, ...colH);
        const childrenW = colW.reduce((sum, w, i) => sum + w + (i > 0 ? GAP_X : 0), 0);
        const block = { w: item.w + (cols.length > 0 ? GAP_X + childrenW : 0), h: Math.max(item.h, childrenH), cols, colW, childrenH };
        busy.delete(item.id);
        blocks.set(item.id, block);
        return block;
    };

    const out: Record<string, MapPoint> = {};
    const placed = new Set<string>();
    const place = (item: LayoutItem, x: number, top: number): void => {
        if (placed.has(item.id)) return;
        placed.add(item.id);
        const block = measure(item);
        out[item.id] = { x, y: top + (block.h - item.h) / 2 };
        let colX = x + item.w + GAP_X;
        const y0 = top + (block.h - block.childrenH) / 2;
        block.cols.forEach((col, c) => {
            let y = y0;
            for (const child of col) {
                if (placed.has(child.id)) continue;
                place(child, colX, y);
                y += measure(child).h + GAP_Y;
            }
            colX += (block.colW[c] ?? 0) + GAP_X;
        });
    };

    // the top-level blocks; what a cycle cut off from every one of them is a block of its own / блоки верхнего уровня; то, что цикл отрезал от всех, отдельный блок
    const roots = [...(kids.get(null) ?? [])];
    const reach = new Set<string>();
    const walk = (item: LayoutItem): void => {
        if (reach.has(item.id)) return;
        reach.add(item.id);
        for (const k of kids.get(item.id) ?? []) walk(k);
    };
    roots.forEach(walk);
    for (const item of [...items].sort(byOrder)) {
        if (!reach.has(item.id)) {
            roots.push(item);
            walk(item);
        }
    }

    // the rows: the split whose whole picture is nearest to the aim / ряды: то разбиение, где вся картина ближе всего к цели
    const sized = roots.map((item) => ({ item, block: measure(item) }));
    const total = sized.reduce((sum, b) => sum + b.block.w + GAP_ROOT, 0);
    let best: (typeof sized)[] | null = null;
    let bestScore = Infinity;
    for (let rows = Math.ceil(sized.length / ROW_MAX); rows <= Math.max(1, sized.length); rows++) {
        const target = total / rows;
        const split: (typeof sized)[] = [];
        let row: typeof sized = [];
        let width = 0;
        for (const b of sized) {
            row.push(b);
            width += b.block.w + GAP_ROOT;
            if (width >= target || row.length >= ROW_MAX) {
                split.push(row);
                row = [];
                width = 0;
            }
        }
        if (row.length > 0) split.push(row);
        const w = Math.max(...split.map((r) => r.reduce((sum, b, i) => sum + b.block.w + (i > 0 ? GAP_ROOT : 0), 0)));
        const h = split.reduce((sum, r, i) => sum + Math.max(...r.map((b) => b.block.h)) + (i > 0 ? GAP_ROOT : 0), 0);
        const score = Math.abs(Math.log(w / Math.max(1, h) / ASPECT));
        if (score < bestScore - 1e-9) {
            bestScore = score;
            best = split;
        }
    }
    let top = 0;
    for (const row of best ?? []) {
        let x = 0;
        for (const b of row) {
            place(b.item, x, top);
            x += b.block.w + GAP_ROOT;
        }
        top += Math.max(...row.map((b) => b.block.h)) + GAP_ROOT;
    }
    return out;
}

/**
 * The place of every card: a saved one wins; a card without one takes its automatic place shifted by how far its parent
 * was moved from its own automatic place. So a new child lands beside its parent wherever the parent was put, and a
 * branch moved as a whole keeps its shape, while cards the person placed never move by themselves.
 *
 * Место каждой карточки: сохранённое побеждает; карточка без него берёт своё автоматическое, сдвинутое на то, насколько
 * её родитель ушёл от своего автоматического. Так новый ребёнок встаёт рядом с родителем, куда бы тот ни был поставлен,
 * а ветка, перенесённая целиком, не теряет формы; карточки, поставленные человеком, сами не двигаются.
 */
export function mergePlaces(
    items: readonly LayoutItem[],
    auto: Readonly<Record<string, MapPoint>>,
    saved: Readonly<Record<string, MapPoint>>,
): Record<string, MapPoint> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const out: Record<string, MapPoint> = {};
    const busy = new Set<string>();
    const resolve = (id: string): MapPoint => {
        const done = out[id];
        if (done) return done;
        const own = saved[id];
        const base = auto[id] ?? { x: 0, y: 0 };
        if (own) return (out[id] = own);
        const parent = byId.get(id)?.parent;
        if (!parent || !byId.has(parent) || busy.has(id)) return (out[id] = base);
        busy.add(id);
        const at = resolve(parent);
        busy.delete(id);
        const was = auto[parent] ?? at;
        return (out[id] = { x: base.x + (at.x - was.x), y: base.y + (at.y - was.y) });
    };
    for (const item of items) resolve(item.id);
    return out;
}

/** The record and everything under it, drawn or not. / Запись и всё под ней, нарисовано или нет. */
export function branchOf(records: readonly AxisRecord[], id: string): string[] {
    const kids = new Map<string, string[]>();
    for (const r of records) if (r.parent) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r.id]);
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (at: string): void => {
        if (seen.has(at)) return;
        seen.add(at);
        out.push(at);
        for (const child of kids.get(at) ?? []) walk(child);
    };
    walk(id);
    return out;
}

/** The places of `ids` shifted by (dx, dy), starting from `from`. / Места `ids`, сдвинутые на (dx, dy), от `from`. */
export function shiftPlaces(from: Readonly<Record<string, MapPoint>>, ids: Iterable<string>, dx: number, dy: number): Record<string, MapPoint> {
    const out: Record<string, MapPoint> = {};
    for (const id of ids) {
        const at = from[id];
        if (at) out[id] = { x: at.x + dx, y: at.y + dy };
    }
    return out;
}

// ───────────────────────────── lines / линии ─────────────────────────────

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Anchor extends MapPoint {
    side: Side;
}

const MARGIN = 12;

const middle = (r: Rect, side: Side): MapPoint =>
    side === 'left' ? { x: r.x, y: r.y + r.h / 2 } : side === 'right' ? { x: r.x + r.w, y: r.y + r.h / 2 } : side === 'top' ? { x: r.x + r.w / 2, y: r.y } : { x: r.x + r.w / 2, y: r.y + r.h };

export const pointOn = (r: Rect, side: Side): Anchor => ({ ...middle(r, side), side });

/**
 * The sides two cards are joined by: the nearest pair facing each other (left to right when `b` lies to the right of `a`,
 * and so on). Cards of one column (they overlap in x by most of their width) are joined by their right sides, so the line
 * bulges out beside the column instead of running behind the cards between them; cards that overlap in x a little are
 * joined bottom to top.
 * Стороны, которыми соединены две карточки: ближайшая пара, обращённая друг к другу (слева направо, если `b` правее `a`,
 * и так далее). Карточки одного столбца (перекрываются по x на большую часть ширины) соединяются правыми сторонами: линия
 * выгибается рядом со столбцом, а не идёт за карточками между ними; карточки, чуть перекрывающиеся по x, соединяются низом и верхом.
 */
export function joinSides(a: Rect, b: Rect): { from: Anchor; to: Anchor } {
    let sa: Side;
    let sb: Side;
    if (a.x + a.w + MARGIN <= b.x) [sa, sb] = ['right', 'left'];
    else if (b.x + b.w + MARGIN <= a.x) [sa, sb] = ['left', 'right'];
    else if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > Math.min(a.w, b.w) * 0.6) [sa, sb] = ['right', 'right'];
    else if (a.y + a.h / 2 <= b.y + b.h / 2) [sa, sb] = ['bottom', 'top'];
    else [sa, sb] = ['top', 'bottom'];
    return { from: pointOn(a, sa), to: pointOn(b, sb) };
}

/** The side of a rectangle nearest to a point (the diagonals divide it): where a link released over a card's body lands. / Сторона прямоугольника, ближайшая к точке (делят диагонали): куда ляжет связь, отпущенная над телом карточки. */
export function sideNear(r: Rect, p: MapPoint): Side {
    const dx = (p.x - (r.x + r.w / 2)) / r.w;
    const dy = (p.y - (r.y + r.h / 2)) / r.h;
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
}

const OUT: Record<Side, readonly [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export interface Curve {
    /** An SVG path. / Путь SVG. */
    d: string;
    /** A filled arrowhead at the end, or an empty string. / Залитый наконечник в конце или пустая строка. */
    head: string;
    /** The middle of the line: where a label sits. / Середина линии: там стоит подпись. */
    mid: MapPoint;
}

const n1 = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * A smooth line from an anchor to an anchor (or a free point), with an arrowhead of `head` units at the end.
 * Плавная линия от якоря к якорю (или к свободной точке), с наконечником в `head` единиц на конце.
 */
export function curve(a: Anchor, b: Anchor | MapPoint, head = 0): Curve {
    const bSide = 'side' in b ? b.side : null;
    const reach = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
    const oa = OUT[a.side];
    const ob = bSide ? OUT[bSide] : ([-oa[0], -oa[1]] as const);
    // the end is trimmed so the line stops at the base of the arrowhead / конец подрезан: линия кончается у основания наконечника
    const tip = { x: b.x, y: b.y };
    const into = [-ob[0], -ob[1]] as const; // the direction the line arrives in / направление, в котором линия приходит
    const end = head > 0 ? { x: tip.x - into[0] * head * 0.8, y: tip.y - into[1] * head * 0.8 } : tip;
    const c1 = { x: a.x + oa[0] * reach, y: a.y + oa[1] * reach };
    const c2 = { x: end.x + ob[0] * reach, y: end.y + ob[1] * reach };
    const d = `M${n1(a.x)} ${n1(a.y)}C${n1(c1.x)} ${n1(c1.y)} ${n1(c2.x)} ${n1(c2.y)} ${n1(end.x)} ${n1(end.y)}`;
    const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + end.y) / 8 };
    let arrow = '';
    if (head > 0) {
        const nx = -into[1];
        const ny = into[0];
        const base = { x: tip.x - into[0] * head, y: tip.y - into[1] * head };
        const w = head * 0.45;
        arrow = `M${n1(tip.x)} ${n1(tip.y)}L${n1(base.x + nx * w)} ${n1(base.y + ny * w)}L${n1(base.x - nx * w)} ${n1(base.y - ny * w)}Z`;
    }
    return { d, head: arrow, mid };
}

const ROUND = 10;

/** A polyline with rounded corners as an SVG path. / Ломаная со скруглёнными углами, путь SVG. */
function rounded(points: readonly MapPoint[]): string {
    let d = `M${n1(points[0]!.x)} ${n1(points[0]!.y)}`;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const c = points[i + 1]!;
        const la = Math.hypot(a.x - b.x, a.y - b.y);
        const lc = Math.hypot(c.x - b.x, c.y - b.y);
        const r = Math.min(ROUND, la / 2, lc / 2);
        const p1 = { x: b.x + ((a.x - b.x) / (la || 1)) * r, y: b.y + ((a.y - b.y) / (la || 1)) * r };
        const p2 = { x: b.x + ((c.x - b.x) / (lc || 1)) * r, y: b.y + ((c.y - b.y) / (lc || 1)) * r };
        d += `L${n1(p1.x)} ${n1(p1.y)}Q${n1(b.x)} ${n1(b.y)} ${n1(p2.x)} ${n1(p2.y)}`;
    }
    const last = points[points.length - 1]!;
    return `${d}L${n1(last.x)} ${n1(last.y)}`;
}

/**
 * The tree line from a parent to one of its children. A child in the first column is reached by a smooth curve. A child in
 * a later column (the column of children wrapped) is reached through the gaps: out of the parent into the gap beside it, up
 * above the block, along the top over the columns before it, down the gap in front of its own column, and in. So no line
 * runs through the cards of another column.
 * Линия дерева от родителя к одному из детей. К ребёнку первого столбца ведёт плавная кривая. К ребёнку в следующем
 * столбце (столбец детей перенесён) линия идёт по зазорам: от родителя в зазор рядом с ним, вверх над блоком, поверху над
 * предыдущими столбцами, вниз по зазору перед своим столбцом и внутрь. Так ни одна линия не идёт сквозь карточки другого столбца.
 */
export function treePath(parent: Rect, child: Rect, siblings: readonly Rect[]): string {
    const firstX = Math.min(child.x, ...siblings.map((r) => r.x));
    if (child.x < firstX + CARD_W) {
        const { from, to } = joinSides(parent, child);
        return curve(from, to).d;
    }
    const top = Math.min(...siblings.map((r) => r.y)) - 22;
    const trunkParent = parent.x + parent.w + GAP_X / 2;
    const trunkChild = child.x - GAP_X / 2;
    const py = parent.y + parent.h / 2;
    const cy = child.y + child.h / 2;
    return rounded([
        { x: parent.x + parent.w, y: py },
        { x: trunkParent, y: py },
        { x: trunkParent, y: top },
        { x: trunkChild, y: top },
        { x: trunkChild, y: cy },
        { x: child.x, y: cy },
    ]);
}

// ───────────────────────────── the keyboard / клавиатура ─────────────────────────────

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Placed extends Rect {
    id: string;
}

/**
 * The card an arrow key goes to from `from`: among the cards that lie in that direction the nearest one, with a shift
 * across the direction counted double, so the key keeps to its row or column. Null when nothing lies that way.
 * Карточка, куда ведёт стрелка из `from`: среди лежащих в этом направлении ближайшая, сдвиг поперёк считается вдвое,
 * так что клавиша держится своей строки или столбца. Null, если в ту сторону ничего нет.
 */
export function neighbour(cards: readonly Placed[], from: string, dir: Direction): string | null {
    const start = cards.find((c) => c.id === from);
    if (!start) return null;
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const card of cards) {
        if (card.id === from) continue;
        const dx = card.x + card.w / 2 - cx;
        const dy = card.y + card.h / 2 - cy;
        const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
        const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
        if (along <= 0 || across > along * 3 + 60) continue;
        const score = along + across * 2;
        if (score < bestScore || (score === bestScore && best !== null && card.id < best)) {
            best = card.id;
            bestScore = score;
        }
    }
    return best;
}
