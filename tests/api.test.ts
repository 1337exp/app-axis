import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../server/api.ts';
import type { Api } from '../server/api.ts';
import { createStore } from '../server/store.ts';
import type { Store } from '../server/store.ts';

let root: string;
let store: Store;
let api: Api;
let server: Server;
let base: string;

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'axis-api-'));
    store = createStore(root);
    store.createProject({ title: 'Demo', id: 'demo' });
    api = createApi(store);
    server = createServer((req, res) => void api.handle(req, res));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/projects/demo`;
});

afterEach(async () => {
    api.close();
    await new Promise((done) => server.close(done));
    rmSync(root, { recursive: true, force: true });
});

const paragraph = (text: string) => ({ v: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const send = async (method: string, path: string, body?: unknown, by = 'user') => {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Axis-By': by },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as Record<string, any> };
};

describe('the draft over HTTP', () => {
    it('puts, gets and deletes a draft, and the project load names the records that have one', async () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'old' }, 'user');
        expect((await send('GET', `/records/${r.id}/draft`)).data).toEqual({ draft: null });
        expect((await send('GET', '')).data.drafts).toEqual([]);

        const put = await send('PUT', `/records/${r.id}/draft`, { body: paragraph('typed'), base: r.updated });
        expect(put.status).toBe(200);
        expect(put.data.draft).toMatchObject({ base: r.updated, by: 'user' });
        expect((await send('GET', `/records/${r.id}/draft`)).data.draft.body).toEqual(paragraph('typed'));
        expect((await send('GET', '')).data.drafts).toEqual([r.id]);
        expect(store.journal('demo')).toHaveLength(1); // only the creation

        expect((await send('PUT', `/records/${r.id}/draft`, { base: r.updated })).status).toBe(400);
        expect((await send('PUT', '/records/missing1/draft', { body: null, base: 'x' })).status).toBe(404);
        expect((await send('POST', `/records/${r.id}/draft`, {})).status).toBe(405);

        expect((await send('DELETE', `/records/${r.id}/draft`)).data).toEqual({ deleted: true });
        expect((await send('GET', '')).data.drafts).toEqual([]);
    });

    it('answers 409 with the current record to a save made against an older version', async () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'old' }, 'user');
        const theirs = store.updateRecord('demo', r.id, { text: 'theirs' }, 'claude');
        const refused = await send('PATCH', `/records/${r.id}`, { body: paragraph('mine'), base: r.updated });
        expect(refused.status).toBe(409);
        expect(refused.data.error).toBeTypeOf('string');
        expect(refused.data.record).toMatchObject({ id: r.id, updated: theirs.updated, updatedBy: 'claude' });

        const forced = await send('PATCH', `/records/${r.id}`, { body: paragraph('mine'), base: theirs.updated });
        expect(forced.status).toBe(200);
        expect(forced.data.record.updatedBy).toBe('user');
        // without a base (MCP, curl) nothing is checked
        expect((await send('PATCH', `/records/${r.id}`, { text: 'again' }, 'claude')).status).toBe(200);
    });
});
