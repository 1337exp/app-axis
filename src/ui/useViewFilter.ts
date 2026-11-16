/**
 * The filter of a working view (types and branch), kept per project and per view: the part of the board and the timeline
 * that is the same. The window of the view draws it with `FilterBar` and feeds `filter` / `rootId` to its grouping.
 *
 * Фильтр рабочего вида (типы и ветка), по проектам и по видам: та часть доски и ленты, что у них одинакова.
 * Окно вида рисует его через `FilterBar` и отдаёт `filter` / `rootId` своей группировке.
 */
import { computed, reactive, watch } from 'vue';
import { defaultFilter, readFilter, writeFilter } from '@/app/viewFilter';
import type { ViewScope } from '@/app/viewFilter';
import { state, tree } from '@/app/state';
import { FILTER_TYPES } from '@/core/filter';
import type { RecordType } from '@/core/model';
import { flatten } from '@/core/tree';
import { useI18n } from '@/i18n';

/** Not an id: ids never start with it. It stands for "the whole project" in the select. / Не id: id так не начинаются. Означает «весь проект» в списке. */
const WHOLE = '*';

export function useViewFilter(scope: ViewScope) {
    const { t } = useI18n();

    const filter = reactive(defaultFilter());
    watch(
        () => state.projectId,
        (id) => Object.assign(filter, readFilter(scope, id)),
        { immediate: true },
    );
    watch(filter, () => writeFilter(scope, state.projectId, filter), { deep: true });

    /** Areas in the order of the tree, indented by depth. / Разделы в порядке дерева, с отступом по глубине. */
    const areaOptions = computed(() => [
        { value: WHOLE, label: t('filter.wholeProject') },
        ...flatten(tree.value)
            .filter((node) => node.record.type === 'area')
            .map((node) => ({ value: node.record.id, label: `${'   '.repeat(node.depth)}${node.record.title}` })),
    ]);

    /** The value of the branch select. A branch that is gone (deleted, or saved in another session) counts as the whole project. / Значение списка веток. Удалённая ветка считается всем проектом. */
    const root = computed({
        get: () => (filter.root && state.records.some((r) => r.id === filter.root && r.type === 'area') ? filter.root : WHOLE),
        set: (value: string | number | null) => (filter.root = typeof value === 'string' && value !== WHOLE ? value : null),
    });

    /** The branch for the grouping: an id, or null for the whole project. / Ветка для группировки: id или null для всего проекта. */
    const rootId = computed(() => (root.value === WHOLE ? null : root.value));

    const typeOn = (type: RecordType): boolean => filter.types.includes(type);
    function setType(type: RecordType, on: boolean): void {
        filter.types = FILTER_TYPES.filter((candidate) => (candidate === type ? on : typeOn(candidate)));
    }

    return { filter, root, rootId, areaOptions, typeOn, setType };
}
