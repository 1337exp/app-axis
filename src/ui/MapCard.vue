<script setup lang="ts">
/**
 * A card of the map: one record. An area is a wider, header-like card with the progress of its branch; the other types
 * show the mark (a task's circle moves its status, with the undo toast), the title up to three lines, the due date, the
 * draft pencil and the mark of Claude. A done or dropped card is quiet. The four small circles on its sides are the handles
 * a link is dragged from (shown on hover and when the card is selected). The DOM carries the contract of the canvas of TaoUX:
 * `data-node-id` on the root, `data-node-handle` on the body (a double click on it opens the record), `data-pin` on the handles.
 *
 * Карточка карты: одна запись. Раздел это более широкая карточка-шапка с прогрессом своей ветки; остальные типы
 * показывают отметку (кружок задачи двигает статус, с тостом отмены), заголовок до трёх строк, срок, карандаш
 * черновика и отметку Claude. Законченная или отброшенная карточка тихая. Четыре кружка на сторонах это ручки, с которых
 * тянут связь (видны при наведении и у выбранной карточки). В DOM договор холста TaoUX: `data-node-id` на корне,
 * `data-node-handle` на теле (двойной клик открывает запись), `data-pin` на ручках.
 */
import { TaoIcon } from '@1337exp/taoui';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { AxisRecord } from '@/core/model';
import { current, useI18n } from '@/i18n';
import ClaudeMark from './ClaudeMark.vue';
import { formatShort } from './format';
import { isOverdue } from './marks';
import StatusMark from './StatusMark.vue';

const props = defineProps<{
    record: AxisRecord;
    x: number;
    y: number;
    w: number;
    selected: boolean;
    draft: boolean;
    /** The progress of an area's branch. / Прогресс ветки раздела. */
    progress: { done: number; total: number; share: number } | null;
}>();

/** The measured height, for the layout. / Измеренная высота для раскладки. */
const emit = defineEmits<{ size: [id: string, height: number] }>();

const { t } = useI18n();

const root = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
    const el = root.value;
    if (!el) return;
    emit('size', props.record.id, el.offsetHeight);
    observer = new ResizeObserver(() => emit('size', props.record.id, el.offsetHeight));
    observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
</script>

<template>
    <div
        ref="root"
        class="mcard"
        :class="{
            'mcard--selected': selected,
            'mcard--area': record.type === 'area',
            'mcard--closed': record.status === 'done' || record.status === 'dropped',
            'mcard--dropped': record.status === 'dropped',
        }"
        :style="{ transform: `translate(${x}px, ${y}px)`, width: `${w}px` }"
        :data-node-id="record.id"
        tabindex="0"
        role="button"
        :aria-pressed="selected"
        :aria-label="`${t(`type.${record.type}`)}: ${record.title}`"
    >
        <div class="mcard__body" data-node-handle>
            <StatusMark class="mcard__mark" :record="record" :tabbable="false" />
            <span class="mcard__title">{{ record.title }}</span>
        </div>

        <div v-if="record.type === 'area' && progress && progress.total > 0" class="mcard__meta" :title="t('project.tasks', [progress.done, progress.total])">
            <span class="mcard__bar"><span class="mcard__fill" :style="{ width: `${progress.share}%` }"></span></span>
            <span class="mcard__count">{{ progress.done }}/{{ progress.total }}</span>
        </div>
        <div v-else-if="record.type !== 'area' && (record.due || draft || record.body || record.images.length > 0 || record.updatedBy === 'claude')" class="mcard__meta">
            <span v-if="record.due" class="mcard__due" :class="{ 'mcard__due--late': isOverdue(record) }">{{ formatShort(record.due, current) }}</span>
            <TaoIcon v-if="record.body" class="mcard__icon" name="mark-text" :title="t('tree.hasText')" />
            <TaoIcon v-if="draft" class="mcard__icon mcard__draft" name="tao-edit" :title="t('tree.hasDraft')" />
            <TaoIcon v-if="record.images.length > 0" class="mcard__icon" name="image" />
            <ClaudeMark v-if="record.updatedBy === 'claude'" class="mcard__claude" />
        </div>

        <span v-for="side in SIDES" :key="side" class="mcard__pin" :class="`mcard__pin--${side}`" :data-pin="side" aria-hidden="true"></span>
    </div>
</template>

<style scoped>
.mcard {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    padding: var(--tao-space-2) var(--tao-space-3);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-panel);
    background: var(--tao-color-surface-raised);
    color: var(--tao-color-text);
    font-size: var(--tao-font-size-sm);
    cursor: grab;
    will-change: transform;
}

.mcard:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 2px;
}

.mcard--selected {
    z-index: 1;
    border-color: var(--tao-color-accent);
    box-shadow: 0 0 0 1px var(--tao-color-accent);
}

.mcard--area {
    padding: var(--tao-space-3);
    background: var(--tao-color-surface-sunken);
    border-color: var(--tao-color-border-strong);
}

.mcard--closed {
    opacity: 0.6;
}

.mcard__body {
    display: flex;
    align-items: flex-start;
    gap: var(--tao-space-2);
}

.mcard__mark {
    flex: none;
    margin-top: 1px;
}

.mcard__title {
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    line-height: 18px;
    overflow-wrap: anywhere;
    color: var(--tao-color-text-strong);
}

.mcard--area .mcard__title {
    font-weight: 600;
    font-size: var(--tao-font-size-md);
}

.mcard--closed .mcard__title {
    color: var(--tao-color-text-muted);
}

.mcard--dropped .mcard__title {
    text-decoration: line-through;
}

.mcard__meta {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    margin-top: var(--tao-space-1);
    padding-left: 24px;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-variant-numeric: tabular-nums;
}

.mcard--area .mcard__meta {
    padding-left: 0;
    margin-top: var(--tao-space-2);
}

.mcard__due--late {
    color: var(--tao-color-danger-text);
}

.mcard__icon {
    flex: none;
    font-size: 13px;
}

.mcard__draft {
    color: var(--tao-color-info);
}

.mcard__claude {
    margin-left: auto;
}

.mcard__bar {
    flex: 1;
    height: 4px;
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-surface);
    overflow: hidden;
}

.mcard__fill {
    display: block;
    height: 100%;
    background: var(--tao-color-success);
}

/* the handles a link is dragged from: on the middle of each side, shown on hover and on a selected card */
.mcard__pin {
    position: absolute;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 2px solid var(--tao-color-accent);
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-surface-raised);
    opacity: 0;
    cursor: crosshair;
    transition: opacity 0.12s;
}

.mcard:hover .mcard__pin,
.mcard--selected .mcard__pin,
.mcard:focus-visible .mcard__pin {
    opacity: 1;
}

.mcard__pin--top {
    top: -7px;
    left: calc(50% - 6px);
}

.mcard__pin--bottom {
    bottom: -7px;
    left: calc(50% - 6px);
}

.mcard__pin--left {
    left: -7px;
    top: calc(50% - 6px);
}

.mcard__pin--right {
    right: -7px;
    top: calc(50% - 6px);
}

@media (pointer: coarse) {
    .mcard__pin {
        width: 18px;
        height: 18px;
    }
}
</style>
