<script setup lang="ts">
/**
 * The mark of a record in a row: its icon in the tone of its status. For a task it is a button, and a click moves the
 * status round (not started, in work, done, not started…); the other types have no such shortcut and show a plain mark.
 * The tree and the timeline draw it the same way, so it lives here once.
 *
 * Отметка записи в строке: иконка тоном статуса. У задачи это кнопка, клик по ней двигает статус по кругу
 * (не начата, в работе, готова, не начата…); у других типов такого быстрого хода нет, и отметка простая.
 * Дерево и лента рисуют её одинаково, поэтому она живёт тут один раз.
 */
import { TaoIcon } from '@1337exp/taoui';
import type { AxisRecord } from '@/core/model';
import { useI18n } from '@/i18n';
import { nextStatus, recordIcon, toneClass } from './marks';
import { changeStatus } from './undoable';

const props = defineProps<{
    record: AxisRecord;
    /** `false`: the button is out of the tab order (the tree row around it is the one that takes the focus). / `false`: кнопка вне порядка Tab (фокус берёт строка дерева вокруг неё). */
    tabbable?: boolean;
}>();

const { t } = useI18n();

async function toggle(): Promise<void> {
    await changeStatus(props.record, nextStatus(props.record.status));
}
</script>

<template>
    <button
        v-if="record.type === 'task'"
        type="button"
        class="mark mark--button"
        :class="toneClass(record)"
        :title="`${t('tree.toggle')}: ${t(`status.task.${record.status}`)}`"
        :aria-label="`${t('tree.toggle')}: ${t(`status.task.${record.status}`)}`"
        :tabindex="tabbable === false ? -1 : undefined"
        @click.stop="toggle"
    >
        <TaoIcon :name="recordIcon(record)" />
    </button>
    <span v-else class="mark" :class="toneClass(record)" :title="t(`type.${record.type}`)"><TaoIcon :name="recordIcon(record)" /></span>
</template>

<style scoped>
.mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: none;
    font-size: 16px;
}

.mark--button {
    cursor: pointer;
    border-radius: var(--tao-radius-full);
}

.mark--button:hover {
    color: var(--tao-color-text-strong);
}

.mark--button:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 2px;
}
</style>
