// ============================================================
// javascript/features/payment.js
//
// назначение
// этот файл отвечает за форму оплаты долга.
//
// ответственность
// - открыть модалку с текущим долгом точки
// - проверить сумму перед отправкой
// - отправить пко в 1с
// - локально уменьшить долг не дожидаясь загрузки
//
// зависимости
// - core/state.js дает globalData, currentPaymentPointId, currentPaymentRequestId
// - core/utils.js дает fmt и isBlankServerError
// - core/api.js дает postJson, newRequestId
// - core/storage.js дает localDB
// - core/locks.js дает invalidateLockSnapshot
// - ui/toast.js дает showToast, showSuccessAnimation
// - ui/focus.js дает rememberFocus, restoreFocus, getTopModal
// - features/meter.js дает setBtnLoading, resetBtn, clearPaymentFlowState, refreshResults
// - но refreshResults объявлен в features/search.js
// - app/load.js дает loadData
// ============================================================


// ============================================================
// блок 1. открытие модалки оплаты
// ============================================================

function openPaymentModal(pointId) {
    const item = globalData.find(i => String(i.id) === String(pointId))
    if (!item) return

    rememberFocus()
    currentPaymentPointId = item.id
    currentPaymentRequestId = newRequestId()

    const debt = Number(item.debt) || 0

    document.getElementById('paymentPointName').textContent = item.point_name || 'Без назви'

    const debtEl = document.getElementById('paymentCurrentDebt')
    debtEl.textContent = `${fmt(debt)} ₴`
    debtEl.className = debt > 0 ? 'debt-value red' : 'debt-value green'

    // по умолчанию подставляем весь долг
    const input = document.getElementById('paymentAmount')
    input.value = debt > 0 ? debt : ''
    input.max = debt > 0 ? debt : ''

    document.getElementById('paymentError').style.display = 'none'
    document.querySelector('#paymentOverlay .btn-success').disabled = false
    document.getElementById('paymentOverlay').classList.add('active')

    // на десктопе сразу фокус и выделяем сумму
    if (window.matchMedia('(pointer: fine)').matches) {
        setTimeout(() => {
            input.focus()
            input.select()
        }, 100)
    }
}

function closePaymentModal() {
    document.getElementById('paymentOverlay')?.classList.remove('active')
    clearPaymentFlowState()
    if (!getTopModal()) restoreFocus()
}


// ============================================================
// блок 2. отправка оплаты в 1с
//
// три проверки перед отправкой
// сумма больше нуля
// сумма не больше текущего долга
// сеть доступна
//
// после ответа разбираем conduct_error
// 1с может провести пко но не провести погашение долга
// ============================================================

async function submitPayment() {
    const pointId = currentPaymentPointId
    const item = globalData.find(i => String(i.id) === String(pointId))
    if (!item) { closePaymentModal(); return }

    const input = document.getElementById('paymentAmount')
    const errorBox = document.getElementById('paymentError')
    const amount = Number(input.value)
    const currentDebt = Number(item.debt) || 0

    // валидация
    if (!amount || amount <= 0) {
        errorBox.textContent = 'Сума має бути більше нуля'
        errorBox.style.display = 'block'
        return
    }
    if (amount > currentDebt) {
        errorBox.textContent = `Сума не може перевищувати поточний борг (${fmt(currentDebt)} ₴)`
        errorBox.style.display = 'block'
        return
    }
    if (!navigator.onLine) {
        errorBox.textContent = 'Немає мережі! Оплату можна провести тільки онлайн.'
        errorBox.style.display = 'block'
        return
    }

    const btn = document.querySelector('#paymentOverlay .btn-success')
    const cancelBtn = document.querySelector('#paymentOverlay .btn-secondary')
    if (cancelBtn) cancelBtn.disabled = true

    setBtnLoading(btn, 'Відправка...')
    errorBox.style.display = 'none'

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        amount,
        request_id: currentPaymentRequestId || newRequestId()
    }

    try {
        const response = await postJson('payment', payload)

        if (!response.ok) {
            const errText = await response.text()
            throw new Error((errText && errText.slice(0, 150)) || 'Помилка сервера 1С')
        }

        let body = null
        try { body = await response.json(); } catch (e) {}

        invalidateLockSnapshot()

        // 1с может провести пко но не провести погашение
        const rawConduct = (body && body.conduct_error != null) ? String(body.conduct_error) : ''
        const conductError = isBlankServerError(rawConduct) ? '' : rawConduct

        if (conductError) {
            console.error('[1С] помилка проведення ПКО:', conductError)
            showToast('Оплата створена, але НЕ ПРОВЕДЕНА: ' + conductError.slice(0, 150), true)
        } else {
            showSuccessAnimation()
            showToast(`Оплата ${fmt(amount)} ₴ успішно проведена!`)
        }

        closePaymentModal()

        if (!conductError) refreshAfterSubmit(pointId, -amount)
        else refreshResults()

    } catch (error) {
        const msg = error && error.message ? error.message : String(error)

        if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('timeout')) {
            errorBox.textContent = '1С не відповідає. Перевірте інтернет і спробуйте знову.'
        } else {
            errorBox.textContent = `Не вдалося провести: ${msg}`
        }

        errorBox.style.display = 'block'

    } finally {
        resetBtn(btn, 'Провести оплату')
        if (cancelBtn) cancelBtn.disabled = false
    }
}


// ============================================================
// блок 3. локальное изменение долга
//
// уменьшаем или увеличиваем долг в общем массиве и в кеше.
// используется чтобы обновить карточку не дожидаясь сети
// ============================================================

async function applyDebtDelta(pointId, delta) {
    if (!delta) return

    const item = globalData.find(i => String(i.id) === String(pointId))
    if (!item) return

    item.debt = Math.max(0, (Number(item.debt) || 0) + delta)

    try { await localDB.save('cachedNomenclature', globalData) }
    catch (e) { console.warn('не зберегли кеш боргу', e) }
}


// ============================================================
// блок 4. обновление после успешной отправки
//
// сразу перерисовываем карточки.
// через полсекунды тихо тянем свежие данные с сервера
// чтобы точно совпадало с 1с
// ============================================================

function refreshAfterSubmit(pointId, debtDelta) {
    if (debtDelta && pointId) applyDebtDelta(pointId, debtDelta)
    refreshResults()
    setTimeout(() => loadData({ silent: true }), 600)
}