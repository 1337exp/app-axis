<script setup lang="ts">
/**
 * The timeline: what is due when, and what is already late. One centred column of sections (overdue, today, tomorrow,
 * this week, next week, then month by month, and a collapsed "No date" backlog at the end); a row is a record with its
 * date. It is a dated list, not a Gantt chart: a record has one date and no duration. The data is the same reactive list
 * as in the tree, so a change from outside moves a row by itself, and "today" moves at midnight (see `useToday`).
 * A click on a row opens the record in the drawer on the right, the same drawer the board uses.
 *
 * Лента: что на когда назначено и что уже опоздало. Одна колонка по центру из секций (просрочено, сегодня, завтра,
 * эта неделя, следующая, дальше месяц за месяцем, а в конце свёрнутый запас «Без срока»); строка это запись с её датой.
 * Это список по датам, не диаграмма Ганта: у записи одна дата и нет длительности. Данные те же реактивные, что и у
 * дерева, поэтому правка снаружи двигает строку сама, а «сегодня» сдвигается в полночь (см. `useToday`).
 * Клик по строке открывает запись в панели справа, в той же, что у доски.
 */
import { TaoButton, TaoEmpty, TaoIcon } from '@1337exp/taoui';
import { computed, ref, watch } from 'vue';
import { hasDraft, select, state } from '@/app/state';
import { useToday } from '@/app/today';
import { readFlag, writeFlag } from '@/app/viewFilter';
import { buildTimeline } from '@/core/timeline';
import type { TimelineSection } from '@/core/timeline';
import { areaPathOf } from '@/core/tree';
import { current, useI18n } from '@/i18n';
import FilterBar from './FilterBar.vue';
import { formatMonth } from './format';
import RecordDrawer from './RecordDrawer.vue';
import TimelineRow from './TimelineRow.vue';
import { useViewFilter } from './useViewFilter';

const { t } = useI18n();

// types and branch: the filter the board has too, kept apart per view / типы и ветка: фильтр тот же, что у доски, но у каждого вида свой
const { filter, root, rootId, areaOptions, typeOn, setType } = useViewFilter('timeline');

// two switches of the view, kept per project: finished records shown, and the "No date" backlog opened
const showDone = ref(false);
const noDateOpen = ref(false);
watch(
    () => state.projectId,
    (id) => {
        showDone.value = readFlag('timeline.done', id, false);
        noDateOpen.value = readFlag('timeline.nodate', id, false);
    },
    { immediate: true },
);
watch(showDone, (on) => writeFlag('timeline.done', state.projectId, on));
watch(noDateOpen, (on) => writeFlag('timeline.nodate', state.projectId, on));

const today = useToday();

const sections = computed(() => buildTimeline(state.records, { types: filter.types, root: rootId.value, showDone: showDone.value }, today.value));

function titleOf(section: TimelineSection): string {
    if (section.kind === 'month') return formatMonth(section.month ?? '', current.value);
    return t(`timeline.section.${section.kind}`);
}

/** The backlog is a header that opens; every other section is open. / Запас это заголовок, который раскрывается; остальные секции раскрыты. */
const isOpen = (section: TimelineSection): boolean => section.kind !== 'none' || noDateOpen.value;
</script>

<template>
    <section class="timeline-pane" :aria-label="t('timeline.label')">
        <FilterBar v-model:root="root" :type-on="typeOn" :area-options="areaOptions" @type="setType">
            <TaoButton v-model:pressed="showDone" variant="ghost" tone="neutral" icon="tao-check-circle">{{ t('timeline.showDone') }}</TaoButton>
        </FilterBar>

        <div class="timeline__scroll">
            <TaoEmpty v-if="sections.length === 0" class="timeline__empty" :title="t('timeline.empty')">{{ t('timeline.emptyText') }}</TaoEmpty>

            <div v-else class="timeline">
                <section v-for="section in sections" :key="section.id" class="tsec" :class="`tsec--${section.kind}`" :aria-labelledby="`tsec-${section.id}`">
                    <h2 :id="`tsec-${section.id}`" class="tsec__head">
                        <button v-if="section.kind === 'none'" type="button" class="tsec__toggle" :aria-expanded="noDateOpen" @click="noDateOpen = !noDateOpen">
                            <TaoIcon :name="noDateOpen ? 'tao-chevron-down' : 'tao-chevron-right'" />
                            <span class="tsec__title">{{ titleOf(section) }}</span>
                            <span class="tsec__count">{{ section.items.length }}</span>
                        </button>
                        <template v-else>
                            <span class="tsec__title">{{ titleOf(section) }}</span>
                            <span class="tsec__count">{{ section.items.length }}</span>
                        </template>
                    </h2>
                    <ul v-if="isOpen(section)" class="tsec__list">
                        <TimelineRow
                            v-for="item in section.items"
                            :key="item.record.id"
                            :item="item"
                            :path="areaPathOf(state.records, item.record.id)"
                            :draft="hasDraft(item.record.id)"
                            :selected="state.selected === item.record.id"
                            @open="select(item.record.id)"
                        />
                    </ul>
                </section>
            </div>
        </div>

        <RecordDrawer />
    </section>
</template>

<style scoped>
.timeline-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
}

.timeline__scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
}

.timeline__empty {
    margin: auto;
    height: 100%;
}

/* one column in the middle, about 760px; the whole width of a narrow window */
.timeline {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--tao-space-3) var(--tao-space-3) var(--tao-space-8);
}

.tsec + .tsec {
    margin-top: var(--tao-space-5);
}

.tsec__head {
    display: flex;
    align-items: baseline;
    gap: var(--tao-space-2);
    margin: 0 0 var(--tao-space-1);
    padding: 0 var(--tao-space-3);
    font-size: var(--tao-font-size-sm);
    font-weight: 600;
    color: var(--tao-color-text-strong);
}

.tsec__count {
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
}

/* late: the colour the tree gives a late date */
.tsec--overdue .tsec__title {
    color: var(--tao-color-danger-text);
}

.tsec--earlier .tsec__title {
    color: var(--tao-color-text-muted);
}

.tsec__toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--tao-space-2);
    margin-left: calc(var(--tao-space-2) * -1);
    padding: var(--tao-space-1) var(--tao-space-2);
    border: 0;
    border-radius: var(--tao-radius-md);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.tsec__toggle:hover {
    background: var(--tao-color-hover);
}

.tsec__toggle:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 1px;
}

.tsec__toggle .tsec__title {
    color: var(--tao-color-text-muted);
}

.tsec__list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.tsec__list :deep(li + li) {
    border-top: 1px solid var(--tao-color-border);
}
</style>
