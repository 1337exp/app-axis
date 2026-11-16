<script setup lang="ts">
/**
 * The journal of the whole project: every change and every free note, newest first, and a field to add a note.
 * Журнал всего проекта: каждое изменение и каждая свободная заметка, новые сверху, и поле для заметки.
 */
import { TaoButton, TaoEmpty, TaoTextarea, toast } from '@1337exp/taoui';
import { computed, ref, watch } from 'vue';
import { api } from '@/app/api';
import { query, searching } from '@/app/search';
import { state } from '@/app/state';
import type { JournalEntry } from '@/core/journal';
import { useI18n } from '@/i18n';
import { fold } from '@/core/search';
import JournalList from './JournalList.vue';
import SearchEmpty from './SearchEmpty.vue';

const { t } = useI18n();
const entries = ref<JournalEntry[]>([]);
const note = ref('');
const busy = ref(false);

async function load(): Promise<void> {
    if (!state.projectId) return;
    try {
        entries.value = await api.journal(state.projectId);
    } catch {
        // the header already says when the server is away
    }
}
watch(() => [state.projectId, state.tick], load, { immediate: true });

// the quick search: the title of the record and the text of the entry (a note or the reason) / быстрый поиск: заголовок записи и текст строки (заметка или причина)
const shown = computed(() => {
    if (!searching.value) return entries.value;
    const words = query.value.words;
    return entries.value.filter((entry) => {
        const hay = fold(`${entry.title}
${entry.text ?? ''}`);
        return words.every((word) => hay.includes(word));
    });
});

async function add(): Promise<void> {
    const text = note.value.trim();
    if (!text || busy.value) return;
    busy.value = true;
    try {
        await api.log(state.projectId, text);
        note.value = '';
        await load();
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <section class="journal-pane">
        <form class="journal-pane__note" @submit.prevent="add">
            <TaoTextarea v-model="note" variant="outline" :rows="2" :max-height="200" :placeholder="t('journal.notePlaceholder')" :aria-label="t('journal.note')" @keydown.ctrl.enter="add" @keydown.meta.enter="add" />
            <TaoButton type="submit" variant="secondary" :disabled="note.trim() === ''" :loading="busy">{{ t('journal.add') }}</TaoButton>
        </form>
        <TaoEmpty v-if="entries.length === 0" :title="t('journal.empty')">{{ t('journal.emptyText') }}</TaoEmpty>
        <SearchEmpty v-else-if="shown.length === 0" />
        <JournalList v-else :entries="shown" />
    </section>
</template>

<style scoped>
.journal-pane {
    max-width: 860px;
    margin: 0 auto;
    padding: var(--tao-space-5) var(--tao-space-4) var(--tao-space-8);
}

.journal-pane__note {
    display: grid;
    gap: var(--tao-space-2);
    justify-items: end;
    margin-bottom: var(--tao-space-5);
}

.journal-pane__note > :first-child {
    width: 100%;
}
</style>
