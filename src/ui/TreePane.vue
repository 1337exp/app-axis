<script setup lang="ts">
/**
 * The tree of the project and the quick input under it. A row shows what the record is, how far it is
 * and who touched it last; the field below turns a line into a record without leaving the keyboard.
 *
 * Дерево проекта и быстрый ввод под ним. Строка показывает, что это за запись, насколько она продвинулась
 * и кто трогал её последним; поле внизу превращает строку в запись, не отрывая рук от клавиатуры.
 */
import { TaoButton, TaoDropdownMenu, TaoEmpty, TaoIcon, TaoInput, TaoKbd, TaoTree, confirm, toast } from '@1337exp/taoui';
import type { TaoMenuItem, TaoTreeMove, TaoTreeNode } from '@1337exp/taoui';
import { computed, nextTick, ref, watch } from 'vue';
import { isFound, kept, query } from '@/app/search';
import { ui } from '@/app/ui';
import { readIds, writeIds } from '@/app/viewFilter';
import { addRecord, countInside, hasDraft, moveStep, outdent, patchRecord, recordById, removeRecord, select, state, tree } from '@/app/state';
import type { AxisRecord, RecordType } from '@/core/model';
import { parseQuick } from '@/core/quick';
import { markRanges } from '@/core/search';
import { progressOf, shares } from '@/core/tree';
import type { TreeNode } from '@/core/tree';
import { current, useI18n } from '@/i18n';
import ClaudeMark from './ClaudeMark.vue';
import { formatShort } from './format';
import { isOverdue } from './marks';
import SearchEmpty from './SearchEmpty.vue';
import SearchField from './SearchField.vue';
import StatusMark from './StatusMark.vue';
import TypeSelect from './TypeSelect.vue';

const { t } = useI18n();

// ───────────────────────────── the tree / дерево ─────────────────────────────

const nodeById = computed(() => {
    const map = new Map<string, TreeNode>();
    const walk = (nodes: readonly TreeNode[]): void => {
        for (const node of nodes) {
            map.set(node.record.id, node);
            walk(node.children);
        }
    };
    walk(tree.value);
    return map;
});

/** With a quick search typed only the found records and their ancestors stay. / При наборе быстрого поиска остаются только найденные записи и их предки. */
const toTao = (nodes: readonly TreeNode[]): TaoTreeNode[] =>
    nodes
        .filter((node) => !kept.value || kept.value.has(node.record.id))
        .map((node) => {
            const children = toTao(node.children);
            return { id: node.record.id, label: node.record.title, ...(children.length > 0 ? { children } : {}) };
        });
const nodes = computed(() => toTao(tree.value));

/**
 * While a search is typed every branch that is left is open; the person's own open and closed branches are not touched and come
 * back when the line is cleared.
 * Пока набран поиск, каждая оставшаяся ветка раскрыта; собственные открытые и закрытые ветки человека не трогаются и
 * возвращаются, когда строка очищена.
 */
const shownExpanded = computed({
    get: () => {
        if (!kept.value) return expanded.value;
        const ids: string[] = [];
        const walk = (list: readonly TaoTreeNode[]): void => {
            for (const n of list) {
                if (n.children?.length) ids.push(n.id);
                walk(n.children ?? []);
            }
        };
        walk(nodes.value);
        return ids;
    },
    set: (value: string[]) => {
        if (!kept.value) expanded.value = value;
    },
});

/** A title cut into plain and found pieces for the highlight. / Заголовок, разрезанный на обычные и найденные куски для подсветки. */
function pieces(title: string): { text: string; hit: boolean }[] {
    const ranges = kept.value ? markRanges(title, query.value.words) : [];
    if (ranges.length === 0) return [{ text: title, hit: false }];
    const out: { text: string; hit: boolean }[] = [];
    let at = 0;
    for (const [from, to] of ranges) {
        if (from > at) out.push({ text: title.slice(at, from), hit: false });
        out.push({ text: title.slice(from, to), hit: true });
        at = to;
    }
    if (at < title.length) out.push({ text: title.slice(at), hit: false });
    return out;
}

// every branch starts open; after that the user decides, and a branch that gets a child opens.
// What the person closed is kept per project (`localStorage`): a branch that is new is not in the list, so it starts open.
// Каждая ветка начинает открытой; дальше решает человек, а ветка, получившая ребёнка, открывается.
// Закрытое человеком помнится по проектам (`localStorage`): новой ветки в списке нет, поэтому она начинает открытой.
const expanded = ref<string[]>([]);
const branchIds = (): string[] => [...nodeById.value.values()].filter((n) => n.children.length > 0).map((n) => n.record.id);
watch(
    () => state.projectId,
    (id) => {
        const closed = new Set(readIds('tree.closed', id));
        expanded.value = branchIds().filter((branch) => !closed.has(branch));
    },
    { immediate: true },
);
watch(expanded, (open) => {
    if (!state.projectId || nodeById.value.size === 0) return;
    const now = new Set(open);
    writeIds('tree.closed', state.projectId, branchIds().filter((branch) => !now.has(branch)));
});
const open = (id: string): void => {
    if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
};

/**
 * In Axis the selected row is the open record, so a right click must not select: the tree selects the row it opens its menu on
 * (as file managers do), and `menu` comes in the same tick right before that `update:selected`. The menu acts on its own row.
 * В Axis выбранная строка это открытая запись, поэтому правый клик не должен выбирать: дерево выбирает строку, на которой
 * открывает меню (как файловые менеджеры), а `menu` приходит в том же такте прямо перед этим `update:selected`. Меню действует на свою строку.
 */
let menuAsked = false;
function onMenuAsked(): void {
    menuAsked = true;
    queueMicrotask(() => (menuAsked = false));
}

/**
 * A single click only picks a row (the highlight, where the quick input puts a new record); the record opens on a double click
 * or Enter, as a file opens in a file manager, so a stray click does not swap the open record. What is open is `state.selected`;
 * when it changes from elsewhere (a new record, the hash, another view) the pick follows it.
 * Одинарный клик только выбирает строку (подсветка, куда быстрый ввод ставит новую запись); запись открывается двойным кликом
 * или Enter, как файл в файловом менеджере, и случайный клик не подменяет открытую запись. Открытая это `state.selected`;
 * когда она меняется не отсюда (новая запись, адрес, другой вид), выбор идёт за ней.
 */
const picked = ref<string | null>(state.selected);
watch(
    () => state.selected,
    (id) => (picked.value = id),
);

const selected = computed({
    get: () => (picked.value && recordById(picked.value) ? picked.value : null),
    set: (id: string | string[] | null) => {
        if (menuAsked) return;
        picked.value = typeof id === 'string' ? id : null;
    },
});

/** Opens the record of a row in the pane. / Открывает запись строки в панели. */
const openRecord = (id: string): void => select(id);
/** A double click on a branch only folds or unfolds it in the tree; the record opens too (the row was picked by the first click). / Двойной клик по ветке дерево лишь сворачивает или разворачивает; запись открывается тоже (строку выбрал первый клик). */
const openPicked = (): void => {
    if (picked.value) openRecord(picked.value);
};

function row(id: string): { record: AxisRecord; done: number; total: number; share: number; active: number } | null {
    const node = nodeById.value.get(id);
    if (!node) return null;
    const p = node.children.length > 0 ? progressOf(node) : { done: 0, total: 0 };
    const part = shares({ ...p, active: 'active' in p ? p.active : 0, questions: 0 });
    return { record: node.record, done: p.done, total: p.total, share: part.done, active: part.active };
}

async function run(work: () => Promise<unknown>): Promise<void> {
    try {
        await work();
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    }
}

/** The items of a row: the «⋯» button and the right click of the tree show the same list. / Пункты строки: кнопка «⋯» и правый клик по дереву показывают один список. */
function menuOf(record: AxisRecord | undefined): TaoMenuItem[] {
    if (!record) return [];
    return [
        { id: 'open', label: t('tree.open'), icon: 'mark-text' },
        { id: 'add', label: t('tree.addChild'), icon: 'tao-plus' },
        { type: 'separator' },
        { id: 'up', label: t('tree.moveUp'), icon: 'tao-arrow-up' },
        { id: 'down', label: t('tree.moveDown'), icon: 'tao-arrow-down' },
        { id: 'outdent', label: t('tree.outdent'), icon: 'tao-chevron-left', disabled: record.parent === null },
        { type: 'separator' },
        { id: 'remove', label: t('tree.remove'), icon: 'tao-trash' },
    ];
}

async function act(action: string, record: AxisRecord): Promise<void> {
    if (action === 'open') openRecord(record.id);
    else if (action === 'add') {
        target.value = record.id;
        open(record.id);
        await nextTick();
        focusQuick();
    } else if (action === 'up') await run(() => moveStep(record.id, -1));
    else if (action === 'down') await run(() => moveStep(record.id, 1));
    else if (action === 'outdent') await run(() => outdent(record.id));
    else if (action === 'remove') {
        const inside = countInside(record.id);
        const ok = await confirm()
            .title(t('record.removeTitle', [record.title]))
            .message(inside > 0 ? t('record.removeBranch', [inside]) : t('record.removeText'))
            .danger();
        if (ok) await run(() => removeRecord(record.id));
    }
}

/**
 * A drag (or Ctrl+X / Ctrl+V) of the tree: the rows go under `parentId` at `index` among the children left once the moved
 * ones are taken out. The server wants "after this sibling" (null: first), so the sibling before `index` is found in the
 * order the tree shows. A failure rejects, and the tree puts the rows back and says `move-error`. Copies are refused by `can-drop`;
 * while a search is typed nothing moves (`movable`), the filtered list has other indexes.
 * Перенос в дереве (мышью или Ctrl+X / Ctrl+V): строки встают под `parentId` на место `index` среди оставшихся детей.
 * Серверу нужно «после этого соседа» (null: первым), поэтому сосед перед `index` берётся в порядке, который показывает дерево.
 * Ошибка отклоняет обещание, дерево возвращает строки и говорит `move-error`. Копии отклоняет `can-drop`; пока набран поиск,
 * ничего не переносится (`movable`): у отфильтрованного списка другие индексы.
 */
async function onMove(move: TaoTreeMove): Promise<void> {
    const siblings = (move.parentId ? (nodeById.value.get(move.parentId)?.children ?? []) : tree.value).map((n) => n.record.id).filter((id) => !move.ids.includes(id));
    let after: string | null = siblings[move.index - 1] ?? null;
    for (const id of move.ids) {
        await patchRecord(id, { parent: move.parentId, after });
        after = id;
    }
    if (move.parentId) open(move.parentId);
}

// ───────────────────────────── quick input / быстрый ввод ─────────────────────────────

const line = ref('');
const type = ref<RecordType>('task');
const quick = ref<HTMLElement | null>(null);
const focusQuick = (): void => quick.value?.querySelector('input')?.focus();
// "New record" in the navigation: the focus goes to the quick input / «Запись» в навигации: фокус уходит в быстрый ввод
watch(
    () => ui.quick,
    () => void nextTick(focusQuick),
);

/** "Add inside" pins the parent until the selection moves elsewhere. / «Добавить внутрь» закрепляет родителя, пока выбор не уйдёт. */
const target = ref<string | null>(null);
watch(picked, () => (target.value = null));

/**
 * Where a new record goes: into the pinned record, into the selected area, beside the selected record, or to the top.
 * Куда встанет новая запись: в закреплённую, в выбранный раздел, рядом с выбранной записью или наверх.
 */
const place = computed<{ parent: string | null; after?: string }>(() => {
    const pinned = target.value ? recordById(target.value) : undefined;
    if (pinned) return { parent: pinned.id };
    const at = picked.value ? recordById(picked.value) : undefined;
    if (!at) return { parent: null };
    return at.type === 'area' ? { parent: at.id } : { parent: at.parent, after: at.id };
});
const placeText = computed(() => {
    const parent = place.value.parent ? recordById(place.value.parent) : undefined;
    return parent ? t('quick.into', [parent.title]) : t('quick.top');
});
const parsed = computed(() => parseQuick(line.value, type.value));

async function add(): Promise<void> {
    const input = parsed.value;
    if (!input) return;
    const { parent, after } = place.value;
    await run(async () => {
        const record = await addRecord({ type: input.type, title: input.title, parent, ...(after ? { after } : {}) });
        line.value = '';
        if (parent) open(parent);
        // the next line goes after the one just added: a list is typed top to bottom
        if (target.value === null && record.type !== 'area') select(record.id);
        else if (record.type === 'area') select(record.id);
        await nextTick();
        focusQuick();
    });
}
</script>

<template>
    <section class="tree-pane">
        <div class="tree-pane__search"><SearchField wide /></div>
        <div class="tree-pane__scroll">
            <SearchEmpty v-if="nodes.length === 0 && kept" />
            <TaoEmpty v-else-if="nodes.length === 0" :title="t('tree.empty')">{{ t('tree.emptyText') }}</TaoEmpty>
            <TaoTree
                v-else
                v-model:expanded="shownExpanded"
                v-model:selected="selected"
                :nodes="nodes"
                :aria-label="t('tree.label')"
                :menu="(node: TaoTreeNode) => menuOf(recordById(node.id))"
                :menu-label="t('tree.actions')"
                :movable="!kept"
                :can-drop="(move: TaoTreeMove) => !move.copy"
                @open="(node: TaoTreeNode) => openRecord(node.id)"
                @dblclick="openPicked"
                @move="onMove"
                @move-error="(_: TaoTreeMove, error: unknown) => toast().danger().message(`${t('tree.moveFailed')}: ${error instanceof Error ? error.message : String(error)}`)"
                @menu="onMenuAsked"
                @menu-select="(id: string, node: TaoTreeNode) => act(id, recordById(node.id)!)"
            >
                <template #icon="{ node }">
                    <template v-for="r in [row(node.id)]" :key="node.id">
                        <StatusMark v-if="r" :record="r.record" :tabbable="false" />
                    </template>
                </template>
                <template #label="{ node }">
                    <template v-for="r in [row(node.id)]" :key="node.id">
                        <span v-if="r" class="row" :class="{ 'row--closed': r.record.status === 'done' || r.record.status === 'dropped', 'row--dropped': r.record.status === 'dropped', 'row--area': r.record.type === 'area', 'row--dim': kept !== null && !isFound(r.record.id) }">
                            <span class="row__title"><template v-for="(piece, i) in pieces(r.record.title)" :key="i"><mark v-if="piece.hit" class="row__hit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template></span>
                            <TaoIcon v-if="r.record.body" class="row__mark" name="mark-text" :title="t('tree.hasText')" />
                            <TaoIcon v-if="hasDraft(r.record.id)" class="row__mark row__draft" name="tao-edit" :title="t('tree.hasDraft')" />
                            <TaoIcon v-if="r.record.images.length > 0" class="row__mark" name="image" />
                            <ClaudeMark v-if="r.record.updatedBy === 'claude'" />
                            <span v-if="r.record.due" class="row__due" :class="{ 'row__due--late': isOverdue(r.record) }">{{ formatShort(r.record.due, current) }}</span>
                            <span v-if="r.total > 0" class="row__progress" :title="t('project.tasks', [r.done, r.total])">
                                <span class="row__bar"><span class="row__fill" :style="{ width: `${r.share}%` }"></span><span class="row__work" :style="{ width: `${r.active}%` }"></span></span>
                                {{ r.done }}/{{ r.total }}
                            </span>
                        </span>
                    </template>
                </template>
                <template #actions="{ node }">
                    <TaoDropdownMenu
                        v-if="recordById(node.id)"
                        :items="menuOf(recordById(node.id)!)"
                        :menu-label="t('tree.actions')"
                        dots="horizontal"
                        :tabbable="false"
                        @select="(id: string) => act(id, recordById(node.id)!)"
                    />
                </template>
            </TaoTree>
        </div>

        <form ref="quick" class="quick" @submit.prevent="add">
            <div class="quick__row">
                <TypeSelect v-model="type" class="quick__type" :aria-label="t('quick.type')" />
                <TaoInput v-model="line" class="quick__input" :placeholder="t('quick.placeholder')" :aria-label="t('quick.placeholder')" autocomplete="off">
                    <template #suffix><TaoKbd class="quick__key" aria-hidden="true">Enter</TaoKbd></template>
                </TaoInput>
                <TaoButton type="submit" icon="tao-plus" :aria-label="t('quick.add')" :disabled="!parsed" />
            </div>
            <p class="quick__hint">
                <template v-if="parsed">
                    <strong>{{ t(`type.${parsed.type}`) }}</strong> {{ placeText }}
                </template>
                <template v-else>{{ t('quick.hint') }}</template>
            </p>
        </form>
    </section>
</template>

<style scoped>
.tree-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.tree-pane__search {
    flex: none;
    padding: var(--tao-space-2) var(--tao-space-2) 0;
}

.tree-pane__scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--tao-space-2);
}

.row {
    display: flex;
    align-items: center;
    gap: var(--tao-space-2);
    min-width: 0;
}

.row__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.row--dim {
    opacity: 0.5;
}

/* the found part of a title: a quiet background, no loud yellow / найденная часть заголовка: тихий фон, без кричащей жёлтой заливки */
.row__hit {
    border-radius: 2px;
    background: color-mix(in srgb, var(--tao-color-text) 18%, transparent);
    color: inherit;
}

.row--area .row__title {
    font-weight: 600;
    color: var(--tao-color-text-strong);
}

.row--closed .row__title {
    color: var(--tao-color-text-muted);
}

.row--dropped .row__title {
    text-decoration: line-through;
}

.row__mark {
    flex: none;
    color: var(--tao-color-text-muted);
    font-size: 13px;
}

/* an unsaved draft of the text: a pencil in the plain text colour, a little brighter than the grey marks (blue is for "in work") / набросок текста: карандаш цветом обычного текста, чуть ярче серых пометок (синий это «в работе») */
.row__draft {
    color: var(--tao-color-text);
}

.row__due,
.row__progress {
    flex: none;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
    font-variant-numeric: tabular-nums;
}

.row__due--late {
    color: var(--tao-color-danger-text);
}

.row__progress {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}

.row__bar {
    width: 36px;
    height: 4px;
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-surface-sunken);
    overflow: hidden;
}

.row__bar {
    display: flex;
}

.row__fill,
.row__work {
    display: block;
    flex: none;
    height: 100%;
}

.row__fill {
    background: var(--axis-status-done);
}

.row__work {
    background: var(--axis-status-active);
}

.quick {
    /* the layout answers to the width of the pane, not of the window / раскладка отвечает ширине панели, а не окна */
    container-type: inline-size;
    flex: none;
    padding: var(--tao-space-3);
    border-top: 1px solid var(--tao-color-border);
    background: var(--tao-color-surface);
}

.quick__row {
    display: flex;
    flex-wrap: wrap; /* on a very narrow pane the button drops under the field instead of squeezing it / на совсем узкой панели кнопка уходит под поле, а не сжимает его */
    gap: var(--tao-space-2);
}

.quick__type {
    flex: none;
    width: 148px;
}

.quick__input {
    flex: 1 1 0;
    min-width: 0;
}

/* a narrow pane: the type select goes on top, the field and the button share the row below / узкая панель: выбор типа сверху, поле и кнопка делят строку под ним */
@container (max-width: 400px) {
    .quick__type {
        flex: 1 0 100%;
        width: auto;
    }
}

.quick__hint {
    margin: var(--tao-space-2) 0 0;
    color: var(--tao-color-text-muted);
    font-size: var(--tao-font-size-xs);
}

.quick__hint strong {
    color: var(--tao-color-text);
    font-weight: 600;
}
</style>
