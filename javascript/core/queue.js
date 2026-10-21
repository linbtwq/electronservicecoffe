// ============================================================
// javascript/core/queue.js
//
// назначение
// этот файл отвечает за офлайн-очередь отправки показаний.
//
// ответственность
// - хранить очередь неотправленных показаний
// - хранить список записей которые сервер отклонил
// - синхронизировать оба списка между indexedDB и localStorage
// - показывать пользователю диалог повторной отправки
//
// что тут важно
// основное хранилище это indexedDB.
// резервная копия в localStorage на случай если база недоступна.
// в памяти держится синхронная копия чтобы обработчики могли читать без ожидания.
//
// зависимости
// - core/storage.js дает localDB
// - core/utils.js дает readJsonSafe
// - core/api.js дает newRequestId
// - core/locks.js дает lockPoint и invalidateLockSnapshot
// - ui/dialog.js дает showConfirmDialog
// - app/sync.js дает scheduleSyncRetry
// ============================================================


// ============================================================
// блок 1. константы и состояние
// ============================================================

// ключи для indexedDB
const QUEUE_DB_KEY = 'offlineMetersQueue'
const FAILED_DB_KEY = 'failedMetersQueue'

// ключи для localStorage резервной копии
const QUEUE_LS_KEY = 'offlineMetersQueue'
const FAILED_LS_KEY = 'failedMetersQueue'

// лимит попыток на одну запись
// после этого запись уходит в список отклоненных
const MAX_QUEUE_ATTEMPTS = 5

// отклоненные записи хранятся четырнадцать дней
const FAILED_TTL_MS = 14 * 24 * 3600 * 1000

// синхронная копия очередей в памяти
let _queueState = { queue: [], failed: [] }

// флаг что хранилище уже инициализировано
let _queueReady = false


// ============================================================
// блок 2. инициализация
//
// вызывается один раз при запуске приложения.
// сначала пробует indexedDB, при ошибке падает на localStorage.
// попутно переносит старые записи из localStorage в indexedDB.
// после успешной миграции LS-ключ удаляется,
// чтобы старые данные не могли воскреснуть при очистке indexedDB.
// ============================================================

async function initQueueStorage() {
    if (_queueReady) return

    try {
        let queue = await localDB.load(QUEUE_DB_KEY)
        let failed = await localDB.load(FAILED_DB_KEY)

        queue = Array.isArray(queue) ? queue : []
        failed = Array.isArray(failed) ? failed : []

        // переносим записи из прежнего локального хранилища
        if (!queue.length) {
            const legacy = readJsonSafe(QUEUE_LS_KEY, [])
            if (Array.isArray(legacy) && legacy.length) {
                queue = legacy
                try {
                    await localDB.save(QUEUE_DB_KEY, queue)
                    // успешно мигрировали - чистим LS чтобы не дублировалось
                    localStorage.removeItem(QUEUE_LS_KEY)
                } catch (e) {
                    // если запись в БД упала, LS оставляем как резерв
                    console.warn('[queue] не вдалося мігрувати чергу в IndexedDB', e)
                }
            }
        }
        if (!failed.length) {
            const legacy = readJsonSafe(FAILED_LS_KEY, [])
            if (Array.isArray(legacy) && legacy.length) {
                failed = legacy
                try {
                    await localDB.save(FAILED_DB_KEY, failed)
                    localStorage.removeItem(FAILED_LS_KEY)
                } catch (e) {
                    console.warn('[queue] не вдалося мігрувати failed в IndexedDB', e)
                }
            }
        }

        _queueState = { queue, failed }
        _queueReady = true

    } catch (e) {
        // при недоступности базы используем резервное локальное хранилище
        console.warn('[queue] IndexedDB недоступна, fallback на localStorage', e)
        _queueState = {
            queue: readJsonSafe(QUEUE_LS_KEY, []),
            failed: readJsonSafe(FAILED_LS_KEY, [])
        }
        _queueReady = true
    }
}


// ============================================================
// блок 3. чтение и запись очереди
// ============================================================

// возвращает актуальную очередь без ожидания базы
function readQueue() {
    if (!_queueReady) return readJsonSafe(QUEUE_LS_KEY, [])
    return _queueState.queue
}

// обновляет очередь в основной и резервной базе
function saveQueue(q) {
    const list = Array.isArray(q) ? q : []
    _queueState.queue = list

    localDB.save(QUEUE_DB_KEY, list).catch(e => console.warn('[queue] save', e))

    try {
        if (list.length) localStorage.setItem(QUEUE_LS_KEY, JSON.stringify(list))
        else localStorage.removeItem(QUEUE_LS_KEY)
    } catch (e) {}
}

// читает отклоненные записи и попутно выкидывает просроченные
function readFailed() {
    const raw = _queueReady
        ? _queueState.failed
        : readJsonSafe(FAILED_LS_KEY, [])

    const now = Date.now()
    return raw.filter(f => f && f.payload && f.at && now - f.at < FAILED_TTL_MS)
}

// сохраняет отклоненные записи
function saveFailed(list) {
    const arr = Array.isArray(list) ? list : []
    _queueState.failed = arr

    localDB.save(FAILED_DB_KEY, arr).catch(e => console.warn('[queue] saveFailed', e))

    try {
        if (arr.length) localStorage.setItem(FAILED_LS_KEY, JSON.stringify(arr))
        else localStorage.removeItem(FAILED_LS_KEY)
    } catch (e) {}
}


// ============================================================
// блок 4. снятие локальной блокировки
//
// если точка была заблокирована только потому что ждала отправки,
// после успешной отправки или после отказа сервера ее надо разблокировать.
// ============================================================

function unlockPoint(pointId) {
    const locks = getLocks()
    const lock = locks[String(pointId)]

    if (lock && lock.pending) {
        delete locks[String(pointId)]
        saveLocks(locks)
        invalidateLockSnapshot()
    }
}


// ============================================================
// блок 5. диалог по отклоненным записям
//
// показывает пользователю список отклоненных записей.
// если пользователь соглашается повторить,
// возвращаем их в очередь и сбрасываем счетчик попыток.
// ============================================================

async function reviewFailedQueue() {
    const failed = readFailed()
    if (!failed.length) return false

    const ok = await showConfirmDialog({
        title: 'Не відправлені записи',
        message: '1С відхилила ці показники. Повторити відправку?',
        details: failed.map(f => `Точка ${f.payload.point_id}: ${String(f.error || 'помилка').slice(0, 90)}`),
        okText: 'Повторити',
        cancelText: 'Закрити'
    })
    if (!ok) return false

    const queue = readQueue().slice()
    for (const f of failed) {
        // сбрасываем счетчик попыток
        f.payload.attempts = 0
        delete f.payload.lastError
        queue.push(f.payload)
        lockPoint(f.payload.point_id, true)
    }

    saveFailed([])
    saveQueue(queue)
    retryAttempt = 0
    scheduleSyncRetry()
    return true
}