import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outlineText, recordText } from '../server/agent.ts';
import { AxisError, createStore } from '../server/store.ts';
import type { Store } from '../server/store.ts';
import { diffRecord } from '../src/core/journal.ts';
import { execText, normalizeExec, normalizeRecord } from '../src/core/model.ts';
import type { AxisRecord } from '../src/core/model.ts';

const NOW = '2026-11-15T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        brain: null, exec: null, created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

describe('the exec field of a task', () => {
    it('is null for old records and for both parts empty', () => {
        expect(normalizeRecord({ id: 'a1', type: 'task', title: 'Old' }, NOW)!.exec).toBeNull();
        expect(normalizeExec({ model: null, effort: null })).toBeNull();
        expect(normalizeExec({})).toBeNull();
        expect(normalizeExec('sonnet')).toBeNull();
        expect(normalizeExec(null)).toBeNull();
        expect(normalizeExec(['sonnet'])).toBeNull();
    });

    it('drops a part with an unknown word and keeps the other', () => {
        expect(normalizeExec({ model: 'gpt', effort: 'high' })).toEqual({ model: null, effort: 'high' });
        expect(normalizeExec({ model: 'opus', effort: 'extreme' })).toEqual({ model: 'opus', effort: null });
        expect(normalizeExec({ model: 'gpt', effort: 'extreme' })).toBeNull();
        expect(normalizeExec({ model: 'sonnet', effort: 'medium' })).toEqual({ model: 'sonnet', effort: 'medium' });
    });

    it('is kept on a task and dropped from every other type when read', () => {
        const exec = { model: 'sonnet', effort: 'high' };
        expect(normalizeRecord({ id: 'a1', type: 'task', exec }, NOW)!.exec).toEqual(exec);
        for (const type of ['area', 'idea', 'decision', 'question', 'note']) expect(normalizeRecord({ id: 'a1', type, exec }, NOW)!.exec).toBeNull();
    });

    it('is written as a short value', () => {
        expect(execText({ model: 'sonnet', effort: 'high' })).toBe('sonnet/high');
        expect(execText({ model: 'sonnet', effort: null })).toBe('sonnet');
        expect(execText({ model: null, effort: 'high' })).toBe('/high');
        expect(execText(null)).toBe('');
        expect(execText(undefined)).toBe('');
    });

    it('has a journal line with short values', () => {
        expect(diffRecord(rec('t'), rec('t', { exec: { model: 'sonnet', effort: 'high' } }))).toEqual({ exec: ['', 'sonnet/high'] });
        expect(diffRecord(rec('t', { exec: { model: 'sonnet', effort: 'high' } }), rec('t', { exec: { model: 'opus', effort: 'high' } }))).toEqual({ exec: ['sonnet/high', 'opus/high'] });
        expect(diffRecord(rec('t', { exec: { model: 'sonnet', effort: null } }), rec('t', { exec: null }))).toEqual({ exec: ['sonnet', ''] });
        expect(diffRecord(rec('t', { exec: { model: 'sonnet', effort: 'low' } }), rec('t', { exec: { model: 'sonnet', effort: 'low' } }))).toBeUndefined();
    });
});

describe('the store and exec', () => {
    let root: string;
    let store: Store;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'axis-exec-'));
        store = createStore(root);
        store.createProject({ title: 'Demo', id: 'demo' });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const status = (fn: () => unknown): number => {
        try {
            fn();
        } catch (error) {
            return error instanceof AxisError ? error.status : -1;
        }
        return 0;
    };

    it('takes exec, or the shortcuts model and effort, on a new task, from the person and from Claude', () => {
        const a = store.createRecord('demo', { type: 'task', title: 'A', exec: { model: 'opus', effort: 'high' } }, 'user');
        expect(a.exec).toEqual({ model: 'opus', effort: 'high' });
        const b = store.createRecord('demo', { type: 'task', title: 'B', model: 'haiku', effort: 'low' }, 'claude');
        expect(b.exec).toEqual({ model: 'haiku', effort: 'low' });
        expect(store.record('demo', b.id).exec).toEqual({ model: 'haiku', effort: 'low' });
        expect(store.createRecord('demo', { type: 'task', title: 'C' }, 'user').exec).toBeNull();
    });

    it('changes only the parts passed and clears a part or the whole', () => {
        const t = store.createRecord('demo', { type: 'task', title: 'T', model: 'sonnet', effort: 'medium' }, 'claude');
        expect(store.updateRecord('demo', t.id, { exec: { effort: 'high' } }, 'user').exec).toEqual({ model: 'sonnet', effort: 'high' });
        expect(store.updateRecord('demo', t.id, { model: 'opus' }, 'claude').exec).toEqual({ model: 'opus', effort: 'high' });
        expect(store.updateRecord('demo', t.id, { exec: { model: null } }, 'user').exec).toEqual({ model: null, effort: 'high' });
        expect(store.updateRecord('demo', t.id, { model: 'haiku' }, 'claude').exec).toEqual({ model: 'haiku', effort: 'high' });
        expect(store.updateRecord('demo', t.id, { effort: '' }, 'claude').exec).toEqual({ model: 'haiku', effort: null });
        expect(store.updateRecord('demo', t.id, { exec: { model: '' } }, 'user').exec).toBeNull(); // both parts gone: null
        const again = store.updateRecord('demo', t.id, { model: 'sonnet', effort: 'low' }, 'claude');
        expect(again.exec).toEqual({ model: 'sonnet', effort: 'low' });
        expect(store.updateRecord('demo', t.id, { exec: null }, 'user').exec).toBeNull();
    });

    it('leaves exec alone when nothing about it is passed', () => {
        const t = store.createRecord('demo', { type: 'task', title: 'T', model: 'sonnet' }, 'claude');
        expect(store.updateRecord('demo', t.id, { title: 'Renamed', status: 'active' }, 'user').exec).toEqual({ model: 'sonnet', effort: null });
    });

    it('refuses an unknown word and a bad shape', () => {
        const t = store.createRecord('demo', { type: 'task', title: 'T' }, 'user');
        expect(status(() => store.updateRecord('demo', t.id, { model: 'gpt' }, 'claude'))).toBe(400);
        expect(status(() => store.updateRecord('demo', t.id, { effort: 'extreme' }, 'claude'))).toBe(400);
        expect(status(() => store.updateRecord('demo', t.id, { exec: { model: 'gpt' } }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', t.id, { exec: 'sonnet' }, 'user'))).toBe(400);
        expect(status(() => store.createRecord('demo', { type: 'task', title: 'x', model: 'gpt' }, 'user'))).toBe(400);
        expect(store.record('demo', t.id).exec).toBeNull();
    });

    it('is kept by a task only: ignored on other types, dropped when the type leaves task', () => {
        const idea = store.createRecord('demo', { type: 'idea', title: 'I', model: 'opus' }, 'claude');
        expect(idea.exec).toBeNull();
        expect(store.updateRecord('demo', idea.id, { effort: 'high' }, 'user').exec).toBeNull();
        const t = store.createRecord('demo', { type: 'task', title: 'T', model: 'opus', effort: 'high' }, 'claude');
        const note = store.updateRecord('demo', t.id, { type: 'note' }, 'user');
        expect(note.exec).toBeNull();
        expect(store.updateRecord('demo', t.id, { type: 'task' }, 'user').exec).toBeNull(); // it does not come back by itself
        // a change of type together with exec: the final type decides
        expect(store.updateRecord('demo', t.id, { type: 'task', model: 'sonnet' }, 'user').exec).toEqual({ model: 'sonnet', effort: null });
    });

    it('writes a journal line with the short value, and none for a change that changes nothing', () => {
        const t = store.createRecord('demo', { type: 'task', title: 'T' }, 'user');
        store.updateRecord('demo', t.id, { model: 'sonnet', effort: 'high', why: 'tricky' }, 'claude');
        expect(store.journal('demo')[0]).toMatchObject({ by: 'claude', kind: 'update', changes: { exec: ['', 'sonnet/high'] }, text: 'tricky' });
        const lines = store.journal('demo').length;
        store.updateRecord('demo', t.id, { model: 'sonnet' }, 'user');
        expect(store.journal('demo')).toHaveLength(lines);
        store.updateRecord('demo', t.id, { effort: '' }, 'user');
        expect(store.journal('demo')[0]!.changes).toEqual({ exec: ['sonnet/high', 'sonnet'] });
    });

    it('shows in the outline of the agent and in a full read', () => {
        const both = store.createRecord('demo', { type: 'task', title: 'Both', model: 'sonnet', effort: 'high' }, 'claude');
        store.createRecord('demo', { type: 'task', title: 'Model only', model: 'haiku' }, 'claude');
        store.createRecord('demo', { type: 'task', title: 'Effort only', effort: 'low' }, 'claude');
        store.createRecord('demo', { type: 'task', title: 'Plain' }, 'claude');
        const lines = outlineText(store.project('demo'), store.records('demo')).split('\n');
        const of = (title: string): string => lines.find((l) => l.includes(`  ${title}`))!;
        expect(of('Both').endsWith('⚙ sonnet/high')).toBe(true);
        expect(of('Model only').endsWith('⚙ haiku')).toBe(true);
        expect(of('Effort only').endsWith('⚙ /low')).toBe(true);
        expect(of('Plain')).not.toContain('⚙');
        const read = (r: AxisRecord): string => recordText(store.record('demo', r.id), store.records('demo'), [], (n) => n);
        expect(read(both)).toContain('executor: sonnet, effort high');
        const effortOnly = store.records('demo').find((r) => r.title === 'Effort only')!;
        expect(read(effortOnly)).toContain('executor: effort low');
    });
});

describe('exec through the MCP server', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'axis-exec-mcp-'));
        createStore(root).createProject({ title: 'Demo', id: 'demo' });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const call = (calls: { name: string; arguments: Record<string, unknown> }[]): string[] => {
        const input = calls.map((params, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params })).join('\n');
        const run = spawnSync(process.execPath, [join(process.cwd(), 'server', 'mcp.ts')], { input: `${input}\n`, env: { ...process.env, AXIS_DATA: root }, encoding: 'utf8' });
        return run.stdout.trim().split('\n').map((l) => (JSON.parse(l) as { result: { content: { text: string }[] } }).result.content[0]!.text);
    };

    it('sets, changes and clears model and effort', () => {
        const [added] = call([{ name: 'axis_add', arguments: { project: 'demo', type: 'task', title: 'Do it', model: 'sonnet', effort: 'medium' } }]);
        const id = /\[(\w{8})\]/.exec(added!)![1]!;
        const [bad, changed, overview, cleared, read] = call([
            { name: 'axis_update', arguments: { project: 'demo', id, model: 'gpt' } },
            { name: 'axis_update', arguments: { project: 'demo', id, model: 'opus' } },
            { name: 'axis_overview', arguments: { project: 'demo' } },
            { name: 'axis_update', arguments: { project: 'demo', id, model: '', effort: '' } },
            { name: 'axis_read', arguments: { project: 'demo', id } },
        ]);
        expect(bad).toContain('model:');
        expect(changed).toContain('Updated');
        expect(overview).toContain('⚙ opus/medium');
        expect(cleared).toContain('Updated');
        expect(read).not.toContain('executor');
        expect(createStore(root).record('demo', id).exec).toBeNull();
    });
});
