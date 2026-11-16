/**
 * The standalone server: the API and the built page (`dist/`) on one local port. `npm run build`, then `npm start`.
 * For development `npm run dev` serves the same API from inside Vite.
 *
 * Самостоятельный сервер: API и собранная страница (`dist/`) на одном локальном порту.
 * Для разработки `npm run dev` отдаёт то же API изнутри Vite.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createApi } from './api.ts';
import { APP_ROOT, dataDir, port } from './config.ts';
import { createStore } from './store.ts';

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
};

const dist = resolve(APP_ROOT, 'dist');
const data = dataDir();
const api = createApi(createStore(data));

const server = createServer((req, res) => {
    void api.handle(req, res).then((handled) => {
        if (handled) return;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        let file = normalize(join(dist, path));
        // nothing outside dist; an unknown address is the page itself (it routes by the hash)
        if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html');
        if (!existsSync(file)) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('The page is not built yet: run "npm run build" (or "npm run dev").');
            return;
        }
        const hashed = path.startsWith('/assets/');
        res.writeHead(200, {
            'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
    });
});

const at = port();
server.listen(at, '127.0.0.1', () => {
    console.log(`Axis: http://localhost:${at}`);
    console.log(`Data: ${data}`);
});

const stop = (): void => {
    api.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
