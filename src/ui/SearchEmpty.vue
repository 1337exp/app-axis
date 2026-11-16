<script setup lang="ts">
/**
 * The quiet empty state of a view when the quick search finds nothing, with a button that clears the line.
 * Тихое пустое состояние вида, когда быстрый поиск ничего не нашёл, с кнопкой, очищающей строку.
 */
import { TaoButton, TaoEmpty } from '@1337exp/taoui';
import { clearSearch } from '@/app/search';
import { useI18n } from '@/i18n';

const { t } = useI18n();
</script>

<template>
    <TaoEmpty :title="t('search.none')">
        {{ t('search.noneText') }}
        <template #action>
            <TaoButton variant="secondary" tone="neutral" icon="tao-close" @click="clearSearch">{{ t('search.clear') }}</TaoButton>
        </template>
    </TaoEmpty>
</template>
