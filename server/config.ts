/**
 * Where the data lives. One folder for all projects; the order of the answer:
 * the `AXIS_DATA` variable, then `"data"` in `axis.local.json` beside `package.json` (not in git), then `./data`.
 *
 * Где лежат данные. Одна папка на все проекты; порядок ответа: переменная `AXIS_DATA`,
 * затем `"data"` в `axis.local.json` рядом с `package.json` (в git не попадает), затем `./data`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root of the app (where `package.json` is). / Корень приложения. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_PORT = 4517;

interface LocalConfig {
    data?: unknown;
    port?: unknown;
}

function readLocal(): LocalConfig {
    const file = resolve(APP_ROOT, 'axis.local.json');
    if (!existsSync(file)) return {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        return typeof parsed === 'object' && parsed !== null ? (parsed as LocalConfig) : {};
    } catch {
        return {};
    }
}

export function dataDir(): string {
    const fromEnv = process.env.AXIS_DATA?.trim();
    const local = readLocal().data;
    const chosen = fromEnv || (typeof local === 'string' && local.trim() !== '' ? local.trim() : 'data');
    return isAbsolute(chosen) ? chosen : resolve(APP_ROOT, chosen);
}

export function port(): number {
    const fromEnv = Number(process.env.AXIS_PORT);
    if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
    const local = readLocal().port;
    return typeof local === 'number' && Number.isInteger(local) && local > 0 && local < 65536 ? local : DEFAULT_PORT;
}
