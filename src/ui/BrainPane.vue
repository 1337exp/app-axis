<script setup lang="ts">
/**
 * The brainstorm: ideas developed in rounds with Claude. At the top a box for a new idea; below, the threads. A thread is a
 * chain of rounds: an idea, the variants of Claude, the rating of the person, the verdict, the reply (which is the next
 * idea). The rounds are built from the records by `core/brainstorm.ts`; the records stay ordinary ones, so the tree, the
 * board and the rest see them as before. A click on a title opens the record in the drawer on the right.
 *
 * Брейншторм: идеи, которые развиваются раундами вместе с Claude. Сверху поле для новой задумки, ниже нити. Нить это
 * цепочка раундов: задумка, варианты Claude, оценка человека, вердикт, ответ (он же следующая задумка). Раунды собирает
 * из записей `core/brainstorm.ts`; записи остаются обычными, поэтому дерево, доска и остальное видят их как раньше.
 * Клик по заголовку открывает запись в панели справа.
 */
import { TaoEmpty } from '@1337exp/taoui';
import { computed } from 'vue';
import { addSeed, threads } from '@/app/state';
import { useI18n } from '@/i18n';
import BrainCompose from './BrainCompose.vue';
import BrainRound from './BrainRound.vue';
import RecordDrawer from './RecordDrawer.vue';

const { t } = useI18n();

// the newest idea first, and it stays where it is while its rounds change / сначала новая задумка, и она остаётся на месте, пока меняются её раунды
const ordered = computed(() => [...threads.value].sort((a, b) => b.rounds[0]!.seed.created.localeCompare(a.rounds[0]!.seed.created) || b.id.localeCompare(a.id)));

const create = (text: string): Promise<unknown> => addSeed(text);
</script>

<template>
    <section class="brain-pane" :aria-label="t('brain.label')">
        <div class="brain-scroll">
            <div class="brain">
                <section class="brain__new">
                    <h2 class="brain__title">{{ t('brain.newIdea') }}</h2>
                    <BrainCompose :label="t('brain.newIdea')" :placeholder="t('brain.newIdeaPlaceholder')" :submit="t('brain.start')" icon="tao-plus" :send="create" />
                </section>

                <TaoEmpty v-if="ordered.length === 0" class="brain__empty" :title="t('brain.empty')">
                    {{ t('brain.emptyText') }}
                    <p class="brain__steps">{{ t('brain.steps') }}</p>
                </TaoEmpty>

                <ol v-else class="threads">
                    <li v-for="thread in ordered" :key="thread.id" class="thread">
                        <BrainRound v-for="(round, index) in thread.rounds" :key="round.seed.id" :round="round" :number="index + 1" :last="index === thread.rounds.length - 1" />
                    </li>
                </ol>
            </div>
        </div>

        <RecordDrawer />
    </section>
</template>

<style scoped>
.brain-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
}

.brain-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.brain {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-4);
    max-width: 860px;
    margin: 0 auto;
    padding: var(--tao-space-4) var(--tao-space-3);
}

.brain__new {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
}

.brain__title {
    margin: 0;
    color: var(--tao-color-text-strong);
    font-size: var(--tao-font-size-sm);
    font-weight: 600;
}

.brain__empty {
    margin: var(--tao-space-6) auto;
}

.brain__steps {
    margin: var(--tao-space-2) 0 0;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.threads {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-5);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* a thread: rounds one under another, joined by a thin line on the left / нить: раунды друг под другом, соединены тонкой линией слева */
.thread {
    display: flex;
    flex-direction: column;
    gap: var(--tao-space-2);
    margin-left: var(--tao-space-2);
    padding-left: var(--tao-space-3);
    border-left: 2px solid var(--tao-color-border-strong);
}
</style>
