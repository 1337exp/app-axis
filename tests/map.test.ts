import { describe, expect, it } from 'vitest';
import {
    autoLayout,
    boundsOf,
    branchOf,
    curve,
    drawnParents,
    emptyMap,
    estimateHeight,
    joinSides,
    mergePlaces,
    neighbour,
    normalizeMap,
    patchMap,
    shiftPlaces,
    sideNear,
    visibleIds,
} from '../src/core/map.ts';
import type { LayoutItem, Rect } from '../src/core/map.ts';
import type { AxisRecord } from '../src/core/model.ts';

const NOW = '2026-11-16T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

const item = (id: string, parent: string | null, order = 0, w = 200, h = 80): LayoutItem => ({ id, parent, order, w, h });

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function noOverlaps(items: readonly LayoutItem[], places: Record<string, { x: number; y: number }>): void {
    const rects = items.map((i) => ({ id: i.id, x: places[i.id]!.x, y: places[i.id]!.y, w: i.w, h: i.h }));
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) expect(overlap(rects[a]!, rects[b]!), `${rects[a]!.id} / ${rects[b]!.id}`).toBe(false);
}

/** A nested tree: every card has `fan` children down to `depth`. */
function nested(depth: number, fan: number): LayoutItem[] {
    const out: LayoutItem[] = [];
    const grow = (parent: string | null, level: number, prefix: string): void => {
        for (let i = 0; i < fan; i++) {
            const id = `${prefix}${i}`;
            out.push(item(id, parent, i, 200 + ((i * 37) % 3) * 40, 60 + ((i * 53) % 4) * 30));
            if (level < depth) grow(id, level + 1, `${id}.`);
        }
    };
    grow(null, 1, 'n');
    return out;
}

describe('the file', () => {
    it('keeps good places, drops bad ones and the places of records that are gone', () => {
        const map = normalizeMap({ positions: { a: { x: 1.26, y: 2 }, b: { x: 'no', y: 1 }, gone: { x: 5, y: 5 }, c: { x: 1e9, y: 0 } }, camera: { x: 1, y: 2, zoom: 1.5 } }, new Set(['a', 'b', 'c']));
        expect(map.positions).toEqual({ a: { x: 1.3, y: 2 } });
        expect(map.camera).toEqual({ x: 1, y: 2, zoom: 1.5 });
        expect(normalizeMap('junk')).toEqual(emptyMap());
        expect(normalizeMap({ camera: { x: 0, y: 0, zoom: 0 } }).camera).toBeUndefined();
    });

    it('patches places and the camera; null removes', () => {
        const start = normalizeMap({ positions: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }, camera: { x: 0, y: 0, zoom: 1 } });
        const next = patchMap(start, { positions: { a: null, c: { x: 3, y: 3 } }, camera: { x: 5, y: 5, zoom: 2 } });
        expect(next.positions).toEqual({ b: { x: 2, y: 2 }, c: { x: 3, y: 3 } });
        expect(next.camera).toEqual({ x: 5, y: 5, zoom: 2 });
        expect(patchMap(next, { camera: null }).camera).toBeUndefined();
        expect(start.positions.a).toEqual({ x: 1, y: 1 }); // the input stays as it was
        expect(patchMap(start, {}).positions).toEqual(start.positions);
    });
});

describe('the automatic layout', () => {
    it('grows left to right: children to the right of their parent, roots stacked with a gap', () => {
        const items = [item('a', null, 1), item('a1', 'a', 1), item('a2', 'a', 2), item('b', null, 2)];
        const p = autoLayout(items);
        expect(p.a!.x).toBe(0);
        expect(p.b!.x).toBe(0);
        expect(p.a1!.x).toBeGreaterThan(p.a!.x + 200);
        expect(p.a1!.x).toBe(p.a2!.x);
        expect(p.a2!.y).toBeGreaterThan(p.a1!.y + 80);
        expect(p.b!.y).toBeGreaterThan(p.a2!.y + 80);
        // the parent sits at the middle of its children
        expect(p.a!.y + 40).toBeCloseTo((p.a1!.y + 40 + p.a2!.y + 40) / 2);
    });

    it('has no overlaps for nested trees and for many children', () => {
        for (const items of [nested(3, 3), nested(2, 6), [item('r', null), ...Array.from({ length: 60 }, (_, i) => item(`k${i}`, 'r', i, 224, 56 + (i % 3) * 18))]]) {
            noOverlaps(items, autoLayout(items));
        }
    });

    it('does not overlap when a tall subtree sits beside a short one', () => {
        const items = [item('a', null, 1, 200, 40), item('a1', 'a', 1, 200, 400), item('b', null, 2, 200, 40), item('b1', 'b', 1, 200, 40)];
        noOverlaps(items, autoLayout(items));
    });

    it('is stable between runs and does not depend on the order of the input', () => {
        const items = nested(3, 3);
        const first = autoLayout(items);
        expect(autoLayout(items)).toEqual(first);
        expect(autoLayout([...items].reverse())).toEqual(first);
    });

    it('treats a card whose parent is missing as a root and survives a cycle', () => {
        const orphan = autoLayout([item('x', 'nowhere')]);
        expect(orphan.x).toEqual({ x: 0, y: 0 });
        const cycle = autoLayout([item('a', 'b'), item('b', 'a')]);
        expect(Object.keys(cycle).sort()).toEqual(['a', 'b']);
    });
});

describe('saved and automatic places', () => {
    const items = [item('a', null, 1), item('a1', 'a', 1), item('a2', 'a', 2)];
    const auto = autoLayout(items);

    it('a saved place wins over the automatic one', () => {
        const merged = mergePlaces(items, auto, { a1: { x: 900, y: 900 } });
        expect(merged.a1).toEqual({ x: 900, y: 900 });
        expect(merged.a2).toEqual(auto.a2);
        expect(merged.a).toEqual(auto.a);
    });

    it('an unplaced child follows its moved parent, a placed one stays', () => {
        const merged = mergePlaces(items, auto, { a: { x: auto.a!.x + 500, y: auto.a!.y + 100 }, a2: { x: 7, y: 7 } });
        expect(merged.a1).toEqual({ x: auto.a1!.x + 500, y: auto.a1!.y + 100 });
        expect(merged.a2).toEqual({ x: 7, y: 7 });
    });

    it('a new child lands beside its parent and does not move the cards that were placed', () => {
        const before = [item('a', null, 1), item('a1', 'a', 1)];
        const saved = { a: { x: 400, y: 300 }, a1: { x: 800, y: 320 } };
        const grown = [...before, item('a2', 'a', 2)];
        const merged = mergePlaces(grown, autoLayout(grown), saved);
        expect(merged.a).toEqual(saved.a);
        expect(merged.a1).toEqual(saved.a1);
        expect(merged.a2!.x).toBeGreaterThan(saved.a.x + 200);
        expect(Math.abs(merged.a2!.y - saved.a.y)).toBeLessThan(300);
    });
});

describe('moving a branch', () => {
    const records = [rec('a', { type: 'area' }), rec('a1', { parent: 'a' }), rec('a11', { parent: 'a1' }), rec('b', { type: 'area' }), rec('b1', { parent: 'b' })];

    it('takes the record and everything under it', () => {
        expect(branchOf(records, 'a').sort()).toEqual(['a', 'a1', 'a11']);
        expect(branchOf(records, 'a11')).toEqual(['a11']);
        expect(branchOf(records, 'b1')).toEqual(['b1']);
    });

    it('shifts only the places asked for', () => {
        const from = { a: { x: 0, y: 0 }, a1: { x: 10, y: 10 }, b: { x: 5, y: 5 } };
        expect(shiftPlaces(from, branchOf(records, 'a'), 3, -2)).toEqual({ a: { x: 3, y: -2 }, a1: { x: 13, y: 8 } });
    });
});

describe('what is drawn', () => {
    const records = [
        rec('a', { type: 'area' }),
        rec('t1', { parent: 'a' }),
        rec('t2', { parent: 'a', status: 'done' }),
        rec('i1', { parent: 'a', type: 'idea' }),
        rec('n1', { parent: 'a', type: 'note' }),
        rec('b', { type: 'area' }),
        rec('b1', { parent: 'b' }),
    ];
    const ALL = ['task', 'idea', 'decision', 'question'] as const;

    it('areas and notes are always cards, the rest goes by the filter', () => {
        expect([...visibleIds(records, { types: ['task'], showDone: false })].sort()).toEqual(['a', 'b', 'b1', 'n1', 't1']);
        expect([...visibleIds(records, { types: ALL, showDone: true })].sort()).toEqual(['a', 'b', 'b1', 'i1', 'n1', 't1', 't2']);
    });

    it('a root limits it to that area and what is under it', () => {
        expect([...visibleIds(records, { types: ALL, showDone: true, root: 'b' })].sort()).toEqual(['b', 'b1']);
    });

    it('a card hangs under its nearest drawn ancestor', () => {
        const chain = [rec('a', { type: 'area' }), rec('t', { parent: 'a' }), rec('u', { parent: 't' })];
        const parents = drawnParents(chain, new Set(['a', 'u']));
        expect(parents.get('u')).toBe('a');
        expect(parents.get('a')).toBeNull();
    });
});

describe('lines', () => {
    const a: Rect = { x: 0, y: 0, w: 200, h: 80 };

    it('joins the sides that face each other', () => {
        expect(joinSides(a, { x: 300, y: 10, w: 200, h: 80 })).toMatchObject({ from: { side: 'right', x: 200, y: 40 }, to: { side: 'left', x: 300, y: 50 } });
        expect(joinSides({ x: 300, y: 0, w: 200, h: 80 }, a)).toMatchObject({ from: { side: 'left' }, to: { side: 'right' } });
        // a little overlap in x: bottom to top
        expect(joinSides(a, { x: 150, y: 200, w: 200, h: 80 })).toMatchObject({ from: { side: 'bottom' }, to: { side: 'top' } });
        expect(joinSides({ x: 150, y: 200, w: 200, h: 80 }, a)).toMatchObject({ from: { side: 'top' }, to: { side: 'bottom' } });
        // one column: the right sides, so the line goes round beside the cards between
        expect(joinSides(a, { x: 20, y: 200, w: 200, h: 80 })).toMatchObject({ from: { side: 'right' }, to: { side: 'right' } });
    });

    it('picks the side nearest to a point', () => {
        expect(sideNear(a, { x: 5, y: 40 })).toBe('left');
        expect(sideNear(a, { x: 195, y: 40 })).toBe('right');
        expect(sideNear(a, { x: 100, y: 2 })).toBe('top');
        expect(sideNear(a, { x: 100, y: 78 })).toBe('bottom');
    });

    it('draws a curve with an arrowhead and a middle point', () => {
        const { from, to } = joinSides(a, { x: 300, y: 0, w: 200, h: 80 });
        const line = curve(from, to, 10);
        expect(line.d.startsWith('M200 40C')).toBe(true);
        expect(line.head.startsWith('M300 40L')).toBe(true);
        expect(line.mid.x).toBeGreaterThan(200);
        expect(line.mid.x).toBeLessThan(300);
        expect(curve(from, to).head).toBe('');
        expect(curve(from, { x: 400, y: 300 }).d).toContain('400');
    });
});

describe('the keyboard neighbour', () => {
    // a 3 x 2 grid: a b c over d e f
    const cards = [
        { id: 'a', x: 0, y: 0, w: 100, h: 50 },
        { id: 'b', x: 200, y: 0, w: 100, h: 50 },
        { id: 'c', x: 400, y: 0, w: 100, h: 50 },
        { id: 'd', x: 0, y: 100, w: 100, h: 50 },
        { id: 'e', x: 200, y: 100, w: 100, h: 50 },
        { id: 'f', x: 400, y: 100, w: 100, h: 50 },
    ];

    it('goes to the nearest card in the direction, keeping to its row or column', () => {
        expect(neighbour(cards, 'a', 'right')).toBe('b');
        expect(neighbour(cards, 'b', 'right')).toBe('c');
        expect(neighbour(cards, 'e', 'left')).toBe('d');
        expect(neighbour(cards, 'b', 'down')).toBe('e');
        expect(neighbour(cards, 'f', 'up')).toBe('c');
    });

    it('is null when nothing lies that way or the card is unknown', () => {
        expect(neighbour(cards, 'a', 'left')).toBeNull();
        expect(neighbour(cards, 'a', 'up')).toBeNull();
        expect(neighbour(cards, 'zz', 'right')).toBeNull();
    });
});

describe('sizes', () => {
    it('estimates a taller card for a longer title, at most three lines', () => {
        expect(estimateHeight('task', 'a')).toBeLessThan(estimateHeight('task', 'a'.repeat(60)));
        expect(estimateHeight('task', 'a'.repeat(60))).toBe(estimateHeight('task', 'a'.repeat(300)));
    });

    it('measures the bounds of a set of cards', () => {
        expect(boundsOf([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 30, w: 5, h: 5 }])).toEqual({ x: 0, y: 0, w: 25, h: 35 });
        expect(boundsOf([])).toBeNull();
    });
});
