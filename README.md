# Axis

**English** · [Русский](README.ru.md)

A place where a project is designed by two: a person and Claude. A project is a tree of typed records (area, task, idea, decision, question, note) with statuses, due dates, links, pictures and a journal. The data is plain files on disk, the page shows it live, and Claude reads and edits it through an MCP server.

**Stack:** Vue 3 + TypeScript + Vite, the interface on [TaoUI](https://www.npmjs.com/package/@1337exp/taoui), the text of a record in [TaoEditor](https://www.npmjs.com/package/@1337exp/taoeditor), i18n from [TaoUX](https://www.npmjs.com/package/@1337exp/taoux). The server runs on Node 22.18+ with no dependencies (TypeScript runs as is). Tests: Vitest.

```bash
npm install
npm run dev         # the page and the API at http://localhost:4517
npm run build       # type check and build
npm start           # the built page and the API without Vite
npm run mcp         # the MCP server (usually started by Claude Code, see below)
npm test
npm run typecheck
```

## What it does

- **The tree of a project.** An area gathers records into a branch and shows its progress (tasks done out of all, dropped ones do not count). A click on the circle of a task moves it round: not started, in work, done. A row shows the due date (red when late), whether there is a text and pictures, and a "C" mark when Claude edited the record last.
- **Quick input.** The field under the tree: a line and `Enter`. A mark at the start sets the type: `?` question, `!` decision, `*` idea, `#` area, `-` task, `~` note; a word works too (`idea: …`, `todo: …`). The record lands in the selected area or right after the selected record, so a list is typed top to bottom.
- **A record.** Title, type, status (each type has its own words: a decision is "Accepted", a question is "Answered"), due date, a text in the editor with headings, lists, tables and code. There is no Save button: a change goes by itself.
- **Pictures.** Paste from the clipboard (`Ctrl+V`), drop, or the button. A file is named by the hash of its content, so the same picture is stored once.
- **Links.** "Depends on", "because of", "relates to"; a record shows both the outgoing and the incoming ones.
- **The journal.** Every change: who (you or Claude), what, when and why; plus free notes on the whole project or on a record. Append-only.
- **Live.** The server watches the data folder: a change by Claude, from another tab or by hand in a file shows on the page by itself.
- Russian and English, light and dark themes, the address of a record in the address bar (`#/project/record`).

## Where the data lives

One folder for all projects. The order of the choice: the `AXIS_DATA` variable, then `"data"` in `axis.local.json` beside `package.json` (a sample: `axis.local.example.json`; the file is not in git), then `./data`.

```
<data>/<project>/project.json
<data>/<project>/records/<id>.json     one record per file
<data>/<project>/journal.jsonl         a line per change
<data>/<project>/assets/<hash>.png     pictures
<data>/<project>/trash/<id>.json       what was deleted (nothing is erased)
```

The files can be read and edited by hand, put in git and moved. A record with a mistake inside does not break the project: it is made valid or skipped.

## How to connect Claude

The MCP server works on the same files, so the page does not have to be running. To connect it to Claude Code for every project:

```bash
claude mcp add axis --scope user -- node E:/job/git/app-axis/server/mcp.ts
```

Tools: `axis_projects`, `axis_create_project`, `axis_overview` (a project as an outline), `axis_read` (a record in full with its journal), `axis_add`, `axis_update`, `axis_link`, `axis_delete`, `axis_journal`, `axis_log` (a note to the journal), `axis_search`. Claude writes and reads the text of a record as plain text with light Markdown; `src/core/text.ts` turns it into the stored document of the editor. Changes take a `why` field: the reason goes to the journal.

The same access exists over HTTP (`/api/projects/…`, the header `X-Axis-By: claude`), and Claude can open the page and look at it in the built-in browser.

## How it is built

```
src/core/     plain TypeScript, no DOM and no Node: the model, the tree and progress, quick input, text ↔ document, the journal
server/       the file store, the HTTP API with an event stream, the standalone server, the MCP server, the agent's view
src/app/      the state of the page, the API client, live updates, the address
src/ui/       the tree with quick input, a record, the journal, the new project window
src/i18n/     dictionaries ru / en
tests/        the core and the store (on a temporary folder)
```

The server answers this machine only: it listens on `127.0.0.1`, refuses a foreign `Host` or `Origin`, and takes changes only as JSON.

## Not yet

A board by status, a timeline and a map on a canvas (views of the same data). Dragging records in the tree with the mouse (for now "Move up", "Move down", "One level up" in the row menu). Pictures inside the text. Undo. Access from another device. Checked by hand in Chromium; Firefox, Safari, touch screens and a narrow screen are not checked. There are no tests of the page components yet, only of the core and the store.

## License

[MIT](LICENSE)

## Us

Homepage: [666.io](https://666.io). If you want to help, suggest an idea or just talk, come by.
