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

- **The tree of a project.** An area gathers records into a branch and shows its progress (tasks done out of all, dropped ones do not count). A click on the circle of a task moves it round: not started, in work, done. A row shows the due date (red when late), whether there is a text and pictures, a pencil when the text has an unsaved draft, and a "C" mark when Claude edited the record last.
- **Board.** The same records in four columns by status (not started, in work, done, dropped): what is in work right now and what is next. A card shows the type, the title, the areas above it, the due date, the draft pencil and the "C" mark. Drag a card to another column or use the menu on the card (it names the statuses with the words of the record's type); a click opens the record in a drawer on the right. Filters by type (tasks and questions by default) and by branch are kept per project.
- **Timeline.** Records with a due date as a list by date: what is due when, and what is already late. Not a Gantt chart: a record has one date, no start and no duration. Sections: overdue (red, oldest first), today, tomorrow, this week, next week, then month by month; at the end a collapsed "No date" backlog (tasks and questions with no date: a reminder of what is lying around). A row has the mark (the circle of a task moves its status, as in the tree), the title, the areas above it, the date with its weekday and a hint ("in 2 days", "3 days late"); a click opens the record in the same drawer on the right the board uses. A small calendar button on the row changes the due date without opening the record (the journal gets its line). Done and dropped records are hidden, "Show done" brings them back into their sections. The same filters by type and branch as the board, kept apart; all of it is kept per project. "Today" moves by itself at midnight.
- **Undo.** A status changed by one click or one drag (the circle in the tree or the timeline, a card on the board) and a due date changed from the timeline row show a toast "Title: new status" with "Undo"; undo puts the previous value back through the same save, so the journal gets its line. A second change replaces the toast. Inside the open record the status control is in front of you, so it has no toast.
- **Map.** The records as cards on a plane: one more view of the same data, not a second model. An area is a wide header card with the progress of its branch; the other types are cards with the status mark (a task's circle moves its status, with the undo toast), the title, the due date and the marks of a draft and of Claude. Tree relations are thin quiet lines; typed links ("depends on", "because of", "relates to") are clear lines with an arrowhead and a label, each kind in its own line style (solid, dashed, dotted). A card without a place is laid out automatically: every top-level record with its subtree is a block (children in a column to its right, wrapped into several columns when there are many), and the blocks stand in rows, aiming at a 16:10 picture; a dragged card keeps its place, an area takes its branch along (`Alt` moves the area alone), alignment guides help to line cards up, "Tidy up" lays everything out again (with Undo). Pan with the right or middle button, the wheel or two fingers, zoom with `Ctrl` + wheel, a pinch or the buttons (`+`, `-`, `1` for 100%, `0` for the whole map); the camera is remembered per project. Drag from a handle on a card's side onto another card to make a typed link (a small menu asks the kind), onto an empty place to make a new record there inside the first card; a double click on an empty place makes a top-level record; a selected link can be removed (`Delete`, with Undo). Arrow keys move between cards, `Enter` opens one. The same filters as the board (here the done ones are shown by default), kept apart. Where cards sit is not part of the project: it lives in its own file and is not in the journal.
- **Colour.** One colour axis: the status. A type is told by the shape of its icon only. Not started is plain grey (no colour), in work is blue (the most noticeable thing on a screen), done is green, dropped is a calm red on the icon and a thin marker with a muted title; a late date is red on the date text only. The colours are CSS variables in `src/styles.css` (`--axis-status-*`, with a faint `-soft` tint for backgrounds). They show on the marks of every row and card, on the board columns (a top border and a tint on the head), on the left edge of a map card, as a dot in the status menus and in the status control, and on the progress bars (done in green, then in work in blue). The amber accent is for focus, selection and the primary button only.
- **Navigation.** A side panel (TaoUI's `TaoNav`) with the views (tree, board with the count of what is in work, timeline, map, journal), a main button "Record" that puts the focus into the quick input, the project menu (with "New project"), and at the bottom the language, the theme and a fold button. It can be folded into a rail of icons (remembered); on a phone it is a bar at the bottom, with a thin header for the project, the language and the theme. Corners are softer than the TaoUI defaults, as in NextUp.
- **Quick search.** One field for every view, always at hand in the view itself (above the tree, in the toolbar of the board, the timeline and the map, above the journal; `/` or `Ctrl+K` focuses it, `Escape` clears it): words (all must match, case and `ё` do not matter) in the title and the text of a record; a type mark at the start (`? phone`, `idea: …`) looks for that type only. The tree keeps the matches with their ancestors (dimmed) and highlights the found part; the board and the timeline keep the matching cards and rows with their counts; the map moves nothing, it dims what does not match, and `Enter` brings the matches into view; the journal is filtered by the title and the note text. The line is not kept and is not in the address. The agent's `axis_search` uses the same matching.
- **Quick input.** The field under the tree: a line and `Enter`. A mark at the start sets the type: `?` question, `!` decision, `*` idea, `#` area, `-` task, `~` note; a word works too (`idea: …`, `todo: …`). The record lands in the selected area or right after the selected record, so a list is typed top to bottom.
- **A record.** Title, type, status (each type has its own words: a decision is "Accepted", a question is "Answered"), due date, a text with headings, lists, tables and code. Type, status, due date, links and pictures are saved at once, the title when you leave the field. The text is shown for reading (a long one is cut to about 12 lines with "Show more"); "Edit" (or a double click, or Enter on the text) opens the editor, and what you type is kept as a **draft** on the server, not in the record and not in the journal, until you press "Save" (`Ctrl+Enter`: one journal line) or "Cancel" (it asks first when the draft differs). A draft is not lost by a reload, another record, another view or a closed drawer: the record opens in editing with the draft, and the tree row and the board card carry a small pencil. If the text was changed meanwhile (by Claude, in another tab, by hand), the page says so, "Save" is refused, and a window shows the new text beside the choice: overwrite with mine, keep editing, take the new one. Nothing is merged for you.
- **Pictures.** Paste from the clipboard (`Ctrl+V`), drop, or the button. A file is named by the hash of its content, so the same picture is stored once.
- **Links.** "Depends on", "because of", "relates to"; a record shows both the outgoing and the incoming ones.
- **The journal.** Every change: who (you or Claude), what, when and why; plus free notes on the whole project or on a record. Append-only.
- **Status bar.** One thin line at the bottom: the progress of the open project, tasks done out of all, tasks in work, open questions. On a narrow window the less important counts drop out.
- **Live.** The server watches the data folder: a change by Claude, from another tab or by hand in a file shows on the page by itself.
- Russian and English, light and dark themes, the address of a record or a view in the address bar (`#/project/record`, `#/project/~board`, `#/project/~board/record`, `#/project/~timeline`, `#/project/~timeline/record`, `#/project/~journal`).

## Where the data lives

One folder for all projects. The order of the choice: the `AXIS_DATA` variable, then `"data"` in `axis.local.json` beside `package.json` (a sample: `axis.local.example.json`; the file is not in git), then `./data`.

```
<data>/<project>/project.json
<data>/<project>/records/<id>.json     one record per file
<data>/<project>/journal.jsonl         a line per change
<data>/<project>/drafts/<id>.json          an unsaved text of a record: { body, base, at, by }
<data>/<project>/map.json              where the cards of the map sit and the camera: { v, positions, camera } (not in the journal)
<data>/<project>/assets/<hash>.png     pictures
<data>/<project>/trash/<id>.json       what was deleted (nothing is erased)
<data>/<project>/trash/<id>.draft.json the draft of a deleted record
```

A draft is one file per record and is not in the journal. `base` is the `updated` stamp of the record when editing started: if the record has a newer one when the text is saved, the server answers 409 with the current record (a caller that sends no `base`, like the MCP server, is not checked). Over HTTP: `GET`, `PUT` (`{ body, base }`) and `DELETE` on `/api/projects/<project>/records/<id>/draft`; the project load lists the ids that have a draft (`drafts`). Claude does not see drafts, only saved text.

The files can be read and edited by hand, put in git and moved. A record with a mistake inside does not break the project: it is made valid or skipped.

## How to connect Claude

The MCP server works on the same files, so the page does not have to be running. To connect it to Claude Code for every project:

```bash
claude mcp add axis --scope user -- node E:/job/git/app-axis/server/mcp.ts
```

Tools: `axis_projects`, `axis_create_project`, `axis_overview` (a project as an outline), `axis_read` (a record in full with its journal), `axis_add`, `axis_update`, `axis_link`, `axis_delete`, `axis_journal`, `axis_log` (a note to the journal), `axis_search`. Claude writes and reads the text of a record as plain text with light Markdown; TaoEditor's Markdown functions (`markdownToDoc`, `docToMarkdown`, wrapped in `src/core/text.ts`) turn it into the stored document of the editor and back. Changes take a `why` field: the reason goes to the journal.

The same access exists over HTTP (`/api/projects/…`, the header `X-Axis-By: claude`), and Claude can open the page and look at it in the built-in browser.

## How it is built

```
src/core/     plain TypeScript, no DOM and no Node: the model, the tree and progress, the board columns, the timeline by due dates, the map (layout, lines, keyboard neighbour), the filter the views share, quick input, text ↔ document, the journal
server/       the file store, the HTTP API with an event stream, the standalone server, the MCP server, the agent's view
src/app/      the state of the page, the API client, live updates, the address, the saved filters of the views, the places of the cards of the map, "today"
src/ui/       the tree with quick input, the board, the timeline, the map (on TaoUX's `TaoxCanvas`), a record, the journal, the new project window; shared by the views: the record drawer, the filter bar, the status mark
src/i18n/     dictionaries ru / en
tests/        the core, the store and the HTTP API (on a temporary folder)
```

The server answers this machine only: it listens on `127.0.0.1`, refuses a foreign `Host` or `Origin`, and takes changes only as JSON.

## Not yet

Dragging records in the tree with the mouse (for now "Move up", "Move down", "One level up" in the row menu). Pictures inside the text. Undo. Access from another device. Checked by hand in Chromium; Firefox, Safari, touch screens and a narrow screen are not checked. There are no tests of the page components yet, only of the core, the store and the HTTP API.

## License

[MIT](LICENSE)

## Us

Homepage: [666.io](https://666.io). If you want to help, suggest an idea or just talk, come by.
