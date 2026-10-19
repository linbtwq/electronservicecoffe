// ============================================================
// javascript/features/meter.js
//
// назначение
// этот файл отвечает за форму показаний счетчиков.
//
// ответственность
// - открыть модалку с ассортиментом точки
// - посчитать сумму по каждой строке
// - не дать ввести значение меньше предыдущего
// - показать окно подтверждения
// - отправить документ в 1с
// - при ошибке сети положить в офлайн-очередь
//
// зависимости
// - core/state.js дает globalData, currentPointId, currentMeterRequestId, _meterErrors, AUTO_LOGOUT_AFTER_SUBMIT
// - core/utils.js дает fmt и escapeHtml
// - core/api.js дает newRequestId, postJson
// - core/locks.js дает isMeterBlocked, lockPoint, invalidateLockSnapshot
// - ui/icons.js дает emptyStateHtml
// - ui/toast.js дает showToast, showSuccessAnimation
// - ui/focus.js дает rememberFocus, restoreFocus, getTopModal, autofocusModal
// - app/sync.js дает saveOffline
// - app/load.js дает loadData
// ============================================================


// ============================================================
// блок 1. открытие модалки показаний
//
// порядок такой
// 1. найти точку в общем списке
// 2. проверить что она еще не заблокирована
// 3. запомнить фокус и сбросить ошибки
// 4. создать новый request_id
// 5. собрать строку на каждый напиток
// 6. показать окно и поставить фокус
// ============================================================

function openMeterModal(pointId) {
    const item = globalData.find(i => String(i.id) === String(pointId))
    if (!item) return

    // если точка уже закрыта, не открываем
    if (isMeterBlocked(item)) {
        showToast('По цій точці показники вже зняті. Зміни — через 1С.', true)
        return
    }

    rememberFocus()
    _meterErrors.clear()
    currentPointId = item.id
    currentMeterRequestId = newRequestId()

    // заполняем подзаголовок
    const modalSub = document.getElementById('modalSub')
    if (modalSub) {
        const subParts = [item.point_name || 'Точка', `код ${item.id}`]
        if (item.coffee_machine) {
            subParts.push(item.coffee_machine + (item.coffee_machine_code ? ` (${item.coffee_machine_code})` : ''))
        }
        modalSub.textContent = subParts.join(' · ')
    }

    let bodyHtml

    if (item.assortment && item.assortment.length > 0) {
        // считаем ценовой диапазон
        const prices = item.assortment.map(d => Number(d.price) || 0)
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        const priceText = min === max ? `${fmt(min)} ₴` : `${fmt(min)}–${fmt(max)} ₴`

        // общий счетчик показываем только если включен в настройках оборудования
        const sumLast = item.assortment.reduce((s, d) => s + (Number(d.last_meter) || 0), 0)
        const serverTotal = item.total_counter == null ? NaN : Number(item.total_counter)
        const totalBase = Number.isFinite(serverTotal) ? serverTotal : sumLast

        const totalPill = item.use_total_counter === true
            ? `<span class="assort-pill total">Загальний лічильник
                   <b id="totalCounterValue" data-base="${totalBase}">${fmt(totalBase)}</b>
                   <span class="pill-delta" id="totalCounterDelta"></span>
               </span>`
            : ''

        // строка на каждый напиток
        const rowsHtml = item.assortment.map(drink => {
            const price = Number(drink.price) || 0
            const lastMeter = Number(drink.last_meter) || 0

            return `
                <div class="meter-input-group assort-row" data-drink-row data-code="${escapeHtml(drink.code || '')}">
                    <div class="assort-row-head">
                        <strong class="assort-tile-name drink-name">${escapeHtml(drink.name) || 'Без назви'}</strong>
                        <span class="assort-row-price">Ціна: <strong>${fmt(price)} ₴</strong></span>
                    </div>
                    <div class="assort-row-fields">
                        <div>
                            <label>Було</label>
                            <div class="assort-field-static">${fmt(lastMeter)}</div>
                        </div>
                        <div>
                            <label>Новий</label>
                            <div class="qty">
                                <button type="button" class="qty-btn" data-step="-1" aria-label="Менше">−</button>
                                <input type="text" inputmode="numeric" pattern="[0-9]*"
                                       class="meter-input qty-input"
                                       value="${lastMeter}"
                                       data-price="${price}"
                                       data-last="${lastMeter}">
                                <button type="button" class="qty-btn" data-step="1" aria-label="Більше">+</button>
                            </div>
                        </div>
                        <div>
                            <label>Разом</label>
                            <div class="row-total assort-row-total">0 ₴</div>
                        </div>
                    </div>
                </div>
            `
        }).join('')

        bodyHtml = `
            <div class="assort-panel">
                <div class="assort-pills">
                    ${totalPill}
                    <span class="assort-pill">${item.assortment.length} поз.</span>
                    <span class="assort-pill price">${priceText}</span>
                </div>
                <div class="assort-grid">${rowsHtml}</div>
            </div>
        `
    } else {
        bodyHtml = `<div class="empty-state" style="padding: 20px;">Для обладнання асортимент не заповнений в 1С.</div>`
    }

    document.getElementById('modalBody').innerHTML = bodyHtml
    document.getElementById('modalOverlay').classList.add('active')

    // кнопка продолжить активна только если есть ассортимент
    const hasAssortment = Array.isArray(item.assortment) && item.assortment.length > 0
    const proceedBtn = document.querySelector('#modalOverlay .modal-footer .action-btn')
    if (proceedBtn) proceedBtn.disabled = !hasAssortment

    // пересчет по всем строкам при первом показе
    document.querySelectorAll('#modalBody [data-drink-row] .meter-input')
        .forEach(inp => calculateRowTotal(inp))

    autofocusModal(document.getElementById('modalOverlay'))
}


// ============================================================
// блок 2. пересчет строки показаний
//
// новое значение не может быть меньше предыдущего.
// если меньше, подсвечиваем поле и блокируем кнопку продолжить.
// ============================================================

function calculateRowTotal(input) {
    const row = input.closest('[data-drink-row]')
    const lastMeter = Number(input.getAttribute('data-last')) || 0
    const price = Number(input.getAttribute('data-price')) || 0
    const raw = input.value.trim()
    const isBlank = raw === ''
    const newVal = isBlank ? 0 : Number(raw) || 0

    // добавляем подсказку об ошибке если ее нет
    let errorHint = row.querySelector('.error-hint')
    if (!errorHint) {
        errorHint = document.createElement('div')
        errorHint.className = 'error-hint'
        errorHint.textContent = 'Менше попереднього!'
        const wrap = input.closest('.assort-row-fields > div') || input.parentNode
        wrap.appendChild(errorHint)
    }

    const totalEl = row.querySelector('.row-total')
    const hasError = !isBlank && newVal < lastMeter

    if (hasError) {
        input.classList.add('error')
        errorHint.classList.add('show')
        totalEl.textContent = '0 ₴'
        totalEl.classList.remove('has-sum')
    } else {
        input.classList.remove('error')
        errorHint.classList.remove('show')

        const delta = newVal - lastMeter
        const totalSum = delta > 0 ? delta * price : 0
        totalEl.textContent = `${fmt(totalSum)} ₴`
        totalEl.classList.toggle('has-sum', totalSum > 0)
    }

    if (hasError) _meterErrors.add(input)
    else _meterErrors.delete(input)

    // кнопка продолжить блокируется если есть ошибки
    const proceedBtn = document.querySelector('#modalOverlay .modal-footer .action-btn')
    if (proceedBtn) proceedBtn.disabled = _meterErrors.size > 0

    updateTotalCounter()
}


// ============================================================
// блок 3. общий счетчик в шапке
//
// показывается только если оборудование поддерживает общий счетчик.
// суммирует все приросты по строкам
// ============================================================

function updateTotalCounter() {
    const valueEl = document.getElementById('totalCounterValue')
    if (!valueEl) return

    const base = Number(valueEl.dataset.base) || 0
    let added = 0

    document.querySelectorAll('#modalBody [data-drink-row] .meter-input').forEach(inp => {
        const last = Number(inp.getAttribute('data-last')) || 0
        const val = Number(inp.value.trim()) || 0
        if (val > last) added += val - last
    })

    valueEl.textContent = fmt(base + added)

    const deltaEl = document.getElementById('totalCounterDelta')
    if (deltaEl) deltaEl.textContent = added > 0 ? `+${fmt(added)}` : ''
}


// ============================================================
// блок 4. сброс состояния показаний и оплаты
// ============================================================

function clearMeterFlowState() {
    currentPointId = null
    currentMeterRequestId = null
}

function clearPaymentFlowState() {
    currentPaymentPointId = null
    currentPaymentRequestId = null
}


// ============================================================
// блок 5. окно подтверждения
//
// считает итог по всем строкам и показывает его пользователю
// ============================================================

function showConfirmModal() {
    const rows = document.querySelectorAll('#modalBody [data-drink-row]')
    let totalCups = 0
    let totalMoney = 0

    rows.forEach(row => {
        const price = Number(row.querySelector('.meter-input').getAttribute('data-price')) || 0
        const value = Number(row.querySelector('.meter-input').value) || 0
        const lastMeter = Number(row.querySelector('.meter-input').getAttribute('data-last')) || 0
        const delta = value - lastMeter

        if (delta > 0) {
            totalCups += delta
            totalMoney += delta * price
        }
    })

    document.getElementById('confirmTotalCups').textContent = `${fmt(totalCups)} шт`
    document.getElementById('confirmTotalMoney').textContent = `${fmt(totalMoney)} ₴`
    document.getElementById('confirmOverlay').classList.add('active')

    autofocusModal(document.getElementById('confirmOverlay'))
}

function closeConfirmModal() {
    document.getElementById('confirmOverlay').classList.remove('active')
    if (!getTopModal()) restoreFocus()
}

function closeModal() {
    document.getElementById('modalOverlay')?.classList.remove('active')
    _meterErrors.clear()
    clearMeterFlowState()
    if (!getTopModal()) restoreFocus()
}


// ============================================================
// блок 6. отправка показаний в 1с
//
// порядок такой
// 1. найти точку и проверить что она еще не заблокирована
// 2. собрать метры из строк формы
// 3. если сети нет положить в офлайн-очередь
// 4. отправить post на /meters
// 5. разобрать ответ, 409 значит точку уже кто-то сдал
// 6. при успехе заблокировать точку и обновить данные
//
// request_id защищает от дублей при обрыве связи
// ============================================================

async function submitMeters() {
    const pointId = currentPointId
    const currentItem = globalData.find(i => String(i.id) === String(pointId))

    // еще раз проверяем что точку не заблокировали пока открыта модалка
    if (currentItem && isMeterBlocked(currentItem)) {
        showToast('По цій точці показники вже зняті. Зміни — через 1С.', true)
        finishSubmission({ logout: false })
        return
    }

    const rows = document.querySelectorAll('#modalBody [data-drink-row]')
    const metersData = []
    let sessionTotal = 0

    rows.forEach(row => {
        const nameEl = row.querySelector('.drink-name')
        const name = nameEl ? nameEl.textContent.trim() : ''
        const code = row.dataset.code || ''
        const meterInput = row.querySelector('.meter-input')
        if (!meterInput) return

        const price = Number(meterInput.getAttribute('data-price')) || 0
        const value = Number(meterInput.value) || 0
        const lastMeter = Number(meterInput.getAttribute('data-last')) || 0
        const delta = value - lastMeter

        if (code || name) {
            const itemTotal = delta > 0 ? delta * price : 0
            sessionTotal += itemTotal

            metersData.push({
                code, name, price, value,
                delta: delta > 0 ? delta : 0,
                total: itemTotal
            })
        }
    })

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: currentMeterRequestId || newRequestId(),
        meters: metersData
    }

    const confirmBtn = document.querySelector('#confirmOverlay .btn-success')
    if (!confirmBtn) return

    setBtnLoading(confirmBtn, 'Відправка...')

    // офлайн, кладем в очередь
    if (!navigator.onLine) {
        saveOffline(payload)
        finishSubmission()
        refreshResults()
        resetBtn(confirmBtn, 'Відправити в 1С')
        return
    }

    try {
        const response = await postJson('meters', payload)

        // 409 значит точку уже кто-то сдал
        if (response.status === 409) {
            lockPoint(pointId)
            invalidateLockSnapshot()
            showToast('По цій точці показники вже внесені. Для змін телефонуйте в 1С.', true)
            finishSubmission()
            refreshResults()
            return
        }

        if (!response.ok) {
            const errText = await response.text()
            throw new Error((errText && errText.slice(0, 200)) || 'Помилка сервера 1С')
        }

        let body = null
        try { body = await response.json(); } catch (e) {}

        // явная ошибка от 1с
        if (body && body.ok === false) {
            showToast(body.error || body.debt_error || '1С відхилила документ.', true)
            return
        }

        lockPoint(pointId)
        invalidateLockSnapshot()

        // отдельно показываем что долг не начислился
        const hasDebtError = body && body.debt_error

        if (hasDebtError) {
            console.error('[1С] борг не нарахований:', body.debt_error)
            showToast('Документ створено, але БОРГ НЕ НАРАХОВАНО: ' + String(body.debt_error).slice(0, 150), true)
        } else {
            showSuccessAnimation()
            showToast('Документ в 1С успішно створено!')
        }

        finishSubmission()

        if (!hasDebtError) refreshAfterSubmit(pointId, sessionTotal)
        else refreshResults()

    } catch (error) {
        const msg = error && error.message ? error.message : String(error)

        // сетевая ошибка, кладем в очередь
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
            saveOffline(payload)
            finishSubmission()
            refreshResults()
        } else {
            showToast(`Помилка: ${msg}`, true)
        }

    } finally {
        resetBtn(confirmBtn, 'Відправити в 1С')
    }
}


// ============================================================
// блок 7. завершение отправки
//
// закрывает обе модалки и по настройке выходит из системы
// ============================================================

function finishSubmission({ logout: doLogout = AUTO_LOGOUT_AFTER_SUBMIT } = {}) {
    closeConfirmModal()
    closeModal()
    clearMeterFlowState()
    clearPaymentFlowState()

    if (doLogout && typeof logout === 'function') {
        setTimeout(() => logout(), 1800)
    }
}


// ============================================================
// блок 8. управление состоянием кнопки
//
// loading это заблокированная кнопка с текстом.
// reset возвращает исходный текст из dataset
// ============================================================

function setBtnLoading(btn, text) {
    if (!btn) return

    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent.trim()

    btn.disabled = true
    btn.textContent = text
    btn.classList.add('btn-loading')
}

function resetBtn(btn, text) {
    if (!btn) return

    btn.disabled = false
    btn.textContent = text || btn.dataset.originalText || 'OK'
    btn.classList.remove('btn-loading')
}