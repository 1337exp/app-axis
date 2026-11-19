<script setup lang="ts">
/**
 * A box to write an idea in: a multiline field and a button. Ctrl+Enter sends. The first line becomes the title, the
 * rest the text (`ideaFromText`). It clears itself when the send went through and keeps the text when it did not.
 *
 * Поле, где пишется задумка: многострочное поле и кнопка. Ctrl+Enter отправляет. Первая строка становится заголовком,
 * остальное текстом (`ideaFromText`). После удачной отправки очищается, при неудаче текст остаётся.
 */
import { TaoButton, TaoTextarea, TaoTooltip, toast } from '@1337exp/taoui';
import { computed, ref } from 'vue';
import { ideaFromText } from '@/core/brainstorm';
import { useI18n } from '@/i18n';

const props = defineProps<{
    label: string;
    placeholder: string;
    submit: string;
    /** Does the work; throws to keep the text. / Делает дело; бросает, чтобы текст остался. */
    send: (text: string) => Promise<unknown>;
    rows?: number;
    icon?: string;
}>();

const { t } = useI18n();
const text = ref('');
const busy = ref(false);
const ready = computed(() => ideaFromText(text.value) !== null);

async function go(): Promise<void> {
    if (!ready.value || busy.value) return;
    busy.value = true;
    try {
        await props.send(text.value);
        text.value = '';
    } catch (error) {
        toast().danger().message(t('brain.failed', [error instanceof Error ? error.message : String(error)]));
    } finally {
        busy.value = false;
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void go();
    }
}
</script>

<template>
    <form class="compose" @submit.prevent="go">
        <TaoTextarea v-model="text" :placeholder="placeholder" :aria-label="label" :rows="rows ?? 2" max-height="40vh" variant="outline" :disabled="busy" @keydown="onKeydown" />
        <TaoTooltip :content="`${submit} (${t('brain.sendHint')})`"><TaoButton type="submit" :icon="icon" :disabled="!ready" :loading="busy">{{ submit }}</TaoButton></TaoTooltip>
    </form>
</template>

<style scoped>
.compose {
    display: flex;
    gap: var(--tao-space-2);
    align-items: flex-end;
}

.compose > :first-child {
    flex: 1;
    min-width: 0;
}

@media (max-width: 599px) {
    .compose {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
