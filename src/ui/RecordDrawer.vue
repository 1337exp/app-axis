<script setup lang="ts">
/**
 * The drawer on the right with the open record, shared by the views that do not keep a record pane of their own (the
 * board and the timeline). It is open while a record is selected (the address `~board/<record>` or `~timeline/<record>`
 * is the same thing). Closing it deselects. The record pane saves what is typed when the record switches or the pane goes
 * away, so a close does not lose the last second of typing.
 *
 * Панель справа с открытой записью, общая для видов, у которых нет своей панели записи (доска и лента). Открыта,
 * пока выбрана запись (адрес `~board/<запись>` или `~timeline/<запись>` то же самое). Закрытие снимает выбор.
 * Панель записи сохраняет набранное при смене записи и при исчезновении, так что закрытие не теряет последнюю секунду набора.
 */
import { TaoDrawer } from '@1337exp/taoui';
import { computed, ref, watch } from 'vue';
import { select, selectedRecord } from '@/app/state';
import { useI18n } from '@/i18n';
import RecordPane from './RecordPane.vue';

const { t } = useI18n();

const opened = computed({
    get: () => selectedRecord.value !== null,
    set: (value: boolean) => {
        if (!value) select(null);
    },
});

// the title stays while the drawer slides out, when nothing is selected any more / заголовок остаётся, пока панель уезжает
const title = ref('');
watch(
    () => selectedRecord.value?.type,
    (type) => {
        if (type) title.value = t(`type.${type}`);
    },
    { immediate: true },
);
</script>

<template>
    <TaoDrawer v-model="opened" class="record-drawer" :title="title" side="right" :style="{ width: 'min(640px, 100%)' }">
        <RecordPane v-if="selectedRecord" />
    </TaoDrawer>
</template>

<style>
/* the drawer is teleported to body, so this cannot be scoped; the drawer already has its own padding, the record has more */
aside.record-drawer .tao-drawer__content {
    padding: 0;
}
</style>
