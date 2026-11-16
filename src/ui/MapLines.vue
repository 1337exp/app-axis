<script setup lang="ts">
/**
 * The lines layer of the map, one SVG in the world under the cards: the relations of the tree (thin, quiet), the typed
 * links (clearly visible, an arrowhead, a small label of the kind, a line style per kind: solid / dashed / dotted, not a
 * colour), the line being dragged out, and the alignment guides of a drag. Thickness is in screen pixels at any zoom.
 * TaoUX's `TaoxLinks` has no line style per line (only a colour), so the layer is drawn here; the canvas only needs
 * `data-conn-id` on a link and a wide hit path, and both are here.
 *
 * Слой линий карты, один SVG в мире под карточками: связи дерева (тонкие, тихие), типизированные связи (хорошо видны,
 * стрелка, маленькая подпись вида, стиль линии на вид: сплошная / штрих / точки, а не цвет), линия, которую тянут, и
 * направляющие при переносе. Толщина в пикселях экрана при любом масштабе. У `TaoxLinks` из TaoUX нет стиля линии на
 * каждую (только цвет), поэтому слой нарисован тут; холсту нужен лишь `data-conn-id` на связи и широкая зона попадания.
 */
import type { LinkKind } from '@/core/model';

export interface TreeLine {
    id: string;
    d: string;
}

export interface TypedLine {
    id: string;
    d: string;
    head: string;
    kind: LinkKind;
    label: string;
    mid: { x: number; y: number };
}

export interface Guide {
    axis: 'x' | 'y';
    at: number;
    from: number;
    to: number;
}

defineProps<{
    tree: readonly TreeLine[];
    links: readonly TypedLine[];
    selectedId: string | null;
    preview: { d: string; head: string } | null;
    guides: readonly Guide[];
    zoom: number;
}>();
</script>

<template>
    <svg class="mlines" width="1" height="1" aria-hidden="true">
        <g class="mlines__tree">
            <path v-for="line in tree" :key="line.id" :d="line.d" />
        </g>

        <g v-for="line in guides" :key="`${line.axis}${line.at}`" class="mlines__guide">
            <path :d="line.axis === 'x' ? `M${line.at} ${line.from}V${line.to}` : `M${line.from} ${line.at}H${line.to}`" />
        </g>

        <g v-for="line in links" :key="line.id" class="mlink" :class="[`mlink--${line.kind}`, { 'mlink--selected': selectedId === line.id }]" :data-conn-id="line.id">
            <path class="mlink__line" :d="line.d" />
            <path class="mlink__head" :d="line.head" />
            <path class="mlink__hit" :d="line.d" />
            <text v-if="zoom >= 0.35" class="mlink__label" :x="line.mid.x" :y="line.mid.y" :font-size="Math.min(12 / zoom, 22)" :stroke-width="4 / zoom" text-anchor="middle" dominant-baseline="central">{{ line.label }}</text>
        </g>

        <g v-if="preview" class="mlines__preview">
            <path class="mlines__preview-line" :d="preview.d" />
            <path class="mlines__preview-head" :d="preview.head" />
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

.mlines__guide path {
    stroke: var(--tao-color-accent);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    opacity: 0.8;
}

.mlink {
    --mlink-color: var(--tao-color-text-muted);
    color: var(--mlink-color);
}

.mlink:hover,
.mlink--selected {
    --mlink-color: var(--tao-color-text-strong);
}

.mlink--selected {
    --mlink-color: var(--tao-color-accent);
}

.mlink__line {
    stroke: var(--mlink-color);
    stroke-width: 1.6;
}

.mlink:hover .mlink__line,
.mlink--selected .mlink__line {
    stroke-width: 2.4;
}

/* the line style tells the kind: depends solid, because dashed, relates dotted / вид читается по линии: «зависит» сплошная, «потому что» штрих, «связано» точки */
.mlink--because .mlink__line {
    stroke-dasharray: 8 5;
}

.mlink--relates .mlink__line {
    stroke-dasharray: 1 5;
    stroke-width: 2.2;
}

.mlink--relates:hover .mlink__line,
.mlink--relates.mlink--selected .mlink__line {
    stroke-width: 3;
}

.mlines .mlink__head {
    fill: var(--mlink-color);
    stroke: none;
}

.mlink__hit {
    stroke: transparent;
    stroke-width: 14;
    pointer-events: stroke;
    cursor: pointer;
}

@media (pointer: coarse) {
    .mlink__hit {
        stroke-width: 30;
    }
}

.mlink__label {
    fill: var(--mlink-color);
    stroke: var(--tao-color-bg);
    paint-order: stroke;
    stroke-linejoin: round;
    pointer-events: none;
    user-select: none;
    vector-effect: none;
}

.mlines__preview-line {
    stroke: var(--tao-color-accent);
    stroke-width: 1.6;
    stroke-dasharray: 6 4;
}

.mlines .mlines__preview-head {
    fill: var(--tao-color-accent);
    stroke: none;
}
</style>
