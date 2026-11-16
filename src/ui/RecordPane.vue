<script setup lang="ts">
/**
 * One record in full: what it is, how far it is, its text, pictures, links and its own journal.
 * There is no Save button: a change goes to the server by itself, and the corner says when it is there.
 *
 * Одна запись целиком: что это, насколько продвинулась, текст, картинки, связи и её собственный журнал.
 * Кнопки «Сохранить» нет: правка уходит на сервер сама, а в углу видно, когда она там.
 */
import { isEmptyDoc } from '@1337exp/taoeditor/core';
import type { Doc } from '@1337exp/taoeditor/core';
import { TaoEditor } from '@1337exp/taoeditor/vue/taoui';
import { TaoButton, TaoCombobox, TaoDate, TaoEmpty, TaoIcon, TaoInput, TaoSegmented, TaoSegmentedOption, TaoSelect, TaoTextarea, confirm, toast } from '@1337exp/taoui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/app/api';
import type { RecordPatch } from '@/app/api';
import { countInside, patchRecord, recordById, removeRecord, select, selectedRecord, state } from '@/app/state';
import type { JournalEntry } from '@/core/journal';
import { LINK_KINDS, RECORD_TYPES, STATUSES, hasStatus } from '@/core/model';
import type { AxisRecord, LinkKind, RecordType, Status } from '@/core/model';
import { pathOf } from '@/core/tree';
import { LOCALES, current, useI18n } from '@/i18n';
import { formatDay, formatTime, dayOf } from './format';
import JournalList from './JournalList.vue';
import { recordIcon, toneClass } from './marks';

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

// ───────────────────────────── title and text / заголовок и текст ─────────────────────────────

const title = ref('');
const doc = ref<Doc | null>(null);
const bodyOf = (value: Doc | null): Doc | null => (value && !isEmptyDoc(value) ? value : null);
const same = (a: Doc | null, b: Doc | null): boolean => JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));

let timer: ReturnType<typeof setTimeout> | null = null;
/** The record the pending text belongs to: a switch to another record must not send it there. */
let pendingFor: string | null = null;

function flush(): void {
    if (timer === null || pendingFor === null) return;
    clearTimeout(timer);
    timer = null;
    const id = pendingFor;
    pendingFor = null;
    void save(id, { body: bodyOf(doc.value) });
}

watch(
    () => record.value?.id,
    () => {
        flush();
        title.value = record.value?.title ?? '';
        doc.value = record.value?.body ?? null;
        saveState.value = 'idle';
    },
    { immediate: true, flush: 'sync' },
);

// a change from elsewhere (Claude, another tab): take it, unless the person is in the middle of typing
watch(
    () => record.value?.updated,
    () => {
        const r = record.value;
        if (!r) return;
        if (document.activeElement?.closest('.record__title') === null || title.value === '') title.value = r.title;
        if (timer === null && !same(doc.value, r.body)) doc.value = r.body;
    },
);

watch(doc, (value) => {
    const r = record.value;
    if (!r || same(value, r.body)) return;
    if (timer) clearTimeout(timer);
    pendingFor = r.id;
    timer = setTimeout(flush, 700);
});

onBeforeUnmount(flush);
window.addEventListener('beforeunload', flush);
onBeforeUnmount(() => window.removeEventListener('beforeunload', flush));

function saveTitle(): void {
    const r = record.value;
    if (!r) return;
    const next = title.value.replace(/\s+/g, ' ').trim();
    if (next === '') title.value = r.title;
    else if (next !== r.title) void save(r.id, { title: next });
}

// ───────────────────────────── type, status, due / тип, статус, срок ─────────────────────────────

const typeOptions = computed(() => RECORD_TYPES.map((value) => ({ value, label: t(`type.${value}`) })));
const statusKey = computed(() => {
    const type = record.value?.type;
    return type === 'idea' || type === 'decision' || type === 'question' ? type : 'task';
});

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
            <TaoSelect v-model="type" class="record__type" :options="typeOptions" :clearable="false" :aria-label="t('record.type')" />
            <TaoSegmented v-if="hasStatus(record.type)" v-model="status" :aria-label="t('record.status')">
                <TaoSegmentedOption v-for="s in STATUSES" :key="s" :value="s" :label="t(`status.${statusKey}.${s}`)" />
            </TaoSegmented>
            <TaoDate v-model="due" class="record__due" :placeholder="t('record.due')" :today-text="t('record.today')" :clear-text="t('record.dueClear')" :aria-label="t('record.due')" />
        </div>

        <TaoEditor :key="record.id" v-model="doc" class="record__text" profile="article" :label="t('record.text')" :placeholder="t('record.textPlaceholder')" :labels="LOCALES[current].editor" :min-rows="6" />

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
