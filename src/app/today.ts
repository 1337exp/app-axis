/**
 * "Today" for a view that lives for days in an open tab: a reactive day that moves by itself. A timer is set for the next
 * local midnight, and the day is checked again when the tab comes back to the front or the window gets the focus (a laptop
 * that slept through midnight, a timer that a background tab ran late). The day is the local one, as a person means it.
 *
 * «Сегодня» для вида, который живёт днями в открытой вкладке: реактивный день, который сдвигается сам. Таймер ставится
 * на ближайшую местную полночь, а день проверяется заново, когда вкладка снова на виду или окно получило фокус (ноутбук
 * проспал полночь, фоновая вкладка опоздала с таймером). День местный, как его и понимает человек.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';
import { today } from '@/ui/format';

/** Milliseconds from `now` to the next local midnight. / Миллисекунд от `now` до ближайшей местной полночи. */
export function untilMidnight(now: Date): number {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/** The current day `YYYY-MM-DD`, kept up to date while the component is mounted. / Текущий день, который обновляется, пока компонент на странице. */
export function useToday(): Ref<string> {
    const day = ref(today());
    let timer: ReturnType<typeof setTimeout> | null = null;

    function check(): void {
        day.value = today();
        if (timer) clearTimeout(timer);
        // a second past midnight: never wake up a hair before it and see the old day again
        timer = setTimeout(check, untilMidnight(new Date()) + 1000);
    }
    const onVisible = (): void => {
        if (document.visibilityState === 'visible') check();
    };

    onMounted(() => {
        check();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', check);
    });
    onBeforeUnmount(() => {
        if (timer) clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', check);
    });
    return day;
}
