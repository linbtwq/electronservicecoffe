// ============================================================
// javascript/ui/focus.js
//
// назначение
// этот файл отвечает за фокус и работу с клавиатурой.
//
// ответственность
// - искать верхнюю модалку по z-index
// - закрывать верхнюю модалку по escape
// - помнить и возвращать фокус
// - держать tab внутри активной модалки
// - обрабатывать глобальные горячие клавиши
// - ставить фокус в первое поле при открытии модалки
//
// зависимости
// - core/state.js дает searchMode и searchTimer
// - features/search.js дает handleSearch
// - app/refresh.js дает manualRefresh
// - ui/dialog.js дает _isFormField
// - features/meter.js дает closeModal, closeConfirmModal
// - closeStockModal, closeShipmentModal, closeRecountModal, closeNoteModal, closeAssortModal, closeOrderConfirmModal
// - features/payment.js дает closePaymentModal
// ============================================================


// ============================================================
// блок 1. список селекторов для обхода по tab
// ============================================================

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'


// ============================================================
// блок 2. определение верхней модалки
//
// идем по всем активным оверлеям и берем тот у которого z-index больше
// ============================================================

function getTopModal() {
    const modals = document.querySelectorAll('.modal-overlay.active')
    if (!modals.length) return null

    let top = null
    let topZ = -Infinity

    for (const m of modals) {
        const rawZ = getComputedStyle(m).zIndex
        const z = Number(rawZ)
        const zz = Number.isFinite(z) ? z : 1000
        if (zz > topZ) { topZ = zz; top = m }
    }
    return top
}


// ============================================================
// блок 3. закрытие верхней модалки
//
// каждая модалка знает как себя закрыть по своему id
// ============================================================

function closeTopModal() {
    const m = getTopModal()
    if (!m) return

    if (m.id === 'modalOverlay') closeModal()
    else if (m.id === 'confirmOverlay') closeConfirmModal()
    else if (m.id === 'paymentOverlay') closePaymentModal()
    else if (m.id === 'assortOverlay') closeAssortModal()
    else if (m.id === 'orderConfirmOverlay') closeOrderConfirmModal()
    else if (m.id === 'stockOverlay') closeStockModal()
    else if (m.id === 'shipmentOverlay') closeShipmentModal()
    else if (m.id === 'recountOverlay') closeRecountModal()
    else if (m.id === 'noteOverlay') closeNoteModal()
}


// ============================================================
// блок 4. запоминание и возврат фокуса
// ============================================================

let _focusBeforeModal = null

// запоминает что было в фокусе до открытия модалки
function rememberFocus() {
    _focusBeforeModal = document.activeElement
}

// возвращает фокус назад после закрытия
function restoreFocus() {
    if (_focusBeforeModal && document.contains(_focusBeforeModal)) {
        try { _focusBeforeModal.focus() } catch (e) {}
    }
    _focusBeforeModal = null
}


// ============================================================
// блок 5. удержание tab внутри модалки
//
// если фокус на первом элементе и нажат shift tab перекидываем на последний
// если фокус на последнем и нажат tab перекидываем на первый
// ============================================================

function trapFocus(e) {
    if (e.key !== 'Tab') return

    const modal = getTopModal()
    if (!modal) return

    const box = modal.querySelector('.modal-box')
    if (!box) return

    const focusables = Array.from(box.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null)
    if (!focusables.length) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
    }
}


// ============================================================
// блок 6. глобальные горячие клавиши
//
// escape закрывает верхнюю модалку или чистит поиск
// слэш или ctrl k ставит фокус в поиск
// r запускает ручное обновление
// ============================================================

function onKeyDown(e) {
    const inField = _isFormField(document.activeElement)

    // escape закрывает модалку или чистит поиск
    if (e.key === 'Escape') {
        if (getTopModal()) { e.preventDefault(); closeTopModal(); return }

        const si = document.getElementById('searchInput')
        if (inField && si && si.value) {
            e.preventDefault()
            si.value = ''
            handleSearch({ target: si })
            return
        }
    }

    if (inField) { trapFocus(e); return }

    // слэш или ctrl k фокусирует поиск
    if (e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        document.getElementById('searchInput')?.focus()
        return
    }

    // r обновляет данные
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        manualRefresh()
        return
    }

    trapFocus(e)
}


// ============================================================
// блок 7. автфокус в модалке
//
// на тач устройствах фокусируем первую кнопку
// чтобы не поднимать экранную клавиатуру
//
// на устройствах с мышью фокусируем первое поле ввода
// ============================================================

function autofocusModal(modal) {
    if (!modal) return

    const box = modal.querySelector('.modal-box')
    if (!box) return

    // на тач фокус на первую кнопку
    if (window.matchMedia('(pointer: coarse)').matches) {
        const firstButton = Array.from(box.querySelectorAll('button:not([disabled])'))
            .find(el => el.offsetParent !== null)
        if (firstButton) firstButton.focus()
        return
    }

    // иначе первое поле ввода
    const inputs = Array.from(box.querySelectorAll(
        'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])'
    )).filter(el => el.offsetParent !== null)

    if (inputs.length) {
        const firstInput = inputs[0]
        try {
            firstInput.focus()
            if (typeof firstInput.select === 'function') firstInput.select()
        } catch (e) {}
        return
    }

    const focusables = Array.from(box.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null)
    if (focusables.length) focusables[0].focus()
}