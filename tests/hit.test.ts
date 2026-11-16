// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { emptyPlaceAt } from '../src/ui/hit.ts';

function canvas(): { root: HTMLElement; card: HTMLElement; title: HTMLElement; handle: HTMLElement; line: HTMLElement; button: HTMLElement; bg: HTMLElement } {
    document.body.innerHTML = `
        <div id="root" class="tx-canvas">
            <div class="world"><div id="bg"></div>
                <div id="card" data-node-id="a"><span id="title"></span><i id="handle" data-pin="right"></i></div>
                <svg><g data-conn-id="a|b|depends"><path id="line"></path></g></svg>
            </div>
            <div class="map__ui"><button id="button"></button></div>
        </div>`;
    const get = (id: string) => document.getElementById(id) as HTMLElement;
    return { root: get('root'), card: get('card'), title: get('title'), handle: get('handle'), line: get('line'), button: get('button'), bg: get('bg') };
}

describe('an empty place of the map', () => {
    it('is the background, and only the background', () => {
        const c = canvas();
        const at = (el: Element | null) => () => el;
        expect(emptyPlaceAt(c.root, 5, 5, at(c.root))).toBe(true);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.bg))).toBe(true);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.card))).toBe(false);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.title))).toBe(false);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.handle))).toBe(false);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.line))).toBe(false);
        expect(emptyPlaceAt(c.root, 5, 5, at(c.button))).toBe(false);
    });

    it('is not anything outside the canvas, nor a point with nothing under it', () => {
        const c = canvas();
        const outside = document.createElement('div');
        document.body.append(outside);
        expect(emptyPlaceAt(c.root, 5, 5, () => outside)).toBe(false);
        expect(emptyPlaceAt(c.root, 5, 5, () => null)).toBe(false);
        expect(emptyPlaceAt(null, 5, 5, () => c.root)).toBe(false);
    });

    it('asks the point it was given, so the target of an event (always the canvas under a pointer capture) cannot mislead it', () => {
        const c = canvas();
        const asked: number[][] = [];
        // the browser reports a double click on the card with the canvas as the target; the point still lies on the card
        emptyPlaceAt(c.root, 40, 60, (x, y) => {
            asked.push([x, y]);
            return c.card;
        });
        expect(asked).toEqual([[40, 60]]);
        expect(emptyPlaceAt(c.root, 40, 60, () => c.card)).toBe(false);
    });
});
