// ============================================================
// javascript/core/storage.js
//
// назначение
// этот файл отвечает за локальное хранилище приложения.
//
// ответственность
// - работать с indexedDB для кеша справочника и ассортимента
// - читать и писать локальные блокировки точек в localStorage
// - очищать кеш indexedDB кроме очереди и отклоненных записей
//
// особенности
// блокировки читаются часто, поэтому в памяти держится кеш
// срок жизни кеша одна секунда
//
// зависимости
// - core/utils.js для readJsonSafe
// ============================================================


// ============================================================
// блок 1. обертка над indexedDB
//
// одна база, одно хранилище ключ значение.
// версия схемы первая, апгрейд не нужен.
// ============================================================

const localDB = {
    name: 'CoffeeMetersDB',
    store: 'cache',
    _db: null,

    // открывает базу или возвращает уже открытую
    async getDb() {
        if (this._db) return this._db

        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.name, 1)
            req.onupgradeneeded = e => e.target.result.createObjectStore(this.store)
            req.onsuccess = () => {
                this._db = req.result
                resolve(req.result)
            }
            req.onerror = () => reject(req.error)
        })
    },

    // сохраняет значение по ключу
    async save(key, data) {
        const db = await this.getDb()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.store, 'readwrite')
            tx.objectStore(this.store).put(data, key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    },

    // читает значение по ключу
    async load(key) {
        const db = await this.getDb()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.store, 'readonly')
            const req = tx.objectStore(this.store).get(key)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(tx.error)
        })
    }
}

// очищает кеш приложения, сохраняя очередь и отклоненные записи
// ключи очереди импортируются как глобальные из core/queue.js
// storage.js грузится до queue.js (в index.html порядок utils → storage → api → queue → locks → state).
// работает только потому, что QUEUE_DB_KEY и FAILED_DB_KEY
// используются внутри clearLocalDb в момент вызова, а не при загрузке

async function clearLocalDb() {
    try {
        const db = await localDB.getDb()

        await new Promise((resolve, reject) => {
            const tx = db.transaction(localDB.store, 'readwrite')
            const store = tx.objectStore(localDB.store)
            const req = store.getAllKeys()

            req.onsuccess = () => {
                for (const key of req.result || []) {
                    if (key !== QUEUE_DB_KEY && key !== FAILED_DB_KEY) {
                        store.delete(key)
                    }
                }
            }

            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (e) {
        console.warn('[clearLocalDb]', e)
    }
}

// публикуем в window чтобы auth.js мог вызвать при выходе
window.clearLocalDb = clearLocalDb


// ============================================================
// блок 2. локальные блокировки точек
//
// блокировки хранятся в localStorage под ключом pointLocks.
// чтобы не читать их на каждый рендер карточки держим кеш в памяти.
// срок жизни кеша одна секунда, этого достаточно для отзывчивости.
// ============================================================

let _locksCache = null
let _locksCacheAt = 0

// читает блокировки из localStorage или из памяти
function getLocks() {
    const now = Date.now()
    // используем свежую копию из памяти
    if (_locksCache && now - _locksCacheAt < 1000) return _locksCache

    try {
        _locksCache = JSON.parse(localStorage.getItem('pointLocks')) || {}
    } catch (e) {
        _locksCache = {}
    }

    _locksCacheAt = now
    return _locksCache
}

// сохраняет блокировки и обновляет кеш
function saveLocks(locks) {
    localStorage.setItem('pointLocks', JSON.stringify(locks))
    _locksCache = locks
    _locksCacheAt = Date.now()
}