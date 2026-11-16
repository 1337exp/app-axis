<script setup lang="ts">
/**
 * The shell: the header (which project, which view) and under it the tree beside the open record,
 * the board by status or the timeline by due dates over the whole width, or the journal; at the bottom the status bar
 * with the progress.
 *
 * Оболочка: шапка (какой проект, какой вид) и под ней дерево рядом с открытой записью,
 * доска по статусам или лента по срокам на всю ширину или журнал; внизу строка состояния с прогрессом.
 */
import { TaoAlert, TaoButton, TaoEmpty, TaoLoader, TaoSegmented, TaoSegmentedOption, TaoSelect, TaoSplit, TaoThemeToggle } from '@1337exp/taoui';
import { computed, ref, watch } from 'vue';
import { openProject, setView, start, state } from '@/app/state';
import type { View } from '@/app/state';
import { LOCALE_NAMES, codes, current, setLocale, useI18n } from '@/i18n';
import type { LocaleCode } from '@/i18n';
import BoardPane from '@/ui/BoardPane.vue';
import JournalPane from '@/ui/JournalPane.vue';
import NewProjectDialog from '@/ui/NewProjectDialog.vue';
import RecordPane from '@/ui/RecordPane.vue';
import StatusBar from '@/ui/StatusBar.vue';
import TimelinePane from '@/ui/TimelinePane.vue';
import TreePane from '@/ui/TreePane.vue';

const { t } = useI18n();

const creating = ref(false);
const split = ref(Number(localStorage.getItem('axis.split')) || 38);
watch(split, (value) => localStorage.setItem('axis.split', String(Math.round(value))));

const projectOptions = computed(() => state.projects.map((p) => ({ value: p.id, label: p.title })));
const projectId = computed({
    get: () => state.projectId || null,
    set: (id: string | number | null) => typeof id === 'string' && id !== state.projectId && void openProject(id),
});

const view = computed({
    get: () => state.view,
    set: (value: View) => setView(value),
});

const localeOptions = codes.map((value) => ({ value, label: LOCALE_NAMES[value] }));
const locale = computed({
    get: () => current.value,
    set: (code: LocaleCode) => setLocale(code),
});

watch(
    () => state.project?.title,
    (title) => (document.title = title ? `${title} · Axis` : 'Axis'),
    { immediate: true },
);
watch(current, (code) => (document.documentElement.lang = code), { immediate: true });
</script>

<template>
    <div class="app">
        <header class="bar">
            <strong class="bar__name">Axis</strong>
            <TaoSelect v-if="state.projects.length > 0" v-model="projectId" class="bar__project" :options="projectOptions" :clearable="false" :aria-label="t('project.choose')" />
            <TaoButton variant="ghost" tone="neutral" icon="tao-plus" :aria-label="t('project.create')" :title="t('project.create')" @click="creating = true" />

            <span class="bar__space"></span>

            <TaoSegmented v-if="state.project" v-model="view" :aria-label="t('view.label')">
                <TaoSegmentedOption value="tree" icon="tree" :label="t('view.tree')" />
                <TaoSegmentedOption value="board" icon="board" :label="t('view.board')" />
                <TaoSegmentedOption value="timeline" icon="timeline" :label="t('view.timeline')" />
                <TaoSegmentedOption value="journal" icon="journal" :label="t('view.journal')" />
            </TaoSegmented>
            <TaoSelect v-model="locale" class="bar__locale" :options="localeOptions" :clearable="false" :aria-label="t('app.language')" />
            <TaoThemeToggle :to-light-label="t('app.toLight')" :to-dark-label="t('app.toDark')" />
        </header>

        <TaoAlert v-if="state.offline" class="app__alert" tone="danger">
            {{ t('app.offline') }}
            <TaoButton variant="text" tone="neutral" @click="start()">{{ t('app.retry') }}</TaoButton>
        </TaoAlert>

        <main class="app__main">
            <TaoLoader v-if="!state.ready" class="app__center" />
            <TaoEmpty v-else-if="!state.project" class="app__center" :title="t('project.none')">
                {{ t('project.noneText') }}
                <template #action>
                    <TaoButton icon="tao-plus" @click="creating = true">{{ t('project.create') }}</TaoButton>
                </template>
            </TaoEmpty>
            <div v-else-if="state.view === 'journal'" class="app__scroll"><JournalPane /></div>
            <BoardPane v-else-if="state.view === 'board'" />
            <TimelinePane v-else-if="state.view === 'timeline'" />

            <TaoSplit v-else v-model="split" class="app__split" :min="22" :max="70">
                <template #start><TreePane /></template>
                <template #end>
                    <div class="app__scroll"><RecordPane /></div>
                </template>
            </TaoSplit>
        </main>

        <StatusBar />

        <NewProjectDialog v-model="creating" />
    </div>
</template>

<style scoped>
.app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    min-height: 0;
}

.bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    padding: var(--tao-space-2) var(--tao-space-3);
    border-bottom: 1px solid var(--tao-color-border);
    background: var(--tao-color-surface);
}

.bar__name {
    margin-right: var(--tao-space-2);
    color: var(--tao-color-text-strong);
    font-size: var(--tao-font-size-lg);
    letter-spacing: 0.02em;
}

.bar__project {
    width: 220px;
}

.bar__space {
    flex: 1;
}

.bar__locale {
    width: 120px;
}

.app__alert {
    margin: var(--tao-space-2) var(--tao-space-3) 0;
}

.app__main {
    flex: 1;
    min-height: 0;
    display: flex;
}

.app__center {
    margin: auto;
}

.app__split {
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.app__scroll {
    flex: 1;
    height: 100%;
    min-width: 0;
    overflow: auto;
}

@media (max-width: 900px) {
    .bar {
        flex-wrap: wrap;
    }
}
</style>
