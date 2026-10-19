// ============================================================
// javascript/ui/status.js
//
// назначение
// этот файл отвечает за индикатор связи внизу экрана.
//
// ответственность
// - хранить последнее известное состояние сети
// - показывать сколько секунд назад обновлялись данные
// - перерисовывать индикатор с учетом очереди и синхронизации
//
// оптимизация
// если ключ состояния не менялся перерисовка не выполняется
//
// зависимости
// - core/state.js дает connectionOnline, lastLoadedAt, isLoading, lastSyncError, _lastStatusKey
// - core/queue.js дает readQueue и readFailed
// ============================================================


// ============================================================
// блок 1. установка состояния сети
// ============================================================

function setConnectionStatus(isOnline) {
    connectionOnline = isOnline
    renderStatus()
}


// ============================================================
// блок 2. сколько секунд назад обновлялись данные
//
// показываем короткое человеческое описание
// ============================================================

function getStatusTimeText() {
    if (!lastLoadedAt) return ''

    const sec = Math.floor((Date.now() - lastLoadedAt) / 1000)
    if (sec < 5) return 'щойно'
    if (sec < 60) return `${sec} сек тому`
    if (sec < 3600) return `${Math.floor(sec / 60)} хв тому`
    return `${Math.floor(sec / 3600)} год тому`
}


// ============================================================
// блок 3. отрисовка индикатора
//
// собирает ключ состояния из нескольких полей.
// если ключ совпадает с прошлым просто выходим.
// иначе пересобираем класс и текст индикатора.
// ============================================================

function renderStatus() {
    const box = document.getElementById('connectionStatus')
    if (!box) return

    const queued = readQueue().length
    const failedCount = readFailed().length
    const timeText = getStatusTimeText()

    const timeEl = box.querySelector('.status-time')
    if (timeEl) timeEl.textContent = timeText

    // если ничего не менялось не перерисовываем
    const stateKey = `${connectionOnline}|${queued}|${failedCount}|${lastSyncError}|${isLoading ? 1 : 0}`
    if (stateKey === _lastStatusKey) return
    _lastStatusKey = stateKey

    box.className = 'connection-status'
        + (connectionOnline === true ? ' online' : connectionOnline === false ? ' offline' : '')
        + ((queued || failedCount) ? ' has-queue' : '')
        + (isLoading ? ' syncing' : '')

    let text = connectionOnline === null
        ? 'Перевірка зв\'язку...'
        : connectionOnline
            ? '1С підключена'
            : 'Немає зв\'язку з 1С'

    if (queued) text += ` · Не відправлено: ${queued}`
    if (failedCount) text += ` · Відхилено: ${failedCount}`

    const textEl = box.querySelector('.status-text')
    if (textEl) textEl.textContent = text

    box.title = 'Натисніть для оновлення' + (lastSyncError ? ` (${lastSyncError})` : '')
}