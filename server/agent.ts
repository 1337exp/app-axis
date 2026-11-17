/**
 * What the agent sees: a project and a record as compact plain text. A model reads an outline
 * faster and cheaper than a pile of JSON, and the ids it needs for the next call are right there.
 *
 * Что видит агент: проект и запись компактным текстом. Оглавление читается моделью быстрее и дешевле,
 * чем куча JSON, а id для следующего вызова стоят тут же.
 */
import { ratingOf } from '../src/core/brainstorm.ts';
import type { JournalEntry } from '../src/core/journal.ts';
import { execText, hasStatus } from '../src/core/model.ts';
import type { AxisProject, AxisRecord } from '../src/core/model.ts';
import { fold, matchesWords } from '../src/core/search.ts';
import { docToText, preview } from '../src/core/text.ts';
import { buildTree, pathOf, progressOf, progressOfAll } from '../src/core/tree.ts';
import type { Progress, TreeNode } from '../src/core/tree.ts';

const progressText = (p: Progress): string =>
    [`tasks ${p.done}/${p.total} done`, p.active > 0 ? `${p.active} active` : '', p.questions > 0 ? `${p.questions} open question${p.questions === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(', ');

const RATING_MARK = { good: '+', bad: '-', disputed: '±', neutral: '' } as const;

/**
 * The brainstorm mark at the end of an outline line: a seed (with "waits for Claude" when its turn is passed), a variant
 * with its rating (`+` good, `-` bad, `±` disputed, nothing for neutral) and `✎` when the person left a remark, a verdict.
 * Метка брейншторма в конце строки оглавления: задумка (с «waits for Claude», когда ход передан), вариант с оценкой
 * (`+` хорошо, `-` плохо, `±` спорно, ничего для нейтрального) и `✎`, если есть заметка человека, вердикт.
 */
export function brainMark(r: AxisRecord): string {
    const b = r.brain;
    if (!b) return '';
    if (b.role === 'seed') return b.handed ? 'seed  ⏳ waits for Claude' : 'seed';
    if (b.role === 'variant') return ['variant', RATING_MARK[ratingOf(r)], b.remark ? '✎' : ''].filter(Boolean).join(' ');
    return 'verdict';
}

function line(node: TreeNode): string {
    const r = node.record;
    const kind = hasStatus(r.type) ? `${r.type}·${r.status}` : r.type;
    const parts = [`[${r.id}] ${kind}  ${r.title}`];
    if (node.children.length > 0) {
        const p = progressOf(node);
        if (p.total > 0) parts.push(`(${p.done}/${p.total})`);
    }
    if (r.due) parts.push(`due ${r.due}`);
    if (r.body) parts.push('¶');
    if (r.images.length > 0) parts.push(`🖼${r.images.length}`);
    for (const link of r.links) parts.push(`→ ${link.kind}:${link.to}`);
    const mark = brainMark(r);
    if (mark) parts.push(mark);
    // the recommended executor of a task: `⚙ sonnet/high`, `⚙ sonnet` (no effort set), `⚙ /high` (no model set) / рекомендованный исполнитель задачи
    if (r.exec) parts.push(`⚙ ${execText(r.exec)}`);
    return `${'  '.repeat(node.depth)}- ${parts.join('  ')}`;
}

/** The whole project as an outline. `¶` marks a record that has a text. / Весь проект оглавлением; `¶` значит, что у записи есть текст. */
export function outlineText(project: AxisProject, records: readonly AxisRecord[], root?: string): string {
    const tree = buildTree(records);
    const lines: string[] = [];
    const walk = (nodes: readonly TreeNode[]): void => {
        for (const node of nodes) {
            lines.push(line(node));
            walk(node.children);
        }
    };
    if (root === undefined) walk(tree);
    else {
        const find = (nodes: readonly TreeNode[]): TreeNode | undefined => {
            for (const node of nodes) {
                if (node.record.id === root) return node;
                const inside = find(node.children);
                if (inside) return inside;
            }
            return undefined;
        };
        const branch = find(tree);
        if (!branch) return `No record "${root}" in "${project.id}".`;
        // the branch is printed from its own depth, so it reads the same as the top
        const shift = (node: TreeNode, by: number): TreeNode => ({ ...node, depth: node.depth - by, children: node.children.map((c) => shift(c, by)) });
        walk([shift(branch, branch.depth)]);
    }
    const head = [`Project "${project.id}": ${project.title}`, progressText(progressOfAll(records))];
    if (project.repo) head.push(`repo ${project.repo}`);
    const about = project.description ? `\n${project.description}` : '';
    return `${head.join(' · ')}${about}\n\n${lines.length > 0 ? lines.join('\n') : '(no records yet)'}`;
}

export function entryText(entry: JournalEntry): string {
    const when = entry.t.slice(0, 16).replace('T', ' ');
    const what =
        entry.kind === 'note'
            ? 'note'
            : entry.kind === 'update' && entry.changes
              ? `update ${Object.entries(entry.changes)
                    .map(([field, [from, to]]) => (field === 'body' ? 'text' : `${field}: ${from || '∅'} → ${to || '∅'}`))
                    .join('; ')}`
              : entry.kind;
    const about = entry.record ? ` [${entry.record}] ${entry.title}` : '';
    return `${when} ${entry.by} · ${what}${about}${entry.text ? ` — ${entry.text}` : ''}`;
}

/** One record in full: where it is, what it says, what it is linked with, what happened to it. */
export function recordText(record: AxisRecord, records: readonly AxisRecord[], journal: readonly JournalEntry[], assetPath: (name: string) => string): string {
    const title = (id: string): string => records.find((r) => r.id === id)?.title ?? '(missing)';
    const path = pathOf(records, record.id)
        .slice(0, -1)
        .map((r) => r.title)
        .join(' / ');
    const out = [`[${record.id}] ${hasStatus(record.type) ? `${record.type}·${record.status}` : record.type}  ${record.title}`];
    if (path) out.push(`in: ${path}`);
    if (record.due) out.push(`due: ${record.due}`);
    if (record.exec) out.push(`executor: ${[record.exec.model, record.exec.effort ? `effort ${record.exec.effort}` : ''].filter(Boolean).join(', ')}`);
    const b = record.brain;
    if (b?.role === 'seed') out.push(`brainstorm: seed${b.handed ? ', handed: it is your turn (offer variants, or add a verdict once they are rated)' : ''}`);
    else if (b?.role === 'variant') {
        const rating = ratingOf(record);
        out.push(`brainstorm: variant, rating: ${rating}${rating === 'good' ? ' (liked)' : rating === 'bad' ? ' (disliked)' : rating === 'disputed' ? ' (liked and disliked)' : ' (not rated)'}`);
        if (b.remark) out.push(`remark of the person: ${b.remark}`);
    } else if (b?.role === 'verdict') out.push('brainstorm: verdict');
    out.push(`created ${record.created.slice(0, 10)} by ${record.createdBy}, updated ${record.updated.slice(0, 16).replace('T', ' ')} by ${record.updatedBy}`);
    for (const link of record.links) out.push(`→ ${link.kind} [${link.to}] ${title(link.to)}`);
    for (const other of records) for (const link of other.links) if (link.to === record.id) out.push(`← ${link.kind} from [${other.id}] ${other.title}`);
    const children = records.filter((r) => r.parent === record.id).sort((a, b) => a.order - b.order);
    if (children.length > 0) out.push(`children: ${children.map((c) => `[${c.id}] ${c.title}`).join('; ')}`);
    for (const name of record.images) out.push(`image: ${assetPath(name)}`);
    const text = docToText(record.body);
    out.push('', text === '' ? '(no text)' : text);
    if (journal.length > 0) out.push('', 'journal:', ...journal.map((e) => `  ${entryText(e)}`));
    return out.join('\n');
}

/** Records that have every word of the query in the title or the text. / Записи, в которых есть все слова запроса. */
export function search(records: readonly AxisRecord[], query: string): AxisRecord[] {
    // the same matching as the quick search of the page (`core/search.ts`); an empty query finds nothing here, not everything
    const words = fold(query).split(/\s+/).filter(Boolean);
    return words.length === 0 ? [] : records.filter((record) => matchesWords(record, words));
}

export const hitText = (project: string, record: AxisRecord): string =>
    `${project} [${record.id}] ${hasStatus(record.type) ? `${record.type}·${record.status}` : record.type}  ${record.title}${record.body ? ` — ${preview(record.body, 100)}` : ''}`;
