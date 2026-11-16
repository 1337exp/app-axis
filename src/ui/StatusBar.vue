<script setup lang="ts">
/**
 * The thin bar at the bottom of the window: how far the open project is. It keeps its height when no project is
 * open, and never wraps: on a narrow window the less important counts drop out.
 * The numbers come from `progress` (`progressOfAll` in `core/tree.ts`); nothing is counted here.
 *
 * Тонкая полоса внизу окна: насколько продвинулся открытый проект. Без проекта высота остаётся, строка не
 * переносится: в узком окне менее важные числа пропадают. Числа берутся из `progress` (`progressOfAll` в
 * `core/tree.ts`), здесь ничего не считается.
 */
import { computed } from 'vue';
import { progress, state } from '@/app/state';
import { percent, shares } from '@/core/tree';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const share = computed(() => percent(progress.value));
const work = computed(() => shares(progress.value).active);
const tasks = computed(() => t('project.tasks', [progress.value.done, progress.value.total]));
</script>

<template>
    <footer class="status">
        <template v-if="state.project">
            <template v-if="progress.total > 0">
                <span class="status__track" role="progressbar" :aria-valuenow="share" aria-valuemin="0" aria-valuemax="100" :aria-label="tasks">
                    <span class="status__fill" :style="{ width: `${share}%` }"></span><span class="status__work" :style="{ width: `${work}%` }"></span>
                </span>
                <span class="status__item status__item--strong">{{ share }}%</span>
                <span class="status__item status__tasks">{{ tasks }}</span>
                <span v-if="progress.active > 0" class="status__item status__active">{{ t('project.active', [progress.active]) }}</span>
            </template>
            <span v-else class="status__item">{{ t('project.noTasks') }}</span>
            <span v-if="progress.questions > 0" class="status__item status__questions">{{ t('project.questions', [progress.questions]) }}</span>
        </template>
    </footer>
</template>

<style scoped>
.status {
    flex: none;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--tao-space-4);
    height: 27px;
    padding: 0 var(--tao-space-3);
    border-top: 1px solid var(--tao-color-border);
    background: var(--tao-color-surface);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    white-space: nowrap;
    overflow: hidden;
}

.status__track {
    flex: none;
    width: 120px;
    height: 6px;
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-surface-sunken);
    overflow: hidden;
}

.status__track {
    display: flex;
}

.status__fill,
.status__work {
    display: block;
    flex: none;
    height: 100%;
    transition: width 0.3s ease;
}

.status__fill {
    background: var(--axis-status-done);
}

.status__work {
    background: var(--axis-status-active);
}

.status__item {
    flex: none;
    font-variant-numeric: tabular-nums;
}

.status__item--strong {
    color: var(--tao-color-text-strong);
}

/* what may shrink: the tasks line gives way to an ellipsis last / что может сжаться: строка задач уступает последней */
.status__tasks {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

@media (max-width: 640px) {
    .status__questions {
        display: none;
    }
}

@media (max-width: 480px) {
    .status__active {
        display: none;
    }
}

@media (max-width: 360px) {
    .status__track {
        width: 64px;
    }
}
</style>
