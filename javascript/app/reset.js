// ============================================================
// javascript/app/reset.js
//
// назначение
// этот файл сбрасывает состояние приложения при выходе.
//
// ответственность
// - обнулить все глобальные переменные
// - очистить контейнеры и поля
// - остановить все таймеры
// - вернуть поиск в центр
//
// зависимости
// - core/state.js даёт почти все переменные
// - core/storage.js даёт _locksCache
// - core/locks.js даёт invalidateLockSnapshot
// - ui/status.js даёт renderStatus
// - ui/backToTop.js даёт updateBackToTop
// - app/refresh.js даёт stopAutoRefresh
// ============================================================


function resetAppState() {
    // закрываем раскрытый блок остатков если есть
    if (typeof closeMachineExpand === 'function') {
        try { closeMachineExpand() } catch (e) {}
    }

    // сбрасываем данные
    globalData = []
    _dataRevision++
    lastResults = []
    renderedCount = 0
    lastLoadedAt = 0
    isLoading = false
    reloadQueued = false
    isSyncing = false
    retryAttempt = 0
    lastSyncError = ''
    connectionOnline = null
    serverDataFresh = false

    // сбрасываем состояние форм
    currentPointId = null
    currentMeterRequestId = null
    currentPaymentPointId = null
    currentPaymentRequestId = null

    // сбрасываем поиск
    isAtTop = false

    // сбрасываем служебные ключи
    _lastStatusKey = ''
    _locksCache = null
    invalidateLockSnapshot()

    // останавливаем таймеры
    clearTimeout(searchTimer)
    cancelAnimationFrame(renderFrame)
    clearTimeout(retryTimer)
    clearTimeout(toastTimer)

    if (statusTimer) {
        clearInterval(statusTimer)
        statusTimer = null
    }

    stopAutoRefresh()

    // чистим контейнер результатов
    const results = document.getElementById('resultsContainer')
    if (results) {
        results.innerHTML = ''
        results.scrollTop = 0
        results.classList.remove('active')
        delete results.dataset.renderKey
    }
    updateBackToTop()

    // возвращаем поиск в центр
    const searchContainer = document.getElementById('searchContainer')
    if (searchContainer) {
        searchContainer.classList.remove('top')
        searchContainer.classList.add('center')
    }

    const searchInput = document.getElementById('searchInput')
    if (searchInput) searchInput.value = ''

    renderStatus()
}