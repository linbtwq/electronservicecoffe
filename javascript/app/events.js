// ============================================================
// javascript/app/events.js
//
// назначение
// этот файл навешивает все обработчики событий интерфейса.
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
    initPullToRefresh()
}

function initSearchClear() {
    const searchInput = document.getElementById('searchInput')
    const clearBtn = document.getElementById('searchClear')
    if (!searchInput || !clearBtn) return

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

function scheduleStatusLoop() {
    if (statusTimer) clearInterval(statusTimer)

    statusTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && currentUser) renderStatus()
    }, 15000)
}

function onResultsClick(event) {
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

function onResultsKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.target.closest('.machine-expand')) return

    const trigger = event.target.closest('[data-action="machines"]')
    if (!trigger) return

    event.preventDefault()
    toggleMachineExpand(trigger.dataset.id)
}

function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return

    if (readQueue().length) syncOfflineMeters({ quiet: true })

    if (currentUser && Date.now() - lastLoadedAt > APP_CONFIG.refreshAfterMinutes * 60 * 1000) {
        loadData({ silent: true })
    }

    renderStatus()
}

function handleOnlineStatus() {
    retryAttempt = 0
    syncOfflineMeters()
    if (currentUser) loadData({ silent: true })
}

function handleGlobalClick(event) {
    const el = event.target
    if (!el.classList || !el.classList.contains('modal-overlay')) return

    if (el.id === MODAL_IDS.overlay) closeModal()
    else if (el.id === MODAL_IDS.confirmOverlay) closeConfirmModal()
    else if (el.id === MODAL_IDS.paymentOverlay) closePaymentModal()
}

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

// ============================================================
// PULL TO REFRESH
// ============================================================
function initPullToRefresh() {
    const container = document.getElementById('resultsContainer');
    const spinner = document.getElementById('ptrSpinner');
    if (!container || !spinner) return;

    let touchStartY = 0;
    let touchCurrentY = 0;
    const threshold = 70; // пикселей для срабатывания
    let isPulling = false;
    let isRefreshing = false;

    container.addEventListener('touchstart', (e) => {
        // Срабатывает только если список прокручен в самый верх
        if (container.scrollTop <= 0 && !isRefreshing) {
            touchStartY = e.touches[0].clientY;
            touchCurrentY = touchStartY;
            isPulling = true;
            spinner.style.transition = 'none'; 
        } else {
            isPulling = false;
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!isPulling) return;

        touchCurrentY = e.touches[0].clientY;
        const deltaY = touchCurrentY - touchStartY;

        if (deltaY > 0) {
            // ВАЖНО: Блокируем нативный баунс страницы, чтобы он не мешал спиннеру
            if (e.cancelable) e.preventDefault();

            const distance = Math.min(deltaY * 0.5, 100); 
            spinner.style.transform = `translateX(-50%) translateY(${distance}px)`;
            spinner.style.opacity = Math.min(distance / threshold, 1);
        } else {
            // Свайп вверх - отменяем pull-to-refresh, чтобы не мешать прокрутке
            isPulling = false;
            spinner.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
            spinner.style.transform = `translateX(-50%) translateY(-40px)`;
            spinner.style.opacity = '0';
        }
    }, { passive: false }); // <--- ОБЯЗАТЕЛЬНО false

    container.addEventListener('touchend', async () => {
        spinner.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        
        if (!isPulling) return;
        isPulling = false;

        const deltaY = touchCurrentY - touchStartY;
        
        if (deltaY > threshold) {
            isRefreshing = true;
            spinner.classList.add('spinning');
            spinner.style.transform = `translateX(-50%) translateY(10px)`;
            spinner.style.opacity = '1';
            
            if (navigator.vibrate) navigator.vibrate(20);

            if (typeof manualRefresh === 'function') {
                await manualRefresh();
            }

            spinner.classList.remove('spinning');
            spinner.style.transform = `translateX(-50%) translateY(-40px)`;
            spinner.style.opacity = '0';
            isRefreshing = false;
        } else {
            spinner.style.transform = `translateX(-50%) translateY(-40px)`;
            spinner.style.opacity = '0';
        }
    }, { passive: true });
}