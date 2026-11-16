/**
 * The agent's door to the text of a record. People write in the editor; Claude reads and writes plain text
 * with light Markdown marks, and this module turns it into the stored document and back.
 * The editor itself never converts Markdown (a rule of TaoEditor); this is a separate, explicit door.
 *
 * Дверь агента к тексту записи. Люди пишут в редакторе; Claude читает и пишет простой текст с лёгкой
 * разметкой Markdown, а модуль переводит его в хранимый документ и обратно. Сам редактор Markdown
 * не превращает (правило TaoEditor); это отдельная, явная дверь.
 */
import type { Doc, DocMark, DocNode } from '@1337exp/taoeditor/core';

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];

// ───────────────────────────── text → document ─────────────────────────────

/** Plain text with light Markdown → a document. Empty text gives null. / Текст с лёгким Markdown → документ; пустой текст даёт null. */
export function textToDoc(text: string): Doc | null {
    const content = parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'), 0);
    return content.length > 0 ? { v: 1, content } : null;
}

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const ITEM = /^(\s*)([-*•]|\d{1,9}[.)])\s+(.*)$/;

const indentOf = (line: string): number => /^\s*/.exec(line)![0].length;

function parseBlocks(lines: string[], depth: number): DocNode[] {
    const out: DocNode[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim() === '') {
            i += 1;
            continue;
        }
        const fence = FENCE.exec(line);
        if (fence) {
            const code: string[] = [];
            i += 1;
            while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
            i += 1; // the closing fence, or the end
            const node: DocNode = { type: 'codeBlock' };
            if (fence[1]) node.attrs = { lang: fence[1] };
            if (code.length > 0) node.content = [{ type: 'text', text: code.join('\n') }];
            out.push(node);
            continue;
        }
        const heading = depth === 0 ? HEADING.exec(line) : null;
        if (heading) {
            const text = heading[2]!.trim();
            // level 1 is the default and is not written: the stored form is the canonical one
            const node: DocNode = { type: 'heading' };
            if (heading[1]!.length > 1) node.attrs = { level: heading[1]!.length };
            if (text) node.content = [{ type: 'text', text }];
            out.push(node);
            i += 1;
            continue;
        }
        if (QUOTE.test(line)) {
            const inner: string[] = [];
            while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
            const content = parseBlocks(inner, depth + 1);
            if (content.length > 0) out.push({ type: 'blockquote', content });
            continue;
        }
        const item = ITEM.exec(line);
        if (item) {
            const base = item[1]!.length;
            const ordered = /\d/.test(item[2]!);
            const items: DocNode[] = [];
            let start = 1;
            while (i < lines.length) {
                const m = ITEM.exec(lines[i]!);
                if (!m || m[1]!.length !== base || /\d/.test(m[2]!) !== ordered) break;
                if (items.length === 0 && ordered) start = Number.parseInt(m[2]!, 10) || 1;
                const body = [m[3]!];
                i += 1;
                // deeper lines belong to this item: a nested list or the rest of its text
                while (i < lines.length && lines[i]!.trim() !== '' && indentOf(lines[i]!) > base) body.push(lines[i++]!.slice(base + 2));
                const content = parseBlocks(body, depth + 1);
                items.push({ type: 'listItem', content: content.length > 0 ? content : [{ type: 'paragraph' }] });
            }
            const list: DocNode = { type: ordered ? 'orderedList' : 'bulletList', content: items };
            if (ordered && start !== 1) list.attrs = { start };
            out.push(list);
            continue;
        }
        // a paragraph: lines up to a blank one or the start of another block; a line end inside is a line break
        const para: string[] = [];
        while (i < lines.length) {
            const at = lines[i]!;
            if (at.trim() === '' || FENCE.test(at) || QUOTE.test(at) || ITEM.test(at) || (depth === 0 && HEADING.test(at))) break;
            para.push(at.trim());
            i += 1;
        }
        const content: DocNode[] = [];
        para.forEach((text, index) => {
            if (index > 0) content.push({ type: 'hardBreak' });
            content.push(...parseInline(text, []));
        });
        out.push(content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' });
    }
    return out;
}

/** Inline marks, the earliest one first: code, link, bold, strike, italic. */
const INLINE: { mark: string; re: RegExp }[] = [
    { mark: 'code', re: /`([^`\n]+)`/ },
    { mark: 'link', re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/ },
    { mark: 'bold', re: /\*\*(?=\S)([^\n]*?\S)\*\*/ },
    { mark: 'strike', re: /~~(?=\S)([^\n]*?\S)~~/ },
    { mark: 'italic', re: /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/ },
    { mark: 'italic', re: /(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/ },
];

function parseInline(text: string, marks: DocMark[]): DocNode[] {
    let best: { index: number; match: RegExpExecArray; mark: string } | null = null;
    for (const { mark, re } of INLINE) {
        if (marks.some((m) => m.type === mark || m.type === 'code')) continue;
        const match = re.exec(text);
        if (match && (best === null || match.index < best.index)) best = { index: match.index, match, mark };
    }
    if (best === null) return text === '' ? [] : [textNode(text, marks)];
    const { index, match, mark } = best;
    const added: DocMark = mark === 'link' ? { type: 'link', attrs: { href: match[2]! } } : { type: mark };
    const inner = [...marks, added];
    return [
        ...(index > 0 ? [textNode(text.slice(0, index), marks)] : []),
        // code is literal: nothing inside it is parsed
        ...(mark === 'code' ? [textNode(match[1]!, inner)] : parseInline(match[1]!, inner)),
        ...parseInline(text.slice(index + match[0].length), marks),
    ];
}

function textNode(text: string, marks: DocMark[]): DocNode {
    const node: DocNode = { type: 'text', text };
    if (marks.length > 0) node.marks = [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    return node;
}

// ───────────────────────────── document → text ─────────────────────────────

/** A document → plain text with light Markdown: what `textToDoc` reads back. / Документ → текст с лёгким Markdown. */
export function docToText(doc: Doc | null): string {
    return doc ? blocksToText(doc.content).trim() : '';
}

const blocksToText = (nodes: readonly DocNode[]): string => nodes.map(blockToText).filter((s) => s !== '').join('\n\n');

function blockToText(node: DocNode): string {
    const kids = node.content ?? [];
    switch (node.type) {
        case 'paragraph':
            return inlineToText(kids);
        case 'heading':
            return `${'#'.repeat(Number(node.attrs?.level) || 1)} ${inlineToText(kids)}`;
        case 'codeBlock':
            return `\`\`\`${typeof node.attrs?.lang === 'string' ? node.attrs.lang : ''}\n${kids.map((k) => k.text ?? '').join('')}\n\`\`\``;
        case 'blockquote':
            return blocksToText(kids)
                .split('\n')
                .map((line) => (line === '' ? '>' : `> ${line}`))
                .join('\n');
        case 'bulletList':
        case 'orderedList': {
            const start = Number(node.attrs?.start) || 1;
            return kids
                .map((item, index) => {
                    const marker = node.type === 'orderedList' ? `${start + index}. ` : '- ';
                    // blocks of one item sit tight; what follows the first line is indented under it
                    const body = (item.content ?? []).map(blockToText).filter((s) => s !== '').join('\n');
                    return marker + body.split('\n').join('\n  ');
                })
                .join('\n');
        }
        case 'table':
            return kids.map((row) => `| ${(row.content ?? []).map((cell) => blocksToText(cell.content ?? []).replace(/\n+/g, ' ')).join(' | ')} |`).join('\n');
        default:
            return kids.length > 0 ? blocksToText(kids) : '';
    }
}

function inlineToText(nodes: readonly DocNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'hardBreak') return '\n';
            if (node.type === 'mention') return `@${String(node.attrs?.label ?? '')}`;
            if (node.type !== 'text') return '';
            let text = node.text ?? '';
            const has = (type: string): DocMark | undefined => node.marks?.find((m) => m.type === type);
            if (has('code')) text = `\`${text}\``;
            else {
                if (has('strike')) text = `~~${text}~~`;
                if (has('italic')) text = `*${text}*`;
                if (has('bold')) text = `**${text}**`;
            }
            const link = has('link');
            return link ? `[${text}](${String(link.attrs?.href ?? '')})` : text;
        })
        .join('');
}

/** The first lines of a text as one line, for lists and search results. / Начало текста одной строкой: для списков и поиска. */
export function preview(doc: Doc | null, max = 140): string {
    const flat = docToText(doc).replace(/[#>*`~|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
