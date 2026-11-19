import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brainMark, outlineText, recordText } from '../server/agent.ts';
import { AxisError, createStore } from '../server/store.ts';
import type { Store } from '../server/store.ts';
import { buildThreads, ideaFromText, ratingOf, roundState, waitingSeeds } from '../src/core/brainstorm.ts';
import { diffRecord } from '../src/core/journal.ts';
import { normalizeBrain, normalizeRecord } from '../src/core/model.ts';
import type { AxisRecord, Brain } from '../src/core/model.ts';

const NOW = '2026-11-15T10:00:00.000Z';

function rec(id: string, patch: Partial<AxisRecord> = {}): AxisRecord {
    return {
        v: 1, id, type: 'idea', title: id, body: null, status: 'open', parent: null, order: 0, links: [], due: null, images: [],
        brain: null, created: NOW, updated: NOW, createdBy: 'user', updatedBy: 'user', ...patch,
    };
}
const brain = (role: Brain['role'], patch: Partial<Brain> = {}): Brain => ({ role, like: false, dislike: false, remark: '', handed: false, ...patch });
const seed = (id: string, patch: Partial<AxisRecord> & { handed?: boolean } = {}): AxisRecord => {
    const { handed, ...rest } = patch;
    return rec(id, { brain: brain('seed', { handed: handed === true }), ...rest });
};
const variant = (id: string, parent: string, b: Partial<Brain> = {}, order = 0): AxisRecord => rec(id, { parent, order, brain: brain('variant', b) });
const verdict = (id: string, parent: string, patch: Partial<AxisRecord> = {}): AxisRecord => rec(id, { type: 'note', parent, order: 50, brain: brain('verdict'), ...patch });

describe('the brain field of a record', () => {
    it('keeps an old record without it working: brain is null', () => {
        const old = normalizeRecord({ id: 'a1', type: 'idea', title: 'Old', status: 'open' }, NOW);
        expect(old).not.toBeNull();
        expect(old!.brain).toBeNull();
    });

    it('turns an unknown role, junk or no role into null', () => {
        expect(normalizeBrain({ role: 'boss', like: true })).toBeNull();
        expect(normalizeBrain({ like: true })).toBeNull();
        expect(normalizeBrain('seed')).toBeNull();
        expect(normalizeBrain(['seed'])).toBeNull();
        expect(normalizeBrain(null)).toBeNull();
        expect(normalizeRecord({ id: 'a1', brain: { role: 'boss' } }, NOW)!.brain).toBeNull();
    });

    it('drops what does not fit the role', () => {
        const all = { like: true, dislike: true, remark: ' note ', handed: true };
        expect(normalizeBrain({ role: 'variant', ...all })).toEqual({ role: 'variant', like: true, dislike: true, remark: 'note', handed: false });
        expect(normalizeBrain({ role: 'seed', ...all })).toEqual({ role: 'seed', like: false, dislike: false, remark: '', handed: true });
        expect(normalizeBrain({ role: 'verdict', ...all })).toEqual({ role: 'verdict', like: false, dislike: false, remark: '', handed: false });
        // only a real true counts; a remark is cut to 1000 characters
        expect(normalizeBrain({ role: 'variant', like: 'yes', dislike: 1 })).toMatchObject({ like: false, dislike: false });
        expect(normalizeBrain({ role: 'variant', remark: 'x'.repeat(1500) })!.remark).toHaveLength(1000);
    });
});

describe('ratingOf', () => {
    it('reads the two independent marks', () => {
        expect(ratingOf(variant('v', 's', { like: true }))).toBe('good');
        expect(ratingOf(variant('v', 's', { dislike: true }))).toBe('bad');
        expect(ratingOf(variant('v', 's', { like: true, dislike: true }))).toBe('disputed');
        expect(ratingOf(variant('v', 's'))).toBe('neutral');
        expect(ratingOf(rec('plain'))).toBe('neutral');
    });
});

describe('threads', () => {
    it('builds a three round chain: seed, variants, verdict, reply, and so on', () => {
        const records = [
            rec('top', { type: 'area' }),
            seed('s1', { parent: 'top' }),
            variant('v2', 's1', {}, 2),
            variant('v1', 's1', { like: true }, 1),
            verdict('d1', 's1'),
            seed('s2', { parent: 'd1' }),
            variant('w1', 's2', { dislike: true }),
            verdict('d2', 's2'),
            seed('s3', { parent: 'd2', handed: true }),
        ];
        const threads = buildThreads(records);
        expect(threads).toHaveLength(1);
        const [thread] = threads;
        expect(thread!.id).toBe('s1');
        expect(thread!.rounds.map((r) => r.seed.id)).toEqual(['s1', 's2', 's3']);
        const [r1, r2, r3] = thread!.rounds;
        expect(r1!.variants.map((v) => v.id)).toEqual(['v1', 'v2']); // by order
        expect(r1!.verdict?.id).toBe('d1');
        expect(r1!.reply).toBe(r2);
        expect(r2!.variants.map((v) => v.id)).toEqual(['w1']);
        expect(r2!.reply).toBe(r3);
        expect(r3).toMatchObject({ variants: [], verdict: null, reply: null });
        expect(thread!.rounds.map(roundState)).toEqual(['closed', 'closed', 'waiting']);
    });

    it('takes a seed with no variants as a thread of one draft round', () => {
        const threads = buildThreads([seed('s1'), rec('plain'), seed('s2')]);
        expect(threads.map((t) => t.id)).toEqual(['s1', 's2']);
        expect(threads[0]!.rounds).toHaveLength(1);
        expect(threads[0]!.rounds[0]).toMatchObject({ variants: [], verdict: null, reply: null });
        expect(roundState(threads[0]!.rounds[0]!)).toBe('draft');
    });

    it('does not start a thread at a reply, and gives each seed in the tree its own thread', () => {
        const threads = buildThreads([seed('s1'), verdict('d1', 's1'), seed('s2', { parent: 'd1' }), seed('x', { order: 9 })]);
        expect(threads.map((t) => t.id)).toEqual(['s1', 'x']);
    });

    it('loses no seed: a second reply under one verdict, or a seed under a stray verdict, starts a thread', () => {
        const records = [seed('s1'), verdict('d1', 's1'), seed('r1', { parent: 'd1', order: 1 }), seed('r2', { parent: 'd1', order: 2 }), verdict('lost', 'plain'), rec('plain', { type: 'area' }), seed('r3', { parent: 'lost' })];
        const threads = buildThreads(records);
        expect(threads.map((t) => t.id).sort()).toEqual(['r2', 'r3', 's1']);
        expect(threads.find((t) => t.id === 's1')!.rounds.map((r) => r.seed.id)).toEqual(['s1', 'r1']);
    });

    it('ignores a variant or a verdict that is not under a seed, and survives a parent cycle', () => {
        expect(buildThreads([rec('plain'), variant('v', 'plain'), verdict('d', 'plain')])).toEqual([]);
        expect(() => buildThreads([seed('a', { parent: 'b' }), verdict('b', 'a'), seed('c', { parent: 'b' })])).not.toThrow();
    });

    it('takes the last verdict when there are two', () => {
        const [t] = buildThreads([seed('s1'), verdict('d1', 's1', { order: 1 }), verdict('d2', 's1', { order: 2 })]);
        expect(t!.rounds[0]!.verdict?.id).toBe('d2');
    });
});

describe('roundState', () => {
    const one = (records: AxisRecord[]) => buildThreads(records)[0]!.rounds[0]!;

    it('walks draft, waiting, rating, verdict, closed', () => {
        expect(roundState(one([seed('s')]))).toBe('draft');
        expect(roundState(one([seed('s', { handed: true })]))).toBe('waiting');
        expect(roundState(one([seed('s', { handed: true }), variant('v', 's')]))).toBe('waiting'); // handed wins over rating
        expect(roundState(one([seed('s'), variant('v', 's')]))).toBe('rating');
        expect(roundState(one([seed('s'), variant('v', 's'), verdict('d', 's')]))).toBe('verdict');
        expect(roundState(one([seed('s'), verdict('d', 's'), seed('r', { parent: 'd' })]))).toBe('closed');
    });

    it('closes on a verdict that is an accepted decision, but not on a decision still open', () => {
        expect(roundState(one([seed('s'), verdict('d', 's', { type: 'decision', status: 'done' })]))).toBe('closed');
        expect(roundState(one([seed('s'), verdict('d', 's', { type: 'decision', status: 'open' })]))).toBe('verdict');
        expect(roundState(one([seed('s'), verdict('d', 's', { type: 'note', status: 'done' })]))).toBe('verdict');
    });

    it('finds the seeds that wait for the agent', () => {
        const records = [seed('a', { handed: true }), seed('b'), rec('c'), seed('d', { handed: true }), variant('v', 'a')];
        expect(waitingSeeds(records).map((r) => r.id)).toEqual(['a', 'd']);
    });
});

describe('the journal of brain changes', () => {
    it('describes role, rating, remark and handed in short values', () => {
        const before = variant('v', 's');
        const after = { ...before, brain: brain('variant', { like: true, remark: 'nice' }) };
        expect(diffRecord(before, after)).toEqual({ rating: ['neutral', 'good'], remark: ['', 'nice'] });
        expect(diffRecord(seed('s'), seed('s', { handed: true }))).toEqual({ handed: ['', 'yes'] });
        expect(diffRecord(rec('a'), seed('a'))).toEqual({ role: ['', 'seed'] });
        expect(diffRecord(variant('v', 's'), variant('v', 's'))).toBeUndefined();
    });

    it('notices a change of a long remark past the cut', () => {
        const long = 'x'.repeat(100);
        expect(diffRecord(variant('v', 's', { remark: `${long}a` }), variant('v', 's', { remark: `${long}b` }))).toBeDefined();
    });
});

describe('the store and the brainstorm rules', () => {
    let root: string;
    let store: Store;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'axis-brain-'));
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
    const newSeed = (handed = true): AxisRecord => {
        const s = store.createRecord('demo', { type: 'idea', title: 'Seed', brain: { role: 'seed' } }, 'user');
        return handed ? store.updateRecord('demo', s.id, { brain: { handed: true } }, 'user') : s;
    };

    it('stores brain on a new record and a record without it reads as null', () => {
        const plain = store.createRecord('demo', { type: 'note', title: 'Plain' }, 'user');
        expect(plain.brain).toBeNull();
        expect(store.record('demo', plain.id).brain).toBeNull();
        const s = newSeed(false);
        expect(store.record('demo', s.id).brain).toEqual(brain('seed'));
    });

    it('changes only the fields passed, and clears with null or an empty role', () => {
        const s = newSeed(false);
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, role: 'variant' }, 'agent');
        expect(v.brain).toEqual(brain('variant'));
        const liked = store.updateRecord('demo', v.id, { brain: { like: true } }, 'user');
        expect(liked.brain).toEqual(brain('variant', { like: true }));
        const marked = store.updateRecord('demo', v.id, { brain: { remark: ' hm ' } }, 'user');
        expect(marked.brain).toEqual(brain('variant', { like: true, remark: 'hm' }));
        const both = store.updateRecord('demo', v.id, { brain: { dislike: true } }, 'user');
        expect(ratingOf(both)).toBe('disputed');
        const off = store.updateRecord('demo', v.id, { brain: { like: false, dislike: false } }, 'user');
        expect(ratingOf(off)).toBe('neutral');
        expect(off.brain!.remark).toBe('hm');
        expect(store.updateRecord('demo', v.id, { role: '' }, 'user').brain).toBeNull();
        expect(store.updateRecord('demo', v.id, { role: 'variant' }, 'user').brain).toEqual(brain('variant')); // a fresh role starts clean
        expect(store.updateRecord('demo', v.id, { brain: null }, 'user').brain).toBeNull();
    });

    it('ignores what does not fit: like on a seed, handed on a variant, any brain field on a record without a role', () => {
        const s = newSeed(false);
        const afterLike = store.updateRecord('demo', s.id, { brain: { like: true, remark: 'x' } }, 'user');
        expect(afterLike.brain).toEqual(brain('seed'));
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, brain: { role: 'variant', handed: true, like: true } }, 'user');
        expect(v.brain).toEqual(brain('variant', { like: true }));
        const plain = store.createRecord('demo', { type: 'note', title: 'N' }, 'user');
        expect(store.updateRecord('demo', plain.id, { brain: { like: true, handed: true } }, 'user').brain).toBeNull();
        expect(store.updateRecord('demo', v.id, { brain: { handed: true } }, 'user').brain).toEqual(brain('variant', { like: true }));
    });

    it('refuses a bad role or a field of a wrong kind', () => {
        const s = newSeed(false);
        expect(status(() => store.updateRecord('demo', s.id, { role: 'boss' }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', s.id, { brain: { role: 'boss' } }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', s.id, { brain: 'seed' }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', s.id, { brain: { handed: 'yes' } }, 'user'))).toBe(400);
        expect(status(() => store.updateRecord('demo', s.id, { brain: { remark: 5 } }, 'user'))).toBe(400);
        expect(status(() => store.createRecord('demo', { type: 'idea', title: 'x', role: 'boss' }, 'user'))).toBe(400);
    });

    it('lets the agent set only the role', () => {
        const s = newSeed(false);
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, role: 'variant' }, 'agent');
        const tried = store.updateRecord('demo', v.id, { brain: { like: true, dislike: true, remark: 'mine', handed: true } }, 'agent');
        expect(tried.brain).toEqual(brain('variant'));
        const asked = store.updateRecord('demo', s.id, { brain: { handed: true } }, 'agent');
        expect(asked.brain!.handed).toBe(false);
        const made = store.createRecord('demo', { type: 'idea', title: 'W', parent: s.id, brain: { role: 'variant', like: true } }, 'agent');
        expect(made.brain).toEqual(brain('variant'));
    });

    it('clears handed when a verdict is added under the seed, with a line in the journal', () => {
        const s = newSeed(true);
        expect(store.record('demo', s.id).brain!.handed).toBe(true);
        const d = store.createRecord('demo', { type: 'note', title: 'Verdict', parent: s.id, role: 'verdict', why: 'rated' }, 'agent');
        expect(d.brain).toEqual(brain('verdict'));
        expect(store.record('demo', s.id).brain!.handed).toBe(false);
        const [last, previous] = store.journal('demo');
        expect(last).toMatchObject({ kind: 'update', by: 'agent', record: s.id, changes: { handed: ['yes', ''] }, text: 'verdict added, turn passed back to the person' });
        expect(previous).toMatchObject({ kind: 'create', record: d.id });
    });

    it('clears handed when variants are added too, so the seed does not keep waiting while the person rates', () => {
        const s = newSeed(true);
        store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, role: 'variant' }, 'agent');
        expect(store.record('demo', s.id).brain!.handed).toBe(false);
        expect(store.journal('demo')[0]).toMatchObject({ record: s.id, text: 'variant added, turn passed back to the person' });
    });

    it('clears handed when an existing record becomes a verdict under a seed, and not otherwise', () => {
        const s = newSeed(true);
        const note = store.createRecord('demo', { type: 'note', title: 'Later a verdict', parent: s.id }, 'agent');
        expect(store.record('demo', s.id).brain!.handed).toBe(true); // an ordinary child changes nothing
        store.updateRecord('demo', note.id, { title: 'Renamed' }, 'agent');
        expect(store.record('demo', s.id).brain!.handed).toBe(true);
        store.updateRecord('demo', note.id, { role: 'verdict' }, 'agent');
        expect(store.record('demo', s.id).brain!.handed).toBe(false);
        // a verdict somewhere else does not touch a handed seed
        const other = newSeed(true);
        const stray = store.createRecord('demo', { type: 'note', title: 'Stray', role: 'verdict' }, 'agent');
        expect(stray.brain!.role).toBe('verdict');
        expect(store.record('demo', other.id).brain!.handed).toBe(true);
        // a person rating a variant leaves the turn alone
        const again = newSeed(true);
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: again.id }, 'user');
        store.updateRecord('demo', v.id, { role: 'variant' }, 'user');
        store.updateRecord('demo', again.id, { brain: { handed: true } }, 'user');
        store.updateRecord('demo', v.id, { brain: { like: true } }, 'user');
        expect(store.record('demo', again.id).brain!.handed).toBe(true);
    });

    it('writes readable journal lines for rating and handing', () => {
        const s = newSeed(false);
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, role: 'variant' }, 'agent');
        store.updateRecord('demo', v.id, { brain: { like: true } }, 'user');
        expect(store.journal('demo')[0]).toMatchObject({ by: 'user', kind: 'update', changes: { rating: ['neutral', 'good'] } });
        store.updateRecord('demo', v.id, { brain: { remark: 'because' } }, 'user');
        expect(store.journal('demo')[0]!.changes).toEqual({ remark: ['', 'because'] });
        store.updateRecord('demo', s.id, { brain: { handed: true } }, 'user');
        expect(store.journal('demo')[0]!.changes).toEqual({ handed: ['', 'yes'] });
    });

    it('does not write a line for a brain change that changes nothing', () => {
        const s = newSeed(true);
        const lines = store.journal('demo').length;
        store.updateRecord('demo', s.id, { brain: { handed: true } }, 'user');
        expect(store.journal('demo')).toHaveLength(lines);
    });

    it('leaves the search, the tree and the progress as they were', () => {
        const s = newSeed(true);
        store.createRecord('demo', { type: 'idea', title: 'Variant about rockets', parent: s.id, role: 'variant' }, 'agent');
        const records = store.records('demo');
        expect(records).toHaveLength(2);
        expect(store.projects()[0]!.progress.total).toBe(0);
    });
});

describe('what the agent sees', () => {
    let root: string;
    let store: Store;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'axis-brain-agent-'));
        store = createStore(root);
        store.createProject({ title: 'Demo', id: 'demo' });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('marks seeds, variants and verdicts at the end of the outline line', () => {
        const s = store.createRecord('demo', { type: 'idea', title: 'Seed', brain: { role: 'seed', handed: true } }, 'user');
        const good = store.createRecord('demo', { type: 'idea', title: 'Good', parent: s.id, brain: { role: 'variant', like: true, remark: 'yes' } }, 'user');
        store.createRecord('demo', { type: 'idea', title: 'Bad', parent: s.id, brain: { role: 'variant', dislike: true } }, 'user');
        store.createRecord('demo', { type: 'idea', title: 'Both', parent: s.id, brain: { role: 'variant', like: true, dislike: true } }, 'user');
        store.createRecord('demo', { type: 'idea', title: 'Plain', parent: s.id, role: 'variant' }, 'agent');
        const lines = outlineText(store.project('demo'), store.records('demo')).split('\n');
        const of = (title: string) => lines.find((l) => l.includes(`  ${title}`))!;
        // the first variant of the agent passed the turn back, so the seed shows no wait mark here: hand it again
        expect(of('Seed').endsWith('seed')).toBe(true);
        store.updateRecord('demo', s.id, { brain: { handed: true } }, 'user');
        const handed = outlineText(store.project('demo'), store.records('demo')).split('\n').find((l) => l.includes('  Seed'))!;
        expect(handed.endsWith('seed  ⏳ waits for the agent')).toBe(true);
        expect(of('Good').endsWith('variant + ✎')).toBe(true);
        expect(of('Bad').endsWith('variant -')).toBe(true);
        expect(of('Both').endsWith('variant ±')).toBe(true);
        expect(of('Plain').endsWith('variant')).toBe(true);
        expect(brainMark(rec('plain'))).toBe('');
        expect(brainMark(verdict('d', 's'))).toBe('verdict');
        expect(brainMark(good)).toBe('variant + ✎');
    });

    it('shows the role, the rating and the remark in a full read', () => {
        const s = store.createRecord('demo', { type: 'idea', title: 'Seed', brain: { role: 'seed' } }, 'user');
        const v = store.createRecord('demo', { type: 'idea', title: 'V', parent: s.id, brain: { role: 'variant', dislike: true, remark: 'too costly' } }, 'user');
        store.updateRecord('demo', s.id, { brain: { handed: true } }, 'user');
        const read = (r: AxisRecord) => recordText(store.record('demo', r.id), store.records('demo'), [], (n) => n);
        expect(read(s)).toContain('brainstorm: seed, handed: it is your turn');
        const text = read(v);
        expect(text).toContain('brainstorm: variant, rating: bad (disliked)');
        expect(text).toContain('remark of the person: too costly');
    });
});

describe('the MCP server', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'axis-brain-mcp-'));
        const store = createStore(root);
        store.createProject({ title: 'Demo', id: 'demo' });
        store.createRecord('demo', { type: 'idea', title: 'Seed', brain: { role: 'seed', handed: true } }, 'user');
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    /** Runs the real server over stdio: one JSON-RPC call per line. */
    const call = (calls: { name: string; arguments: Record<string, unknown> }[]): string[] => {
        const input = calls.map((params, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params })).join('\n');
        const run = spawnSync(process.execPath, [join(process.cwd(), 'server', 'mcp.ts')], { input: `${input}\n`, env: { ...process.env, AXIS_DATA: root }, encoding: 'utf8' });
        return run.stdout.trim().split('\n').map((l) => (JSON.parse(l) as { result: { content: { text: string }[] } }).result.content[0]!.text);
    };

    it('counts the rounds that wait, adds a role, and takes no ratings from the agent', () => {
        const [projects, overview] = call([
            { name: 'axis_projects', arguments: {} },
            { name: 'axis_overview', arguments: { project: 'demo' } },
        ]);
        expect(projects).toContain('1 round waits for the agent');
        const seedId = /\[(\w{8})\]/.exec(overview!)![1]!;
        expect(overview).toContain('seed  ⏳ waits for the agent');

        const [added, readSeed, projectsAfter] = call([
            { name: 'axis_add', arguments: { project: 'demo', type: 'idea', title: 'Option', parent: seedId, role: 'variant', brain: { role: 'variant', like: true, remark: 'sneaky', handed: true } } },
            { name: 'axis_read', arguments: { project: 'demo', id: seedId } },
            { name: 'axis_projects', arguments: {} },
        ]);
        expect(added).toContain('Added');
        expect(readSeed).toContain('brainstorm: seed');
        expect(readSeed).not.toContain('it is your turn');
        expect(projectsAfter).not.toContain('wait');
        const variant = createStore(root).records('demo').find((r) => r.title === 'Option')!;
        expect(variant.brain).toEqual(brain('variant'));
    });
});

describe('ideaFromText', () => {
    it('takes the first line as the title and the whole text as the body when there is more', () => {
        expect(ideaFromText('Just a title')).toEqual({ title: 'Just a title', text: null });
        expect(ideaFromText('  \n  Title  \nMore words\n\nand more ')).toEqual({ title: 'Title', text: 'Title  \nMore words\n\nand more' });
        expect(ideaFromText('Title\r\nBody')).toEqual({ title: 'Title', text: 'Title\nBody' });
    });

    it('gives nothing for empty text and cuts a long first line, keeping the whole text', () => {
        expect(ideaFromText('')).toBeNull();
        expect(ideaFromText(' \n\t ')).toBeNull();
        const long = 'w'.repeat(500);
        const idea = ideaFromText(long)!;
        expect(idea.title).toHaveLength(300);
        expect(idea.text).toBe(long);
    });
});
