<script setup lang="ts">
/**
 * One round of a brainstorm: the idea (seed) with its state and the button that hands the turn over, the variants of
 * Claude to rate, the verdict (which can be accepted as a decision) and a box to reply to it. An older round is folded
 * to one line (the idea and the start of the verdict); the last one is open. The state is `roundState`, nothing here is stored.
 *
 * Один раунд брейншторма: задумка (seed) с её состоянием и кнопкой передачи хода, варианты Claude для оценки, вердикт
 * (его можно принять как решение) и поле для ответа. Старый раунд свёрнут в одну строку (задумка и начало вердикта);
 * последний открыт. Состояние это `roundState`, ничего здесь не хранится.
 */
import { TaoButton, TaoIcon, TaoTooltip, toast } from '@1337exp/taoui';
import { computed, ref } from 'vue';
import { addSeed, patchBrain, patchRecord, select } from '@/app/state';
import { isAccepted, roundState } from '@/core/brainstorm';
import type { Round } from '@/core/brainstorm';
import { preview } from '@/core/text';
import { useI18n } from '@/i18n';
import BrainCompose from './BrainCompose.vue';
import BrainText from './BrainText.vue';
import BrainVariant from './BrainVariant.vue';

const props = defineProps<{
    round: Round;
    /** The number of the round in its thread, from 1. / Номер раунда в нити, с 1. */
    number: number;
    /** The last round of the thread: open by default. / Последний раунд нити: по умолчанию открыт. */
    last: boolean;
}>();

const { t } = useI18n();

const state = computed(() => roundState(props.round));
/** The person opened or folded it by hand; until then the last round is open and the older ones are folded. / Человек открыл или свернул вручную; пока нет, последний открыт, старые свёрнуты. */
const touched = ref<boolean | null>(null);
const open = computed(() => touched.value ?? props.last);
const accepted = computed(() => (props.round.verdict ? isAccepted(props.round.verdict) : false));
const verdictLine = computed(() => (props.round.verdict ? preview(props.round.verdict.body, 120) || props.round.verdict.title : ''));

const fail = (error: unknown): void => void toast().danger().message(t('brain.failed', [error instanceof Error ? error.message : String(error)]));

async function hand(on: boolean): Promise<void> {
    try {
        await patchBrain(props.round.seed.id, { handed: on });
    } catch (error) {
        fail(error);
    }
}

async function accept(): Promise<void> {
    const verdict = props.round.verdict;
    if (!verdict) return;
    try {
        await patchRecord(verdict.id, { type: 'decision', status: 'done' });
    } catch (error) {
        fail(error);
    }
}

/** A reply is a new idea under the verdict, handed to Claude at once. / Ответ это новая задумка под вердиктом, сразу переданная Claude. */
const reply = (text: string): Promise<unknown> => addSeed(text, { parent: props.round.verdict!.id, handed: true });
</script>

<template>
    <article class="round" :class="[`round--${state}`, { 'round--open': open }]" :aria-label="`${t('brain.round', [number])}: ${round.seed.title}`">
        <button v-if="!open" type="button" class="fold" :aria-expanded="false" :title="t('brain.expand')" @click="touched = true">
            <TaoIcon name="tao-chevron-down" class="fold__icon" />
            <span class="fold__title">{{ round.seed.title }}</span>
            <span v-if="verdictLine" class="fold__verdict">{{ verdictLine }}</span>
            <span class="chip">{{ t(`brain.state.${state}`) }}</span>
        </button>

        <template v-else>
            <section class="seed">
                <header class="seed__head">
                    <TaoIcon class="seed__icon" name="type-idea" />
                    <TaoTooltip class="title-tip" :content="t('brain.openRecord')"><button type="button" class="seed__title" @click="select(round.seed.id)">{{ round.seed.title }}</button></TaoTooltip>
                    <span class="chip" :class="`chip--${state}`">{{ t(`brain.state.${state}`) }}</span>
                    <TaoButton v-if="state === 'draft' || state === 'rating'" size="small" icon="brainstorm" @click="hand(true)">{{ t('brain.hand') }}</TaoButton>
                    <TaoButton v-else-if="state === 'waiting'" size="small" variant="secondary" tone="neutral" @click="hand(false)">{{ t('brain.take') }}</TaoButton>
                    <TaoTooltip v-if="!last" class="seed__fold" :content="t('brain.collapse')">
                        <TaoButton size="small" variant="ghost" tone="neutral" icon="tao-chevron-down" :aria-label="t('brain.collapse')" :aria-expanded="true" @click="touched = false" />
                    </TaoTooltip>
                </header>
                <BrainText :body="round.seed.body" :title="round.seed.title" />
            </section>

            <section v-if="round.variants.length > 0" class="variants" :aria-label="t('brain.variants')">
                <h3 class="label">{{ t('brain.variants') }}</h3>
                <ul class="variants__list">
                    <BrainVariant v-for="variant in round.variants" :key="variant.id" :record="variant" />
                </ul>
            </section>
            <p v-else-if="state === 'draft'" class="hint">{{ t('brain.noVariants') }}</p>
            <p v-else-if="state === 'waiting'" class="hint">{{ t('brain.waitingText') }}</p>

            <section v-if="round.verdict" class="verdict">
                <header class="verdict__head">
                    <TaoIcon :name="accepted ? 'type-decision' : 'type-note'" />
                    <h3 class="label label--inline">{{ accepted ? t('brain.accepted') : t('brain.verdict') }}</h3>
                    <TaoTooltip class="title-tip" :content="t('brain.openRecord')"><button type="button" class="verdict__title" @click="select(round.verdict.id)">{{ round.verdict.title }}</button></TaoTooltip>
                    <TaoButton v-if="!accepted" size="small" variant="secondary" tone="neutral" icon="type-decision" @click="accept">{{ t('brain.accept') }}</TaoButton>
                </header>
                <BrainText :body="round.verdict.body" />
            </section>

            <section v-if="state === 'verdict'" class="reply">
                <h3 class="label">{{ t('brain.reply') }}</h3>
                <BrainCompose :label="t('brain.reply')" :placeholder="t('brain.replyPlaceholder')" :submit="t('brain.replySend')" icon="brainstorm" :send="reply" />
                <p class="hint hint--small">{{ t('brain.replyNote') }}</p>
            </section>
        </template>
    </article>
</template>

<style scoped>
.round {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-3);
    padding: var(--tao-space-3);
    border: 1px solid var(--tao-color-border);
    border-radius: var(--tao-radius-lg);
    background: var(--tao-color-surface-sunken);
}

.round:not(.round--open) {
    padding: 0;
}

.fold {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    width: 100%;
    padding: var(--tao-space-2) var(--tao-space-3);
    border: 0;
    border-radius: inherit;
    background: none;
    color: var(--tao-color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.fold:hover {
    background: color-mix(in srgb, var(--tao-color-text) 5%, transparent);
}

.fold:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: -2px;
}

.fold__icon {
    flex: none;
    transform: rotate(-90deg);
    color: var(--tao-color-text-muted);
}

.fold__title {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    color: var(--tao-color-text-strong);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fold__verdict {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fold .chip {
    margin-left: auto;
}

.seed {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
    padding: var(--tao-space-3);
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface);
}

.seed__head,
.verdict__head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--tao-space-2);
}

.seed__icon {
    flex: none;
    color: var(--tao-color-text-muted);
}

/* the tooltip wrapper is the flex item that takes the free width; the button is the text inside it / обёртка подсказки это flex-элемент, занимающий свободную ширину; кнопка это текст внутри неё */
.title-tip {
    flex: 1;
    min-width: 8em;
}

.seed__title,
.verdict__title {
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

.seed__title:hover,
.verdict__title:hover {
    text-decoration: underline;
}

.seed__title:focus-visible,
.verdict__title:focus-visible {
    outline: 2px solid var(--tao-color-accent);
    outline-offset: 2px;
}

/* the state is words in a quiet frame, not a colour (colour is for status only): the turn of Claude is a bolder word / состояние это слова в тихой рамке, не цвет (цвет только у статуса): ход Claude выделен жирным словом */
.chip {
    flex: none;
    padding: 1px var(--tao-space-2);
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-full);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    white-space: nowrap;
}

.chip--waiting,
.chip--verdict {
    color: var(--tao-color-text-strong);
    font-weight: 600;
}

.label {
    margin: 0 0 var(--tao-space-2);
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.label--inline {
    margin: 0;
}

.variants__list {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.verdict,
.reply {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
    padding: var(--tao-space-3);
    border: 1px solid var(--tao-color-border-strong);
    border-radius: var(--tao-radius-md);
    background: var(--tao-color-surface);
}

.verdict .label {
    margin: 0;
}

.reply {
    border-style: dashed;
    background: none;
}

.reply .label {
    margin: 0;
}

.hint {
    margin: 0;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-sm);
}

.hint--small {
    font-size: var(--tao-font-size-xs);
}
</style>
