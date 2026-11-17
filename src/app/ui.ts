/**
 * Small requests between the parts of the page that do not belong to the data: the shell asks the tree to put the focus
 * into its quick input.
 * Мелкие запросы между частями страницы, не относящиеся к данным: оболочка просит дерево поставить фокус в быстрый ввод.
 */
import { reactive } from 'vue';

export const ui = reactive({
    /** Grows when the quick input of the tree should take the focus. / Растёт, когда быстрый ввод дерева должен получить фокус. */
    quick: 0,
});
