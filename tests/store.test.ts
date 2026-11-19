import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outlineText, recordText, search } from '../server/agent.ts';
import { AxisError, createStore, slugify } from '../server/store.ts';
import type { Store } from '../server/store.ts';
import { docToText } from '../src/core/text.ts';

let root: string;
let store: Store;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axis-test-'));
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

describe('projects', () => {
    it('makes a folder name from a title', () => {
        expect(slugify('Мой Проект №1')).toBe('moy-proekt-1');
        expect(slugify('  TaoFX: editor  ')).toBe('taofx-editor');
        expect(slugify('!!!')).toBe('');
    });

    it('creates, lists and refuses a taken or unsafe id', () => {
        const made = store.createProject({ title: 'Мой проект' });
        expect(made.id).toBe('moy-proekt');
        expect(store.createProject({ title: 'Мой проект' }).id).toBe('moy-proekt-2');
        expect(store.projects().map((p) => p.id).sort()).toEqual(['demo', 'moy-proekt', 'moy-proekt-2']);
        expect(status(() => store.createProject({ title: 'x', id: 'demo' }))).toBe(409);
        expect(status(() => store.createProject({ title: 'x', id: '../up' }))).toBe(400);
        expect(status(() => store.createProject({ title: '' }))).toBe(400);
        expect(status(() => store.records('nope'))).toBe(404);
        expect(status(() => store.records('../demo'))).toBe(400);
    });
});

describe('records', () => {
    it('creates with defaults, in order, with a journal line', () => {
        const area = store.createRecord('demo', { type: 'area', title: 'Editor' }, 'user');
        const a = store.createRecord('demo', { type: 'task', title: 'A', parent: area.id }, 'user');
        const b = store.createRecord('demo', { type: 'task', title: 'B', parent: area.id }, 'agent');
        store.createRecord('demo', { type: 'task', title: 'First', parent: area.id, after: null }, 'user');
        const mid = store.createRecord('demo', { type: 'decision', title: 'Mid', parent: area.id, after: a.id, why: 'because' }, 'agent');
        expect(mid.status).toBe('done'); // a decision written down is made
        expect(a.status).toBe('open');
        expect(b.createdBy).toBe('agent');
        const order = store.records('demo').filter((r) => r.parent === area.id).sort((x, y) => x.order - y.order).map((r) => r.title);
        expect(order).toEqual(['First', 'A', 'Mid', 'B']);
        const journal = store.journal('demo');
        expect(journal).toHaveLength(5);
        expect(journal[0]).toMatchObject({ kind: 'create', by: 'agent', record: mid.id, title: 'Mid', text: 'because' });
    });

    it('refuses what is not valid', () => {
        expect(status(() => store.createRecord('demo', { type: 'task', title: '  ' }, 'user'))).toBe(400);
        expect(status(() => store.createRecord('demo', { type: 'epic', title: 'x' }, 'user'))).toBe(400);
        expect(status(() => store.createRecord('demo', { type: 'task', title: 'x', status: 'later' }, 'user'))).toBe(400);
        expect(status(() => store.createRecord('demo', { type: 'task', title: 'x', parent: 'missing1' }, 'user'))).toBe(404);
        expect(status(() => store.createRecord('demo', { type: 'task', title: 'x', due: '2026-02-30' }, 'user'))).toBe(400);
        expect(store.records('demo')).toEqual([]);
    });

    it('takes the body as text and keeps it as a document', () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'Hello **world**\n\n- one\n- two' }, 'agent');
        expect(r.body?.v).toBe(1);
        expect(docToText(store.record('demo', r.id).body)).toBe('Hello **world**\n\n- one\n- two');
        expect(store.updateRecord('demo', r.id, { text: '   ' }, 'agent').body).toBeNull();
        // a body from the page goes through the editor's gate: what is not a document does not get in
        const dirty = store.updateRecord('demo', r.id, { body: { v: 1, content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] } }, 'user');
        expect(JSON.stringify(dirty.body)).not.toContain('script');
        expect(docToText(dirty.body)).toContain('ok');
    });

    it('updates only what is given and writes what changed', () => {
        const r = store.createRecord('demo', { type: 'task', title: 'T', due: '2026-12-01' }, 'user');
        const same = store.updateRecord('demo', r.id, { title: 'T' }, 'agent');
        expect(same.updated).toBe(r.updated); // nothing changed: nothing written
        expect(same.updatedBy).toBe('user');
        const done = store.updateRecord('demo', r.id, { status: 'done', why: 'checked in the browser' }, 'agent');
        expect(done).toMatchObject({ status: 'done', title: 'T', due: '2026-12-01', updatedBy: 'agent' });
        expect(store.journal('demo')[0]).toMatchObject({ kind: 'update', by: 'agent', changes: { status: ['open', 'done'] }, text: 'checked in the browser' });
        expect(store.updateRecord('demo', r.id, { due: '' }, 'user').due).toBeNull();
        expect(status(() => store.updateRecord('demo', r.id, { status: 'x' }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', 'missing1', { title: 'x' }, 'user'))).toBe(404);
    });

    it('moves a record but not into itself or its own branch', () => {
        const a = store.createRecord('demo', { type: 'area', title: 'A' }, 'user');
        const b = store.createRecord('demo', { type: 'area', title: 'B' }, 'user');
        const t = store.createRecord('demo', { type: 'task', title: 'T', parent: a.id }, 'user');
        expect(store.updateRecord('demo', t.id, { parent: b.id }, 'user').parent).toBe(b.id);
        expect(store.updateRecord('demo', t.id, { parent: null }, 'user').parent).toBeNull();
        store.updateRecord('demo', b.id, { parent: a.id }, 'user');
        expect(status(() => store.updateRecord('demo', a.id, { parent: b.id }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', a.id, { parent: a.id }, 'user'))).toBe(400);
        // a reorder among the same siblings is saved but is not news
        const lines = store.journal('demo').length;
        store.updateRecord('demo', t.id, { after: null }, 'user');
        expect(store.journal('demo')).toHaveLength(lines);
    });

    it('links to records that exist, once', () => {
        const a = store.createRecord('demo', { type: 'decision', title: 'D' }, 'user');
        const b = store.createRecord('demo', { type: 'task', title: 'T' }, 'user');
        const linked = store.updateRecord('demo', b.id, { links: [{ to: a.id, kind: 'because' }, { to: a.id, kind: 'because' }] }, 'agent');
        expect(linked.links).toEqual([{ to: a.id, kind: 'because' }]);
        expect(status(() => store.updateRecord('demo', b.id, { links: [{ to: b.id, kind: 'relates' }] }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', b.id, { links: [{ to: 'missing1', kind: 'relates' }] }, 'user'))).toBe(404);
        expect(status(() => store.updateRecord('demo', b.id, { links: [{ to: a.id, kind: 'loves' }] }, 'user'))).toBe(400);
    });

    it('deletes a branch into the trash and takes away links to it', () => {
        const a = store.createRecord('demo', { type: 'area', title: 'A' }, 'user');
        const t = store.createRecord('demo', { type: 'task', title: 'T', parent: a.id }, 'user');
        const other = store.createRecord('demo', { type: 'note', title: 'O', links: [{ to: t.id, kind: 'relates' }] }, 'user');
        expect(store.deleteRecord('demo', a.id, 'user', 'not needed').sort()).toEqual([a.id, t.id].sort());
        expect(store.records('demo').map((r) => r.id)).toEqual([other.id]);
        expect(store.record('demo', other.id).links).toEqual([]);
        expect(existsSync(join(root, 'demo', 'trash', `${t.id}.json`))).toBe(true);
        expect(store.journal('demo')[0]).toMatchObject({ kind: 'delete', title: 'A', text: 'not needed +1' });
        expect(status(() => store.deleteRecord('demo', a.id, 'user'))).toBe(404);
    });

    it('reads what a hand wrote and ignores what is broken', () => {
        const dir = join(root, 'demo', 'records');
        writeFileSync(join(dir, 'byhand01.json'), JSON.stringify({ id: 'byhand01', type: 'idea', title: 'By hand' }));
        writeFileSync(join(dir, 'broken.json'), '{ not json');
        writeFileSync(join(dir, 'copy.json'), JSON.stringify({ id: 'byhand01', title: 'A copy with a stale id' }));
        const all = store.records('demo');
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ id: 'byhand01', type: 'idea', status: 'open', parent: null });
    });
});

const paragraph = (text: string) => ({ v: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('drafts', () => {
    it('keeps the unsaved text in a file, not in the record and not in the journal', () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'old' }, 'user');
        const lines = store.journal('demo').length;
        expect(store.draft('demo', r.id)).toBeNull();
        expect(store.drafts('demo')).toEqual([]);

        const draft = store.saveDraft('demo', r.id, { body: paragraph('new, typed slowly'), base: r.updated }, 'user');
        expect(draft).toMatchObject({ base: r.updated, by: 'user' });
        expect(docToText(draft.body)).toBe('new, typed slowly');
        // the file is the truth: { body, base, at, by }
        const file = JSON.parse(readFileSync(join(root, 'demo', 'drafts', `${r.id}.json`), 'utf8'));
        expect(Object.keys(file).sort()).toEqual(['at', 'base', 'body', 'by']);
        expect(store.draft('demo', r.id)).toEqual(draft);
        expect(store.drafts('demo')).toEqual([r.id]);

        // typing again replaces it, however often: the record and the journal stay as they were
        store.saveDraft('demo', r.id, { body: paragraph('new, typed slowly, more'), base: r.updated }, 'user');
        store.saveDraft('demo', r.id, { body: paragraph('and more') }, 'agent'); // no base: the draft keeps its own
        expect(store.draft('demo', r.id)).toMatchObject({ base: r.updated, by: 'agent' });
        expect(docToText(store.record('demo', r.id).body)).toBe('old');
        expect(store.record('demo', r.id).updated).toBe(r.updated);
        expect(store.journal('demo')).toHaveLength(lines);

        expect(store.deleteDraft('demo', r.id)).toBe(true);
        expect(store.deleteDraft('demo', r.id)).toBe(false);
        expect(store.draft('demo', r.id)).toBeNull();
        expect(store.drafts('demo')).toEqual([]);
    });

    it('lets a draft be empty and keeps it clean', () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'old' }, 'user');
        expect(store.saveDraft('demo', r.id, { body: null, base: r.updated }, 'user').body).toBeNull(); // "I cleared it" is a draft too
        expect(store.saveDraft('demo', r.id, { body: { v: 1, content: [] }, base: r.updated }, 'user').body).toBeNull();
        const dirty = store.saveDraft('demo', r.id, { body: { v: 1, content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] }, base: r.updated }, 'user');
        expect(JSON.stringify(dirty.body)).not.toContain('script');
        expect(docToText(dirty.body)).toContain('ok');
    });

    it('refuses what is not a draft of a record', () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N' }, 'user');
        expect(status(() => store.saveDraft('demo', 'missing1', { body: null, base: 'x' }, 'user'))).toBe(404);
        expect(status(() => store.saveDraft('demo', '../x', { body: null, base: 'x' }, 'user'))).toBe(400);
        expect(status(() => store.saveDraft('demo', r.id, { base: r.updated }, 'user'))).toBe(400); // no body
        expect(status(() => store.saveDraft('demo', r.id, { body: null, base: 42 }, 'user'))).toBe(400);
        expect(status(() => store.draft('demo', '../x'))).toBe(400);
        expect(status(() => store.draft('nope', r.id))).toBe(404);
        // a file in drafts/ that Axis did not write is not a draft
        mkdirSync(join(root, 'demo', 'drafts'), { recursive: true });
        writeFileSync(join(root, 'demo', 'drafts', 'ghost.json'), '{ not json');
        writeFileSync(join(root, 'demo', 'drafts', 'nobase.json'), JSON.stringify({ body: null }));
        expect(store.drafts('demo')).toEqual([]);
    });

    it('goes to the trash with its record', () => {
        const area = store.createRecord('demo', { type: 'area', title: 'A' }, 'user');
        const t = store.createRecord('demo', { type: 'task', title: 'T', parent: area.id }, 'user');
        const keep = store.createRecord('demo', { type: 'note', title: 'Keep' }, 'user');
        store.saveDraft('demo', area.id, { body: paragraph('a'), base: area.updated }, 'user');
        store.saveDraft('demo', t.id, { body: paragraph('t'), base: t.updated }, 'user');
        store.saveDraft('demo', keep.id, { body: paragraph('k'), base: keep.updated }, 'user');
        store.deleteRecord('demo', area.id, 'user');
        expect(store.drafts('demo')).toEqual([keep.id]);
        // moved, not erased: beside the records in the trash
        expect(existsSync(join(root, 'demo', 'trash', `${area.id}.draft.json`))).toBe(true);
        expect(existsSync(join(root, 'demo', 'trash', `${t.id}.draft.json`))).toBe(true);
        expect(existsSync(join(root, 'demo', 'drafts', `${t.id}.json`))).toBe(false);
    });

    it('refuses a save made against an older version, with the record as it is now', () => {
        const r = store.createRecord('demo', { type: 'note', title: 'N', text: 'old' }, 'user');
        const base = r.updated;
        // the page saves against the base of its draft: the record has not moved, so it goes through
        const ok = store.updateRecord('demo', r.id, { body: paragraph('mine'), base }, 'user');
        expect(docToText(ok.body)).toBe('mine');
        expect(store.journal('demo')[0]).toMatchObject({ kind: 'update', changes: { body: ['', ''] } });

        // somebody else (the agent through MCP: no base) changed the text meanwhile
        const theirs = store.updateRecord('demo', r.id, { text: 'theirs' }, 'agent');
        const lines = store.journal('demo').length;
        let refused: unknown;
        try {
            store.updateRecord('demo', r.id, { body: paragraph('mine again'), base: ok.updated }, 'user');
        } catch (error) {
            refused = error;
        }
        expect(refused).toBeInstanceOf(AxisError);
        expect((refused as AxisError).status).toBe(409);
        expect((refused as AxisError).data).toEqual({ record: theirs });
        // nothing was written: neither the record nor the journal
        expect(docToText(store.record('demo', r.id).body)).toBe('theirs');
        expect(store.journal('demo')).toHaveLength(lines);

        // "overwrite with mine": the same save with the new base
        const forced = store.updateRecord('demo', r.id, { body: paragraph('mine again'), base: theirs.updated }, 'user');
        expect(docToText(forced.body)).toBe('mine again');
        // callers that send no base (MCP) are never refused
        expect(docToText(store.updateRecord('demo', r.id, { text: 'from mcp' }, 'agent').body)).toBe('from mcp');
        expect(status(() => store.updateRecord('demo', r.id, { body: null, base: 7 }, 'user'))).toBe(400);
    });
});

describe('journal and assets', () => {
    it('keeps free notes, newest first, and filters by record', () => {
        const r = store.createRecord('demo', { type: 'task', title: 'T' }, 'user');
        store.log('demo', 'about the project', undefined, 'agent');
        store.log('demo', 'about the task', r.id, 'agent');
        expect(store.journal('demo').map((e) => e.kind)).toEqual(['note', 'note', 'create']);
        expect(store.journal('demo', { record: r.id }).map((e) => e.text ?? e.kind)).toEqual(['about the task', 'create']);
        expect(store.journal('demo', { limit: 1 })).toHaveLength(1);
        expect(status(() => store.log('demo', '  ', undefined, 'user'))).toBe(400);
        expect(status(() => store.log('demo', 'x', 'missing1', 'user'))).toBe(404);
        // the file is plain lines: a broken one does not take the rest with it
        const file = join(root, 'demo', 'journal.jsonl');
        writeFileSync(file, `${readFileSync(file, 'utf8')}garbage\n`);
        expect(store.journal('demo')).toHaveLength(3);
    });

    it('stores a picture by its content and only a picture', () => {
        const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
        const name = store.saveAsset('demo', bytes, 'image/png');
        expect(name).toMatch(/^[0-9a-f]{20}\.png$/);
        expect(store.saveAsset('demo', bytes, 'image/png; charset=binary')).toBe(name);
        expect(readFileSync(store.assetPath('demo', name))).toEqual(Buffer.from(bytes));
        expect(status(() => store.saveAsset('demo', bytes, 'text/html'))).toBe(415);
        expect(status(() => store.saveAsset('demo', new Uint8Array(), 'image/png'))).toBe(400);
        expect(status(() => store.assetPath('demo', '../project.json'))).toBe(400);
        expect(status(() => store.assetPath('demo', 'aaaa.png'))).toBe(404);
        const r = store.createRecord('demo', { type: 'note', title: 'With a picture', images: [name] }, 'user');
        expect(r.images).toEqual([name]);
        expect(status(() => store.updateRecord('demo', r.id, { images: ['missing.png'] }, 'user'))).toBe(404);
    });
});

describe('what the agent sees', () => {
    it('prints an outline, a record and finds by words', () => {
        const area = store.createRecord('demo', { type: 'area', title: 'Редактор' }, 'user');
        const d = store.createRecord('demo', { type: 'decision', title: 'Проект это zip', parent: area.id, text: 'Потому что так делает docx.' }, 'agent');
        const t = store.createRecord('demo', { type: 'task', title: 'Формат файла', parent: area.id, status: 'done', due: '2026-11-20', links: [{ to: d.id, kind: 'because' }] }, 'user');
        store.createRecord('demo', { type: 'task', title: 'Оболочка', parent: area.id }, 'user');
        const records = store.records('demo');
        const outline = outlineText(store.project('demo'), records);
        expect(outline).toContain('Project "demo": Demo · tasks 1/2 done');
        expect(outline).toContain(`- [${area.id}] area  Редактор  (1/2)`);
        expect(outline).toContain(`  - [${d.id}] decision·done  Проект это zip  ¶`);
        expect(outline).toContain(`  - [${t.id}] task·done  Формат файла  due 2026-11-20  → because:${d.id}`);
        expect(outline).toContain(`  - [${d.id}] decision·done  Проект это zip  ¶  ← because:${t.id}`);
        expect(outlineText(store.project('demo'), records, t.id)).toContain(`\n- [${t.id}] task·done`);
        // a branch printed alone still shows the links made from outside of it
        expect(outlineText(store.project('demo'), records, d.id)).toContain(`← because:${t.id}`);
        const text = recordText(store.record('demo', d.id), records, store.journal('demo', { record: d.id }), (n) => n);
        expect(text).toContain('in: Редактор');
        expect(text).toContain(`← because from [${t.id}] Формат файла`);
        expect(text).toContain('Потому что так делает docx.');
        expect(text).toContain('agent · create');
        expect(search(records, 'docx ZIP').map((r) => r.id)).toEqual([d.id]);
        expect(search(records, 'оболочка')).toHaveLength(1);
        expect(search(records, 'нет такого')).toEqual([]);
    });
});
