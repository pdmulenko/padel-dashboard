// Service worker: приложение открывается и работает без интернета.
//
// При установке все файлы приложения скачиваются в кэш («кладовку») и дальше берутся оттуда.
// Браузер сам при каждом открытии с интернетом сверяет этот файл с сайтом. VERSION — отпечаток
// содержимого файлов приложения: после обновления он другой, браузер ставит новый service worker,
// тот целиком скачивает новую версию в новый кэш и удаляет старый. Открытая страница при этом
// не перезагружается — новая версия откроется при следующем запуске.
//
// VERSION не правится руками: `npm run sw-version` (тест проверяет, что он актуален).

const VERSION = '955010851e29';
const CACHE = `pd-${VERSION}`;

const FILES = [
    './',
    'index.html',
    'style.css',
    'ui.js',
    'state.js',
    'scheduler.js',
    'scoring.js',
    'i18n.js',
    'icons.svg',
    'manifest.json',
    'icons/favicon.ico',
    'icons/favicon.svg',
    'icons/favicon-16x16.png',
    'icons/favicon-32x32.png',
    'icons/apple-touch-icon.png',
    'icons/android-chrome-192x192.png',
    'icons/android-chrome-512x512.png',
    'icons/flag-ru.svg',
    'icons/flag-gb.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            // cache: 'reload' — мимо HTTP-кэша браузера, иначе в новый кэш могли бы попасть старые файлы
            .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pd-') && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

// Файлы приложения — из кэша; всё остальное (если вдруг) — из сети
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? fetch(request)));
});
