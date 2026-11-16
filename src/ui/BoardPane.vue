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
import { TaoEmpty } from '@1337exp/taoui';
import { computed, ref } from 'vue';
import { isFound, searching } from '@/app/search';
import { hasDraft, select, state } from '@/app/state';
import { groupByStatus } from '@/core/board';
import type { AxisRecord, Status } from '@/core/model';
import { areaPathOf } from '@/core/tree';
import { useI18n } from '@/i18n';
import BoardCard from './BoardCard.vue';
import FilterBar from './FilterBar.vue';
import RecordDrawer from './RecordDrawer.vue';
import SearchEmpty from './SearchEmpty.vue';
import { changeStatus } from './undoable';
import { useViewFilter } from './useViewFilter';

const { t } = useI18n();

// the filter (types and branch) is the one the timeline has too, kept apart per view / фильтр тот же, что у ленты, но у каждого вида свой
const { filter, root, rootId, areaOptions, typeOn, setType } = useViewFilter('board');

// ───────────────────────────── the columns / колонки ─────────────────────────────

// the quick search keeps the cards that match; the counts of the columns follow / быстрый поиск оставляет подходящие карточки; счётчики колонок идут следом
const columns = computed(() =>
    groupByStatus(state.records, { types: filter.types, root: rootId.value }).map((column) => ({ ...column, records: column.records.filter((r) => isFound(r.id)) })),
);
const total = computed(() => columns.value.reduce((sum, column) => sum + column.records.length, 0));

const setStatus = (record: AxisRecord, status: Status): Promise<void> => changeStatus(record, status);

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
</script>

<template>
    <section class="board-pane" :aria-label="t('board.label')">
        <FilterBar v-model:root="root" :type-on="typeOn" :area-options="areaOptions" @type="setType" />

        <SearchEmpty v-if="total === 0 && searching" class="board-empty" />
        <TaoEmpty v-else-if="total === 0" class="board-empty" :title="t('board.empty')">{{ t('board.emptyText') }}</TaoEmpty>

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
                        :path="areaPathOf(state.records, record.id)"
                        :dragging="dragging?.id === record.id"
                        :draft="hasDraft(record.id)"
                        @open="select(record.id)"
                        @status="(status) => setStatus(record, status)"
                        @dragstart="(event) => onDragStart(record, event)"
                        @dragend="onDragEnd"
                    />
                    <li v-if="column.records.length === 0" class="column__none">{{ t('board.columnEmpty') }}</li>
                </ul>
            </section>
        </div>

        <RecordDrawer />
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
    /* how far the focus ring of a card reaches: 2px outline + 1px offset / на сколько выступает кольцо фокуса карточки */
    --ring: 3px;
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
    /* the list below starts with --ring of padding (for the focus ring of the first card), so the head gives it back */
    padding: var(--tao-space-3) var(--tao-space-3) calc(var(--tao-space-2) - var(--ring));
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
    /*
     * The scroll area clips what sticks out of it, and the focus ring of a card (2px + 1px offset, see BoardCard) sticks out
     * by --ring: without the padding on top the ring of the first card was cut. The bottom and the sides already have more.
     * Область прокрутки обрезает всё, что выступает, а кольцо фокуса карточки (2px + отступ 1px) выступает на --ring:
     * без отступа сверху кольцо первой карточки обрезалось. Снизу и по бокам места уже больше.
     */
    padding: var(--ring) var(--tao-space-2) var(--tao-space-2);
    list-style: none;
    overflow-y: auto;
}

.column__none {
    padding: var(--tao-space-2) var(--tao-space-1);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    list-style: none;
}

/*
 * The colour of a column is its status: a thin top border and a faint tint on the head; the cards carry only their icon.
 * Цвет колонки это её статус: тонкая верхняя граница и слабый тон на шапке; на карточках только их иконка.
 */
.column--open {
    --column: var(--axis-status-open);
}

.column--active {
    --column: var(--axis-status-active);
}

.column--done {
    --column: var(--axis-status-done);
}

.column--dropped {
    /* the quietest of the four: the border is the danger colour mixed halfway into the surface / самая тихая из четырёх: граница это цвет опасности, наполовину смешанный с поверхностью */
    --column: color-mix(in srgb, var(--axis-status-dropped) 55%, var(--tao-color-surface));
}

.column {
    /*
     * The whole column is one tint of its status, the way a group is tinted in the workspace: a faint body, a header strip a little
     * stronger, a thin top border in the full colour; the cards stay on the plain surface and stand out. The two strengths are the
     * knobs (the share of the status colour mixed into the column surface; the same share is a pale tint in the light theme).
     * Вся колонка одного тона своего статуса, как в workspace тонируется группа: слабое тело, чуть более сильная полоса шапки,
     * тонкая верхняя граница полным цветом; карточки остаются на обычной поверхности и выделяются. Две силы это ручки
     * (доля цвета статуса в поверхности колонки; в светлой теме та же доля даёт бледный тон).
     */
    --axis-column-tint: 7%;
    --axis-column-head-tint: 17%;
    border-top: 3px solid var(--column);
    background: color-mix(in srgb, var(--column) var(--axis-column-tint), var(--tao-color-surface-sunken));
}

.column__head {
    background: color-mix(in srgb, var(--column) var(--axis-column-head-tint), var(--tao-color-surface-sunken));
    border-radius: var(--tao-radius-lg) var(--tao-radius-lg) 0 0;
}

/* not started stays neutral: no tint on the body, the head only a shade darker / «не начато» остаётся нейтральной: тела без тона, шапка лишь чуть темнее */
.column--open {
    --axis-column-tint: 0%;
    --axis-column-head-tint: 8%;
}

/* dropped: the quietest column / отброшено: самая тихая колонка */
.column--dropped .column__title,
.column--dropped :deep(.card__title) {
    color: var(--tao-color-text-muted);
}

.column--dropped .column__title {
    font-weight: 500;
}
</style>
