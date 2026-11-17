<script setup lang="ts">
/**
 * The text of a card of the brainstorm, read only: a few lines, and "Show more" when there is more.
 * Текст карточки брейншторма, только для чтения: несколько строк и «Показать полностью», если их больше.
 */
import { computed, ref } from 'vue';
import type { Doc } from '@1337exp/taoeditor/core';
import { plainText } from '@/core/text';
import { useI18n } from '@/i18n';

const props = defineProps<{
    body: Doc | null;
    /** The title shown above: an idea typed in one box has its title as the first line of the text, which is not said twice. / Заголовок над текстом: у задумки, набранной одним полем, он же первая строка текста; дважды его не пишем. */
    title?: string;
}>();
const { t } = useI18n();

const text = computed(() => {
    const whole = plainText(props.body).trim();
    const [first = '', ...rest] = whole.split('\n');
    return props.title && rest.length > 0 && first.replace(/\s+/g, ' ').trim() === props.title ? rest.join('\n').trim() : whole;
});
/** Longer than the few lines that are shown. / Длиннее, чем показанные строки. */
const long = computed(() => text.value.length > 220 || text.value.split('\n').length > 4);
const open = ref(false);
</script>

<template>
    <div v-if="text" class="text">
        <p class="text__body" :class="{ 'text__body--clamp': long && !open }">{{ text }}</p>
        <button v-if="long" type="button" class="text__more" :aria-expanded="open" @click="open = !open">{{ open ? t('record.showLess') : t('record.showMore') }}</button>
    </div>
</template>

<style scoped>
.text__body {
    margin: 0;
    color: var(--tao-color-text);
    font-size: var(--tao-font-size-sm);
    line-height: 1.5;
    white-space: pre-line;
    overflow-wrap: anywhere;
}

.text__body--clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
}

.text__more {
    margin-top: var(--tao-space-1);
    padding: 0;
    border: 0;
    background: none;
    color: var(--tao-color-text-muted);
    font: inherit;
    font-size: var(--tao-font-size-xs);
    text-decoration: underline;
    cursor: pointer;
}

.text__more:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 2px;
}
</style>
