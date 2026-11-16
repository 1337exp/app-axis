<script setup lang="ts">
/**
 * The tree of the project and the quick input under it. A row shows what the record is, how far it is
 * and who touched it last; the field below turns a line into a record without leaving the keyboard.
 *
 * Дерево проекта и быстрый ввод под ним. Строка показывает, что это за запись, насколько она продвинулась
 * и кто трогал её последним; поле внизу превращает строку в запись, не отрывая рук от клавиатуры.
 */
import { TaoButton, TaoDropdownMenu, TaoEmpty, TaoIcon, TaoInput, TaoSelect, TaoTree, confirm, toast } from '@1337exp/taoui';
import type { TaoMenuItem, TaoTreeNode } from '@1337exp/taoui';
import { computed, nextTick, ref, watch } from 'vue';
import { addRecord, countInside, moveStep, outdent, patchRecord, recordById, removeRecord, select, state, tree } from '@/app/state';
import { RECORD_TYPES } from '@/core/model';
import type { AxisRecord, RecordType } from '@/core/model';
import { parseQuick } from '@/core/quick';
import { percent, progressOf } from '@/core/tree';
import type { TreeNode } from '@/core/tree';
import { current, useI18n } from '@/i18n';
import { formatShort, today } from './format';
import { nextStatus, recordIcon, toneClass } from './marks';

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

const toTao = (nodes: readonly TreeNode[]): TaoTreeNode[] =>
    nodes.map((node) => ({ id: node.record.id, label: node.record.title, ...(node.children.length > 0 ? { children: toTao(node.children) } : {}) }));
const nodes = computed(() => toTao(tree.value));

// every branch starts open; after that the user decides, and a branch that gets a child opens
const expanded = ref<string[]>([]);
watch(
    () => state.projectId,
    () => (expanded.value = [...nodeById.value.values()].filter((n) => n.children.length > 0).map((n) => n.record.id)),
    { immediate: true },
);
const open = (id: string): void => {
    if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
};

const selected = computed({
    get: () => state.selected,
    set: (id: string | string[] | null) => select(typeof id === 'string' ? id : null),
});

function row(id: string): { record: AxisRecord; done: number; total: number; share: number } | null {
    const node = nodeById.value.get(id);
    if (!node) return null;
    const p = node.children.length > 0 ? progressOf(node) : { done: 0, total: 0 };
    return { record: node.record, done: p.done, total: p.total, share: percent({ ...p, active: 0, questions: 0 }) };
}

const overdue = (record: AxisRecord): boolean => record.due !== null && record.due < today() && record.status !== 'done' && record.status !== 'dropped';

async function run(work: () => Promise<unknown>): Promise<void> {
    try {
        await work();
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    }
}

const toggle = (record: AxisRecord): Promise<void> => run(() => patchRecord(record.id, { status: nextStatus(record.status) }));

function menuOf(record: AxisRecord): TaoMenuItem[] {
    return [
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
    if (action === 'add') {
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

// ───────────────────────────── quick input / быстрый ввод ─────────────────────────────

const line = ref('');
const type = ref<RecordType>('task');
const typeOptions = computed(() => RECORD_TYPES.map((value) => ({ value, label: t(`type.${value}`) })));
const quick = ref<HTMLElement | null>(null);
const focusQuick = (): void => quick.value?.querySelector('input')?.focus();

/** "Add inside" pins the parent until the selection moves elsewhere. / «Добавить внутрь» закрепляет родителя, пока выбор не уйдёт. */
const target = ref<string | null>(null);
watch(
    () => state.selected,
    () => (target.value = null),
);

/**
 * Where a new record goes: into the pinned record, into the selected area, beside the selected record, or to the top.
 * Куда встанет новая запись: в закреплённую, в выбранный раздел, рядом с выбранной записью или наверх.
 */
const place = computed<{ parent: string | null; after?: string }>(() => {
    const pinned = target.value ? recordById(target.value) : undefined;
    if (pinned) return { parent: pinned.id };
    const at = state.selected ? recordById(state.selected) : undefined;
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
        <div class="tree-pane__scroll">
            <TaoEmpty v-if="nodes.length === 0" :title="t('tree.empty')">{{ t('tree.emptyText') }}</TaoEmpty>
            <TaoTree v-else v-model:expanded="expanded" v-model:selected="selected" :nodes="nodes" :aria-label="t('tree.label')">
                <template #icon="{ node }">
                    <template v-for="r in [row(node.id)]" :key="node.id">
                        <button
                            v-if="r && r.record.type === 'task'"
                            type="button"
                            class="mark mark--button"
                            :class="toneClass(r.record)"
                            :title="`${t('tree.toggle')}: ${t(`status.task.${r.record.status}`)}`"
                            tabindex="-1"
                            @click.stop="toggle(r.record)"
                        >
                            <TaoIcon :name="recordIcon(r.record)" />
                        </button>
                        <span v-else-if="r" class="mark" :class="toneClass(r.record)"><TaoIcon :name="recordIcon(r.record)" /></span>
                    </template>
                </template>
                <template #label="{ node }">
                    <template v-for="r in [row(node.id)]" :key="node.id">
                        <span v-if="r" class="row" :class="{ 'row--closed': r.record.status === 'done' || r.record.status === 'dropped', 'row--dropped': r.record.status === 'dropped', 'row--area': r.record.type === 'area' }">
                            <span class="row__title">{{ r.record.title }}</span>
                            <TaoIcon v-if="r.record.body" class="row__mark" name="mark-text" :title="t('tree.hasText')" />
                            <TaoIcon v-if="r.record.images.length > 0" class="row__mark" name="image" />
                            <span v-if="r.record.updatedBy === 'claude'" class="row__claude" :title="t('tree.byClaude')">C</span>
                            <span v-if="r.record.due" class="row__due" :class="{ 'row__due--late': overdue(r.record) }">{{ formatShort(r.record.due, current) }}</span>
                            <span v-if="r.total > 0" class="row__progress" :title="t('project.tasks', [r.done, r.total])">
                                <span class="row__bar"><span class="row__fill" :style="{ width: `${r.share}%` }"></span></span>
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
                        size="small"
                        dots="horizontal"
                        :tabbable="false"
                        @select="(id: string) => act(id, recordById(node.id)!)"
                    />
                </template>
            </TaoTree>
        </div>

        <form ref="quick" class="quick" @submit.prevent="add">
            <div class="quick__row">
                <TaoSelect v-model="type" class="quick__type" :options="typeOptions" :clearable="false" :aria-label="t('quick.type')" />
                <TaoInput v-model="line" class="quick__input" :placeholder="t('quick.placeholder')" :aria-label="t('quick.placeholder')" autocomplete="off" />
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

.tree-pane__scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--tao-space-2);
}

.mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--tao-color-text-muted);
    font-size: 16px;
}

.mark--button {
    cursor: pointer;
    border-radius: var(--tao-radius-full);
}

.mark--button:hover {
    color: var(--tao-color-text-strong);
}

.mark--active {
    color: var(--tao-color-info);
}

.mark--done {
    color: var(--tao-color-success);
}

.mark--dropped {
    color: var(--tao-color-text-disabled);
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

.row__claude {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: var(--tao-radius-full);
    background: var(--tao-color-info-subtle);
    color: var(--tao-color-info-text);
    font-size: 10px;
    font-weight: 700;
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

.row__fill {
    display: block;
    height: 100%;
    background: var(--tao-color-success);
}

.quick {
    flex: none;
    padding: var(--tao-space-3);
    border-top: 1px solid var(--tao-color-border);
    background: var(--tao-color-surface);
}

.quick__row {
    display: flex;
    gap: var(--tao-space-2);
}

.quick__type {
    flex: none;
    width: 132px;
}

.quick__input {
    flex: 1;
    min-width: 0;
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
