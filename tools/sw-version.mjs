// Отпечаток версии для sw.js: хэш содержимого всех файлов приложения из списка FILES.
// `node tools/sw-version.mjs` (или `npm run sw-version`) записывает его в sw.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'sw.js');

export function cachedFiles(swSource = readFileSync(swPath, 'utf8')) {
    const list = swSource.match(/const FILES = \[([\s\S]*?)\];/)[1];
    return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function computeVersion() {
    const hash = createHash('sha256');
    // './' — это тот же index.html
    for (const file of cachedFiles().filter((f) => f !== './')) {
        hash.update(file);
        hash.update(readFileSync(join(root, file)));
    }
    return hash.digest('hex').slice(0, 12);
}

export function currentVersion(swSource = readFileSync(swPath, 'utf8')) {
    return swSource.match(/const VERSION = '([^']*)';/)[1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const version = computeVersion();
    const source = readFileSync(swPath, 'utf8');
    writeFileSync(swPath, source.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
    console.log(`sw.js VERSION = ${version}`);
}
