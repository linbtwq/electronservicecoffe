// ============================================================
// javascript/app/init.js
//
// назначение
// этот файл запускает приложение.
//
// ответственность
// - поймать DOMContentLoaded и вызвать инициализацию
// - зарегистрировать service worker
// - показать версию приложения
// - собрать функции запуска в startApp
//
// зависимости
// - core/queue.js дает initQueueStorage
// - features/meter.js дает clearMeterFlowState
// - features/payment.js дает clearPaymentFlowState
// - app/load.js дает loadData
// - app/sync.js дает syncOfflineMeters
// - app/events.js дает initEventListeners
// - app/refresh.js дает startAutoRefresh
// - ui/theme.js дает initTheme
// - features/search.js дает initSearchFilters
// - app/reset.js дает resetAppState
// ============================================================


// ============================================================
// блок 1. старт после DOMContentLoaded
//
// в этом порядке
// регистрируем sw, тему, обработчики, фильтры, версию.
// загрузка данных тут не идет, она начнется после входа в auth.js
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initServiceWorker()
    initTheme()
    initEventListeners()
    initSearchFilters()
    showVersion()
})


// ============================================================
// блок 2. запуск приложения после входа
//
// вызывается из auth.js.
// подготавливает хранилище очереди, чистит состояние форм,
// загружает данные, при сети пытается дотянуть очередь,
// включает автообновление и ставит фокус в поиск на десктопе
// ============================================================

async function startApp() {
    // загружаем очередь до первой попытки синхронизации
    await initQueueStorage()

    clearMeterFlowState()
    clearPaymentFlowState()

    loadData()

    if (navigator.onLine) syncOfflineMeters()

    startAutoRefresh()

    // на компьютере сразу переводим фокус в поиск
    if (window.matchMedia('(pointer: fine)').matches) {
        setTimeout(() => {
            const searchInput = document.getElementById('searchInput')
            if (searchInput) searchInput.focus()
        }, 250)
    }
}


// ============================================================
// блок 3. регистрация service worker
// ============================================================

function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('помилка sw:', err))
    }
}


// ============================================================
// блок 4. показ версии внизу экрана
// ============================================================

function showVersion() {
    const el = document.getElementById('appVersion')
    if (el && typeof APP_VERSION !== 'undefined') el.textContent = 'v' + APP_VERSION
}