// ============================================================
// javascript/app/clearCache.js
//
// назначение
// этот файл отвечает за кнопку очистки кеша.
//
// ответственность
// - проверить что очередь пуста перед очисткой
// - спросить подтверждение через диалог
// - удалить кеши service worker
// - очистить indexedDB кроме очереди
// - сохранить пользовательские настройки и очередь
// - перезагрузить страницу
//
// зависимости
// - core/queue.js дает readQueue и QUEUE_LS_KEY, FAILED_LS_KEY
// - core/storage.js дает clearLocalDb
// - ui/dialog.js дает showConfirmDialog
// ============================================================


// ============================================================
// блок 1. инициализация кнопки
//
// если в очереди есть неотправленные записи, чистить нельзя.
// иначе показываем подтверждение и чистим.
//
// сохраняем пользователя, тему, режим поиска, очередь,
// список отклоненных и блокировки точек
// ============================================================

function initClearCacheButton() {
    const btn = document.getElementById('clearCacheBtn')
    if (!btn) return

    btn.addEventListener('click', async () => {
        // защищаем неотправленные записи от случайного удаления
        if (readQueue().length > 0) {
            await showConfirmDialog({
                title: 'Помилка',
                message: 'Неможливо очистити кеш: є невідправлені дані. Дочекайтеся появи мережі.',
                cancelText: 'Закрити'
            })
            return
        }

        const ok = await showConfirmDialog({
            title: 'Очистити кеш?',
            message: 'Сторінка перезавантажиться. Авторизація залишиться.',
            details: ['Буде очищено збережені дані', 'Кеш файлів'],
            okText: 'Очистити',
            cancelText: 'Скасувати',
            danger: true
        })
        if (!ok) return

        btn.disabled = true
        btn.textContent = '⏳'

        try {
            // удаляем кешированные ресурсы приложения
            if ('caches' in window) {
                const keys = await caches.keys()
                await Promise.all(keys.map(k => caches.delete(k)))
            }

            await clearLocalDb()

            // сохраняем пользовательские настройки и незавершенные записи
            const keepUser = localStorage.getItem('currentUser')
            const keepDark = localStorage.getItem('darkMode')
            const keepMode = localStorage.getItem('searchMode')
            const keepFailed = localStorage.getItem(FAILED_LS_KEY)
            const keepLocks = localStorage.getItem('pointLocks')
            const keepQueue = localStorage.getItem(QUEUE_LS_KEY)

            localStorage.clear()

            if (keepQueue) localStorage.setItem(QUEUE_LS_KEY, keepQueue)
            if (keepUser) localStorage.setItem('currentUser', keepUser)
            if (keepDark) localStorage.setItem('darkMode', keepDark)
            if (keepMode) localStorage.setItem('searchMode', keepMode)
            if (keepFailed) localStorage.setItem(FAILED_LS_KEY, keepFailed)
            if (keepLocks) localStorage.setItem('pointLocks', keepLocks)

        } catch (e) {
            console.warn('[clear cache]', e)
        }

        setTimeout(() => location.reload(), 300)
    })
}