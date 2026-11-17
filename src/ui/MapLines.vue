<script setup lang="ts">
/**
 * What the map draws under the cards besides the typed links: the relations of the tree (thin, quiet), the small labels of
 * the kinds that sit on the typed links, and the alignment guides of a drag. One SVG in the world; the thickness is in screen
 * pixels at any zoom. The typed links themselves and the line being dragged out are TaoUX's `TaoxLinks` (the line style per
 * kind is its `dash`); the library has no labels, and the tree routes around wrapped columns are the app's own geometry,
 * so those two stay here.
 *
 * Что карта рисует под карточками, кроме типизированных связей: связи дерева (тонкие, тихие), маленькие подписи видов,
 * что сидят на типизированных связях, и направляющие при переносе. Один SVG в мире; толщина в пикселях экрана при любом
 * масштабе. Сами типизированные связи и линия, которую тянут, это `TaoxLinks` из TaoUX (стиль линии на вид это его
 * `dash`); подписей у библиотеки нет, а обход столбцов в линиях дерева это своя геометрия приложения, поэтому они здесь.
 */
import type { LinkKind } from '@/core/model';

export interface TreeLine {
    id: string;
    d: string;
    /** An end is a card the search did not find. / Один из концов карточка, которую поиск не нашёл. */
    dim?: boolean;
}

export interface TypedLine {
    id: string;
    d: string;
    head: string;
    kind: LinkKind;
    label: string;
    mid: { x: number; y: number };
    dim?: boolean;
}

export interface Guide {
    axis: 'x' | 'y';
    at: number;
    from: number;
    to: number;
}

defineProps<{
    tree: readonly TreeLine[];
    /** The typed links, here only for their labels. / Типизированные связи, здесь только ради подписей. */
    labels: readonly TypedLine[];
    selectedId: string | null;
    guides: readonly Guide[];
    zoom: number;
}>();
</script>

<template>
    <svg class="mlines" width="1" height="1" aria-hidden="true">
        <g class="mlines__tree">
            <path v-for="line in tree" :key="line.id" :d="line.d" :class="{ 'mlines__dim': line.dim }" />
        </g>

        <g v-for="line in guides" :key="`${line.axis}${line.at}`" class="mlines__guide">
            <path :d="line.axis === 'x' ? `M${line.at} ${line.from}V${line.to}` : `M${line.from} ${line.at}H${line.to}`" />
        </g>

        <g v-if="zoom >= 0.35" class="mlines__labels">
            <text
                v-for="line in labels"
                :key="line.id"
                class="mlink__label"
                :class="{ 'mlink__label--selected': selectedId === line.id, 'mlines__dim': line.dim }"
                :x="line.mid.x"
                :y="line.mid.y"
                :font-size="Math.min(12 / zoom, 22)"
                :stroke-width="4 / zoom"
                text-anchor="middle"
                dominant-baseline="central"
            >{{ line.label }}</text>
        </g>
    </svg>
</template>

<style scoped>
.mlines {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    pointer-events: none;
}

.mlines path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.mlines__tree path {
    stroke: var(--tao-color-border-strong);
    stroke-width: 1;
}

.mlines .mlines__dim {
    opacity: 0.2;
}

.mlines__guide path {
    stroke: var(--tao-color-accent);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    opacity: 0.8;
}

.mlink__label {
    fill: var(--tao-color-text-muted);
    stroke: var(--tao-color-bg);
    paint-order: stroke;
    stroke-linejoin: round;
    pointer-events: none;
    user-select: none;
}

.mlink__label--selected {
    fill: var(--tao-color-accent);
}
</style>
