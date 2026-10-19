// ============================================================
// javascript/app/events.js
//
// назначение
// этот файл навешивает все обработчики событий интерфейса.
//
// ответственность
// - связать поле поиска и контейнер результатов с обработчиками
// - слушать сетевые события online и offline
// - следить за видимостью вкладки
// - направлять клики по карточкам в нужные модули
// - поддерживать клавиатурное управление раскрытым блоком
// - обновлять индикатор связи по таймеру
// - обрабатывать кнопки количества в форме показаний
//
// зависимости
// - core/state.js дает MODAL_IDS, statusTimer, retryAttempt
// - core/queue.js дает readQueue
// - ui/status.js дает setConnectionStatus, renderStatus
// - ui/backToTop.js дает initBackToTop
// - ui/modalDrag.js дает initModalDrag
// - features/search.js дает handleSearch
// - features/cards.js дает appendCards
// - features/meter.js дает openMeterModal, calculateRowTotal
// - features/payment.js дает openPaymentModal
// - features/stock.js дает openStockModal
// - app/load.js дает loadData
// - app/sync.js дает syncOfflineMeters, scheduleSyncRetry
// - app/clearCache.js дает initClearCacheButton
// - app/refresh.js дает manualRefresh
// - ui/theme.js дает initTheme
// - app/init.js дает showVersion
// - openAssortModal дает assortments.js
// - openShipmentModal дает shipment.js
// - openRecountModal дает recount.js
// - openNoteModal дает notes.js
// - toggleMachineExpand дает machines.js
// - initSearchFilters дает search.js
// - onKeyDown дает focus.js
// ============================================================


// ============================================================
// блок 1. основная инициализация
//
// вызывается один раз при запуске приложения.
// ============================================================

function initEventListeners() {
    const searchInput = document.getElementById('searchInput')
    if (searchInput) searchInput.addEventListener('input', handleSearch)

    const results = document.getElementById('resultsContainer')
    if (results) {
        results.addEventListener('click', onResultsClick)
        results.addEventListener('keydown', onResultsKeydown)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const statusBox = document.getElementById('connectionStatus')
    if (statusBox) statusBox.addEventListener('click', manualRefresh)

    window.addEventListener('online', handleOnlineStatus)
    window.addEventListener('offline', () => setConnectionStatus(false))
    window.addEventListener('click', handleGlobalClick)
    document.addEventListener('keydown', onKeyDown)

    scheduleStatusLoop()
    setupMeterButtons()
    initBackToTop()
    initSearchClear()
    initModalDrag()
    renderStatus()
    scheduleSyncRetry()
    initClearCacheButton()
}


// ============================================================
// блок 2. кнопка очистки поля поиска
//
// показываем только при непустом запросе
// ============================================================

function initSearchClear() {
    const searchInput = document.getElementById('searchInput')
    const clearBtn = document.getElementById('searchClear')
    if (!searchInput || !clearBtn) return

    // синхронизирует видимость кнопки с содержимым поля
    const sync = () => { clearBtn.hidden = !searchInput.value }

    searchInput.addEventListener('input', sync)

    clearBtn.addEventListener('click', () => {
        searchInput.value = ''
        sync()
        handleSearch({ target: searchInput })
        if (window.matchMedia('(pointer: fine)').matches) searchInput.focus()
    })

    sync()
}


// ============================================================
// блок 3. периодический пересчет статуса связи
//
// раз в пятнадцать секунд, только если вкладка видима
// и пользователь авторизован
// ============================================================

function scheduleStatusLoop() {
    if (statusTimer) clearInterval(statusTimer)

    statusTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && currentUser) renderStatus()
    }, 15000)
}


// ============================================================
// блок 4. клики по карточкам
//
// смотрим на data-action у ближайшей кнопки.
// события раскрытого блока остатков не перехватываем
// ============================================================

function onResultsClick(event) {
    // оставляем события раскрытого списка его собственному обработчику
    if (event.target.closest('.machine-expand')) return

    const btn = event.target.closest('[data-action]')
    if (!btn) return

    const { action, id } = btn.dataset
    const results = document.getElementById('resultsContainer')

    if (action === 'open') openMeterModal(id)
    else if (action === 'more') appendCards(results, false)
    else if (action === 'pay') openPaymentModal(id)
    else if (action === 'assort') openAssortModal(id)
    else if (action === 'stock') openStockModal(id)
    else if (action === 'machines') toggleMachineExpand(id)
    else if (action === 'shipment') openShipmentModal(id)
    else if (action === 'recount') openRecountModal(id)
    else if (action === 'note') openNoteModal(id)
}


// ============================================================
// блок 5. клавиатурное управление раскрытым блоком остатков
//
// enter или пробел на элементе с data-action=machines
// переключают раскрытие блока
// ============================================================

function onResultsKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.target.closest('.machine-expand')) return

    const trigger = event.target.closest('[data-action="machines"]')
    if (!trigger) return

    event.preventDefault()
    toggleMachineExpand(trigger.dataset.id)
}


// ============================================================
// блок 6. возврат на вкладку
//
// синхронизируем очередь если есть.
// перезагружаем данные если они устарели.
// пересчитываем статус.
// ============================================================

function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return

    if (readQueue().length) syncOfflineMeters({ quiet: true })

    if (currentUser && Date.now() - lastLoadedAt > APP_CONFIG.refreshAfterMinutes * 60 * 1000) {
        loadData({ silent: true })
    }

    renderStatus()
}


// ============================================================
// блок 7. восстановление сети
// ============================================================

function handleOnlineStatus() {
    retryAttempt = 0
    syncOfflineMeters()
    if (currentUser) loadData({ silent: true })
}


// ============================================================
// блок 8. закрытие основных модалок кликом по затемнению
//
// остальные модалки закрываются своими модулями
// ============================================================

function handleGlobalClick(event) {
    const el = event.target
    if (!el.classList || !el.classList.contains('modal-overlay')) return

    if (el.id === MODAL_IDS.overlay) closeModal()
    else if (el.id === MODAL_IDS.confirmOverlay) closeConfirmModal()
    else if (el.id === MODAL_IDS.paymentOverlay) closePaymentModal()
}


// ============================================================
// блок 9. кнопки количества в форме показаний
//
// клик по плюсу и минусу меняет значение в поле.
// ввод с клавиатуры фильтруется по цифрам.
// после каждого изменения пересчитывается сумма по строке
// ============================================================

function setupMeterButtons() {
    const container = document.getElementById('modalBody')
    if (!container) return

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.qty-btn')
        if (!btn) return

        const row = btn.closest('[data-drink-row]')
        if (!row) return

        const input = row.querySelector('.meter-input')
        if (!input) return

        const step = Number(btn.dataset.step) || 0
        const current = Number(input.value) || 0
        input.value = Math.max(0, current + step)
        calculateRowTotal(input)
    })

    container.addEventListener('input', (e) => {
        if (!e.target.classList.contains('meter-input')) return
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 7)
        calculateRowTotal(e.target)
    })
}