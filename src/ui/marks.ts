/**
 * How a record looks in a row: its icon and the tone of the icon, by type and status.
 * Как запись выглядит в строке: иконка и её тон, по типу и статусу.
 */
import { hasStatus } from '@/core/model';
import type { AxisRecord, RecordType, Status } from '@/core/model';

const TYPE_ICON: Record<RecordType, string> = {
    area: 'tao-folder',
    task: 'tao-circle',
    idea: 'type-idea',
    decision: 'type-decision',
    question: 'type-question',
    note: 'type-note',
};

const TASK_ICON: Record<Status, string> = {
    open: 'tao-circle',
    active: 'status-active',
    done: 'tao-check-circle',
    dropped: 'tao-x-circle',
};

export const typeIcon = (type: RecordType): string => TYPE_ICON[type];

export const recordIcon = (record: Pick<AxisRecord, 'type' | 'status'>): string => (record.type === 'task' ? TASK_ICON[record.status] : TYPE_ICON[record.type]);

/** A class for the tone of the mark: the status in colour, always beside the words of the status. */
export function toneClass(record: Pick<AxisRecord, 'type' | 'status'>): string {
    if (!hasStatus(record.type)) return 'mark--plain';
    return `mark--${record.status}`;
}

/** The next status on a click on the mark of a task. / Следующий статус по клику на отметку задачи. */
export const nextStatus = (status: Status): Status => (status === 'open' ? 'active' : status === 'active' ? 'done' : 'open');
