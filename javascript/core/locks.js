// ============================================================
// javascript/core/locks.js
//
// назначение
// этот файл отвечает за блокировки точек.
//
// ответственность
// - собирать быстрый снимок блокировок по всем точкам
// - определять заблокирована ли точка на показания или на заказ
// - выставлять и снимать локальную блокировку после отправки
// - считать до какого времени блокировать точку
// - форматировать время блокировки для карточки
//
// про снимок
// на каждой карточке нужно быстро понять ее состояние.
// читать localStorage на каждую карточку слишком дорого.
// поэтому строится снимок один раз и переиспользуется
// пока не изменились данные или правила блокировки.
//
// зависимости
// - core/storage.js дает getLocks и saveLocks
// - core/state.js дает globalData, serverDataFresh, LOCK_MODE, LOCK_HOURS
// - auth.js дает currentUser
// ============================================================


// ============================================================
// блок 1. переменные снимка
// ============================================================

let _lockSnapshot = {}
let _lockSnapshotKey = ''
let _lockSnapshotData = null
let _lockSnapshotFresh = false
let _lockSnapshotUnlimited = false


// ============================================================
// блок 2. сборка снимка
//
// если ключ не менялся и данные те же просто возвращаем старый снимок.
// иначе проходим по всем точкам и для каждой считаем
// ее состояние по показаниям и по заказу.
//
// заодно удаляем просроченные локальные блокировки.
// ============================================================

function buildLockSnapshot() {
    const unlimited = isUnlimitedUser()

    if (_lockSnapshotKey && _lockSnapshotData === globalData &&
        _lockSnapshotFresh === serverDataFresh && _lockSnapshotUnlimited === unlimited) {
        return _lockSnapshot
    }

    const locks = getLocks()
    const snap = {}
    const now = Date.now()
    let locksChanged = false

    for (const item of globalData) {
        const id = String(item.id)
        const local = locks[id]

        let meterLock = null
        // удаляем истекшую временную блокировку
        if (local && !local.pending && local.until <= now) {
            delete locks[id]
            locksChanged = true
        } else if (serverDataFresh && item.locked === true) {
            meterLock = { server: true, at: item.locked_at || null }
        } else if (local && (local.pending || local.until > now)) {
            meterLock = local
        }

        let orderLock = null
        if (item.order_locked === true) {
            orderLock = { server: true, at: item.order_locked_at || null }
        }

        snap[id] = { meter: meterLock, order: orderLock }
    }

    if (locksChanged) saveLocks(locks)

    _lockSnapshot = snap
    _lockSnapshotData = globalData
    _lockSnapshotFresh = serverDataFresh
    _lockSnapshotUnlimited = unlimited
    _lockSnapshotKey = `${_dataRevision}:${_lockRevision}`
    return snap
}

// сбрасывает кеш снимка, следующий вызов пересоберет заново
function invalidateLockSnapshot() {
    _lockSnapshotKey = ''
    _lockRevision++
}

// читает блокировку показаний по точке
function getMeterLock(item) {
    const snap = _lockSnapshot[String(item.id)]
    return snap ? snap.meter : null
}

// читает блокировку заказа по точке
function getOrderLock(item) {
    const snap = _lockSnapshot[String(item.id)]
    return snap ? snap.order : null
}


// ============================================================
// блок 3. правила блокировки
//
// два режима, до конца дня или на заданное число часов.
// режим берется из настроек.
// ============================================================

function computeLockUntil() {
    const now = new Date()

    if (LOCK_MODE === 'hours') {
        return now.getTime() + LOCK_HOURS * 3600 * 1000
    }

    // режим endOfDay, блокируем до полуночи
    const end = new Date(now)
    end.setHours(24, 0, 0, 0)
    return end.getTime()
}

// выставляет локальную блокировку точки
// флаг pending значит ждем отправки в 1с
function lockPoint(pointId, pending = false) {
    const locks = getLocks()

    locks[String(pointId)] = {
        at: Date.now(),
        until: computeLockUntil(),
        pending: pending,
        user: currentUser ? currentUser.name : ''
    }

    saveLocks(locks)
    invalidateLockSnapshot()
}

// снимает флаг ожидания отправки у точки
function markSynced(pointId) {
    const locks = getLocks()
    const lock = locks[String(pointId)]

    if (lock) {
        lock.pending = false
        saveLocks(locks)
        invalidateLockSnapshot()
    }
}


// ============================================================
// блок 4. проверка роли пользователя
//
// админ видит и может все, обычный курьер ограничен блокировками
// ============================================================

function isUnlimitedUser() {
    return !!currentUser && currentUser.isAdmin === true
}

function isMeterBlocked(item) {
    return !!getMeterLock(item) && !isUnlimitedUser()
}

function isOrderBlocked(item) {
    return !!getOrderLock(item) && !isUnlimitedUser()
}


// ============================================================
// блок 5. отображение времени блокировки
//
// два случая
// локальная блокировка хранит число и превращается во время
// серверная приходит строкой и показывается как есть
// ============================================================

function lockTimeText(lock) {
    if (!lock.at) return ''

    if (typeof lock.at === 'number') {
        const t = new Date(lock.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        return ` о ${t}`
    }

    return ` (${lock.at})`
}