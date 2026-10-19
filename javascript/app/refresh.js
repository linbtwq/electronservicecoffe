// ============================================================
// javascript/app/refresh.js
//
// назначение
// этот файл отвечает за обновление данных.
//
// ответственность
// - запускать и останавливать автообновление
// - раз в минуту тихо тянуть свежие данные
// - по клику на индикатор запускать ручное обновление
//
// зависимости
// - core/state.js дает AUTO_REFRESH_INTERVAL, autoRefreshTimer, isLoading, isSyncing, retryAttempt
// - core/queue.js дает readQueue, readFailed
// - ui/focus.js дает getTopModal
// - ui/toast.js дает showToast
// - app/load.js дает loadData
// - app/sync.js дает syncOfflineMeters
// - core/queue.js дает reviewFailedQueue
// ============================================================


// ============================================================
// блок 1. автообновление
//
// раз в минуту тихо тянем свежие данные.
// если есть очередь, сначала пробуем ее отправить.
// автообновление не работает в скрытой вкладке,
// во время открытой модалки и во время другой загрузки
// ============================================================

function startAutoRefresh() {
    stopAutoRefresh()
    autoRefreshTimer = setInterval(autoRefreshTick, AUTO_REFRESH_INTERVAL)
}

function stopAutoRefresh() {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
}

async function autoRefreshTick() {
    // не обновляем когда вкладка невидима или открыта модалка
    if (document.visibilityState !== 'visible') return
    if (getTopModal()) return
    if (isLoading || isSyncing) return
    if (!currentUser) return

    // если есть очередь, сначала пытаемся ее отправить
    if (readQueue().length) {
        retryAttempt = 0
        await syncOfflineMeters({ quiet: true })
        return
    }

    await loadData({ silent: true })
}


// ============================================================
// блок 2. ручное обновление
//
// сначала разбираемся с отклоненными записями.
// потом отправляем очередь и тянем свежие данные
// ============================================================

async function manualRefresh() {
    if (isLoading) return

    if (readFailed().length) await reviewFailedQueue()

    const box = document.getElementById('connectionStatus')
    if (box) box.classList.add('syncing')

    retryAttempt = 0

    try {
        if (readQueue().length) await syncOfflineMeters({ manual: true })
        await loadData({ silent: false })
    } catch (err) {
        console.warn('[manualRefresh]', err)
        showToast('Не вдалося оновити дані', true)
    } finally {
        if (box) setTimeout(() => box.classList.remove('syncing'), 400)
    }
}