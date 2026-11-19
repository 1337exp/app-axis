/**
 * The MCP server: the agent's own door to Axis. It speaks JSON-RPC over stdio (one JSON per line) and works on the
 * same files as the page, so the page does not have to be running; when it is, it shows every change at once.
 * Everything done through this door is signed "claude" in the journal.
 *
 *   claude mcp add axis --scope user -- node <path>/server/mcp.ts
 *
 * MCP-сервер: собственная дверь агента в Axis. Говорит по JSON-RPC через stdio (один JSON на строку) и работает
 * с теми же файлами, что и страница, поэтому странице не обязательно быть запущенной; если она открыта,
 * то сразу показывает каждое изменение. Всё, что сделано через эту дверь, подписано в журнале «claude».
 */
import { createInterface } from 'node:readline';
import { waitingSeeds } from '../src/core/brainstorm.ts';
import { BRAIN_ROLES, EXEC_EFFORTS, EXEC_MODELS, LINK_KINDS, RECORD_TYPES, STATUSES, isLinkKind } from '../src/core/model.ts';
import { draftNote, entryText, hitText, outlineText, recordText, search } from './agent.ts';
import { dataDir } from './config.ts';
import { AxisError, createStore } from './store.ts';
import type { RecordInput } from './store.ts';

const store = createStore(dataDir());
const BY = 'agent';

type Args = Record<string, unknown>;
interface Tool {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    run(args: Args): string;
}

const str = (description: string): unknown => ({ type: 'string', description });
const project = str('Project id (see axis_projects).');
const recordId = str('Record id: the 8 characters in [brackets] in an outline.');
const TEXT_HELP =
    'Markdown (read and written as is, so what axis_read shows can be sent back unchanged): paragraphs split by an empty line, "# heading" (levels 1-3), **bold**, *italic*, ~~strikethrough~~, `inline code`, [label](https://url), "- item" and "1. item" lists (nested by indent), "> quote", ``` code blocks with a language, GFM tables. Nothing else is kept: no images, rules or task lists.';
const ROLE_HELP =
    'Brainstorm role (optional): "seed" (the person\'s starting thought), "variant" (one option you offer under a seed), "verdict" (your summary under a seed after the variants were rated). Use it only inside a brainstorm round (see axis_add).';
const MODEL_HELP =
    'For a task: a recommendation of who should do it. "haiku" for trivial and mechanical work, "sonnet" for most implementation, "opus" for hard design or risky work. Set it when you create a task and keep it honest: change it when the task turns out harder or easier.';
const EFFORT_HELP = 'For a task: how hard the executor should think, "low", "medium" or "high" (a recommendation too).';
const LINKS_HELP = {
    type: 'array',
    description:
        'Links of the new record, made in the same call: [{ "to": id, "kind": "because" | "depends" | "relates" }]. "because": the target is the reason (a task made from a decision, a decision made from a question); "depends": this record waits for the target; "relates": just near. Give them when you create the record: a link in the text as [id] is not a link. To add or remove one later use axis_link.',
    items: {
        type: 'object',
        properties: { to: recordId, kind: { type: 'string', enum: [...LINK_KINDS] } },
        required: ['to', 'kind'],
    },
};
const WHY_HELP ='Why this change is made, one or two sentences. Goes to the journal: it is the memory of the project, so give it whenever the reason is not obvious.';

const need = (args: Args, key: string): string => {
    const value = args[key];
    if (typeof value !== 'string' || value.trim() === '') throw new AxisError(400, `"${key}" is required`);
    return value.trim();
};

const tools: Tool[] = [
    {
        name: 'axis_projects',
        description: 'List the projects in Axis (the shared design space of the user and the agent) with their progress. Start here when you do not know the project id.',
        inputSchema: { type: 'object', properties: {} },
        run() {
            const list = store.projects();
            if (list.length === 0) return `No projects yet (data folder: ${store.root}). Create one with axis_create_project.`;
            return list
                .map((p) => {
                    const waiting = waitingSeeds(store.records(p.id)).length;
                    const waits = waiting > 0 ? ` · ${waiting} round${waiting === 1 ? ' waits' : 's wait'} for the agent` : '';
                    return `${p.id}: ${p.title} · ${p.records} records · tasks ${p.progress.done}/${p.progress.total} done${p.progress.questions ? ` · ${p.progress.questions} open questions` : ''}${waits}${p.repo ? ` · repo ${p.repo}` : ''} · updated ${p.updated.slice(0, 10)}`;
                })
                .join('\n');
        },
    },
    {
        name: 'axis_create_project',
        description: 'Create a project. The id becomes the folder name; when omitted it is made from the title.',
        inputSchema: {
            type: 'object',
            properties: { title: str('Human title.'), id: str('Optional id: lower latin letters, digits, dashes.'), description: str('One or two sentences: what the project is.'), repo: str('Optional path of the repository the project is about.') },
            required: ['title'],
        },
        run(args) {
            const created = store.createProject(args);
            return `Created project "${created.id}": ${created.title}`;
        },
    },
    {
        name: 'axis_overview',
        description:
            'The outline of a project: every record as a line "[id] type·status  title", indented by the tree, with progress of branches. "¶" marks a record that has a text (read it with axis_read); "✎ draft" marks a record whose text the person is typing right now and has not saved (do not replace that text). Types: area (a branch), task, idea, decision, question, note. Statuses: open, active, done, dropped (for a decision "done" means accepted, for a question answered). Pass "record" to see one branch only. Brainstorm marks at the end of a line: "seed" (the person\'s starting thought; "⏳ waits for the agent" means the person handed you the turn: it is your move), "variant" with the rating of the person ("+" liked, "-" disliked, "±" both, nothing: not rated; "✎" means a remark, read it with axis_read), "verdict". A task may end with "⚙ sonnet/high": the recommended executor and effort ("⚙ sonnet" no effort set, "⚙ /high" no executor set). Links: "→ because:id" this record links to that one (kinds: because = it exists for that reason, depends = it waits for it, relates = near), "← because:id" that record links to this one; a decision with no "←" has nothing built on it yet.',
        inputSchema: { type: 'object', properties: { project, record: str('Optional: show only the branch under this record.') }, required: ['project'] },
        run(args) {
            const id = need(args, 'project');
            return outlineText(store.project(id), store.records(id), typeof args.record === 'string' && args.record ? args.record : undefined, store.drafts(id));
        },
    },
    {
        name: 'axis_read',
        description: 'One record in full: its place in the tree, text, links both ways, children, pictures (as file paths you can open with Read) and its journal. For a task the recommended executor and effort. An unsaved draft of the person is named too. For a brainstorm record also its role, whether a seed is handed to you, and for a variant the rating and the remark of the person.',
        inputSchema: { type: 'object', properties: { project, id: recordId }, required: ['project', 'id'] },
        run(args) {
            const p = need(args, 'project');
            const record = store.record(p, need(args, 'id'));
            return recordText(record, store.records(p), store.journal(p, { record: record.id, limit: 30 }), (name) => store.assetPath(p, name), store.draft(p, record.id));
        },
    },
    {
        name: 'axis_add',
        description:
            'Add a record. Use the type that says what it is: a decision records what was chosen and why (put the reasoning in the text), a question is something not known yet, an idea is something to weigh, a task is work to do, an area groups records, a note is everything else. When you create a task, say who should do it with "model" (haiku, sonnet or opus) and how hard to think with "effort" (low, medium or high): it is a recommendation for whoever picks the task up. ' +
            'To run a brainstorm round: axis_overview shows a seed (an idea with role seed) marked "⏳ waits for the agent" when the person handed you the turn. Read the seed with axis_read, then add 1 to 10 ideas with role "variant" as children of the seed (parent = the seed id; only as many as are worth having, do not pad to ten), each a distinct option with its reasoning in the text. ' +
            'Adding variants returns the turn to the person, who rates them (like, dislike, or both = disputed), may leave remarks, and hands the turn back. When the seed waits for you again, read the variants (axis_read shows ratings and remarks) and add one note with role "verdict" as a child of the seed: say what is liked, what is disliked, what is disputed and what to do next. Adding the verdict returns the turn to the person too; you cannot set ratings, remarks or the handed mark yourself.',
        inputSchema: {
            type: 'object',
            properties: {
                project,
                type: { type: 'string', enum: [...RECORD_TYPES] },
                role: { type: 'string', enum: [...BRAIN_ROLES], description: ROLE_HELP },
                model: { type: 'string', enum: [...EXEC_MODELS], description: MODEL_HELP },
                effort: { type: 'string', enum: [...EXEC_EFFORTS], description: EFFORT_HELP },
                title: str('One line.'),
                parent: str('Id of the parent record (usually an area). Omit for the top level.'),
                text: str(`The body. ${TEXT_HELP}`),
                status: { type: 'string', enum: [...STATUSES], description: 'Default: open (done for a decision).' },
                due: str('A day YYYY-MM-DD.'),
                after: str('Put it after this sibling; by default it goes last.'),
                links: LINKS_HELP,
                why: str(WHY_HELP),
            },
            required: ['project', 'type', 'title'],
        },
        run(args) {
            const { brain: _brain, ...input } = args; // only `role`: the person rates and hands the turn over
            const record = store.createRecord(need(args, 'project'), input as RecordInput, BY);
            return `Added [${record.id}] ${record.type}  ${record.title}`;
        },
    },
    {
        name: 'axis_update',
        description: 'Change a record: only the fields you pass change. "text" replaces the whole body (read it first with axis_read if you mean to extend it). Mark work as you go: status "active" when you start a task, "done" when it is finished and checked.',
        inputSchema: {
            type: 'object',
            properties: {
                project,
                id: recordId,
                title: str('New title.'),
                type: { type: 'string', enum: [...RECORD_TYPES] },
                role: { type: 'string', enum: [...BRAIN_ROLES, ''], description: `${ROLE_HELP} An empty string clears the role.` },
                model: { type: 'string', enum: [...EXEC_MODELS, ''], description: `${MODEL_HELP} An empty string clears it.` },
                effort: { type: 'string', enum: [...EXEC_EFFORTS, ''], description: `${EFFORT_HELP} An empty string clears it.` },
                status: { type: 'string', enum: [...STATUSES] },
                text: str(`The new body, replacing the old one. ${TEXT_HELP}`),
                due: str('A day YYYY-MM-DD; an empty string clears it.'),
                parent: str('Move under this record; an empty string moves to the top level.'),
                after: str('Put it after this sibling.'),
                why: str(WHY_HELP),
            },
            required: ['project', 'id'],
        },
        run(args) {
            const { project: _p, id: _id, brain: _brain, ...patch } = args;
            const project = need(args, 'project');
            const id = need(args, 'id');
            // the person may be typing this very text: say so (the change still goes through; the page shows its own conflict) / человек может набирать именно этот текст: говорим об этом (правка всё равно проходит; страница покажет свой конфликт)
            const draft = patch.text !== undefined ? store.draft(project, id) : null;
            const record = store.updateRecord(project, id, patch as RecordInput, BY);
            return `Updated [${record.id}] ${record.type}·${record.status}  ${record.title}${draft ? `
Warning: ${draftNote(draft)}` : ''}`;
        },
    },
    {
        name: 'axis_link',
        description: 'Link two records, or remove a link. Kinds: "because" (the target is the reason of this record, e.g. a task exists because of a decision), "depends" (this record waits for the target), "relates" (just near).',
        inputSchema: {
            type: 'object',
            properties: { project, from: recordId, to: recordId, kind: { type: 'string', enum: [...LINK_KINDS] }, remove: { type: 'boolean', description: 'Remove this link instead of adding it.' }, why: str(WHY_HELP) },
            required: ['project', 'from', 'to', 'kind'],
        },
        run(args) {
            const p = need(args, 'project');
            const from = store.record(p, need(args, 'from'));
            const to = need(args, 'to');
            const kind = args.kind;
            if (!isLinkKind(kind)) throw new AxisError(400, 'kind: relates | depends | because');
            const rest = from.links.filter((l) => !(l.to === to && l.kind === kind));
            const links = args.remove === true ? rest : [...rest, { to, kind }];
            store.updateRecord(p, from.id, { links, why: args.why }, BY);
            return args.remove === true ? `Removed link [${from.id}] → ${kind} [${to}]` : `Linked [${from.id}] → ${kind} [${to}]`;
        },
    },
    {
        name: 'axis_delete',
        description: 'Delete a record with everything under it. The files go to the project\'s trash folder, not away. Ask the user before deleting what they wrote.',
        inputSchema: { type: 'object', properties: { project, id: recordId, why: str(WHY_HELP) }, required: ['project', 'id'] },
        run(args) {
            const gone = store.deleteRecord(need(args, 'project'), need(args, 'id'), BY, args.why);
            return `Deleted ${gone.length} record${gone.length === 1 ? '' : 's'}: ${gone.join(', ')}`;
        },
    },
    {
        name: 'axis_journal',
        description: 'The journal of a project, newest first: who changed what, when and why, and free notes. Read it to recall what happened in earlier sessions.',
        inputSchema: { type: 'object', properties: { project, record: str('Optional: only this record.'), limit: { type: 'number', description: 'How many entries, 40 by default.' } }, required: ['project'] },
        run(args) {
            const entries = store.journal(need(args, 'project'), {
                limit: typeof args.limit === 'number' ? args.limit : 40,
                record: typeof args.record === 'string' && args.record ? args.record : undefined,
            });
            return entries.length > 0 ? entries.map(entryText).join('\n') : 'The journal is empty.';
        },
    },
    {
        name: 'axis_log',
        description: 'Write a free note to the journal: what was done in this session, a nuance worth remembering, why something was left for later. Attach it to a record when it is about one.',
        inputSchema: { type: 'object', properties: { project, text: str('The note.'), record: str('Optional record id the note is about.') }, required: ['project', 'text'] },
        run(args) {
            const entry = store.log(need(args, 'project'), args.text, args.record, BY);
            return `Logged: ${entryText(entry)}`;
        },
    },
    {
        name: 'axis_search',
        description: 'Find records by words in the title or the text (all words must be present). Searches one project, or all of them when "project" is omitted.',
        inputSchema: { type: 'object', properties: { query: str('Words to find.'), project: str('Optional project id.') }, required: ['query'] },
        run(args) {
            const query = need(args, 'query');
            const ids = typeof args.project === 'string' && args.project ? [args.project] : store.projects().map((p) => p.id);
            const hits = ids.flatMap((id) => search(store.records(id), query).map((record) => hitText(id, record)));
            return hits.length > 0 ? hits.slice(0, 60).join('\n') : 'Nothing found.';
        },
    },
];

const INSTRUCTIONS =
    'Axis is the design space the user and the agent share: projects as trees of typed records (area, task, idea, decision, question, note) with statuses, links and a journal. ' +
    'When working on a project that is in Axis: read axis_overview first, keep statuses true as work moves, record decisions with their reasons as "decision" records, open questions as "question", ' +
    'and leave an axis_log note at the end of a piece of work. The user sees every change live on the Axis page. ' +
    'Link records as you make them, not only mention an [id] in the text: a task made from a decision or a decision made from a question gets "because", a record that waits for another gets "depends", close records get "relates" ' +
    '(pass "links" to axis_add, or use axis_link later); axis_overview shows them as "→" (this record links to) and "←" (linked to this record). ' +
    'Brainstorm: a seed marked "⏳ waits for the agent" in axis_overview (or "round waits for the agent" in axis_projects) is the person\'s turn handed to you: offer 1-10 "variant" ideas under it, and after the person rated them add one "verdict" note under the seed (see axis_add).';

interface Request {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: { name?: string; arguments?: Args; protocolVersion?: unknown };
}

function answer(request: Request): unknown {
    switch (request.method) {
        case 'initialize':
            return {
                protocolVersion: typeof request.params?.protocolVersion === 'string' ? request.params.protocolVersion : '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'axis', version: '0.1.0' },
                instructions: INSTRUCTIONS,
            };
        case 'ping':
            return {};
        case 'tools/list':
            return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
        case 'tools/call': {
            const tool = tools.find((t) => t.name === request.params?.name);
            if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${String(request.params?.name)}` }], isError: true };
            try {
                return { content: [{ type: 'text', text: tool.run(request.params?.arguments ?? {}) }] };
            } catch (error) {
                // a refusal is an answer the model can act on, not a protocol failure
                const text = error instanceof AxisError ? error.message : `Internal error: ${error instanceof Error ? error.message : String(error)}`;
                return { content: [{ type: 'text', text }], isError: true };
            }
        }
        default:
            return undefined;
    }
}

const write = (message: unknown): void => void process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim() === '') return;
    let request: Request;
    try {
        request = JSON.parse(line) as Request;
    } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
    }
    // a notification (no id) gets no answer
    if (request.id === undefined || request.id === null) return;
    const result = answer(request);
    if (result === undefined) write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${String(request.method)}` } });
    else write({ jsonrpc: '2.0', id: request.id, result });
});
