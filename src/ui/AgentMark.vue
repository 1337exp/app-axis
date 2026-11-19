<script setup lang="ts">
/**
 * The small spark: the agent (the assistant connected over MCP) edited this record last. One look for the tree, the board,
 * the map and the timeline.
 * Маленькая искра: запись последним правил агент (ассистент, подключённый по MCP). Один вид для дерева, доски, карты и ленты.
 */
import { TaoIcon } from '@1337exp/taoui';
import { useI18n } from '@/i18n';

const { t } = useI18n();
</script>

<template>
    <span class="agent-mark" :title="t('tree.byAgent')"><TaoIcon name="brainstorm" /></span>
</template>

<style scoped>
.agent-mark {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: var(--tao-radius-full);
    background: color-mix(in srgb, var(--tao-color-text) 14%, transparent);
    color: var(--tao-color-text);
    font-size: 11px;
}
</style>
