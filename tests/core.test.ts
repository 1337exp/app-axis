import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROFILES, normalizeDoc } from '@1337exp/taoeditor/core';
import { recordText, search } from '../server/agent.ts';
import { createStore } from '../server/store.ts';
import { diffRecord, parseEntry } from '../src/core/journal.ts';
import { isDay, isId, normalizeRecord } from '../src/core/model.ts';
import type { AxisRecord } from '../src/core/model.ts';
import { docToText, preview, textToDoc } from '../src/core/text.ts';
import { buildTree, canMove, descendants, flatten, orderFor, pathOf, percent, progressOf, progressOfAll } from '../src/core/tree.ts';

const NOW = '2026-11-15T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'task', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}

describe('model', () => {
    it('accepts only safe ids', () => {
        expect(isId('a1b2c3d4')).toBe(true);
        expect(isId('my-project_2')).toBe(true);
        expect(isId('../etc')).toBe(false);
        expect(isId('A')).toBe(false);
        expect(isId('')).toBe(false);
        expect(isId('-x')).toBe(false);
    });

    it('knows a real day from a string that looks like one', () => {
        expect(isDay('2026-02-28')).toBe(true);
        expect(isDay('2026-02-30')).toBe(false);
        expect(isDay('2026-2-3')).toBe(false);
        expect(isDay(20260228)).toBe(false);
    });

    it('makes a hand-edited record valid and drops what cannot be one', () => {
        expect(normalizeRecord({ title: 'no id' }, NOW)).toBeNull();
        const r = normalizeRecord(
            { id: 'abc', type: 'weird', title: '  two\n lines  ', status: 'maybe', parent: 'abc', due: '2026-13-01', links: [{ to: 'abc' }, { to: 'x', kind: 'because' }, { to: 'x', kind: 'because' }, { to: 'y' }], images: ['a.png', '../b.png', 'a.png'] },
            NOW,
        )!;
        expect(r.type).toBe('note');
        expect(r.title).toBe('two lines');
        expect(r.status).toBe('open');
        expect(r.parent).toBeNull(); // not its own parent
        expect(r.due).toBeNull();
        expect(r.links).toEqual([{ to: 'x', kind: 'because' }, { to: 'y', kind: 'relates' }]);
        expect(r.images).toEqual(['a.png']);
        expect(r.created).toBe(NOW);
    });
});

describe('tree', () => {
    const records = [
        rec('area', { type: 'area', order: 1 }),
        rec('t1', { parent: 'area', order: 2, status: 'done' }),
        rec('t2', { parent: 'area', order: 1, status: 'active' }),
        rec('t3', { parent: 'area', order: 3, status: 'dropped' }),
        rec('q1', { parent: 't2', type: 'question' }),
        rec('d1', { parent: 't2', type: 'decision', status: 'done' }),
        rec('top', { order: 0 }),
        rec('lost', { parent: 'nowhere', order: 5 }),
    ];

    it('builds branches in order and lifts orphans to the top', () => {
        const tree = buildTree(records);
        expect(tree.map((n) => n.record.id)).toEqual(['top', 'area', 'lost']);
        expect(tree[1]!.children.map((n) => n.record.id)).toEqual(['t2', 't1', 't3']);
        expect(flatten(tree).find((n) => n.record.id === 'q1')!.depth).toBe(2);
    });

    it('does not hang or lose records on a cycle', () => {
        const cycle = [rec('a', { parent: 'b' }), rec('b', { parent: 'a' }), rec('c', { parent: 'a' })];
        const ids = flatten(buildTree(cycle)).map((n) => n.record.id).sort();
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('counts tasks only, without the dropped ones', () => {
        const area = buildTree(records)[1]!;
        expect(progressOf(area)).toEqual({ done: 1, total: 2, active: 1, questions: 1 });
        expect(percent(progressOf(area))).toBe(50);
        expect(progressOfAll(records)).toEqual({ done: 1, total: 4, active: 1, questions: 1 });
        expect(percent({ done: 0, total: 0, active: 0, questions: 0 })).toBe(0);
    });

    it('lists what is under a record and refuses a move into it', () => {
        expect(descendants(records, 'area').sort()).toEqual(['d1', 'q1', 't1', 't2', 't3']);
        expect(canMove(records, 'area', 'q1')).toBe(false);
        expect(canMove(records, 'area', 'area')).toBe(false);
        expect(canMove(records, 'area', 'missing')).toBe(false);
        expect(canMove(records, 'q1', 'top')).toBe(true);
        expect(canMove(records, 'q1', null)).toBe(true);
    });

    it('finds a place among siblings', () => {
        expect(orderFor(records, 'area')).toBe(4); // last
        expect(orderFor(records, 'area', null)).toBe(0); // first
        expect(orderFor(records, 'area', 't2')).toBe(1.5); // between t2 (1) and t1 (2)
        expect(orderFor(records, 'area', 't3')).toBe(4); // after the last
        expect(orderFor(records, 'empty')).toBe(0);
        // the record that moves does not count as its own neighbour
        expect(orderFor(records, 'area', 't2', 't1')).toBe(2); // between t2 (1) and t3 (3)
    });

    it('gives the path from the top', () => {
        expect(pathOf(records, 'q1').map((r) => r.id)).toEqual(['area', 't2', 'q1']);
    });
});

describe('text', () => {
    const SAMPLE = [
        '# Формат проекта',
        '',
        'Проект это **zip** с файлами, см. [спека](https://example.com/spec).\\',
        'Вторая строка абзаца с `кодом` и *курсивом*.',
        '',
        '- первый',
        '- второй',
        '  - вложенный',
        '',
        '1. раз',
        '2. два',
        '',
        '> цитата',
        '',
        '| имя | значение |',
        '| --- | --- |',
        '| a | 1 |',
        '| b | 2 |',
        '',
        '```ts',
        'const a = **not bold**;',
        '```',
    ].join('\n');

    it('keeps the stored document when the text it gave is read back', () => {
        const doc = textToDoc(SAMPLE)!;
        expect(textToDoc(docToText(doc))).toEqual(doc);
        const odd = textToDoc('2 * 3 * 4, some_var_name, # not a heading, 1. not a list')!;
        expect(textToDoc(docToText(odd))).toEqual(odd);
    });

    it('makes a document the editor accepts as is', () => {
        const doc = textToDoc(SAMPLE)!;
        const { doc: clean, issues } = normalizeDoc(doc, PROFILES.article);
        expect(issues).toEqual([]);
        expect(clean).toEqual(doc);
    });

    it('keeps a line end inside a paragraph as a line break', () => {
        const para = textToDoc('first\nsecond')!.content[0]!;
        expect(para.content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
        // the library writes that break as a backslash at the line end; both spellings give one document
        expect(docToText(textToDoc('first\nsecond'))).toBe('first\\\nsecond');
        expect(textToDoc('first\\\nsecond')).toEqual(textToDoc('first\nsecond'));
    });

    it('gives null for nothing and "" for no document', () => {
        expect(textToDoc('')).toBeNull();
        expect(textToDoc('  \n\n ')).toBeNull();
        expect(docToText(null)).toBe('');
    });

    it('cuts a preview to one line without marks', () => {
        expect(preview(textToDoc('# Title\n\nSome **text** here'), 16)).toBe('Title Some text…');
        expect(preview(textToDoc('a_b `c`\n\n- x'))).toBe('a_b c x');
        expect(preview(null)).toBe('');
    });

    it('reads a record to the agent and takes the same text back without changing the document', () => {
        const root = mkdtempSync(join(tmpdir(), 'axis-core-'));
        try {
            const store = createStore(root);
            store.createProject({ title: 'Demo', id: 'demo' });
            const made = store.createRecord('demo', { type: 'note', title: 'N', text: SAMPLE }, 'claude');
            const read = recordText(store.record('demo', made.id), store.records('demo'), [], (name) => name);
            // `axis_read` prints the text after the header lines and an empty one; `axis_update` takes it as it is
            const text = read.slice(read.indexOf('\n\n') + 2);
            expect(text).toBe(SAMPLE);
            const again = store.updateRecord('demo', made.id, { text }, 'claude');
            expect(again.body).not.toBeNull();
            expect(again.body).toEqual(made.body);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('finds words in a text with marks and escapes', () => {
        const withMarks = rec('a', { body: textToDoc('some_var and **bold** words') });
        expect(search([withMarks], 'some_var bold')).toHaveLength(1);
        expect(search([withMarks], 'missing')).toHaveLength(0);
    });
});

describe('journal', () => {
    it('names what changed and stays silent about a reorder', () => {
        const before = rec('a', { title: 'old', status: 'open' });
        expect(diffRecord(before, { ...before, order: 7 })).toBeUndefined();
        expect(diffRecord(before, { ...before, title: 'new', status: 'done', body: textToDoc('hi'), links: [{ to: 'b', kind: 'because' }] })).toEqual({
            title: ['old', 'new'],
            status: ['open', 'done'],
            body: ['', ''],
            links: ['', 'because:b'],
        });
    });

    it('reads a line and survives a broken one', () => {
        expect(parseEntry('{"t":"2026-11-15T10:00:00Z","by":"claude","kind":"note","record":null,"title":"","text":"hi"}')).toEqual({
            t: '2026-11-15T10:00:00Z', by: 'claude', kind: 'note', record: null, title: '', text: 'hi',
        });
        expect(parseEntry('{not json')).toBeNull();
        expect(parseEntry('"just a string"')).toBeNull();
    });
});

describe('quick input', () => {
    it('reads the type from a mark or a word, else takes the default', async () => {
        const { parseQuick } = await import('../src/core/quick.ts');
        expect(parseQuick('? когда выпускаем', 'task')).toEqual({ type: 'question', title: 'когда выпускаем', explicit: true });
        expect(parseQuick('! проект это zip', 'task')).toEqual({ type: 'decision', title: 'проект это zip', explicit: true });
        expect(parseQuick('Идея:  тёмная   тема', 'task')).toEqual({ type: 'idea', title: 'тёмная тема', explicit: true });
        expect(parseQuick('todo: tests', 'note')).toEqual({ type: 'task', title: 'tests', explicit: true });
        expect(parseQuick('сделать оболочку', 'task')).toEqual({ type: 'task', title: 'сделать оболочку', explicit: false });
        // a mark needs a space after it, an unknown word is just text
        expect(parseQuick('?что', 'note')).toEqual({ type: 'note', title: '?что', explicit: false });
        expect(parseQuick('Tauri: когда?', 'note')).toEqual({ type: 'note', title: 'Tauri: когда?', explicit: false });
        expect(parseQuick('   ', 'task')).toBeNull();
        expect(parseQuick('? ', 'task')).toBeNull();
        expect(parseQuick('идея:', 'task')).toBeNull();
    });
});
