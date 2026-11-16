import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { createApi } from './server/api.ts';
import { dataDir, port } from './server/config.ts';
import { createStore } from './server/store.ts';

/**
 * The API inside the dev server: `npm run dev` is one process on one port, the same as `npm start` after a build.
 * API внутри dev-сервера: `npm run dev` это один процесс на одном порту, как и `npm start` после сборки.
 */
function axisApi(): Plugin {
    return {
        name: 'axis-api',
        apply: 'serve',
        configureServer(server) {
            const api = createApi(createStore(dataDir()));
            server.middlewares.use((req, res, next) => {
                api.handle(req, res).then((handled) => (handled ? undefined : next()), next);
            });
            server.httpServer?.once('close', () => api.close());
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
