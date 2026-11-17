/**
 * Brainstorm rounds, built from the flat list of records. Nothing is stored for a round: it is the shape of the tree.
 * A round is a `seed` record, its `variant` children, its `verdict` child, and the reply: the next round, whose seed
 * is a child `seed` of that verdict. A thread is a chain of rounds from a seed that is not itself a reply.
 *
 * Раунды брейншторма, собранные из плоского списка записей. Для раунда ничего не хранится: это форма дерева.
 * Раунд это запись `seed`, её дети `variant`, её ребёнок `verdict` и ответ: следующий раунд, чья задумка это
 * дочерний `seed` вердикта. Нить это цепочка раундов от задумки, которая сама не является ответом.
 */
import { cleanTitle, TITLE_MAX } from './model.ts';
import type { AxisRecord } from './model.ts';

/** How the person rated a variant. / Как человек оценил вариант. */
export type Rating = 'good' | 'bad' | 'disputed' | 'neutral';

/** Where a round stands. / На каком шаге раунд. */
export type RoundState = 'draft' | 'waiting' | 'rating' | 'verdict' | 'closed';

export interface Round {
    seed: AxisRecord;
    /** `variant` children of the seed, in tree order. / Дети `variant`, по порядку в дереве. */
    variants: AxisRecord[];
    /** The `verdict` child (the last one, if there are several), or null. / Ребёнок `verdict` (последний, если их несколько) или null. */
    verdict: AxisRecord | null;
    /** The next round: the seed under the verdict (the first one, if there are several; the others start threads of their own). / Следующий раунд: задумка под вердиктом (первая, если их несколько). */
    reply: Round | null;
}

export interface Thread {
    /** Id of the first seed. / Id первой задумки. */
    id: string;
    /** The rounds one after another: each is the reply of the one before. / Раунды друг за другом: каждый ответ предыдущего. */
    rounds: Round[];
}

/** 👍 only is good, 👎 only is bad, both is disputed, none is neutral. Anything but a variant is neutral. / Только 👍 хорошо, только 👎 плохо, оба спорно, ни одной нейтрально. */
export function ratingOf(variant: AxisRecord): Rating {
    const b = variant.brain;
    if (!b || b.role !== 'variant') return 'neutral';
    if (b.like && b.dislike) return 'disputed';
    if (b.like) return 'good';
    if (b.dislike) return 'bad';
    return 'neutral';
}

/** A verdict the person accepted: it became a decision and is done. / Принятый вердикт: он стал решением и готов. */
export const isAccepted = (verdict: AxisRecord): boolean => verdict.type === 'decision' && verdict.status === 'done';

/**
 * Where a round stands. Closed wins over everything (a reply exists or the verdict is accepted); then the turn of
 * Claude (`waiting`); then a verdict nobody answered yet; then variants to rate; then a seed alone.
 *
 * На каком шаге раунд. Закрыт важнее всего (есть ответ или вердикт принят); затем ход Claude (`waiting`); затем
 * вердикт без ответа; затем варианты для оценки; затем одна задумка.
 */
export function roundState(round: Round): RoundState {
    if (round.reply || (round.verdict && isAccepted(round.verdict))) return 'closed';
    if (round.seed.brain?.handed === true) return 'waiting';
    if (round.verdict) return 'verdict';
    if (round.variants.length > 0) return 'rating';
    return 'draft';
}

/** Seeds whose turn is passed to Claude. / Задумки, чей ход передан Claude. */
export const waitingSeeds = (records: readonly AxisRecord[]): AxisRecord[] =>
    records.filter((r) => r.brain?.role === 'seed' && r.brain.handed === true);

/** The records of the tree in tree order (depth first, siblings by `order`). / Записи в порядке дерева. */
function inTreeOrder(records: readonly AxisRecord[]): AxisRecord[] {
    const ids = new Set(records.map((r) => r.id));
    const kids = new Map<string | null, AxisRecord[]>();
    for (const r of records) {
        const key = r.parent !== null && ids.has(r.parent) ? r.parent : null;
        const list = kids.get(key);
        if (list) list.push(r);
        else kids.set(key, [r]);
    }
    for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
    const out: AxisRecord[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null): void => {
        for (const r of kids.get(parent) ?? []) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            out.push(r);
            walk(r.id);
        }
    };
    walk(null);
    return out;
}

/**
 * The threads of the project, in tree order of their first seeds. A thread starts at a `seed` that is not a child of a
 * `verdict`. A second seed under the same verdict, or a seed under a verdict that has no seed above it, starts a thread of
 * its own, so no seed is lost. A variant or a verdict that is not under a seed is in no round.
 *
 * Нити проекта в порядке дерева их первых задумок. Нить начинается с `seed`, который не ответ на вердикт. Вторая
 * задумка под тем же вердиктом или задумка под вердиктом без задумки выше начинает свою нить, чтобы ни одна не пропала.
 * Вариант или вердикт не под задумкой в раунды не входят.
 */
export function buildThreads(records: readonly AxisRecord[]): Thread[] {
    const ordered = inTreeOrder(records);
    const byId = new Map(ordered.map((r) => [r.id, r]));
    const children = new Map<string, AxisRecord[]>();
    for (const r of ordered) {
        if (r.parent === null || !byId.has(r.parent)) continue;
        const list = children.get(r.parent);
        if (list) list.push(r);
        else children.set(r.parent, [r]);
    }
    const roleOf = (r: AxisRecord): string | undefined => r.brain?.role;
    const used = new Set<string>();

    const roundOf = (seed: AxisRecord): Round => {
        used.add(seed.id);
        const kids = children.get(seed.id) ?? [];
        const variants = kids.filter((k) => roleOf(k) === 'variant');
        const verdict = kids.filter((k) => roleOf(k) === 'verdict').at(-1) ?? null;
        const next = verdict ? (children.get(verdict.id) ?? []).find((k) => roleOf(k) === 'seed' && !used.has(k.id)) : undefined;
        return { seed, variants, verdict, reply: next ? roundOf(next) : null };
    };

    const threads: Thread[] = [];
    for (const r of ordered) {
        // a reply was taken into the thread of its verdict already (the walk meets a seed before the seeds below it)
        if (roleOf(r) !== 'seed' || used.has(r.id)) continue;
        const rounds: Round[] = [];
        for (let round: Round | null = roundOf(r); round; round = round.reply) rounds.push(round);
        threads.push({ id: r.id, rounds });
    }
    return threads;
}

/**
 * An idea from typed text: the first non-empty line is the title (cut to the title limit); the whole text is the body
 * when there is more than the first line (or the line had to be cut), otherwise there is no body. Empty text gives null.
 * Задумка из набранного текста: первая непустая строка это заголовок (не длиннее предела); всё написанное это тело,
 * если есть что-то кроме первой строки (или строку пришлось обрезать), иначе тела нет. Пустой текст даёт null.
 */
export function ideaFromText(text: string): { title: string; text: string | null } | null {
    const whole = text.replace(/\r\n?/g, '\n').trim();
    if (whole === '') return null;
    const first = whole.split('\n', 1)[0]!;
    const title = cleanTitle(first);
    const more = whole.length > first.length || first.trim().length > TITLE_MAX;
    return { title, text: more ? whole : null };
}
