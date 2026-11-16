<script setup lang="ts">
/**
 * The board: the records of the project that have a status, in four columns (not started, in work, done, dropped).
 * It answers "what is in work and what is next" at a glance. A card moves to another column by dragging or by its
 * menu; a click opens the record in a drawer on the right. The data is the same reactive list as in the tree,
 * so a change from outside moves a card by itself.
 *
 * Доска: записи проекта со статусом в четырёх колонках (не начато, в работе, готово, отброшено).
 * Отвечает «что сейчас в работе и что дальше» с первого взгляда. Карточка уходит в другую колонку перетаскиванием
 * или своим меню; клик открывает запись в панели справа. Данные те же реактивные, что и у дерева,
 * поэтому правка снаружи двигает карточку сама.
 */
import { TaoButton, TaoDrawer, TaoEmpty, TaoSelect, toast } from '@1337exp/taoui';
import { computed, reactive, ref, watch } from 'vue';
import { patchRecord, select, selectedRecord, state, tree } from '@/app/state';
import { defaultFilter, readFilter, writeFilter } from '@/app/boardFilter';
import { BOARD_TYPES, groupByStatus } from '@/core/board';
import type { AxisRecord, RecordType, Status } from '@/core/model';
import { flatten, pathOf } from '@/core/tree';
import { useI18n } from '@/i18n';
import BoardCard from './BoardCard.vue';
import { typeIcon } from './marks';
import RecordPane from './RecordPane.vue';

const { t } = useI18n();

// ───────────────────────────── the filter / фильтр ─────────────────────────────

const filter = reactive(defaultFilter());
watch(
    () => state.projectId,
    (id) => Object.assign(filter, readFilter(id)),
    { immediate: true },
);
watch(filter, () => writeFilter(state.projectId, filter), { deep: true });

const WHOLE = '*'; // not an id: ids never start with it / не id: id так не начинаются

/** Areas in the order of the tree, indented by depth. / Разделы в порядке дерева, с отступом по глубине. */
const areaOptions = computed(() => [
    { value: WHOLE, label: t('board.wholeProject') },
    ...flatten(tree.value)
        .filter((node) => node.record.type === 'area')
        .map((node) => ({ value: node.record.id, label: `${'   '.repeat(node.depth)}${node.record.title}` })),
]);

/** A branch that is gone (deleted, or saved in another session) counts as the whole project. / Удалённая ветка считается всем проектом. */
const root = computed({
    get: () => (filter.root && state.records.some((r) => r.id === filter.root && r.type === 'area') ? filter.root : WHOLE),
    set: (value: string | number | null) => (filter.root = typeof value === 'string' && value !== WHOLE ? value : null),
});

const typeOn = (type: RecordType): boolean => filter.types.includes(type);
function setType(type: RecordType, on: boolean): void {
    filter.types = BOARD_TYPES.filter((candidate) => (candidate === type ? on : typeOn(candidate)));
}

// ───────────────────────────── the columns / колонки ─────────────────────────────

const columns = computed(() => groupByStatus(state.records, { types: filter.types, root: root.value === WHOLE ? null : root.value }));
const total = computed(() => columns.value.reduce((sum, column) => sum + column.records.length, 0));

const pathOfCard = (record: AxisRecord): string[] =>
    pathOf(state.records, record.id)
        .slice(0, -1)
        .filter((step) => step.type === 'area')
        .map((step) => step.title);

async function setStatus(record: AxisRecord, status: Status): Promise<void> {
    if (record.status === status) return;
    try {
        await patchRecord(record.id, { status });
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    }
}

// ───────────────────────────── dragging / перетаскивание ─────────────────────────────

const dragging = ref<AxisRecord | null>(null);
const over = ref<Status | null>(null);

function onDragStart(record: AxisRecord, event: DragEvent): void {
    dragging.value = record;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', record.id);
    }
}

const onDragEnd = (): void => {
    dragging.value = null;
    over.value = null;
};

function onDragOver(status: Status, event: DragEvent): void {
    if (!dragging.value) return; // a file or text from elsewhere is not ours / файл или текст извне не наш
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    over.value = status;
}

function onDragLeave(status: Status, event: DragEvent): void {
    // leaving for a child of the column is not leaving the column / уход на дочерний элемент колонки не уход из неё
    if (over.value === status && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) over.value = null;
}

function onDrop(status: Status, event: DragEvent): void {
    const record = dragging.value;
    if (!record) return;
    event.preventDefault();
    onDragEnd();
    void setStatus(record, status);
}

// ───────────────────────────── the drawer / панель записи ─────────────────────────────

/**
 * The drawer is open while a record is selected (the address `~board/<record>` is the same thing). Closing it
 * deselects. The record pane saves what is typed when the record switches or the pane goes away, so a close
 * does not lose the last second of typing.
 *
 * Панель открыта, пока выбрана запись (адрес `~board/<запись>` то же самое). Закрытие снимает выбор.
 * Панель записи сохраняет набранное при смене записи и при исчезновении, так что закрытие
 * не теряет последнюю секунду набора.
 */
const opened = computed({
    get: () => selectedRecord.value !== null,
    set: (value: boolean) => {
        if (!value) select(null);
    },
});

// the title stays while the drawer slides out, when nothing is selected any more / заголовок остаётся, пока панель уезжает
const drawerTitle = ref('');
watch(
    () => selectedRecord.value?.type,
    (type) => {
        if (type) drawerTitle.value = t(`type.${type}`);
    },
    { immediate: true },
);
</script>

<template>
    <section class="board-pane" :aria-label="t('board.label')">
        <div class="board-bar" role="group" :aria-label="t('board.filters')">
            <div class="board-bar__types" role="group" :aria-label="t('board.types')">
                <TaoButton
                    v-for="type in BOARD_TYPES"
                    :key="type"
                    variant="ghost"
                    tone="neutral"
                    :icon="typeIcon(type)"
                    :pressed="typeOn(type)"
                    :aria-label="t(`type.${type}`)"
                    :title="t(`type.${type}`)"
                    @update:pressed="(on: boolean) => setType(type, on)"
                >
                    <span class="board-bar__text">{{ t(`type.${type}`) }}</span>
                </TaoButton>
            </div>
            <TaoSelect v-model="root" class="board-bar__branch" :options="areaOptions" :clearable="false" :aria-label="t('board.branch')" />
        </div>

        <TaoEmpty v-if="total === 0" class="board-empty" :title="t('board.empty')">{{ t('board.emptyText') }}</TaoEmpty>

        <div v-else class="board">
            <section
                v-for="column in columns"
                :key="column.status"
                class="column"
                :class="[`column--${column.status}`, { 'column--over': over === column.status }]"
                :aria-label="t(`board.status.${column.status}`)"
                @dragover="onDragOver(column.status, $event)"
                @dragleave="onDragLeave(column.status, $event)"
                @drop="onDrop(column.status, $event)"
            >
                <header class="column__head">
                    <h2 class="column__title">{{ t(`board.status.${column.status}`) }}</h2>
                    <span class="column__count">{{ column.records.length }}</span>
                </header>
                <ul class="column__list">
                    <BoardCard
                        v-for="record in column.records"
                        :key="record.id"
                        :record="record"
                        :path="pathOfCard(record)"
                        :dragging="dragging?.id === record.id"
                        @open="select(record.id)"
                        @status="(status) => setStatus(record, status)"
                        @dragstart="(event) => onDragStart(record, event)"
                        @dragend="onDragEnd"
                    />
                    <li v-if="column.records.length === 0" class="column__none">{{ t('board.columnEmpty') }}</li>
                </ul>
            </section>
        </div>

        <TaoDrawer v-model="opened" class="board-drawer" :title="drawerTitle" side="right" :style="{ width: 'min(640px, 100%)' }">
            <RecordPane v-if="selectedRecord" />
        </TaoDrawer>
    </section>
</template>

<style scoped>
.board-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
}

.board-bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tao-space-2) var(--tao-space-4);
    padding: var(--tao-space-2) var(--tao-space-3);
    border-bottom: 1px solid var(--tao-color-border);
}

.board-bar__types {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tao-space-1);
}

.board-bar__branch {
    width: 240px;
    max-width: 100%;
    margin-left: auto;
}

/* a narrow window: the types are icons only (the words stay in the tooltip and for screen readers), the branch takes the rest of the row */
@media (max-width: 600px) {
    .board-bar__text {
        display: none;
    }

    .board-bar__branch {
        flex: 1;
        width: auto;
        min-width: 140px;
    }
}

.board-empty {
    margin: auto;
}

.board {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(250px, 1fr));
    grid-template-rows: minmax(0, 1fr);
    gap: var(--tao-space-3);
    padding: var(--tao-space-3);
    overflow-x: auto;
}

.column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-lg);
    background: var(--tao-color-surface-sunken);
}

.column--over {
    border-color: var(--tao-color-accent);
    box-shadow: 0 0 0 1px var(--tao-color-accent);
}

.column__head {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: var(--tao-space-2);
    padding: var(--tao-space-3) var(--tao-space-3) var(--tao-space-2);
}

.column__title {
    margin: 0;
    color: var(--tao-color-text-strong);
    font-size: var(--tao-font-size-sm);
    font-weight: 600;
}

.column__count {
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-variant-numeric: tabular-nums;
}

.column__list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
    margin: 0;
    padding: 0 var(--tao-space-2) var(--tao-space-2);
    list-style: none;
    overflow-y: auto;
}

.column__none {
    padding: var(--tao-space-2) var(--tao-space-1);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    list-style: none;
}

/* dropped: the quietest column / отброшено: самая тихая колонка */
.column--dropped .column__title,
.column--dropped :deep(.card__title) {
    color: var(--tao-color-text-muted);
}

.column--dropped :deep(.card__type) {
    color: var(--tao-color-text-disabled);
}
</style>

<style>
/* the drawer is teleported to body, so these cannot be scoped; the drawer already has its own padding, the record has more */
aside.board-drawer .tao-drawer__content {
    padding: 0;
}
</style>
