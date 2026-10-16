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
// - core/state.js даёт AUTO_REFRESH_INTERVAL, autoRefreshTimer, isLoading, isSyncing, retryAttempt
// - core/queue.js даёт readQueue, readFailed
// - ui/focus.js даёт getTopModal
// - ui/toast.js даёт showToast
// - app/load.js даёт loadData
// - app/sync.js даёт syncOfflineMeters
// - app/clearCache.js даёт reviewFailedQueue
// ============================================================


// ============================================================
// блок 1. автообновление
//
// раз в минуту тихо тянем свежие данные.
// если есть очередь, сначала пробуем её отправить.
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

    // если есть очередь, сначала пытаемся её отправить
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
// сначала разбираемся с отклонёнными записями.
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