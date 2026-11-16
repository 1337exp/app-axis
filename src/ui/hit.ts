/**
 * What lies under a point of the map canvas. The canvas of TaoUX holds the pointer capture from the press on, so the
 * browser reports the later `click` and `dblclick` with the canvas itself as `event.target`, whatever lay under the
 * pointer. A handler that asks "was this an empty place?" must therefore look at the point (`elementFromPoint`), never
 * at `event.target`: asking the target took a double click on a card for a double click on the background.
 *
 * Что лежит под точкой холста карты. Холст TaoUI держит захват указателя с нажатия, поэтому браузер сообщает следующие
 * `click` и `dblclick` с самим холстом в `event.target`, что бы ни лежало под указателем. Обработчик, который спрашивает
 * «это пустое место?», обязан смотреть на точку (`elementFromPoint`), а не на `event.target`: по цели двойной клик по
 * карточке принимался за двойной клик по фону.
 */

/** What on the canvas is not "an empty place": a card, a line, a control laid over the canvas. / Что на холсте не «пустое место»: карточка, линия, элемент управления поверх холста. */
export const NOT_EMPTY = '[data-node-id], [data-conn-id], [data-pin], .map__ui';

type From = (x: number, y: number) => Element | null;

/** Whether the point (client coordinates) is an empty place of the canvas `root`. / Пустое ли место холста `root` в точке (координаты окна). */
export function emptyPlaceAt(root: Element | null, x: number, y: number, from: From = (px, py) => document.elementFromPoint(px, py)): boolean {
    const under = from(x, y);
    if (!root || !under) return false;
    return root.contains(under) && !under.closest(NOT_EMPTY);
}
