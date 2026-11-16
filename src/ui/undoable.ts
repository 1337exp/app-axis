/**
 * One-click changes with a way back: a status moved by a click or a drag, a due date set or cleared from a row.
 * The row may vanish or jump away after such a change, so a toast says what happened and offers "Undo".
 * The undo is an ordinary `patchRecord` (the journal gets its line too). One toast id: a second change replaces the
 * toast instead of stacking a pile. The segmented status control inside the record pane does not use this: the
 * control stays in front of the user.
 *
 * Правки одним щелчком, у которых есть путь назад: статус по клику или перетаскиванию, срок с кнопки строки.
 * После такой правки строка может исчезнуть или уехать, поэтому тост говорит, что случилось, и даёт «Отменить».
 * Отмена это обычный `patchRecord` (в журнале тоже появляется строка). Один id тоста: следующая правка заменяет
 * тост, а не копит стопку. Сегментный переключатель статуса в панели записи этим не пользуется: он и так перед глазами.
 */
import { toast } from '@1337exp/taoui';
import { patchRecord } from '@/app/state';
import type { AxisRecord, RecordLink, Status } from '@/core/model';
import { current, translate } from '@/i18n';
import { formatShort } from './format';
import { statusKeyOf } from './marks';

export { offer as offerUndo };

const TOAST_ID = 'axis-undo';
const TOAST_MS = 6000;

type Subject = Pick<AxisRecord, 'id' | 'title' | 'type'>;

function fail(error: unknown): void {
    toast().danger().message(error instanceof Error ? error.message : String(error));
}

function offer(message: string, back: () => Promise<unknown>): void {
    toast()
        .info()
        .id(TOAST_ID)
        .replace()
        .timeout(TOAST_MS)
        .message(message)
        .action(translate(current.value, 'undo.action'), () => void back().catch(fail));
}

/**
 * Sets the status and offers to put the previous one back. / Ставит статус и предлагает вернуть прежний.
 */
export async function changeStatus(record: Subject & Pick<AxisRecord, 'status'>, status: Status): Promise<void> {
    if (record.status === status) return;
    const before = record.status;
    try {
        await patchRecord(record.id, { status });
    } catch (error) {
        fail(error);
        return;
    }
    const word = translate(current.value, `status.${statusKeyOf(record.type)}.${status}`);
    offer(`${record.title}: ${word}`, () => patchRecord(record.id, { status: before }));
}

/**
 * Sets or clears the due date and offers to put the previous one back. / Ставит или убирает срок и предлагает вернуть прежний.
 */
export async function changeDue(record: Subject & Pick<AxisRecord, 'due'>, due: string | null): Promise<void> {
    if (record.due === due) return;
    const before = record.due;
    try {
        await patchRecord(record.id, { due });
    } catch (error) {
        fail(error);
        return;
    }
    const text = due ? translate(current.value, 'undo.due', [formatShort(due, current.value)]) : translate(current.value, 'undo.noDue');
    offer(`${record.title}: ${text}`, () => patchRecord(record.id, { due: before }));
}

/**
 * Sets the links of a record (one added or one removed) and offers to put the previous ones back; `message` is the toast text.
 * Ставит связи записи (одна добавлена или одна убрана) и предлагает вернуть прежние; `message` текст тоста.
 */
export async function changeLinks(record: Pick<AxisRecord, 'id' | 'links'>, links: RecordLink[], message: string): Promise<void> {
    const before = record.links;
    try {
        await patchRecord(record.id, { links });
    } catch (error) {
        fail(error);
        return;
    }
    offer(message, () => patchRecord(record.id, { links: before }));
}
