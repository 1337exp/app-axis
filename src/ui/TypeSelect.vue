<script setup lang="ts">
/**
 * A select of the record type with the type icon before the text, in the list and in the shown value.
 * TaoUI's `TaoSelect` has no slot or icon field for its options, so this is a `TaoDropdownMenu` (its `#button` face
 * and `#item` slot take markup) with radio items, dressed like a select field.
 *
 * Выбор типа записи с иконкой типа перед текстом, и в списке, и в показанном значении.
 * У `TaoSelect` из TaoUI нет ни слота, ни поля иконки у пунктов, поэтому это `TaoDropdownMenu` (его кнопка `#button`
 * и слот `#item` принимают разметку) с радио-пунктами, одетый как поле выбора.
 */
import { TaoDropdownMenu, TaoIcon } from '@1337exp/taoui';
import type { TaoMenuItem } from '@1337exp/taoui';
import { computed } from 'vue';
import { RECORD_TYPES, isRecordType } from '@/core/model';
import type { RecordType } from '@/core/model';
import { useI18n } from '@/i18n';
import { typeIcon } from './marks';

const model = defineModel<RecordType>({ required: true });
defineProps<{ ariaLabel?: string }>();

const { t } = useI18n();

const items = computed<TaoMenuItem[]>(() => RECORD_TYPES.map((value) => ({ type: 'radio', id: value, group: 'type', label: t(`type.${value}`), checked: value === model.value })));

function pick(id: string): void {
    if (isRecordType(id)) model.value = id;
}
</script>

<template>
    <TaoDropdownMenu class="type-select" :items="items" placement="bottom-start" :menu-label="ariaLabel" @select="pick">
        <template #button>
            <span class="type-select__face" :title="ariaLabel">
                <TaoIcon class="type-select__icon" :name="typeIcon(model)" />
                <span class="type-select__value">{{ t(`type.${model}`) }}</span>
                <span class="type-select__chevron" aria-hidden="true"></span>
            </span>
        </template>
        <template #item="{ id, label }">
            <TaoIcon v-if="isRecordType(id)" class="type-select__icon" :name="typeIcon(id)" />
            <span class="type-select__text">{{ label }}</span>
        </template>
    </TaoDropdownMenu>
</template>

<style scoped>
.type-select {
    display: block;
}

/* the menu's own button face (padding, hover) is dropped: the face below is the field / собственный вид кнопки меню убран: полем служит лицо ниже */
.type-select :deep(.tao-dropdown-menu__button) {
    display: block;
    width: 100%;
    padding: 0;
    border-radius: var(--tao-radius-control);
}

.type-select :deep(.tao-dropdown-menu__button:hover) {
    background: none;
}

.type-select__face {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    box-sizing: border-box;
    width: 100%;
    height: var(--tao-control-height);
    padding: 0 var(--tao-control-padding-x);
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-control);
    background: var(--tao-color-input-bg);
    color: var(--tao-color-input-text);
    font-size: var(--tao-control-font-size);
    text-align: left;
}

.type-select :deep(.tao-dropdown-menu__button[aria-expanded='true']) .type-select__face,
.type-select :deep(.tao-dropdown-menu__button:focus-visible) .type-select__face {
    border-color: var(--tao-color-accent);
}

.type-select :deep(.tao-dropdown-menu__button:focus-visible) {
    outline: none;
}

.type-select__icon {
    flex: none;
    color: var(--tao-color-text-muted);
}

.type-select__value,
.type-select__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.type-select__value {
    flex: 1;
}

.type-select__chevron {
    flex: none;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid currentColor;
}
</style>
