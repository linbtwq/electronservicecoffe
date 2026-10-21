// ============================================================
// sw.js
//
// назначение
// service worker отвечает за офлайн режим приложения.
//
// ответственность
// - сложить оболочку приложения в кеш при установке
// - убрать кеши прошлых версий при активации
// - обрабатывать запросы отдавая сначала сеть, потом кеш
//
// что кешируется
// только статические ресурсы. html, css, js, манифест.
// запросы к сервису 1с намеренно не кешируются.
//
// как менять версию кеша
// имя кеша собирается из APP_VERSION в version.js.
// при выпуске новой версии меняем APP_VERSION.
// тогда при активации старые кеши удалятся сами.
//
// зависимости
// этот файл подключает version.js через importScripts.
// если добавишь новый файл в проект не забудь добавить его в ASSETS.
// ============================================================

// подтягиваем version.js чтобы получить APP_VERSION
importScripts('./version.js');

// имя текущего кеша
// привязано к версии приложения из version.js
const CACHE_NAME = `coffee-meters-v${APP_VERSION}`;

// список ресурсов для офлайн режима
// css файлы тоже нужны потому что style.css подтягивает их через import
// порядок не важен, но все файлы проекта должны быть здесь
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './css/modals.css',
    './css/ui.css',
    './css/mobile.css',
    './css/theme.css',
    './manifest.json',
    './version.js',

    // конфигурация и авторизация
    './javascript/config.js',
    './javascript/auth.js',

    // ядро
    './javascript/core/utils.js',
    './javascript/core/storage.js',
    './javascript/core/api.js',
    './javascript/core/store.js',
    './javascript/core/queue.js',
    './javascript/core/locks.js',
    './javascript/core/state.js',

    // интерфейсные помощники
    './javascript/ui/icons.js',
    './javascript/ui/rows.js',
    './javascript/ui/toast.js',
    './javascript/ui/status.js',
    './javascript/ui/focus.js',
    './javascript/ui/dialog.js',
    './javascript/ui/theme.js',
    './javascript/ui/backToTop.js',
    './javascript/ui/modalDrag.js',

    // рабочие сценарии
    './javascript/features/search.js',
    './javascript/features/cards.js',
    './javascript/features/meter.js',
    './javascript/features/payment.js',
    './javascript/features/stock.js',

    // сборка приложения
    './javascript/app/load.js',
    './javascript/app/sync.js',
    './javascript/app/submit.js',
    './javascript/app/clearCache.js',
    './javascript/app/events.js',
    './javascript/app/refresh.js',
    './javascript/app/reset.js',
    './javascript/app/init.js',

    // оптимизации и функциональные модули
    './javascript/optimize.js',
    './javascript/assortments.js',
    './javascript/recount.js',
    './javascript/notes.js',
    './javascript/goods.js',
    './javascript/scanner.js',
    './javascript/drawer.js',
    './javascript/machines.js',
    './javascript/shipment.js',

    // кэшируем полифилл сканера для работы офлайн
    './javascript/zbar-wasm.js',
    './javascript/barcode-polyfill.js'
];

// ============================================================
// блок 2. установка и активация
//
// на install складываем все в кеш.
// используем allSettled а не all.
// если один ресурс не скачался остальные все равно попадут в кеш.
// такое поведение мягче и не ломает установку из-за одной 404.
//
// на activate удаляем все кеши кроме текущего.
// это чистит старые версии после деплоя новой сборки.
// ============================================================

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(ASSETS.map((url) => cache.add(url)))
        )
    );
    // активируем новый service worker не дожидаясь закрытия вкладок
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                // оставляем только текущее имя кеша
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ============================================================
// блок 3. обработка запросов
//
// стратегия network first.
// сначала пытаемся получить свежий ответ из сети.
// если сеть не ответила за 4 секунды отдаем то что есть в кеше.
// если и в кеше пусто отдаем заглушку 504.
//
// api 1с не кешируем.
// для него признак это наличие /hs/ в адресе сервиса.
// такие запросы идут только в сеть, в кеш не пишутся.
// ============================================================

self.addEventListener('fetch', (e) => {
    const req = e.request;

    // кешируем только get запросы
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // чужие домены не трогаем
    if (url.origin !== self.location.origin) return;

    // запросы к сервису 1с пропускаем мимо кеша
    if (url.pathname.includes('/hs/')) return;

    e.respondWith(networkFirst(req));
});

// сеть в приоритете, кеш как запасной вариант
async function networkFirst(req) {
    const cached = await caches.match(req, { ignoreSearch: true });

    try {
        // если в кеше что-то есть ставим гонку между сетью и таймаутом
        // если в кеше пусто просто ждем сеть
        const res = cached
            ? await Promise.race([
                fetch(req),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
              ])
            : await fetch(req);

        // успешный ответ кладем в кеш на будущее
        if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
    } catch (err) {
        // сеть не ответила
        // если есть кеш отдаем его
        if (cached) return cached;

        // если это навигация на страницу отдаем главную из кеша
        if (req.mode === 'navigate') {
            const page = await caches.match('./index.html');
            if (page) return page;
        }

        // иначе возвращаем пустой ответ с кодом офлайн
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}