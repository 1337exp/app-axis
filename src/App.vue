<script setup lang="ts">
/**
 * The shell: a navigation (`TaoNav`) with the views, the main action "New record", the project menu, the language and the
 * theme, and beside it the page of the view: the tree beside the open record, the board, the timeline, the map or the
 * journal; at the bottom the status bar. The navigation is a side panel with labels on a wide window, a rail of icons when
 * it is folded or the window is narrower, and a bar at the bottom on a phone (there a thin header carries the project, the
 * language and the theme, which the bar has no room for).
 *
 * Оболочка: навигация (`TaoNav`) с видами, главным действием «Запись», меню проектов, языком и темой, а рядом страница
 * вида: дерево рядом с открытой записью, доска, лента, карта или журнал; внизу строка состояния. Навигация это боковая
 * панель с подписями на широком окне, рейка иконок, когда она свёрнута или окно уже, и панель снизу на телефоне (там
 * тонкая шапка несёт проект, язык и тему, для которых в панели места нет).
 */
import { TaoAlert, TaoButton, TaoDropdownMenu, TaoEmpty, TaoIcon, TaoLoader, TaoNav, TaoSplit, TaoThemeToggle } from '@1337exp/taoui';
import type { TaoMenuItem, TaoNavItem } from '@1337exp/taoui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ui } from '@/app/ui';
import { openProject, setView, start, state, progress, waiting } from '@/app/state';
import type { View } from '@/app/state';
import { LOCALE_NAMES, codes, current, setLocale, useI18n } from '@/i18n';
import type { LocaleCode } from '@/i18n';
import BoardPane from '@/ui/BoardPane.vue';
import BrainPane from '@/ui/BrainPane.vue';
import JournalPane from '@/ui/JournalPane.vue';
import MapPane from '@/ui/MapPane.vue';
import NewProjectDialog from '@/ui/NewProjectDialog.vue';
import RecordPane from '@/ui/RecordPane.vue';
import StatusBar from '@/ui/StatusBar.vue';
import TimelinePane from '@/ui/TimelinePane.vue';
import TreePane from '@/ui/TreePane.vue';

const { t } = useI18n();

const creating = ref(false);
const split = ref(Number(localStorage.getItem('axis.split')) || 38);
watch(split, (value) => localStorage.setItem('axis.split', String(Math.round(value))));

// ───────────────────────────── navigation / навигация ─────────────────────────────

/** A phone: the navigation is a bar at the bottom. / Телефон: навигация это панель снизу. */
const narrow = ref(false);
let query: MediaQueryList | null = null;
const onQuery = (): void => {
    narrow.value = query?.matches ?? false;
};
/** `N` is "New record" (shown on the button), when no field has the keys. / `N` это «Новая запись» (написано на кнопке), когда клавиши не заняты полем. */
function onKey(event: KeyboardEvent): void {
    if (event.code !== 'KeyN' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !state.project) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    event.preventDefault();
    void newRecord();
}
onMounted(() => {
    query = window.matchMedia('(max-width: 599px)');
    onQuery();
    query.addEventListener('change', onQuery);
    window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
    query?.removeEventListener('change', onQuery);
    window.removeEventListener('keydown', onKey);
});

/** The person folded the side panel into a rail. / Человек свернул боковую панель в рейку. */
const folded = ref(localStorage.getItem('axis.nav') === 'rail');
watch(folded, (on) => localStorage.setItem('axis.nav', on ? 'rail' : 'wide'));
const layout = computed(() => (!narrow.value && folded.value ? 'rail' : 'auto'));

const items = computed<TaoNavItem[]>(() => [
    { id: 'tree', label: t('view.tree'), icon: 'tree' },
    { id: 'board', label: t('view.board'), icon: 'board', ...(progress.value.active > 0 ? { badge: progress.value.active } : {}) },
    { id: 'timeline', label: t('view.timeline'), icon: 'timeline' },
    { id: 'map', label: t('view.map'), icon: 'map' },
    { id: 'brainstorm', label: t('view.brainstorm'), icon: 'brainstorm', ...(waiting.value > 0 ? { badge: waiting.value } : {}) },
    { id: 'journal', label: t('view.journal'), icon: 'journal' },
]);

function onSelect(id: string): void {
    setView(id as View);
}

/** "New record": the tree, with the focus in its quick input. / «Запись»: дерево с фокусом в быстром вводе. */
async function newRecord(): Promise<void> {
    setView('tree');
    await nextTick();
    ui.quick += 1;
}

// ───────────────────────────── projects, language / проекты, язык ─────────────────────────────

const NEW = '*new';
const projectItems = computed<TaoMenuItem[]>(() => [
    ...state.projects.map((p): TaoMenuItem => ({ type: 'radio', id: p.id, group: 'project', label: p.title, checked: p.id === state.projectId })),
    ...(state.projects.length > 0 ? [{ type: 'separator' } as TaoMenuItem] : []),
    { id: NEW, label: t('project.create'), icon: 'tao-plus' },
]);
function onProject(id: string): void {
    if (id === NEW) creating.value = true;
    else if (id !== state.projectId) void openProject(id);
}

const localeItems = computed<TaoMenuItem[]>(() => codes.map((code) => ({ type: 'radio', id: code, group: 'locale', label: LOCALE_NAMES[code], checked: code === current.value })));
const onLocale = (id: string): void => setLocale(id as LocaleCode);

watch(
    () => state.project?.title,
    (title) => (document.title = title ? `${title} · Axis` : 'Axis'),
    { immediate: true },
);
watch(current, (code) => (document.documentElement.lang = code), { immediate: true });
</script>

<template>
    <TaoNav :model-value="state.project ? state.view : ''" class="app__nav" :layout="layout" badge-tone="neutral" :items="items" :aria-label="t('nav.label')" @select="(id: string, event: Event) => { event.preventDefault(); onSelect(id); }">
        <!-- the main action, then the project: the rail shows the action round and the project as an icon -->
        <template #action>
            <TaoButton icon="tao-plus" shortcut="N" :disabled="!state.project" @click="newRecord"><span class="tao-nav__action-label">{{ t('nav.newRecord') }}</span></TaoButton>
            <TaoDropdownMenu v-if="state.ready && !narrow" class="nav-project" :items="projectItems" :menu-label="t('project.choose')" placement="bottom-start" @select="onProject">
                <template #button>
                    <span class="nav-chip" :title="t('project.choose')">
                        <TaoIcon name="tao-folder" />
                        <span class="nav-chip__text">{{ state.project?.title ?? t('project.choose') }}</span>
                        <TaoIcon class="nav-chip__more" name="tao-chevron-down" />
                    </span>
                </template>
            </TaoDropdownMenu>
        </template>

        <template #footer>
            <div class="nav-foot">
                <TaoDropdownMenu :items="localeItems" :menu-label="t('app.language')" placement="top-start" @select="onLocale">
                    <template #button>
                        <span class="nav-chip nav-chip--tool" :title="t('app.language')">
                            <TaoIcon name="language" />
                            <span class="nav-chip__text">{{ LOCALE_NAMES[current] }}</span>
                        </span>
                    </template>
                </TaoDropdownMenu>
                <TaoThemeToggle :to-light-label="t('app.toLight')" :to-dark-label="t('app.toDark')" />
                <TaoButton
                    v-if="!narrow"
                    class="nav-fold"
                    variant="ghost"
                    tone="neutral"
                    :icon="folded ? 'panel-open' : 'panel-close'"
                    :aria-label="folded ? t('nav.expand') : t('nav.collapse')"
                    :title="folded ? t('nav.expand') : t('nav.collapse')"
                    @click="folded = !folded"
                />
            </div>
        </template>

        <div class="app">
            <!-- a phone: the bar below has no room for the project, the language and the theme -->
            <header v-if="narrow" class="app__bar">
                <TaoDropdownMenu v-if="state.ready" :items="projectItems" :menu-label="t('project.choose')" placement="bottom-start" @select="onProject">
                    <template #button>
                        <span class="nav-chip">
                            <TaoIcon name="tao-folder" />
                            <span class="nav-chip__text">{{ state.project?.title ?? t('project.choose') }}</span>
                            <TaoIcon class="nav-chip__more" name="tao-chevron-down" />
                        </span>
                    </template>
                </TaoDropdownMenu>
                <span class="app__space"></span>
                <TaoDropdownMenu :items="localeItems" :menu-label="t('app.language')" @select="onLocale">
                    <template #button>
                        <span class="nav-chip nav-chip--tool" :title="t('app.language')"><TaoIcon name="language" /></span>
                    </template>
                </TaoDropdownMenu>
                <TaoThemeToggle :to-light-label="t('app.toLight')" :to-dark-label="t('app.toDark')" />
            </header>

            <TaoAlert v-if="state.offline" class="app__alert" tone="danger">
                {{ t('app.offline') }}
                <TaoButton variant="text" tone="neutral" @click="start()">{{ t('app.retry') }}</TaoButton>
            </TaoAlert>

            <main class="app__main">
                <TaoLoader v-if="!state.ready" class="app__center" />
                <TaoEmpty v-else-if="!state.project" class="app__center" :title="t('project.none')">
                    {{ t('project.noneText') }}
                    <template #action>
                        <TaoButton icon="tao-plus" @click="creating = true">{{ t('project.create') }}</TaoButton>
                    </template>
                </TaoEmpty>
                <div v-else-if="state.view === 'journal'" class="app__scroll"><JournalPane /></div>
                <BoardPane v-else-if="state.view === 'board'" />
                <TimelinePane v-else-if="state.view === 'timeline'" />
                <MapPane v-else-if="state.view === 'map'" />
                <BrainPane v-else-if="state.view === 'brainstorm'" />

                <TaoSplit v-else v-model="split" class="app__split" :min="22" :max="70">
                    <template #start><TreePane /></template>
                    <template #end>
                        <div class="app__scroll"><RecordPane /></div>
                    </template>
                </TaoSplit>
            </main>

            <StatusBar />
        </div>

        <NewProjectDialog v-model="creating" />
    </TaoNav>
</template>

<style scoped>
.app__nav {
    height: 100dvh;
}

/* the page beside the navigation fills the rest and scrolls inside its panes, not as a document / страница рядом с навигацией занимает остаток и прокручивается внутри своих панелей, а не как документ */
.app__nav :deep(.tao-nav__shell) {
    height: 100dvh;
}

.app__nav :deep(.tao-nav__content) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/*
 * On the side the column of the navigation runs the full height and its footer (language, theme, fold) sits at the bottom. In the bar
 * look `--_panel-height` is `none`, the calc is invalid and the height stays automatic.
 * Сбоку колонка навигации во всю высоту, а её подвал (язык, тема, свернуть) внизу. В виде панели снизу `--_panel-height`
 * равен `none`, calc недействителен и высота остаётся автоматической.
 */
.app__nav :deep(.tao-nav__column) {
    height: calc(var(--_panel-height) - 2 * var(--_pad));
}

/* the action and the project one under the other / действие и проект один под другим */
.app__nav :deep(.tao-nav__action) {
    flex-direction: column;
    align-items: center;
    gap: var(--tao-space-2);
}

.app__nav :deep(.tao-nav__list) {
    flex: 0 1 auto;
}

.app__nav :deep(.tao-nav__footer) {
    margin-top: auto;
}

.app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

/*
 * `--_compact` is TaoNav's own variable: 1 on the rail, 0 on the side panel. The chips use it to show only their icon on the rail
 * (a text and a chevron shrink to nothing) and the whole chip with the text on the side panel.
 * `--_compact` это собственная переменная TaoNav: 1 на рейке, 0 в боковой панели. Фишки берут её, чтобы на рейке показывать
 * только иконку (текст и стрелка сжимаются в ничто), а в боковой панели фишку целиком с текстом.
 */
.nav-chip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc((1 - var(--_compact, 0)) * var(--tao-space-2));
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: var(--tao-control-height);
    padding: 0 calc((1 - var(--_compact, 0)) * var(--tao-space-3));
    /* on the rail the chip is a plain round icon: no frame (its arcs were cut by the round box), a faint fill instead / на рейке фишка это простая круглая иконка: без рамки (её дуги обрезались круглой коробкой), вместо неё слабая заливка */
    border: calc((1 - var(--_compact, 0)) * 1px) solid var(--tao-color-border-strong);
    border-radius: inherit;
    background: color-mix(in srgb, var(--tao-color-text) calc(var(--_compact, 0) * 8%), transparent);
    color: var(--tao-color-text);
    font-size: var(--tao-control-font-size);
}

.nav-chip--tool {
    border-color: transparent;
    background: none;
    color: var(--tao-color-text-muted);
}

.nav-chip__text {
    flex: 1;
    min-width: 0;
    max-width: calc((1 - var(--_compact, 0)) * 600px);
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nav-chip__more {
    flex: none;
    max-width: calc((1 - var(--_compact, 0)) * 24px);
    overflow: hidden;
    color: var(--tao-color-text-muted);
}

.nav-project.nav-project {
    /* TaoNav gives every child of the action the side padding of a button: the project is a chip with its own inside / TaoNav даёт каждому ребёнку действия боковой отступ кнопки: у проекта фишка со своим отступом внутри */
    padding-inline: 0;
    /* TaoNav squares its action children on the rail by their height (aspect-ratio): the project needs one, as the button has / TaoNav делает детей действия на рейке квадратными по высоте: проекту она нужна, как и кнопке */
    height: var(--tao-control-height);
}

.nav-project :deep(.tao-dropdown-menu__button) {
    border-radius: inherit;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    background: none;
}

.nav-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--tao-space-1);
}

/* on the rail each tool takes a whole row (a column of icons), on the side panel they stand side by side / на рейке каждый инструмент занимает целую строку (столбец иконок), в боковой панели они стоят рядом */
.nav-foot > * {
    display: flex;
    justify-content: center;
    min-width: calc(var(--_compact, 0) * 100%);
}

.nav-foot :deep(.tao-dropdown-menu__button) {
    padding: 0;
    background: none;
}

.app__bar {
    /* the header is not the rail: the chips show their text (the variable is inherited from the shell of the navigation) / шапка не рейка: фишки показывают текст (переменная наследуется от оболочки навигации) */
    --_compact: 0;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    padding: var(--tao-space-2) var(--tao-space-3);
    border-bottom: 1px solid var(--tao-color-border);
    background: var(--tao-color-surface);
}

.app__bar .nav-chip {
    width: auto;
    max-width: 200px;
}

.app__space {
    flex: 1;
}

.app__alert {
    /* TaoAlert is 100% wide: with side margins that is wider than the window; auto lets the column stretch it inside the margins / TaoAlert шириной 100%: с боковыми отступами это шире окна; auto даёт колонке растянуть его внутри отступов */
    width: auto;
    margin: var(--tao-space-2) var(--tao-space-3) 0;
}

.app__main {
    flex: 1;
    min-height: 0;
    display: flex;
}

.app__center {
    margin: auto;
}

.app__split {
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.app__scroll {
    flex: 1;
    height: 100%;
    min-width: 0;
    overflow: auto;
}
</style>
