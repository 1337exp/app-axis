<script setup lang="ts">
/**
 * A variant of Claude under an idea: its title and text, two independent marks (good, bad: both on is "disputed") and a
 * short note. A click on a mark saves at once; the note saves when the field loses the focus or on Enter. The marks do not
 * use colour (colour is for status only): the mark that is on is a filled thumb with the accent frame, the shape says which
 * is which, and the words of the rating are in the tooltip and the label for a screen reader.
 *
 * Вариант Claude под задумкой: заголовок и текст, две независимые отметки (хорошо, плохо: обе значит «спорно») и короткая
 * заметка. Клик по отметке сохраняется сразу; заметка сохраняется, когда поле теряет фокус, или по Enter. Отметки без
 * цвета (цвет только у статуса): включённая это залитый палец в рамке акцента, форма говорит, какая из них какая,
 * а слова оценки стоят в подсказке и в подписи для экранного диктора.
 */
import { TaoIcon, TaoTextarea, toast } from '@1337exp/taoui';
import { ref, watch } from 'vue';
import { patchBrain, select } from '@/app/state';
import { ratingOf } from '@/core/brainstorm';
import { BRAIN_REMARK_MAX } from '@/core/model';
import type { AxisRecord } from '@/core/model';
import { useI18n } from '@/i18n';
import BrainText from './BrainText.vue';

const props = defineProps<{ record: AxisRecord }>();
const { t } = useI18n();

const like = (): boolean => props.record.brain?.like === true;
const dislike = (): boolean => props.record.brain?.dislike === true;

const remark = ref(props.record.brain?.remark ?? '');
watch(
    () => props.record.brain?.remark ?? '',
    (value) => (remark.value = value),
);

const fail = (error: unknown): void => void toast().danger().message(t('brain.failed', [error instanceof Error ? error.message : String(error)]));

async function toggle(which: 'like' | 'dislike'): Promise<void> {
    const on = which === 'like' ? like() : dislike();
    try {
        await patchBrain(props.record.id, { [which]: !on });
    } catch (error) {
        fail(error);
    }
}

async function saveRemark(): Promise<void> {
    const next = remark.value.trim();
    if (next === (props.record.brain?.remark ?? '')) {
        remark.value = next;
        return;
    }
    try {
        await patchBrain(props.record.id, { remark: next });
    } catch (error) {
        fail(error);
    }
}
</script>

<template>
    <li class="variant" :class="`variant--${ratingOf(record)}`">
        <div class="variant__main">
            <button type="button" class="variant__title" :title="t('brain.openRecord')" @click="select(record.id)">{{ record.title }}</button>
            <BrainText :body="record.body" />
        </div>
        <div class="variant__rate" role="group" :aria-label="t('brain.ratingOf', [t(`brain.rating.${ratingOf(record)}`)])">
            <button type="button" class="thumb" :class="{ 'thumb--on': like() }" :aria-pressed="like()" :aria-label="t('brain.like')" :title="t('brain.like')" @click="toggle('like')">
                <TaoIcon :name="like() ? 'thumb-up-fill' : 'thumb-up'" />
            </button>
            <button type="button" class="thumb" :class="{ 'thumb--on': dislike() }" :aria-pressed="dislike()" :aria-label="t('brain.dislike')" :title="t('brain.dislike')" @click="toggle('dislike')">
                <TaoIcon :name="dislike() ? 'thumb-down-fill' : 'thumb-down'" />
            </button>
            <span class="variant__word" :class="{ 'variant__word--quiet': ratingOf(record) === 'neutral' }">{{ t(`brain.rating.${ratingOf(record)}`) }}</span>
        </div>
        <TaoTextarea
            v-model="remark"
            class="variant__remark"
            :placeholder="t('brain.remarkPlaceholder')"
            :aria-label="t('brain.remark')"
            :rows="1"
            :maxlength="BRAIN_REMARK_MAX"
            max-height="30vh"
            variant="outline"
            size="small"
            blur-on-enter
            @blur="saveRemark"
        />
    </li>
</template>

<style scoped>
.variant {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--tao-space-2) var(--tao-space-3);
    padding: var(--tao-space-3);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface);
    list-style: none;
}

.variant__main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-1);
}

.variant__title {
    align-self: flex-start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--tao-color-text-strong);
    font: inherit;
    font-weight: 600;
    line-height: 1.4;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
}

.variant__title:hover {
    text-decoration: underline;
}

.variant__title:focus-visible,
.thumb:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 2px;
}

.variant__rate {
    display: flex;
    align-items: center;
    gap: var(--tao-space-1);
}

.thumb {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-full);
    background: none;
    color: var(--tao-color-text-muted);
    font-size: 17px;
    cursor: pointer;
}

.thumb:hover {
    color: var(--tao-color-text);
}

/* on: filled thumb and the accent frame (the accent is for selection), no green and no red / включена: залитый палец и рамка акцента (акцент это выбор), ни зелёного, ни красного */
.thumb--on {
    border-color: var(--tao-color-accent);
    box-shadow: 0 0 0 1px var(--tao-color-accent);
    color: var(--tao-color-text-strong);
}

.variant__word {
    min-width: 5.5em;
    color: var(--tao-color-text);
    font-size: var(--tao-font-size-xs);
}

.variant__word--quiet {
    color: var(--tao-color-text-muted);
}

.variant__remark {
    grid-column: 1 / -1;
}

@media (max-width: 599px) {
    .variant {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
