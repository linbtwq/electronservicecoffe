// ============================================================
// javascript/app/load.js
//
// назначение
// этот файл отвечает за загрузку справочника точек.
//
// ответственность
// - читать кеш из indexedDB пока нет данных
// - загружать свежие данные из 1с
// - сохранять ответ в indexedDB
// - аккуратно обрабатывать ошибки сети
// - не запускать параллельные загрузки
//
// особенности
// если во время загрузки пришел еще один вызов,
// он ставится в очередь и выполняется сразу после текущего
//
// зависимости
// - core/state.js дает globalData, isLoading, reloadQueued, serverDataFresh, lastLoadedAt
// - core/api.js дает fetchWithTimeout, showTopProgress, hideTopProgress
// - core/storage.js дает localDB
// - core/locks.js дает invalidateLockSnapshot
// - core/queue.js дает readQueue
// - ui/status.js дает setConnectionStatus, renderStatus
// - ui/toast.js дает showToast
// - features/search.js дает refreshResults
// - app/sync.js дает syncOfflineMeters
// ============================================================


// ============================================================
// блок 1. загрузка данных
//
// порядок такой
// 1. если уже грузим, ставим флаг reloadQueued и выходим
// 2. показываем полосу прогресса
// 3. если данных нет, пробуем отдать кеш
// 4. тянем свежие данные с сервера
// 5. сохраняем в кеш и обновляем состояние
// 6. при ошибке тоже пробуем кеш
//
// silent true значит не показывать тост об ошибке
// ============================================================

async function loadData({ silent = false } = {}) {
    // если уже грузим, ставим в очередь следующий вызов
    if (isLoading) { reloadQueued = true; return }

    isLoading = true
    showTopProgress()

    // пока нет данных, пробуем отдать кеш чтобы список был сразу
    if (!globalData.length) {
        try {
            const cached = await localDB.load('cachedNomenclature')
            if (cached && Array.isArray(cached)) {
                globalData = cached
                _dataRevision++
                serverDataFresh = false
                invalidateLockSnapshot()
                refreshResults()
            }
        } catch (e) {
            console.warn('Помилка читання кешу', e)
        }
    }

    try {
        const response = await fetchWithTimeout(
            `${apiBase}/nomenclature?t=${Date.now()}&v=${APP_CONFIG.apiVersion}&u=${encodeURIComponent(currentUser ? currentUser.id : '')}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        )

        if (!response.ok) throw new Error('Помилка мережі')

        const data = await response.json()
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С')

        globalData = data
        _dataRevision++
        serverDataFresh = true
        lastLoadedAt = Date.now()
        invalidateLockSnapshot()

        try { await localDB.save('cachedNomenclature', data) }
        catch (e) { console.error('Помилка запису в БД', e) }

        setConnectionStatus(true)

        // заодно пробуем дотянуть офлайн очередь
        if (readQueue().length && !isSyncing) syncOfflineMeters({ quiet: true })

    } catch (error) {
        setConnectionStatus(false)
        serverDataFresh = false

        // если данных нет совсем, еще раз смотрим в кеш
        if (!globalData.length) {
            try {
                const cached = await localDB.load('cachedNomenclature')
                globalData = (cached && Array.isArray(cached)) ? cached : []
                _dataRevision++
                invalidateLockSnapshot()
            } catch (e) {}
        }

        if (!silent) {
            showToast(
                globalData.length
                    ? 'Офлайн. Показані збережені дані'
                    : 'Немає зв\'язку і немає збережених даних',
                !globalData.length
            )
        }
    } finally {
        isLoading = false
        refreshResults()
        hideTopProgress()
        renderStatus()

        // если во время загрузки приходил еще запрос, делаем его
        if (reloadQueued) {
            reloadQueued = false
            loadData({ silent: true })
        }
    }
}