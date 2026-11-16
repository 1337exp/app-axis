<script setup lang="ts">
/**
 * One card of the board: what the record is, its title, the areas above it, the due date and the "C" mark.
 * A click on the title opens the record; the card can be dragged to another column, and the small menu does the
 * same without dragging, with the status words of this very type.
 *
 * Одна карточка доски: что за запись, заголовок, разделы над ней, срок и значок «C».
 * Клик по заголовку открывает запись; карточку можно перетащить в другую колонку, а маленькое меню делает то же
 * без перетаскивания, словами статуса именно этого типа.
 */
import { TaoDropdownMenu, TaoIcon } from '@1337exp/taoui';
import type { TaoMenuItem } from '@1337exp/taoui';
import { computed } from 'vue';
import { STATUSES, isStatus } from '@/core/model';
import type { AxisRecord, Status } from '@/core/model';
import { current, useI18n } from '@/i18n';
import ClaudeMark from './ClaudeMark.vue';
import { formatShort } from './format';
import { isOverdue, statusKeyOf, statusVar, toneClass, typeIcon } from './marks';

const props = defineProps<{
    record: AxisRecord;
    /** Titles of the areas above the record, from the top. / Заголовки разделов над записью, сверху вниз. */
    path: readonly string[];
    dragging?: boolean;
    /** The record has an unsaved draft of its text. / У записи есть несохранённый черновик текста. */
    draft?: boolean;
}>();

const emit = defineEmits<{
    open: [];
    status: [status: Status];
    dragstart: [event: DragEvent];
    dragend: [event: DragEvent];
}>();

const { t } = useI18n();

const items = computed<TaoMenuItem[]>(() =>
    STATUSES.map((status) => ({
        type: 'radio',
        id: status,
        group: 'status',
        label: t(`status.${statusKeyOf(props.record.type)}.${status}`),
        checked: props.record.status === status,
    })),
);

const onSelect = (id: string): void => {
    const status = STATUSES.find((s) => s === id);
    if (status && status !== props.record.status) emit('status', status);
};
</script>

<template>
    <li class="card" :class="{ 'card--dragging': dragging }" draggable="true" @dragstart="emit('dragstart', $event)" @dragend="emit('dragend', $event)">
        <span class="card__type" :class="toneClass(record)" :title="t(`type.${record.type}`)"><TaoIcon :name="typeIcon(record.type)" /></span>
        <button type="button" class="card__title" @click="emit('open')">{{ record.title }}</button>
        <TaoDropdownMenu class="card__menu" :items="items" :menu-label="t('board.cardActions')" size="small" dots="horizontal" @select="onSelect">
            <template #item="{ id, label }">
                <span v-if="isStatus(id)" class="status-dot" :class="`status-dot--${id}`" :style="{ '--dot': statusVar(id) }"></span>
                <span class="tao-menu__text">{{ label }}</span>
            </template>
        </TaoDropdownMenu>
        <span v-if="path.length > 0" class="card__path" :title="path.join(' / ')">{{ path.join(' / ') }}</span>
        <span v-if="record.due || record.updatedBy === 'claude' || draft" class="card__meta">
            <span v-if="record.due" class="card__due" :class="{ 'card__due--late': isOverdue(record) }">{{ formatShort(record.due, current) }}</span>
            <TaoIcon v-if="draft" class="card__draft" name="tao-edit" :title="t('tree.hasDraft')" />
            <ClaudeMark v-if="record.updatedBy === 'claude'" />
        </span>
    </li>
</template>

<style scoped>
.card {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: var(--tao-space-2);
    row-gap: 2px;
    align-items: start;
    padding: var(--tao-space-2) var(--tao-space-2) var(--tao-space-2) var(--tao-space-3);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface);
    list-style: none;
    cursor: grab;
}

.card:hover {
    border-color: var(--tao-color-border-strong);
}

.card--dragging {
    opacity: 0.45;
}

.card__type {
    display: inline-flex;
    align-items: center;
    height: 1.4em;
    font-size: 16px;
}

/* the title is the button that opens the record; its box is stretched over the whole card, the menu stays above it */
.card__title {
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--tao-color-text-strong);
    font: inherit;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
}

.card__title::after {
    content: '';
    position: absolute;
    inset: 0;
}

.card__title:focus-visible {
    outline: none;
}

.card:has(.card__title:focus-visible) {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 1px;
}

.card__menu {
    position: relative;
    z-index: 1;
    margin: -2px 0 0;
}

.card__path,
.card__meta {
    grid-column: 2 / -1;
    min-width: 0;
}

.card__path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.card__meta {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    font-size: var(--tao-font-size-xs);
}

.card__due {
    color: var(--tao-color-text-muted);
    font-variant-numeric: tabular-nums;
}

.card__due--late {
    color: var(--tao-color-danger-text);
}

/* a quiet pencil: the text has an unsaved draft / тихий карандаш: у текста есть несохранённый черновик */
.card__draft {
    flex: none;
    color: var(--tao-color-text);
    font-size: 13px;
}
</style>
