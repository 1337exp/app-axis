<script setup lang="ts">
/**
 * One record in full: what it is, how far it is, its text, pictures, links and its own journal.
 * Type, status, due date, links and pictures go to the server at once, the title when you leave the field. The text has
 * two modes: reading (the text as it is saved, cut when long) and editing, where what is typed is kept as a draft
 * on the server (a file, not the record and not the journal) until Save writes it to the record, in one journal line,
 * or Cancel drops it. A draft survives a reload, another record, another view and a closed drawer.
 * If somebody changed the text meanwhile, Save is refused and a window shows the new text beside the choice.
 *
 * Одна запись целиком: что это, насколько продвинулась, текст, картинки, связи и её собственный журнал.
 * Тип, статус, срок, связи и картинки уходят на сервер сразу, заголовок, когда выходишь из поля. У текста два режима:
 * чтение (текст как он сохранён, длинный сокращён) и правка: набранное лежит черновиком на сервере (файл, не запись
 * и не журнал), пока «Сохранить» не запишет его в запись одной строкой журнала, а «Отмена» не отбросит. Черновик
 * переживает перезагрузку, другую запись, другой вид и закрытую панель. Если текст тем временем изменили,
 * сохранение отклоняется, а окно показывает новый текст и выбор.
 */
import { isEmptyDoc } from '@1337exp/taoeditor/core';
import type { Doc } from '@1337exp/taoeditor/core';
import { TaoEditorView } from '@1337exp/taoeditor/vue';
import { TaoEditor } from '@1337exp/taoeditor/vue/taoui';
import { TaoAlert, TaoButton, TaoCombobox, TaoDate, TaoEmpty, TaoIcon, TaoInput, TaoModal, TaoSegmented, TaoSegmentedOption, TaoSelect, TaoTextarea, confirm, toast } from '@1337exp/taoui';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ApiError, api } from '@/app/api';
import type { RecordPatch } from '@/app/api';
import { countInside, dropDraft, hasDraft, loadDraft, patchRecord, recordById, removeRecord, select, selectedRecord, state, writeDraft } from '@/app/state';
import type { JournalEntry } from '@/core/journal';
import { LINK_KINDS, STATUSES, hasStatus } from '@/core/model';
import type { AxisDraft, AxisRecord, LinkKind, RecordType, Status } from '@/core/model';
import { pathOf } from '@/core/tree';
import { LOCALES, current, useI18n } from '@/i18n';
import { formatDay, formatTime, dayOf } from './format';
import JournalList from './JournalList.vue';
import { recordIcon, statusKeyOf, toneClass } from './marks';
import TypeSelect from './TypeSelect.vue';

const { t } = useI18n();
const record = selectedRecord;

const fail = (error: unknown): void => void toast().danger().message(t('record.saveFailed', [error instanceof Error ? error.message : String(error)]));

// ───────────────────────────── saving / сохранение ─────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved';
const saveState = ref<SaveState>('idle');

async function save(id: string, patch: RecordPatch): Promise<void> {
    saveState.value = 'saving';
    try {
        await patchRecord(id, patch);
        saveState.value = 'saved';
    } catch (error) {
        saveState.value = 'idle';
        fail(error);
    }
}

// ───────────────────────────── title / заголовок ─────────────────────────────

const title = ref('');

/** The title is saved once, when the field is left (Enter leaves it too): never a journal line per keystroke. / Заголовок сохраняется один раз, при выходе из поля (Enter тоже выходит). */
function saveTitle(): void {
    const r = record.value;
    if (!r) return;
    const next = title.value.replace(/\s+/g, ' ').trim();
    if (next === '') title.value = r.title;
    else if (next !== r.title) void save(r.id, { title: next });
}
onBeforeUnmount(saveTitle);

// ───────────────────────────── text and its draft / текст и его черновик ─────────────────────────────

type Mode = 'reading' | 'editing';
const mode = ref<Mode>('reading');
/** What the editor holds while editing. / Что держит редактор, пока правишь. */
const doc = ref<Doc | null>(null);
const bodyOf = (value: Doc | null | undefined): Doc | null => (value && !isEmptyDoc(value) ? value : null);
const json = (value: Doc | null | undefined): string => JSON.stringify(bodyOf(value));
const same = (a: Doc | null | undefined, b: Doc | null | undefined): boolean => json(a) === json(b);

/** The `updated` stamp of the record the draft is written against: the version editing started on. / Версия записи, на которой началась правка. */
const draftBase = ref<string | null>(null);
/** The text of the record at that version; null when it is not known (the draft was opened after the record had moved on). / Текст записи на той версии; null, если неизвестен. */
const baseText = shallowRef<{ doc: Doc | null } | null>(null);
const draftAt = ref<string | null>(null);
type DraftState = 'idle' | 'saving' | 'saved' | 'failed';
const draftState = ref<DraftState>('idle');
const editor = ref<{ focus: () => void } | null>(null);
const saving = ref(false);
const conflictOpen = ref(false);
/** A draft of this record is being fetched: reading is not shown for the blink before editing takes its place. / Черновик этой записи загружается: чтение не мелькает перед правкой. */
const draftLoading = ref(false);

/** The last text the editor reported, to tell a real change from an echo. / Последний текст редактора, чтобы отличить правку от эха. */
let lastJson = '';
/** Whether a draft will be on the server when the queued calls are done. / Будет ли черновик на сервере, когда очередь пройдёт. */
let draftQueued = false;

interface Pending {
    project: string;
    id: string;
    body: Doc | null;
    base: string;
    /** The saved text of the record when this was typed: a draft equal to it is not worth a file. / Сохранённый текст на тот момент. */
    saved: Doc | null;
}
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Pending | null = null;

function cancelPending(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
}

/** Sends the typed text to the draft of the record it was typed in. / Отправляет набранное в черновик той записи, где оно набрано. */
function flushDraft(keepalive = false): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    if (!p) return;
    // typed text equal to the saved one, and no draft yet: there is nothing to keep
    if (!draftQueued && same(p.body, p.saved)) return;
    draftQueued = true;
    if (record.value?.id === p.id) draftState.value = 'saving';
    writeDraft(p.project, p.id, p.body, p.base, keepalive).then(
        (draft) => {
            if (record.value?.id !== p.id) return;
            draftAt.value = draft.at;
            draftState.value = 'saved';
        },
        (error: unknown) => {
            // the record is gone: its draft went to the trash with it
            if (error instanceof ApiError && error.status === 404) return;
            if (record.value?.id !== p.id) return;
            const first = draftState.value !== 'failed';
            draftState.value = 'failed';
            if (first) toast().danger().message(t('record.draftFailed', [error instanceof Error ? error.message : String(error)]));
        },
    );
}

function scheduleDraft(): void {
    const r = record.value;
    const base = draftBase.value;
    if (!r || base === null) return;
    pending = { project: state.projectId, id: r.id, body: bodyOf(doc.value), base, saved: r.body };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flushDraft(), 700);
}

watch(doc, (value) => {
    if (mode.value !== 'editing') return;
    const now = json(value);
    if (now === lastJson) return;
    lastJson = now;
    scheduleDraft();
});

function beginEditing(r: AxisRecord, draft: AxisDraft | null): void {
    doc.value = draft ? draft.body : r.body;
    lastJson = json(doc.value);
    draftBase.value = draft ? draft.base : r.updated;
    baseText.value = !draft || draft.base === r.updated ? { doc: r.body } : null;
    draftAt.value = draft?.at ?? null;
    draftState.value = draft ? 'saved' : 'idle';
    draftQueued = draft !== null;
    mode.value = 'editing';
}

function finishEditing(): void {
    cancelPending();
    mode.value = 'reading';
    doc.value = null;
    draftBase.value = null;
    baseText.value = null;
    draftAt.value = null;
    draftState.value = 'idle';
    draftQueued = false;
    conflictOpen.value = false;
}

async function startEditing(): Promise<void> {
    const r = record.value;
    if (!r || mode.value === 'editing') return;
    beginEditing(r, null);
    await nextTick();
    editor.value?.focus();
}

/** A record that has a draft opens in editing, with the draft in the editor. / Запись с черновиком открывается в правке, с черновиком в редакторе. */
async function openDraft(id: string): Promise<void> {
    const project = state.projectId;
    draftLoading.value = true;
    try {
        const draft = await loadDraft(project, id);
        const r = record.value;
        if (!draft || !r || r.id !== id || project !== state.projectId || mode.value === 'editing') return;
        beginEditing(r, draft);
    } catch {
        // the header already says when the server is away
    } finally {
        if (record.value?.id === id) draftLoading.value = false;
    }
}

watch(
    () => record.value?.id,
    (id) => {
        flushDraft(); // what was typed goes to the draft of the record it was typed in (it carries its own id)
        title.value = record.value?.title ?? '';
        saveState.value = 'idle';
        finishEditing();
        draftLoading.value = false;
        if (id && hasDraft(id)) void openDraft(id);
    },
    { immediate: true, flush: 'sync' },
);

/** The saved text moved on since the draft was started, and it is not just another field that changed. / Сохранённый текст ушёл вперёд с начала черновика. */
const textMoved = computed(() => {
    const r = record.value;
    if (mode.value !== 'editing' || saving.value || !r || draftBase.value === null || r.updated === draftBase.value) return false;
    return !(baseText.value && same(r.body, baseText.value.doc));
});

// a change from elsewhere (Claude, another tab) or from this page (status, due): the draft is NOT reloaded, the typing is safe
watch(
    () => record.value?.updated,
    () => {
        const r = record.value;
        if (!r) return;
        if (document.activeElement?.closest('.record__title') === null || title.value === '') title.value = r.title;
        if (mode.value !== 'editing' || saving.value || draftBase.value === null || r.updated === draftBase.value || textMoved.value) return;
        // only another field changed: the text is the one the draft started from, so the draft is still on the right version
        draftBase.value = r.updated;
        if (draftQueued) scheduleDraft();
    },
);

/** "by whom, when" of the latest change of the record. / «Кем и когда» последнего изменения записи. */
const lastChange = (r: AxisRecord): [string, string] => [t(`author.${r.updatedBy}`), `${formatDay(dayOf(r.updated), current.value)}, ${formatTime(r.updated, current.value)}`];
const movedText = computed(() => (record.value ? t('record.textChanged', lastChange(record.value)) : ''));
const conflictText = computed(() => (record.value ? t('record.conflictText', lastChange(record.value)) : ''));

const draftNote = computed(() =>
    draftState.value === 'saving'
        ? t('record.draftSaving')
        : draftState.value === 'failed'
          ? t('record.draftNotSaved')
          : draftAt.value
            ? t('record.draftSaved', [formatTime(draftAt.value, current.value)])
            : '',
);

/**
 * Save: the text goes to the record (one journal line), the draft is dropped, the pane goes back to reading.
 * A text equal to the saved one only drops the draft. A record that has moved on refuses (409): the window opens.
 * `base` is the version to write against; "Overwrite with mine" passes the new one.
 * Сохранить: текст уходит в запись (одна строка журнала), черновик убирается, панель возвращается к чтению.
 * Текст, равный сохранённому, только убирает черновик. Ушедшая вперёд запись отказывает (409): открывается окно.
 */
async function commitText(base?: string): Promise<void> {
    const r = record.value;
    if (!r || mode.value !== 'editing' || saving.value) return;
    const body = bodyOf(doc.value);
    const from = base ?? draftBase.value ?? r.updated;
    saving.value = true;
    cancelPending(); // the draft is about to go: a late write must not bring it back
    saveState.value = 'saving';
    try {
        if (!same(body, r.body)) await patchRecord(r.id, { body, base: from });
        await dropDraft(state.projectId, r.id);
        saveState.value = 'saved';
        finishEditing();
    } catch (error) {
        saveState.value = 'idle';
        if (error instanceof ApiError && error.status === 409) conflictOpen.value = true;
        else fail(error);
    } finally {
        saving.value = false;
    }
}

/** Drops the draft and goes back to reading. / Убирает черновик и возвращается к чтению. */
async function discardDraft(id: string): Promise<void> {
    cancelPending();
    try {
        await dropDraft(state.projectId, id);
    } catch (error) {
        toast().danger().message(t('record.draftDropFailed', [error instanceof Error ? error.message : String(error)]));
    }
    if (record.value?.id === id) finishEditing();
}

async function cancelEditing(): Promise<void> {
    const r = record.value;
    if (!r || mode.value !== 'editing' || saving.value) return;
    if (!same(doc.value, r.body)) {
        const ok = await confirm().title(t('record.cancelTitle')).message(t('record.cancelText')).ok(t('record.cancelOk')).cancel(t('record.keepEditing')).danger();
        if (!ok || record.value?.id !== r.id || mode.value !== 'editing') return;
    }
    await discardDraft(r.id);
}

/** "Take the new one": the draft goes, the saved text stays. / «Взять новый»: черновик уходит, сохранённый текст остаётся. */
async function takeNew(): Promise<void> {
    const r = record.value;
    if (!r) return;
    const ok = await confirm().title(t('record.takeTitle')).message(t('record.takeText')).ok(t('record.takeNew')).cancel(t('record.keepEditing')).danger();
    if (ok && record.value?.id === r.id) await discardDraft(r.id);
}

/** The typed text of this pane is not lost when it goes away (a switch of the view, a closed drawer, a reload). / Набранное не теряется при уходе панели. */
const flushNow = (): void => flushDraft(true);
onBeforeUnmount(flushNow);
window.addEventListener('beforeunload', flushNow);
onBeforeUnmount(() => window.removeEventListener('beforeunload', flushNow));

// ───────────────────────────── type, status, due / тип, статус, срок ─────────────────────────────

const statusKey = computed(() => statusKeyOf(record.value?.type ?? 'task'));

const type = computed({
    get: () => record.value?.type ?? 'note',
    set: (value: RecordType) => record.value && value !== record.value.type && void save(record.value.id, { type: value }),
});
const status = computed({
    get: () => record.value?.status ?? 'open',
    set: (value: Status) => record.value && value !== record.value.status && void save(record.value.id, { status: value }),
});
const due = computed({
    get: () => record.value?.due ?? null,
    set: (value: string | null) => record.value && value !== record.value.due && void save(record.value.id, { due: value }),
});

const path = computed(() => (record.value ? pathOf(state.records, record.value.id).slice(0, -1) : []));

async function remove(): Promise<void> {
    const r = record.value;
    if (!r) return;
    const inside = countInside(r.id);
    const ok = await confirm()
        .title(t('record.removeTitle', [r.title]))
        .message(inside > 0 ? t('record.removeBranch', [inside]) : t('record.removeText'))
        .danger();
    if (!ok) return;
    try {
        await removeRecord(r.id);
    } catch (error) {
        fail(error);
    }
}

// ───────────────────────────── pictures / картинки ─────────────────────────────

const picker = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function addImages(files: readonly File[]): Promise<void> {
    const r = record.value;
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (!r || pictures.length === 0) return;
    uploading.value = true;
    try {
        const names: string[] = [];
        for (const file of pictures) names.push(await api.upload(state.projectId, file));
        const now = recordById(r.id);
        if (now) await save(r.id, { images: [...new Set([...now.images, ...names])] });
    } catch (error) {
        toast().danger().message(t('images.failed', [error instanceof Error ? error.message : String(error)]));
    } finally {
        uploading.value = false;
    }
}

function onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    void addImages([...(input.files ?? [])]);
    input.value = '';
}

function onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return; // text goes where it was going
    event.preventDefault();
    void addImages(files);
}

function onDrop(event: DragEvent): void {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.some((file) => file.type.startsWith('image/'))) {
        event.preventDefault();
        void addImages(files);
    }
}

const removeImage = (name: string): void => {
    const r = record.value;
    if (r) void save(r.id, { images: r.images.filter((n) => n !== name) });
};

// ───────────────────────────── links / связи ─────────────────────────────

const linkKind = ref<LinkKind>('relates');
const linkTarget = ref<string | null>(null);
const kindOptions = computed(() => LINK_KINDS.map((value) => ({ value, label: t(`links.out.${value}`) })));
const targetOptions = computed(() =>
    state.records
        .filter((r) => r.id !== record.value?.id)
        .map((r) => ({ value: r.id, label: r.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
);
const incoming = computed(() => {
    const id = record.value?.id;
    if (!id) return [];
    return state.records.flatMap((r) => r.links.filter((l) => l.to === id).map((l) => ({ from: r, kind: l.kind })));
});

function addLink(): void {
    const r = record.value;
    const to = linkTarget.value;
    if (!r || !to || !recordById(to)) return;
    const kind = linkKind.value;
    linkTarget.value = null;
    if (r.links.some((l) => l.to === to && l.kind === kind)) return;
    void save(r.id, { links: [...r.links, { to, kind }] });
}

const removeLink = (to: string, kind: LinkKind): void => {
    const r = record.value;
    if (r) void save(r.id, { links: r.links.filter((l) => !(l.to === to && l.kind === kind)) });
};

// ───────────────────────────── its journal / её журнал ─────────────────────────────

const entries = ref<JournalEntry[]>([]);
const note = ref('');

async function loadJournal(): Promise<void> {
    const id = record.value?.id;
    if (!id) {
        entries.value = [];
        return;
    }
    try {
        const list = await api.journal(state.projectId, id);
        if (record.value?.id === id) entries.value = list;
    } catch {
        // the header already says when the server is away
    }
}
watch(() => [record.value?.id, state.tick], loadJournal, { immediate: true });

async function addNote(): Promise<void> {
    const r = record.value;
    const text = note.value.trim();
    if (!r || !text) return;
    try {
        await api.log(state.projectId, text, r.id);
        note.value = '';
        await loadJournal();
    } catch (error) {
        fail(error);
    }
}

const stamp = (r: AxisRecord, which: 'created' | 'updated'): string => {
    const iso = which === 'created' ? r.created : r.updated;
    const who = t(`author.${which === 'created' ? r.createdBy : r.updatedBy}`);
    return t(`record.${which}`, [who, `${formatDay(dayOf(iso), current.value)}, ${formatTime(iso, current.value)}`]);
};
</script>

<template>
    <TaoEmpty v-if="!record" class="record-empty" :title="t('record.none')">{{ t('record.noneText') }}</TaoEmpty>

    <article v-else class="record" @paste="onPaste" @dragover.prevent @drop="onDrop">
        <header class="record__head">
            <nav class="record__path" aria-label="Path">
                <template v-for="step in path" :key="step.id">
                    <button type="button" class="record__step" @click="select(step.id)">{{ step.title }}</button>
                    <span aria-hidden="true">/</span>
                </template>
            </nav>
            <span class="record__saved" role="status">{{ saveState === 'saving' ? t('record.saving') : saveState === 'saved' ? t('record.saved') : '' }}</span>
            <TaoButton variant="ghost" tone="neutral" icon="tao-trash" :aria-label="t('record.remove')" :title="t('record.remove')" @click="remove" />
        </header>

        <div class="record__titlerow">
            <span class="record__mark" :class="toneClass(record)"><TaoIcon :name="recordIcon(record)" /></span>
            <TaoTextarea
                v-model="title"
                class="record__title"
                variant="plain"
                :rows="1"
                :resize="false"
                max-height="none"
                blur-on-enter
                :aria-label="t('record.title')"
                @blur="saveTitle"
            />
        </div>

        <div class="record__props">
            <TypeSelect v-model="type" class="record__type" :aria-label="t('record.type')" />
            <TaoSegmented v-if="hasStatus(record.type)" v-model="status" :aria-label="t('record.status')">
                <TaoSegmentedOption v-for="s in STATUSES" :key="s" :value="s" :label="t(`status.${statusKey}.${s}`)" />
            </TaoSegmented>
            <TaoDate v-model="due" class="record__due" :placeholder="t('record.due')" :today-text="t('record.today')" :clear-text="t('record.dueClear')" :aria-label="t('record.due')" />
        </div>

        <section class="block block--text">
            <div class="block__head">
                <h3 class="block__title"><TaoIcon name="mark-text" /> {{ t('record.textTitle') }}</h3>
                <TaoButton v-if="mode === 'reading' && !draftLoading" variant="secondary" tone="neutral" size="small" icon="tao-edit" @click="startEditing">{{ t('record.edit') }}</TaoButton>
            </div>

            <!-- reading: the text as it is saved, no editing engine; a double click, Enter or the button starts editing -->
            <template v-if="mode === 'reading' && !draftLoading">
                <div v-if="bodyOf(record.body)" class="record__text record__view" tabindex="0" role="group" :aria-label="t('record.text')" @dblclick="startEditing" @keydown.enter.self.prevent="startEditing">
                    <TaoEditorView class="tao-prose" :doc="record.body" profile="article" :max-rows="12" :more-label="t('record.showMore')" :less-label="t('record.showLess')" />
                </div>
                <button v-else type="button" class="record__empty" @click="startEditing">{{ t('record.textEmpty') }}</button>
            </template>

            <!-- editing: what is typed is a draft on the server until Save -->
            <template v-else-if="mode === 'editing'">
                <TaoAlert v-if="textMoved" class="record__moved" tone="warning">
                    {{ movedText }}
                    <TaoButton variant="text" tone="neutral" size="small" @click="conflictOpen = true">{{ t('record.show') }}</TaoButton>
                </TaoAlert>
                <TaoEditor
                    ref="editor"
                    :key="record.id"
                    v-model="doc"
                    class="record__text"
                    profile="article"
                    submit="mod-enter"
                    :label="t('record.text')"
                    :placeholder="t('record.textPlaceholder')"
                    :labels="LOCALES[current].editor"
                    :min-rows="6"
                    @send="commitText()"
                />
                <div class="record__actions">
                    <TaoButton :loading="saving" shortcut="Ctrl+Enter" @click="commitText()">{{ t('record.save') }}</TaoButton>
                    <TaoButton variant="secondary" tone="neutral" :disabled="saving" @click="cancelEditing">{{ t('record.cancel') }}</TaoButton>
                    <span class="record__draft" :class="{ 'record__draft--bad': draftState === 'failed' }" role="status">{{ draftNote }}</span>
                </div>
            </template>
        </section>

        <TaoModal v-model="conflictOpen" :title="t('record.conflictTitle')" :style="{ maxWidth: '640px' }">
            <p class="conflict__text">{{ conflictText }}</p>
            <div class="conflict__view">
                <TaoEditorView v-if="bodyOf(record.body)" class="tao-prose" :doc="record.body" profile="article" :aria-label="t('record.conflictSaved')" />
                <p v-else class="conflict__empty">{{ t('record.conflictEmpty') }}</p>
            </div>
            <p class="conflict__hint">{{ t('record.conflictHint') }}</p>
            <template #footer>
                <div class="conflict__actions">
                    <TaoButton variant="ghost" tone="neutral" @click="takeNew">{{ t('record.takeNew') }}</TaoButton>
                    <TaoButton variant="secondary" tone="neutral" :loading="saving" @click="commitText(record.updated)">{{ t('record.overwrite') }}</TaoButton>
                    <TaoButton @click="conflictOpen = false">{{ t('record.keepEditing') }}</TaoButton>
                </div>
            </template>
        </TaoModal>

        <section class="block">
            <h3 class="block__title"><TaoIcon name="image" /> {{ t('images.title') }}</h3>
            <ul v-if="record.images.length > 0" class="shots">
                <li v-for="name in record.images" :key="name" class="shot">
                    <a :href="api.assetUrl(state.projectId, name)" target="_blank" rel="noopener" :aria-label="t('images.open')">
                        <img :src="api.assetUrl(state.projectId, name)" alt="" loading="lazy" />
                    </a>
                    <TaoButton class="shot__remove" size="small" variant="secondary" tone="neutral" icon="tao-close" :aria-label="t('images.remove')" :title="t('images.remove')" @click="removeImage(name)" />
                </li>
            </ul>
            <div class="block__row">
                <TaoButton variant="ghost" tone="neutral" icon="tao-plus" :loading="uploading" @click="picker?.click()">{{ t('images.add') }}</TaoButton>
                <span class="block__hint">{{ t('images.hint') }}</span>
                <input ref="picker" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple hidden @change="onPick" />
            </div>
        </section>

        <section class="block">
            <h3 class="block__title"><TaoIcon name="link" /> {{ t('links.title') }}</h3>
            <ul v-if="record.links.length > 0 || incoming.length > 0" class="links">
                <li v-for="link in record.links" :key="`${link.kind}:${link.to}`" class="linkrow">
                    <span class="linkrow__kind">{{ t(`links.out.${link.kind}`) }}</span>
                    <button v-if="recordById(link.to)" type="button" class="linkrow__title" @click="select(link.to)">
                        <span class="mark" :class="toneClass(recordById(link.to)!)"><TaoIcon :name="recordIcon(recordById(link.to)!)" /></span>
                        {{ recordById(link.to)!.title }}
                    </button>
                    <TaoButton size="small" variant="ghost" tone="neutral" icon="tao-close" :aria-label="t('links.remove')" :title="t('links.remove')" @click="removeLink(link.to, link.kind)" />
                </li>
                <li v-for="link in incoming" :key="`in:${link.kind}:${link.from.id}`" class="linkrow linkrow--in">
                    <span class="linkrow__kind">{{ t(`links.in.${link.kind}`) }}</span>
                    <button type="button" class="linkrow__title" @click="select(link.from.id)">
                        <span class="mark" :class="toneClass(link.from)"><TaoIcon :name="recordIcon(link.from)" /></span>
                        {{ link.from.title }}
                    </button>
                </li>
            </ul>
            <form class="block__row" @submit.prevent="addLink">
                <TaoSelect v-model="linkKind" class="links__kind" :options="kindOptions" :clearable="false" :aria-label="t('links.kind')" />
                <TaoCombobox v-model="linkTarget" class="links__target" :options="targetOptions" :placeholder="t('links.targetPlaceholder')" :aria-label="t('links.target')" />
                <TaoButton type="submit" variant="secondary" :disabled="!linkTarget">{{ t('links.add') }}</TaoButton>
            </form>
        </section>

        <section class="block">
            <h3 class="block__title"><TaoIcon name="journal" /> {{ t('journal.title') }}</h3>
            <form class="block__row" @submit.prevent="addNote">
                <TaoInput v-model="note" class="note__input" :placeholder="t('journal.noteRecordPlaceholder')" :aria-label="t('journal.note')" autocomplete="off" />
                <TaoButton type="submit" variant="secondary" :disabled="note.trim() === ''">{{ t('journal.add') }}</TaoButton>
            </form>
            <JournalList :entries="entries" compact />
            <p class="record__stamp">{{ stamp(record, 'created') }} · {{ stamp(record, 'updated') }}</p>
        </section>
    </article>
</template>

<style scoped>
.record-empty {
    height: 100%;
}

.record {
    max-width: 860px;
    margin: 0 auto;
    padding: var(--tao-space-3) var(--tao-space-5) var(--tao-space-8);
}

.record__head {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    min-height: 36px;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-sm);
}

.record__path {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.record__step {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--tao-color-text-muted);
    cursor: pointer;
}

.record__step:hover {
    color: var(--tao-color-text);
}

.record__saved {
    flex: none;
    font-size: var(--tao-font-size-xs);
}

.record__titlerow {
    display: flex;
    align-items: flex-start;
    gap: var(--tao-space-3);
    margin-top: var(--tao-space-2);
    /* the line box of the title, so the mark can be centred on its first line / строка заголовка, по ней центруем отметку */
    --title-line: calc(var(--tao-font-size-2xl) * 1.25);
}

/*
 * The mark is a box as tall as one title line, pushed down by the textarea's own top padding, and the icon is
 * centred in it: it stays on the first line however many lines the title wraps to.
 * Отметка: коробка высотой в одну строку заголовка, опущенная на верхний padding textarea, иконка по центру;
 * при переносе заголовка остаётся у первой строки.
 */
.record__mark {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--title-line);
    margin-top: var(--tao-control-padding-y);
    font-size: 22px;
    color: var(--tao-color-text-muted);
}

.record__title {
    flex: 1;
    min-width: 0;
}

/* the title is the one big line of the pane; the field itself stays the library's plain textarea */
.record__title :deep(textarea) {
    font-size: var(--tao-font-size-2xl);
    font-weight: 600;
    line-height: 1.25; /* keep in step with --title-line / в паре с --title-line */
    color: var(--tao-color-text-strong);
}

/*
 * Tighter lines for short working notes. The editor sits under `tao-prose`, which sets its own line height and
 * ignores `--te-line-height`, so the variable is set here and read by the text explicitly; margins stay as they are.
 * Строки теснее для коротких рабочих заметок. Редактор под `tao-prose`, а тот задаёт свою высоту строки и
 * `--te-line-height` не читает: переменная задана здесь и читается текстом явно; отступы не трогаем.
 */
.record__text {
    --te-line-height: 1.45;
}

.record__text :deep(.tao-prose) {
    line-height: var(--te-line-height);
}

.record__props {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tao-space-2);
    margin: var(--tao-space-3) 0 var(--tao-space-4);
}

.record__type {
    width: 140px;
}

.record__due {
    width: 170px;
}

.block {
    margin-top: var(--tao-space-6);
}

.block--text {
    margin-top: 0;
}

.block__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tao-space-2);
    min-height: 28px;
    margin-bottom: var(--tao-space-3);
}

.block__head .block__title {
    margin: 0;
}

/* reading: the block is focusable (Enter edits); the ring sits a little outside so the text does not move */
.record__view {
    border-radius: var(--tao-radius-sm);
}

.record__view:focus-visible,
.record__empty:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 4px;
}

/* an empty text: a quiet line that starts editing on click / пустой текст: тихая строка, клик начинает правку */
.record__empty {
    display: block;
    width: 100%;
    padding: var(--tao-space-2) 0;
    border: 0;
    border-radius: var(--tao-radius-sm);
    background: none;
    color: var(--tao-color-text-muted);
    font: inherit;
    text-align: left;
    cursor: text;
}

.record__empty:hover {
    color: var(--tao-color-text);
}

.record__moved {
    margin-bottom: var(--tao-space-3);
}

.record__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tao-space-2);
    margin-top: var(--tao-space-3);
}

.record__draft {
    margin-left: var(--tao-space-1);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.record__draft--bad {
    color: var(--tao-color-danger-text);
}

/* the window with the new text: what is saved now, to read and to copy from / окно с новым текстом: что сохранено сейчас, читать и копировать */
.conflict__text,
.conflict__hint {
    margin: 0 0 var(--tao-space-3);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-sm);
}

.conflict__hint {
    margin: var(--tao-space-3) 0 0;
    font-size: var(--tao-font-size-xs);
}

.conflict__view {
    max-height: 40vh;
    overflow: auto;
    padding: var(--tao-space-3);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface-sunken);
    --te-line-height: 1.45;
    user-select: text;
}

.conflict__view :deep(.tao-prose) {
    line-height: var(--te-line-height);
}

.conflict__empty {
    margin: 0;
    color: var(--tao-color-text-muted);
}

.conflict__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--tao-space-2);
}

.block__title {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    margin: 0 0 var(--tao-space-3);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.block__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tao-space-2);
    margin-bottom: var(--tao-space-3);
}

.block__hint {
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.shots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--tao-space-3);
    margin: 0 0 var(--tao-space-3);
    padding: 0;
    list-style: none;
}

.shot {
    position: relative;
    aspect-ratio: 4 / 3;
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface-sunken);
    overflow: hidden;
}

.shot a,
.shot img {
    display: block;
    width: 100%;
    height: 100%;
}

.shot img {
    object-fit: cover;
}

.shot__remove {
    position: absolute;
    top: 6px;
    right: 6px;
    opacity: 0;
}

.shot:hover .shot__remove,
.shot:focus-within .shot__remove {
    opacity: 1;
}

@media (pointer: coarse) {
    .shot__remove {
        opacity: 1;
    }
}

.links {
    display: grid;
    gap: 2px;
    margin: 0 0 var(--tao-space-3);
    padding: 0;
    list-style: none;
}

.linkrow {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    min-height: 30px;
    font-size: var(--tao-font-size-sm);
}

.linkrow__kind {
    flex: none;
    width: 130px;
    color: var(--tao-color-text-muted);
}

.linkrow__title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--tao-color-text);
    text-align: left;
    cursor: pointer;
}

.linkrow__title:hover {
    color: var(--tao-color-text-strong);
}

.mark {
    display: inline-flex;
    color: var(--tao-color-text-muted);
}

.mark--active {
    color: var(--tao-color-info);
}

.mark--done {
    color: var(--tao-color-success);
}

.mark--dropped {
    color: var(--tao-color-text-disabled);
}

.links__kind {
    width: 150px;
}

.links__target,
.note__input {
    flex: 1;
    min-width: 180px;
}

.record__stamp {
    margin: var(--tao-space-4) 0 0;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}
</style>
