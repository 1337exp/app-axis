import { registerTaoIcons } from '@1337exp/taoui';

/**
 * Icons of the app for `TaoIcon`: a 24 grid, a 2px stroke, `currentColor`, like the built-in `tao-*` of TaoUI.
 * Иконки приложения для `TaoIcon`: сетка 24, обводка 2px, `currentColor`, как у встроенных `tao-*` из TaoUI.
 */
export function registerAppIcons(): void {
    registerTaoIcons({
        // types of records / типы записей
        'type-idea': { body: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>' },
        'type-decision': { body: '<path d="M12 3l9 9-9 9-9-9z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
        'type-question': { body: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>' },
        'type-note': { body: '<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>' },
        // a task in work: a half-filled circle / задача в работе: наполовину залитый круг
        'status-active': { body: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>' },
        // marks in a row and sections / пометки в строке и разделы
        'mark-text': { body: '<path d="M5 7h14M5 12h14M5 17h9"/>' },
        image: { body: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5.5-5 3.5 3 3-2.5 4 4"/>' },
        link: { body: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
        journal: { body: '<path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h6M8 12h6M8 16h3"/>' },
        board: { body: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>' },
        // a vertical axis with dated entries on it / вертикальная ось с датированными записями
        timeline: { body: '<path d="M6 3v18M11 6h9M11 12h9M11 18h6"/><circle cx="6" cy="6" r="1.8" fill="currentColor"/><circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="6" cy="18" r="1.8" fill="currentColor"/>' },
        tree: { body: '<path d="M5 5h5M5 5v14M5 12h5M5 19h5M13 5h6M13 12h6M13 19h6"/>' },
    });
}
