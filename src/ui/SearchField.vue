<script setup lang="ts">
/**
 * The search field of the header: one line for every view. `/` and Ctrl+K focus it (not while typing in a field or the
 * editor), Escape clears it and, pressed again, leaves it; Enter asks the map to bring the found cards into view. On a narrow
 * window it is an icon that opens the field. A small "N found" stands beside it while a line is typed.
 *
 * Поле поиска в шапке: одна строка на все виды. `/` и Ctrl+K переводят на него фокус (не при наборе в поле или редакторе),
 * Escape очищает, повторный выходит из поля; Enter просит карту показать найденные карточки. В узком окне это иконка,
 * которая раскрывает поле. Рядом с ним, пока набрана строка, маленькое «найдено N».
 */
import { TaoButton, TaoIcon, TaoInput } from '@1337exp/taoui';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { clearSearch, found, search, searching } from '@/app/search';
import { tn, useI18n } from '@/i18n';

const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
/** On a narrow window the field is folded into an icon until it is opened. / В узком окне поле свёрнуто в иконку, пока его не откроют. */
const open = ref(false);

const input = (): HTMLInputElement | null | undefined => root.value?.querySelector('input');

async function focus(): Promise<void> {
    open.value = true;
    await nextTick();
    input()?.focus();
    input()?.select();
}

function onWindowKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const ctrlK = (event.ctrlKey || event.metaKey) && event.code === 'KeyK';
    const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!ctrlK && !slash) return;
    event.preventDefault();
    void focus();
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault();
        if (search.line !== '') clearSearch();
        else {
            input()?.blur();
            open.value = false;
        }
    } else if (event.key === 'Enter') {
        event.preventDefault();
        search.enter += 1;
    }
}

function onBlur(): void {
    if (search.line === '') open.value = false;
}

onMounted(() => window.addEventListener('keydown', onWindowKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey));
</script>

<template>
    <div ref="root" class="search" :class="{ 'search--open': open || searching }" role="search">
        <TaoButton class="search__icon" variant="ghost" tone="neutral" icon="tao-search" :aria-label="t('search.open')" :title="t('search.open')" @click="focus" />
        <TaoInput
            v-model="search.line"
            class="search__input"
            size="small"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.label')"
            autocomplete="off"
            @keydown="onKeydown"
            @blur="onBlur"
        >
            <template #prefix><TaoIcon name="tao-search" /></template>
            <template #suffix>
                <button v-if="search.line !== ''" type="button" class="search__clear" :aria-label="t('search.clear')" :title="t('search.clear')" @click="clearSearch(); input()?.focus()">
                    <TaoIcon name="tao-close" />
                </button>
            </template>
        </TaoInput>
        <span v-if="found" class="search__count" aria-live="polite">{{ tn('search.found', found.size) }}</span>
    </div>
</template>

<style scoped>
.search {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    min-width: 0;
}

.search__input {
    width: 260px;
    min-width: 0;
}

.search__icon {
    display: none;
}

.search__clear {
    display: inline-grid;
    place-items: center;
    padding: 2px;
    border: 0;
    border-radius: var(--tao-radius-full);
    background: none;
    color: var(--tao-color-text-muted);
    cursor: pointer;
}

.search__clear:hover {
    color: var(--tao-color-text-strong);
}

.search__count {
    flex: none;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* a narrow window: an icon that opens the field */
@media (max-width: 900px) {
    .search__input {
        width: 200px;
    }
}

@media (max-width: 700px) {
    .search__icon {
        display: inline-flex;
    }

    .search:not(.search--open) .search__input,
    .search:not(.search--open) .search__count {
        display: none;
    }

    .search--open .search__icon {
        display: none;
    }
}
</style>
