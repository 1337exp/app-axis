import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import type { Api } from './server/api.ts';
import { dataDir, port } from './server/config.ts';

/**
 * The API inside the dev server: `npm run dev` is one process on one port, the same as `npm start` after a build.
 * The API code is loaded through Vite's own module loader (not imported by this file), and every change in `server/`
 * or in `src/core/` (the server imports the model from there) makes the plugin load it again: the old API is closed
 * (its watcher and its event streams, the page reconnects by itself) and a new one takes its place. So an edit of the
 * server never leaves the running dev server on the old answers.
 *
 * API внутри dev-сервера: `npm run dev` это один процесс на одном порту, как и `npm start` после сборки.
 * Код API грузится загрузчиком модулей самого Vite (этот файл его не импортирует), и каждая правка в `server/` или в
 * `src/core/` (сервер берёт оттуда модель) заставляет плагин загрузить его заново: старый API закрывается (его
 * наблюдатель и потоки событий, страница переподключается сама), на его место встаёт новый. Правка сервера больше
 * не оставляет работающий dev-сервер на старых ответах.
 */
function axisApi(): Plugin {
    return {
        name: 'axis-api',
        apply: 'serve',
        async configureServer(server) {
            const log = server.config.logger;
            let api: Api | null = null;
            let generation = 0;

            const load = async (): Promise<void> => {
                const mine = ++generation;
                server.environments.ssr.moduleGraph.invalidateAll();
                const [apiModule, storeModule] = await Promise.all([server.ssrLoadModule('/server/api.ts'), server.ssrLoadModule('/server/store.ts')]);
                if (mine !== generation) return; // a newer change is already loading / уже грузится более новая правка
                const next = (apiModule.createApi as (store: unknown) => Api)((storeModule.createStore as (root: string) => unknown)(dataDir()));
                const old = api;
                api = next;
                old?.close();
            };

            try {
                await load();
            } catch (error) {
                log.error(`[axis] the API did not load: ${error instanceof Error ? error.message : String(error)}`);
            }

            server.middlewares.use((req, res, next) => {
                if (!api) return next();
                api.handle(req, res).then((handled) => (handled ? undefined : next()), next);
            });

            let timer: ReturnType<typeof setTimeout> | null = null;
            const changed = (file: string): void => {
                if (!/\/(server|src\/core)\/[^/]+\.ts$/.test(file.replaceAll('\\', '/'))) return;
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    log.info('[axis] server code changed: loading the API again');
                    load().catch((error: unknown) => log.error(`[axis] the API did not load: ${error instanceof Error ? error.message : String(error)}`));
                }, 150);
            };
            server.watcher.on('change', changed);
            server.watcher.on('add', changed);
            server.watcher.on('unlink', changed);

            server.httpServer?.once('close', () => {
                if (timer) clearTimeout(timer);
                api?.close();
            });
        },
    };
}

export default defineConfig({
    // not under the tests: they need neither the API nor a watcher on the data folder
    plugins: [vue(), ...(process.env.VITEST ? [] : [axisApi()])],
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: port(), host: '127.0.0.1' },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
