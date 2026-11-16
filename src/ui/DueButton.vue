<script setup lang="ts">
/**
 * A small calendar button that sets the due date of a record without opening it: a click opens a month calendar,
 * a day is saved through `patchRecord` (so the journal gets its line), "Clear" takes the date away.
 * TaoUI's `TaoDate` is a whole field (a box with the date in it) and has no compact form, so the button is a
 * `TaoPopover` with a `TaoCalendar`, the parts `TaoDate` itself is made of.
 *
 * Маленькая кнопка с календарём, которая ставит срок записи, не открывая её: клик открывает календарь на месяц,
 * выбранный день сохраняется через `patchRecord` (в журнале появляется строка), «Без срока» убирает дату.
 * `TaoDate` из TaoUI это целое поле (рамка с датой) и компактного вида у него нет, поэтому кнопка это `TaoPopover`
 * с `TaoCalendar`, из которых сам `TaoDate` и собран.
 */
import { TaoButton, TaoCalendar, TaoPopover, toast } from '@1337exp/taoui';
import { nextTick, ref, watch } from 'vue';
import { patchRecord } from '@/app/state';
import type { AxisRecord } from '@/core/model';
import { useI18n } from '@/i18n';

const props = defineProps<{ record: Pick<AxisRecord, 'id' | 'due'> }>();

const { t } = useI18n();
const open = ref(false);
const calendar = ref<{ focus: () => void } | null>(null);

// the keys of the calendar listen on the calendar itself, so it takes the focus when it opens
watch(open, async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    calendar.value?.focus();
});

async function choose(value: unknown): Promise<void> {
    const due = typeof value === 'string' ? value : null;
    open.value = false;
    if (due === props.record.due) return;
    try {
        await patchRecord(props.record.id, { due });
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    }
}
</script>

<template>
    <TaoPopover v-model="open" class="due-button" :class="{ 'due-button--open': open }" placement="bottom-end">
        <template #trigger>
            <TaoButton variant="ghost" tone="neutral" size="small" icon="tao-calendar" :aria-label="t('timeline.setDate')" :title="t('timeline.setDate')" :aria-expanded="open" aria-haspopup="dialog" />
        </template>
        <TaoCalendar ref="calendar" :model-value="record.due" :today-text="t('record.today')" :clear-text="t('record.dueClear')" @change="choose" />
    </TaoPopover>
</template>
