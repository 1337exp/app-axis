/**
 * What the agent sees: a project and a record as compact plain text. A model reads an outline
 * faster and cheaper than a pile of JSON, and the ids it needs for the next call are right there.
 *
 * Что видит агент: проект и запись компактным текстом. Оглавление читается моделью быстрее и дешевле,
 * чем куча JSON, а id для следующего вызова стоят тут же.
 */
import type { JournalEntry } from '../src/core/journal.ts';
import { hasStatus } from '../src/core/model.ts';
import type { AxisProject, AxisRecord } from '../src/core/model.ts';
import { docToText, plainText, preview } from '../src/core/text.ts';
import { buildTree, pathOf, progressOf, progressOfAll } from '../src/core/tree.ts';
import type { Progress, TreeNode } from '../src/core/tree.ts';

const progressText = (p: Progress): string =>
    [`tasks ${p.done}/${p.total} done`, p.active > 0 ? `${p.active} active` : '', p.questions > 0 ? `${p.questions} open question${p.questions === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(', ');

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
    const words = query.toLowerCase().replaceAll('ё', 'е').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return records.filter((record) => {
        const hay = `${record.title}\n${plainText(record.body)}`.toLowerCase().replaceAll('ё', 'е');
        return words.every((word) => hay.includes(word));
    });
}

export const hitText = (project: string, record: AxisRecord): string =>
    `${project} [${record.id}] ${hasStatus(record.type) ? `${record.type}·${record.status}` : record.type}  ${record.title}${record.body ? ` — ${preview(record.body, 100)}` : ''}`;
