<script setup lang="ts">
/**
 * One row of the timeline: the mark of the record (a task's circle moves its status), the title, the areas above it,
 * the unsaved-draft pencil and the "C" mark, and on the right the date with its weekday and a hint of how near it is
 * ("in 2 days", "3 days late"). A click on the title opens the record; the small calendar button changes the date
 * without opening anything (it shows on hover and on focus, and always on a touch screen).
 *
 * Одна строка ленты: отметка записи (круг задачи двигает статус), заголовок, разделы над ней, карандаш черновика
 * и значок «C», справа дата с днём недели и подсказка, как она близко («через 2 дня», «просрочено на 3 дня»).
 * Клик по заголовку открывает запись; маленькая кнопка с календарём меняет дату, ничего не открывая
 * (она видна при наведении и фокусе, а на сенсорном экране всегда).
 */
import { TaoIcon } from '@1337exp/taoui';
import { computed } from 'vue';
import { isClosed } from '@/core/model';
import type { TimelineItem } from '@/core/timeline';
import { current, tn, useI18n } from '@/i18n';
import ClaudeMark from './ClaudeMark.vue';
import DueButton from './DueButton.vue';
import { formatWeekdayDay } from './format';
import StatusMark from './StatusMark.vue';

const props = defineProps<{
    item: TimelineItem;
    /** Titles of the areas above the record, from the top. / Заголовки разделов над записью, сверху вниз. */
    path: readonly string[];
    /** The record has an unsaved draft of its text. / У записи есть несохранённый черновик текста. */
    draft?: boolean;
    /** The record is open in the drawer. / Запись открыта в панели. */
    selected?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18n();

const closed = computed(() => isClosed(props.item.record.status));
const late = computed(() => !closed.value && props.item.days !== null && props.item.days < 0);

/** How near the date is, in words, for the dates that need it: any lateness, and the next two weeks after tomorrow. A finished record is not late. / Как близко дата, словами: любая просрочка и две недели после завтра. Закрытая запись не опаздывает. */
const hint = computed(() => {
    const days = props.item.days;
    if (days === null || closed.value) return '';
    if (days < 0) return tn('timeline.lateDays', -days);
    return days >= 2 && days <= 14 ? tn('timeline.inDays', days) : '';
});
</script>

<template>
    <li class="trow" :class="{ 'trow--closed': closed, 'trow--dropped': item.record.status === 'dropped', 'trow--selected': selected }">
        <StatusMark class="trow__mark" :record="item.record" />
        <div class="trow__main">
            <span class="trow__line">
                <button type="button" class="trow__title" @click="emit('open')">{{ item.record.title }}</button>
                <TaoIcon v-if="draft" class="trow__draft" name="tao-edit" :title="t('tree.hasDraft')" />
                <ClaudeMark v-if="item.record.updatedBy === 'claude'" />
            </span>
            <span v-if="path.length > 0" class="trow__path" :title="path.join(' / ')">{{ path.join(' / ') }}</span>
        </div>
        <div class="trow__when">
            <span v-if="item.record.due" class="trow__dates">
                <span class="trow__date" :class="{ 'trow__date--late': late }">{{ formatWeekdayDay(item.record.due, current) }}</span>
                <span v-if="hint" class="trow__hint" :class="{ 'trow__hint--late': late }">{{ hint }}</span>
            </span>
            <DueButton class="trow__pick" :record="item.record" />
        </div>
    </li>
</template>

<style scoped>
.trow {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: var(--tao-space-3);
    align-items: start;
    padding: var(--tao-space-2) var(--tao-space-2) var(--tao-space-2) var(--tao-space-3);
    list-style: none;
}

.trow:hover {
    background: var(--tao-color-hover);
}

.trow--selected {
    background: var(--tao-color-surface-sunken);
}

/* the title is the button that opens the record; its box is stretched over the whole row, the mark and the date button stay above it */
.trow:has(.trow__title:focus-visible) {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 1px;
}

.trow__mark {
    position: relative;
    z-index: 1;
    grid-column: 1;
    grid-row: 1;
    /* the height of a line of the title, so the icon sits on its first line */
    height: 22px;
}

.trow__main {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.trow__line {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    min-width: 0;
    min-height: 22px;
}

.trow__title {
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
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
}

.trow__title::after {
    content: '';
    position: absolute;
    inset: 0;
}

.trow__title:focus-visible {
    outline: none;
}

.trow__draft {
    flex: none;
    color: var(--tao-color-info);
    font-size: 13px;
}

.trow__path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.trow__when {
    grid-column: 3;
    grid-row: 1;
    display: flex;
    align-items: flex-start;
    gap: var(--tao-space-1);
}

.trow__dates {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-height: 22px;
    justify-content: center;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.trow__date {
    color: var(--tao-color-text);
}

.trow__date--late,
.trow__hint--late {
    color: var(--tao-color-danger-text);
}

/* a finished record is quiet: nothing to do, nothing to hurry / законченная запись тихая: делать нечего, спешить некуда */
.trow--closed .trow__title,
.trow--closed .trow__date {
    color: var(--tao-color-text-muted);
}

.trow--dropped .trow__title {
    text-decoration: line-through;
}

/* the date button takes its place always (the row does not jump) and shows on hover, on focus and while its calendar is open */
.trow__pick {
    position: relative;
    z-index: 1;
    opacity: 0;
}

.trow:hover .trow__pick,
.trow:focus-within .trow__pick,
.trow__pick.due-button--open {
    opacity: 1;
}

@media (pointer: coarse) {
    .trow__pick {
        opacity: 1;
    }
}

/* a narrow window: the date goes under the title, the date button stays at the top right */
@media (max-width: 560px) {
    .trow__when {
        display: contents;
    }

    .trow__dates {
        grid-column: 2;
        grid-row: 2;
        flex-direction: row;
        align-items: baseline;
        justify-content: flex-start;
        gap: var(--tao-space-2);
        min-height: 0;
    }

    .trow__pick {
        grid-column: 3;
        grid-row: 1;
    }
}
</style>
