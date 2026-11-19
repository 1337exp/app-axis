/**
 * The agent sees through MCP that the person is typing a text: a mark in the outline, a line in a full read, a warning when it sends its own text.
 * Агент видит через MCP, что человек набирает текст: метка в оглавлении, строка в полном чтении, предупреждение, когда шлёт свой текст.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../server/store.ts';
import { docToText, textToDoc } from '../src/core/text.ts';

let root: string;
let a: string;
let b: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axis-draft-mark-'));
    const store = createStore(root);
    store.createProject({ title: 'Demo', id: 'demo' });
    const typed = store.createRecord('demo', { type: 'task', title: 'Typed' }, 'user');
    const quiet = store.createRecord('demo', { type: 'task', title: 'Quiet' }, 'user');
    a = typed.id;
    b = quiet.id;
    store.saveDraft('demo', a, { body: textToDoc('the person is typing'), base: typed.updated }, 'user');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Runs the real server over stdio: one JSON-RPC call per line. */
const call = (calls: { name: string; arguments: Record<string, unknown> }[]): string[] => {
    const input = calls.map((params, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params })).join('\n');
    const run = spawnSync(process.execPath, [join(process.cwd(), 'server', 'mcp.ts')], { input: `${input}\n`, env: { ...process.env, AXIS_DATA: root }, encoding: 'utf8' });
    return run.stdout.trim().split('\n').map((l) => (JSON.parse(l) as { result: { content: { text: string }[] } }).result.content[0]!.text);
};

describe('an unsaved draft in MCP', () => {
    it('marks only the record with a draft in the outline', () => {
        const [overview] = call([{ name: 'axis_overview', arguments: { project: 'demo' } }]);
        const line = (title: string): string => overview!.split('\n').find((l) => l.includes(`  ${title}`))!;
        expect(line('Typed')).toContain('✎ draft');
        expect(line('Quiet')).not.toContain('draft');
    });

    it('says it in a full read, without putting the draft text in', () => {
        const [typed, quiet] = call([
            { name: 'axis_read', arguments: { project: 'demo', id: a } },
            { name: 'axis_read', arguments: { project: 'demo', id: b } },
        ]);
        expect(typed).toContain('draft: user has an unsaved text of this record');
        expect(typed).not.toContain('the person is typing');
        expect(quiet).not.toContain('draft:');
    });

    it('warns when a text is sent to a record with a draft, and still saves it', () => {
        const [withDraft, without, status] = call([
            { name: 'axis_update', arguments: { project: 'demo', id: a, text: 'from the agent' } },
            { name: 'axis_update', arguments: { project: 'demo', id: b, text: 'from the agent' } },
            { name: 'axis_update', arguments: { project: 'demo', id: a, status: 'active' } },
        ]);
        expect(withDraft).toContain('Warning: draft:');
        expect(without).not.toContain('Warning');
        expect(status).not.toContain('Warning'); // only the text collides with a draft of the text
        expect(docToText(createStore(root).record('demo', a).body)).toBe('from the agent');
    });
});
