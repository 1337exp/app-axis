/**
 * The tree of a project: records point at their parent, this module turns the flat list into branches,
 * counts progress and answers "may this record move there".
 *
 * Дерево проекта: записи указывают на родителя, модуль собирает из плоского списка ветки,
 * считает прогресс и отвечает «можно ли перенести запись туда».
 */
import type { AxisRecord } from './model.ts';

export interface TreeNode {
    record: AxisRecord;
    children: TreeNode[];
    depth: number;
}

export interface Progress {
    /** Tasks done. / Задач сделано. */
    done: number;
    /** Tasks that count: all but the dropped ones. / Задач в счёте: все, кроме отброшенных. */
    total: number;
    /** Tasks in work. / Задач в работе. */
    active: number;
    /** Questions with no answer yet. / Вопросов без ответа. */
    questions: number;
}

const byOrder = (a: AxisRecord, b: AxisRecord): number => a.order - b.order || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

/**
 * Branches from the flat list. A record whose parent is missing, or that sits in a cycle, comes up to the top:
 * nothing is lost because a file was removed by hand.
 *
 * Ветки из плоского списка. Запись без найденного родителя или внутри цикла поднимается наверх:
 * ничего не теряется, если файл удалили руками.
 */
export function buildTree(records: readonly AxisRecord[]): TreeNode[] {
    const byId = new Map(records.map((r) => [r.id, r]));
    const kids = new Map<string | null, AxisRecord[]>();
    for (const record of records) {
        const parent = record.parent !== null && byId.has(record.parent) && !inCycle(record, byId) ? record.parent : null;
        const list = kids.get(parent);
        if (list) list.push(record);
        else kids.set(parent, [record]);
    }
    const grow = (parent: string | null, depth: number): TreeNode[] =>
        (kids.get(parent) ?? []).sort(byOrder).map((record) => ({ record, depth, children: grow(record.id, depth + 1) }));
    return grow(null, 0);
}

function inCycle(record: AxisRecord, byId: Map<string, AxisRecord>): boolean {
    const seen = new Set<string>([record.id]);
    let at = record.parent;
    while (at !== null) {
        if (seen.has(at)) return true;
        seen.add(at);
        at = byId.get(at)?.parent ?? null;
    }
    return false;
}

/** The node and everything under it, top first. / Узел и всё под ним, сверху вниз. */
export function flatten(nodes: readonly TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (list: readonly TreeNode[]): void => {
        for (const node of list) {
            out.push(node);
            walk(node.children);
        }
    };
    walk(nodes);
    return out;
}

/** Progress of a branch: the node itself and everything under it. / Прогресс ветки: сам узел и всё под ним. */
export function progressOf(node: TreeNode): Progress {
    const sum: Progress = { done: 0, total: 0, active: 0, questions: 0 };
    for (const { record } of flatten([node])) count(sum, record);
    return sum;
}

/** Progress of the whole project. / Прогресс всего проекта. */
export function progressOfAll(records: readonly AxisRecord[]): Progress {
    const sum: Progress = { done: 0, total: 0, active: 0, questions: 0 };
    for (const record of records) count(sum, record);
    return sum;
}

function count(sum: Progress, record: AxisRecord): void {
    if (record.type === 'task' && record.status !== 'dropped') {
        sum.total += 1;
        if (record.status === 'done') sum.done += 1;
        if (record.status === 'active') sum.active += 1;
    }
    if (record.type === 'question' && (record.status === 'open' || record.status === 'active')) sum.questions += 1;
}

/** Share done, 0…100, whole. An empty branch is 0. / Доля сделанного, целое 0…100. */
export const percent = (p: Progress): number => (p.total === 0 ? 0 : Math.round((p.done / p.total) * 100));

/** Ids under a record, without it. / Id всего, что под записью, без неё самой. */
export function descendants(records: readonly AxisRecord[], id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
        const at = queue.shift()!;
        for (const record of records) {
            if (record.parent === at && !seen.has(record.id)) {
                seen.add(record.id);
                out.push(record.id);
                queue.push(record.id);
            }
        }
    }
    return out;
}

/** A record cannot become a child of itself or of what is under it. / Запись нельзя вложить в саму себя или в своё поддерево. */
export function canMove(records: readonly AxisRecord[], id: string, parent: string | null): boolean {
    if (parent === null) return true;
    if (parent === id) return false;
    if (!records.some((r) => r.id === parent)) return false;
    return !descendants(records, id).includes(parent);
}

/**
 * The order for a record put among the children of `parent`: after the sibling `after`, or at the end.
 * Orders are plain numbers; a place between two neighbours is their middle.
 *
 * Порядок для записи среди детей `parent`: после соседа `after` или в конце. Место между двумя соседями это их середина.
 */
export function orderFor(records: readonly AxisRecord[], parent: string | null, after?: string | null, moving?: string): number {
    const siblings = records.filter((r) => r.parent === parent && r.id !== moving).sort(byOrder);
    if (after === null) {
        const first = siblings[0];
        return first ? first.order - 1 : 0;
    }
    const at = after === undefined ? -1 : siblings.findIndex((r) => r.id === after);
    if (at === -1) {
        const last = siblings.at(-1);
        return last ? last.order + 1 : 0;
    }
    const prev = siblings[at]!;
    const next = siblings[at + 1];
    return next ? (prev.order + next.order) / 2 : prev.order + 1;
}

/** Path of titles from the top to the record. / Путь заголовков от верха до записи. */
export function pathOf(records: readonly AxisRecord[], id: string): AxisRecord[] {
    const byId = new Map(records.map((r) => [r.id, r]));
    const path: AxisRecord[] = [];
    const seen = new Set<string>();
    let at = byId.get(id);
    while (at && !seen.has(at.id)) {
        seen.add(at.id);
        path.unshift(at);
        at = at.parent === null ? undefined : byId.get(at.parent);
    }
    return path;
}
