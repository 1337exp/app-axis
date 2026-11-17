import { describe, expect, it } from 'vitest';
import { BOARD_STATUSES, BOARD_TYPES, DEFAULT_BOARD_TYPES, groupByStatus } from '../src/core/board.ts';
import type { AxisRecord } from '../src/core/model.ts';
import { defaultFilter, readFilter, readIds, writeFilter, writeIds } from '../src/app/viewFilter.ts';

const NOW = '2026-11-16T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

const ids = (list: readonly AxisRecord[]): string[] => list.map((r) => r.id);
const column = (records: readonly AxisRecord[], status: string, filter = { types: BOARD_TYPES }): string[] =>
    ids(groupByStatus(records, filter).find((c) => c.status === status)!.records);

// a: area  ─ a1 task open, a2 task active (with question aq open, decision ad done), a3 idea dropped
// b: area  ─ b1 task done, b2 note (no status); b-sub area ─ bs1 task active
// top: task open at the top level, after the areas
const records = [
    rec('a', { type: 'area', order: 1 }),
    rec('a1', { parent: 'a', order: 1 }),
    rec('a2', { parent: 'a', order: 2, status: 'active' }),
    rec('aq', { parent: 'a2', type: 'question', status: 'open' }),
    rec('ad', { parent: 'a2', type: 'decision', status: 'done' }),
    rec('a3', { parent: 'a', order: 3, type: 'idea', status: 'dropped' }),
    rec('b', { type: 'area', order: 2 }),
    rec('b1', { parent: 'b', order: 1, status: 'done' }),
    rec('b2', { parent: 'b', order: 2, type: 'note' }),
    rec('bsub', { parent: 'b', order: 3, type: 'area' }),
    rec('bs1', { parent: 'bsub', status: 'active' }),
    rec('top', { order: 3 }),
];

describe('board columns', () => {
    it('returns the four columns in a fixed order, even when empty', () => {
        expect(BOARD_STATUSES).toEqual(['open', 'active', 'done', 'dropped']);
        const empty = groupByStatus([], { types: BOARD_TYPES });
        expect(empty.map((c) => c.status)).toEqual(['open', 'active', 'done', 'dropped']);
        expect(empty.every((c) => c.records.length === 0)).toBe(true);
    });

    it('puts each record into the column of its status, in the order of the tree', () => {
        // the tree walks a, a1, a2, aq, ad, a3, b, b1, b2, bsub, bs1, top
        expect(column(records, 'open')).toEqual(['a1', 'aq', 'top']);
        expect(column(records, 'active')).toEqual(['a2', 'bs1']);
        expect(column(records, 'done')).toEqual(['ad', 'b1']);
        expect(column(records, 'dropped')).toEqual(['a3']);
    });

    it('follows the order of the tree, not the order of the list', () => {
        const shuffled = [records[11]!, records[3]!, records[1]!, records[0]!, ...records.slice(4, 11), records[2]!];
        expect(column(shuffled, 'open')).toEqual(['a1', 'aq', 'top']);
    });

    it('leaves out records with no status: areas and notes', () => {
        const all = groupByStatus(records, { types: ['area', 'note', ...BOARD_TYPES] }).flatMap((c) => ids(c.records));
        expect(all).not.toContain('a');
        expect(all).not.toContain('b');
        expect(all).not.toContain('bsub');
        expect(all).not.toContain('b2');
        expect(all).toHaveLength(8);
    });
});

describe('board filters', () => {
    it('shows only the chosen types', () => {
        const only = (types: AxisRecord['type'][]) => groupByStatus(records, { types }).flatMap((c) => ids(c.records)).sort();
        expect(only(['task'])).toEqual(['a1', 'a2', 'b1', 'bs1', 'top']);
        expect(only(['question', 'decision'])).toEqual(['ad', 'aq']);
        expect(only([])).toEqual([]);
        expect(only([...DEFAULT_BOARD_TYPES])).toEqual(['a1', 'a2', 'aq', 'b1', 'bs1', 'top']);
    });

    it('with a root shows only what is under it, at any depth, and not the root', () => {
        const under = (root: string) => groupByStatus(records, { types: BOARD_TYPES, root }).flatMap((c) => ids(c.records)).sort();
        expect(under('a')).toEqual(['a1', 'a2', 'a3', 'ad', 'aq']);
        expect(under('b')).toEqual(['b1', 'bs1']);
        expect(under('bsub')).toEqual(['bs1']);
        expect(under('a1')).toEqual([]);
    });

    it('combines the type and the branch', () => {
        const got = groupByStatus(records, { types: ['question'], root: 'a' }).flatMap((c) => ids(c.records));
        expect(got).toEqual(['aq']);
    });

    it('treats a missing or null root as the whole project', () => {
        const whole = groupByStatus(records, { types: BOARD_TYPES }).flatMap((c) => ids(c.records));
        expect(groupByStatus(records, { types: BOARD_TYPES, root: null }).flatMap((c) => ids(c.records))).toEqual(whole);
        expect(groupByStatus(records, { types: BOARD_TYPES, root: undefined }).flatMap((c) => ids(c.records))).toEqual(whole);
    });

    it('gives empty columns for a root that does not exist, still four of them', () => {
        const columns = groupByStatus(records, { types: BOARD_TYPES, root: 'gone' });
        expect(columns).toHaveLength(4);
        expect(columns.every((c) => c.records.length === 0)).toBe(true);
    });

    it('does not lose a record whose parent is gone: it comes up to the top, like in the tree', () => {
        const lonely = [rec('x', { parent: 'missing' })];
        expect(column(lonely, 'open')).toEqual(['x']);
    });
});

describe('saved filter of the board', () => {
    const fake = (initial: Record<string, string> = {}) => {
        const data = { ...initial };
        return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    };

    it('starts with tasks and questions, the whole project', () => {
        expect(readFilter('board', 'p', fake())).toEqual({ types: ['task', 'question'], root: null });
        expect(defaultFilter()).toEqual({ types: ['task', 'question'], root: null });
        // the map is the whole picture: every type is on until the person turns one off
        expect(defaultFilter('map')).toEqual({ types: ['task', 'idea', 'decision', 'question'], root: null });
        expect(readFilter('map', 'fresh', { getItem: () => null, setItem: () => undefined })).toEqual(defaultFilter('map'));
    });

    it('keeps a filter per project', () => {
        const store = fake();
        writeFilter('board', 'p', { types: ['idea'], root: 'a' }, store);
        writeFilter('board', 'q', { types: ['task', 'decision'], root: null }, store);
        expect(readFilter('board', 'p', store)).toEqual({ types: ['idea'], root: 'a' });
        expect(readFilter('board', 'q', store)).toEqual({ types: ['task', 'decision'], root: null });
        expect(readFilter('board', 'other', store)).toEqual(defaultFilter());
    });

    it('survives garbage in the storage', () => {
        expect(readFilter('board', 'p', fake({ 'axis.board.p': '{not json' }))).toEqual(defaultFilter());
        expect(readFilter('board', 'p', fake({ 'axis.board.p': '[]' }))).toEqual(defaultFilter());
        expect(readFilter('board', 'p', fake({ 'axis.board.p': JSON.stringify({ types: ['area', 'idea', 'x'], root: '../x' }) }))).toEqual({ types: ['idea'], root: null });
    });

    it('survives a storage that throws', () => {
        const broken = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('full');
            },
        };
        expect(readFilter('board', 'p', broken)).toEqual(defaultFilter());
        expect(() => writeFilter('board', 'p', defaultFilter(), broken)).not.toThrow();
    });
});

describe('the closed branches of the tree', () => {
    const memory = () => {
        const data: Record<string, string> = {};
        return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    };

    it('are kept per project and read back', () => {
        const store = memory();
        writeIds('tree.closed', 'p', ['a1', 'b2'], store);
        expect(readIds('tree.closed', 'p', store)).toEqual(['a1', 'b2']);
        expect(readIds('tree.closed', 'other', store)).toEqual([]);
    });

    it('are empty when nothing is saved, the value is broken or the storage is shut', () => {
        expect(readIds('tree.closed', 'p', memory())).toEqual([]);
        expect(readIds('tree.closed', 'p', { getItem: () => '{oops', setItem: () => undefined })).toEqual([]);
        expect(readIds('tree.closed', 'p', { getItem: () => '{"a":1}', setItem: () => undefined })).toEqual([]);
        expect(readIds('tree.closed', 'p', { getItem: () => JSON.stringify(['ok', 'Bad Id!', 3]), setItem: () => undefined })).toEqual(['ok']);
        const shut = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
        expect(readIds('tree.closed', 'p', shut)).toEqual([]);
        expect(() => writeIds('tree.closed', 'p', ['a'], shut)).not.toThrow();
    });
});
