import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { cachedFiles, computeVersion, currentVersion } from '../tools/sw-version.mjs';

test('sw.js: все файлы из списка кэша существуют', () => {
    for (const f of cachedFiles().filter((f) => f !== './')) assert.ok(existsSync(f), f);
});

test('sw.js: в кэш попадают все файлы приложения из git', () => {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    const app = tracked.filter((f) => !/^(tests\/|tools\/|SPEC\.md|README\.md|package\.json|\.gitignore|sw\.js)/.test(f));
    const cached = new Set(cachedFiles());
    for (const f of app) assert.ok(cached.has(f), `${f} нет в FILES в sw.js`);
});

test('sw.js: отпечаток версии актуален (иначе: npm run sw-version)', () => {
    assert.equal(currentVersion(), computeVersion(), 'файлы приложения изменились — запустите npm run sw-version');
});
