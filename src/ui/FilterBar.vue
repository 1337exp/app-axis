<script setup lang="ts">
/**
 * The thin toolbar of a working view: a toggle per type of record on the left, the branch select on the right, and in
 * between whatever the view adds in the default slot (the timeline puts "Show done" there). The choices themselves
 * live in `useViewFilter`; this only draws them.
 *
 * Тонкая панель рабочего вида: слева переключатель на каждый тип записи, справа список веток, а между ними то, что
 * вид добавит в слот (лента кладёт туда «Показать завершённые»). Сами выборы живут в `useViewFilter`, тут они только рисуются.
 */
import { TaoButton, TaoSelect } from '@1337exp/taoui';
import { FILTER_TYPES } from '@/core/filter';
import type { RecordType } from '@/core/model';
import { useI18n } from '@/i18n';
import { typeIcon } from './marks';

defineProps<{
    typeOn: (type: RecordType) => boolean;
    areaOptions: { value: string; label: string }[];
}>();

const root = defineModel<string>('root', { required: true });
const emit = defineEmits<{ type: [type: RecordType, on: boolean] }>();

const { t } = useI18n();
</script>

<template>
    <div class="filter-bar" role="group" :aria-label="t('filter.label')">
        <div class="filter-bar__types" role="group" :aria-label="t('filter.types')">
            <TaoButton
                v-for="type in FILTER_TYPES"
                :key="type"
                variant="ghost"
                tone="neutral"
                :icon="typeIcon(type)"
                :pressed="typeOn(type)"
                :aria-label="t(`type.${type}`)"
                :title="t(`type.${type}`)"
                @update:pressed="(on: boolean) => emit('type', type, on)"
            >
                <span class="filter-bar__text">{{ t(`type.${type}`) }}</span>
            </TaoButton>
        </div>
        <slot />
        <TaoSelect v-model="root" class="filter-bar__branch" :options="areaOptions" :clearable="false" :aria-label="t('filter.branch')" />
    </div>
</template>

<style scoped>
.filter-bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tao-space-2) var(--tao-space-4);
    padding: var(--tao-space-2) var(--tao-space-3);
    border-bottom: 1px solid var(--tao-color-border);
}

.filter-bar__types {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tao-space-1);
}

.filter-bar__branch {
    width: 240px;
    max-width: 100%;
    margin-left: auto;
}

/* a narrow window: the types are icons only (the words stay in the tooltip and for screen readers), the branch takes the rest of the row */
@media (max-width: 600px) {
    .filter-bar__text {
        display: none;
    }

    .filter-bar__branch {
        flex: 1;
        width: auto;
        min-width: 140px;
    }
}
</style>
