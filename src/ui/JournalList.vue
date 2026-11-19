<script setup lang="ts">
/**
 * Journal entries grouped by day: who, what, why. Used for the whole project and for one record.
 * Записи журнала по дням: кто, что, почему. Используется и для всего проекта, и для одной записи.
 */
import { computed } from 'vue';
import { recordById, select } from '@/app/state';
import type { JournalEntry, TrackedField } from '@/core/journal';
import { isBrainRole, isRecordType, isStatus } from '@/core/model';
import type { RecordType } from '@/core/model';
import { current, useI18n } from '@/i18n';
import { dayOf, formatDay, formatShort, formatTime, today, yesterday } from './format';

const props = defineProps<{
    entries: JournalEntry[];
    /** Inside a record the title of the record is not repeated. / Внутри записи её заголовок не повторяется. */
    compact?: boolean;
}>();

const { t } = useI18n();

const groups = computed(() => {
    const out: { day: string; label: string; entries: JournalEntry[] }[] = [];
    for (const entry of props.entries) {
        const day = dayOf(entry.t);
        const last = out.at(-1);
        if (last && last.day === day) last.entries.push(entry);
        else out.push({ day, label: day === today() ? t('journal.today') : day === yesterday() ? t('journal.yesterday') : formatDay(day, current.value), entries: [entry] });
    }
    return out;
});

/** A value of a field in words: a status by the type of the record, a parent by its title. */
function value(field: TrackedField, raw: string, entry: JournalEntry): string {
    if (raw === '') return '∅';
    if (field === 'status' && isStatus(raw)) {
        const type: RecordType | undefined = entry.record ? recordById(entry.record)?.type : undefined;
        const key = type === 'idea' || type === 'decision' || type === 'question' ? type : 'task';
        return t(`status.${key}.${raw}`);
    }
    if (field === 'type' && isRecordType(raw)) return t(`type.${raw}`);
    if (field === 'parent') return recordById(raw)?.title ?? raw;
    if (field === 'due') return formatShort(raw, current.value);
    // the brainstorm values in words: the part, the rating, the turn / значения брейншторма словами: роль, оценка, ход
    if (field === 'role' && isBrainRole(raw)) return t(`brain.role.${raw}`);
    if (field === 'rating' && (raw === 'good' || raw === 'bad' || raw === 'disputed' || raw === 'neutral')) return t(`brain.rating.${raw}`);
    if (field === 'handed' && raw === 'yes') return t('journal.yes');
    return raw;
}

function changes(entry: JournalEntry): string[] {
    if (!entry.changes) return [];
    return (Object.entries(entry.changes) as [TrackedField, [string, string]][]).map(([field, [from, to]]) => {
        const name = t(`journal.field.${field}`);
        // long values are only named; short ones are shown as "was → is"
        if (field === 'body' || field === 'links' || field === 'images') return name;
        return `${name}: ${value(field, from, entry)} → ${value(field, to, entry)}`;
    });
}
</script>

<template>
    <div class="journal">
        <section v-for="group in groups" :key="group.day" class="journal__day">
            <h3 class="journal__date">{{ group.label }}</h3>
            <ol class="journal__list">
                <li v-for="(entry, index) in group.entries" :key="`${entry.t}-${index}`" class="entry" :class="`entry--${entry.kind}`">
                    <time class="entry__time" :datetime="entry.t">{{ formatTime(entry.t, current) }}</time>
                    <span class="entry__by" :class="`entry__by--${entry.by}`">{{ t(`author.${entry.by}`) }}</span>
                    <div class="entry__body">
                        <p class="entry__what">
                            <span class="entry__kind">{{ t(`journal.kind.${entry.kind}`) }}</span>
                            <template v-if="!compact && entry.record">
                                <button v-if="recordById(entry.record)" type="button" class="entry__record" @click="select(entry.record)">{{ recordById(entry.record)!.title }}</button>
                                <span v-else class="entry__record entry__record--gone">{{ entry.title }}</span>
                            </template>
                            <span v-if="changes(entry).length > 0" class="entry__changes">{{ changes(entry).join('; ') }}</span>
                        </p>
                        <p v-if="entry.text" class="entry__text">{{ entry.text }}</p>
                    </div>
                </li>
            </ol>
        </section>
    </div>
</template>

<style scoped>
.journal__day + .journal__day {
    margin-top: var(--tao-space-4);
}

.journal__date {
    margin: 0 0 var(--tao-space-2);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.journal__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--tao-space-2);
}

.entry {
    display: grid;
    grid-template-columns: 44px 56px 1fr;
    gap: var(--tao-space-2);
    align-items: baseline;
    font-size: var(--tao-font-size-sm);
}

.entry__time {
    color: var(--tao-color-text-muted);
    font-variant-numeric: tabular-nums;
}

.entry__by {
    font-weight: 600;
    color: var(--tao-color-text);
}

.entry__by--agent {
    color: var(--tao-color-text-strong);
}

.entry__body {
    min-width: 0;
}

.entry__what {
    margin: 0;
    color: var(--tao-color-text);
    overflow-wrap: anywhere;
}

.entry__kind {
    color: var(--tao-color-text-muted);
}

.entry__record {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--tao-color-text-strong);
    text-align: left;
}

button.entry__record {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--tao-color-border-strong);
    text-underline-offset: 3px;
}

button.entry__record:hover {
    text-decoration-color: currentColor;
}

.entry__record--gone {
    color: var(--tao-color-text-muted);
    text-decoration: line-through;
}

.entry__changes {
    margin-left: 6px;
    color: var(--tao-color-text-muted);
}

.entry__text {
    margin: 2px 0 0;
    color: var(--tao-color-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.entry--note .entry__text {
    color: var(--tao-color-text-strong);
}
</style>
