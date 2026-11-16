<script setup lang="ts">
/**
 * The small "C": Claude edited this record last. One look for the tree, the board and the timeline.
 * Маленькая «C»: запись последним правил Claude. Один вид для дерева, доски и ленты.
 */
import { useI18n } from '@/i18n';

const { t } = useI18n();
</script>

<template>
    <span class="claude-mark" :title="t('tree.byClaude')">C</span>
</template>

<style scoped>
.claude-mark {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-info-subtle);
    color: var(--tao-color-info-text);
    font-size: 10px;
    font-weight: 700;
}
</style>
