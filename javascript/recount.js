// ============================================================
// recount.js
//
// назначение
// этот файл отвечает за перерасчёт фактических остатков.
//
// ответственность
// - открыть форму перерасчёта по точке
// - загрузить учётные количества и цены из 1с
// - принять от курьера фактические остатки
// - посчитать отклонения по каждой позиции
// - отправить документ перерасчёта в 1с
//
// сценарий работы
// 1. сотрудник открывает перерасчёт из карточки точки
// 2. приложение загружает товары и их учётные количества
// 3. сотрудник вводит фактические остатки
// 4. приложение отправляет в 1с разницу между фактом и учётом
//
// про знак отклонения
// положительное отклонение значит излишек
// отрицательное отклонение значит недостача
//
// зависимости
// - globalData из script.js даёт список точек
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из script.js
// - setBtnLoading и resetBtn из script.js
// - isStubResponse и emptyStateHtml из script.js
// - qtyControlHtml из script.js
//
// порядок подключения
// index.html подключает recount.js после script.js
// ============================================================

// ============================================================
// блок 1. состояние формы перерасчёта
//
// переменные живут между открытием и закрытием окна.
// при закрытии окна значения сбрасываются в closeRecountModal.
// ============================================================

// не допускает параллельную загрузку списка товаров
let recountLoading = false

// блокирует повторную отправку документа
let recountSending = false

// товары формы с учётным и фактическим количеством
// фактическое изначально равно учётному
let recountItems = []

// идентификатор точки для которой открыта форма
let recountPointId = null

// уникальный идентификатор защищает документ от повторного создания
let recountRequestId = null

// ============================================================
// блок 2. создание окна
//
// окно создаётся один раз и дальше переиспользуется.
// тело формы заполняется отдельно в renderRecountBody.
// ============================================================

function ensureRecountModal() {
    // используем существующее окно если оно уже создано
    let el = document.getElementById('recountOverlay')
    if (el) return el

    el = document.createElement('div')
    el.className = 'modal-overlay'
    el.id = 'recountOverlay'
    el.style.zIndex = '1005'

    // в теле пока пусто, оно заполняется в renderRecountBody
    el.innerHTML = `
        <div class="modal-box assort-box">
            <div class="modal-header">
                <div class="assort-head">
                    <h3>Перерахунок</h3>
                    <div class="assort-sub" id="recountSub"></div>
                </div>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>
            <div class="modal-body" id="recountBody"></div>
            <div class="modal-footer order-footer">
                <div class="order-summary" id="recountSummary"></div>
                <button class="action-btn btn-success" type="button" id="recountSendBtn" disabled>Відправити в 1С</button>
            </div>
        </div>
    `

    document.body.appendChild(el)

    // кнопка крестика закрывает окно
    el.querySelector('.modal-close').addEventListener('click', closeRecountModal)
    // кнопка в футере отправляет документ
    el.querySelector('#recountSendBtn').addEventListener('click', submitRecount)

    // нажатие вне окна закрывает форму
    el.addEventListener('click', (e) => {
        if (e.target === el) closeRecountModal()
    })

    return el
}

// ============================================================
// блок 3. закрытие окна и очистка состояния
//
// во время отправки окно не закрывается.
// после закрытия сбрасываем данные текущего перерасчёта.
// ============================================================

function closeRecountModal() {
    // оставляем окно открытым пока сервер обрабатывает документ
    if (recountSending) return

    document.getElementById('recountOverlay')?.classList.remove('active')

    // очищаем данные текущего перерасчёта
    recountPointId = null
    recountRequestId = null
    recountItems = []

    // возвращаем фокус только если другое окно не перекрывает это
    if (typeof getTopModal === 'function' && !getTopModal() && typeof restoreFocus === 'function') {
        restoreFocus()
    }
}

// ============================================================
// блок 4. открытие формы и загрузка учётных остатков
//
// порядок такой
// 1. ищем точку в общем списке
// 2. сбрасываем данные прошлой формы
// 3. показываем шапку и скелетон
// 4. грузим учётные количества с сервера
// 5. нормализуем поля и рендерим список
//
// из 1с приходят поля Code, Name, price и book.
// в book лежит учётное количество.
// фактическое actual изначально равно book.
// ============================================================

async function openRecountModal(pointId) {
    // находим точку в общем списке
    const point = globalData.find(i => String(i.id) === String(pointId))

    // не открываем форму без точки или во время другой загрузки
    if (!point || recountLoading) return

    rememberFocus()

    const overlay = ensureRecountModal()
    const sub = document.getElementById('recountSub')
    const body = document.getElementById('recountBody')
    const summary = document.getElementById('recountSummary')
    const sendBtn = document.getElementById('recountSendBtn')

    // сбрасываем данные предыдущей формы и создаём ключ запроса
    recountPointId = point.id
    recountRequestId = newRequestId()
    recountItems = []

    // показываем точку и установленное оборудование
    const subParts = [point.point_name || 'Точка', `код ${point.id}`]
    if (point.coffee_machine) {
        subParts.push(point.coffee_machine + (point.coffee_machine_code ? ` (${point.coffee_machine_code})` : ''))
    }
    sub.textContent = subParts.join(' · ')

    // очищаем итог и блокируем отправку до загрузки данных
    summary.textContent = ''
    sendBtn.disabled = true

    // показываем состояние загрузки
    body.innerHTML = `
        <div class="assort-loading">
            <div class="skeleton skeleton-text" style="width:60%;"></div>
            <div class="skeleton skeleton-text" style="width:80%;"></div>
            <div class="skeleton skeleton-text" style="width:50%;"></div>
        </div>
    `

    overlay.classList.add('active')
    recountLoading = true

    try {
        // запрашиваем учётные остатки и цены по точке
        const res = await fetchWithTimeout(
            `${apiBase}/recount?point=${encodeURIComponent(point.id)}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        )

        if (!res.ok) throw new Error('Помилка мережі')

        const data = await res.json()
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С')

        // заглушка от 1с, например нет остатков или точка не настроена
        if (isStubResponse(data)) {
            body.innerHTML = emptyStateHtml(data[0].Name, '36px 20px', 'alert')
            return
        }

        // нормализуем поля из 1с
        // actual изначально равен book, курьер меняет только если реально другое
        recountItems = data.map(it => ({
            Code: String(it.Code || ''),
            Name: String(it.Name || ''),
            price: Number(it.price) || 0,
            book: Number(it.book) || 0,
            actual: Number(it.book) || 0
        }))

        // сервер вернул пустой массив, значит нечего пересчитывать
        if (!recountItems.length) {
            body.innerHTML = emptyStateHtml('Немає позицій для перерахунку', '36px 20px', 'box')
            return
        }

        // все ок, рисуем список
        renderRecountBody()

    } catch (err) {
        const message = err && err.message ? err.message : String(err)
        body.innerHTML = `<div class="assort-error">Не вдалося завантажити перерахунок: ${escapeHtml(message)}</div>`
    } finally {
        recountLoading = false
    }
}

// ============================================================
// блок 5. отрисовка тела модалки
//
// тело состоит из трёх частей.
// первое это пилюля со счётчиком позиций.
// второе это легенда что значит плюс и минус.
// третье это список строк с учётным и фактическим количеством.
//
// после отрисовки навешиваем обработчики через делегирование.
// клик по кнопкам плюс и минус, ручной ввод и уход из поля.
// ============================================================

function renderRecountBody() {
    const body = document.getElementById('recountBody')

    body.innerHTML = `
        <div class="assort-panel">
            <div class="assort-pills" style="margin-top:0;">
                <span class="assort-pill">${recountItems.length} поз.</span>
            </div>

            <div class="recount-legend">
                <span class="rl rl-pos">+ надлишок</span>
                <span class="rl rl-neg">− недостача</span>
            </div>

            <div id="recountGrid" class="assort-grid" style="margin-top:14px;">
                ${recountItems.map((it, i) => {
                    return `
                        <div class="meter-input-group assort-row" data-recount-row data-idx="${i}">
                            <div class="assort-row-head">
                                <strong class="assort-tile-name">${escapeHtml(it.Name) || '—'}</strong>
                                <span class="assort-row-price">Ціна: <strong>${fmt(it.price)} ₴</strong></span>
                            </div>
                            <div class="assort-row-fields">
                                <div>
                                    <label>Облікове</label>
                                    <div class="assort-field-static">${fmt(it.book)}</div>
                                </div>
                                <div>
                                    <label>Фактичне</label>
                                    ${qtyControlHtml({ value: it.actual, aria: 'Фактичне' })}
                                </div>
                                <div>
                                    <label>Відхилення</label>
                                    <div class="recount-deviation zero">0 шт · 0 ₴</div>
                                </div>
                            </div>
                        </div>
                    `
                }).join('')}
            </div>
        </div>
    `

    const grid = document.getElementById('recountGrid')

    // клик по кнопкам минус и плюс
    // фактическое не может уйти ниже нуля
    grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn')
        if (!btn) return

        const row = btn.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        const step = Number(btn.dataset.step) || 0
        recountItems[idx].actual = Math.max(0, recountItems[idx].actual + step)

        // синхронизируем инпут в этой же строке
        const inp = row.querySelector('.qty-input')
        if (inp) inp.value = recountItems[idx].actual

        updateRecountRow(row, idx)
        updateRecountSummary()
    })

    // ручной ввод количества с клавиатуры
    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        // только цифры, не больше шести знаков
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
        recountItems[idx].actual = Number(e.target.value) || 0

        updateRecountRow(row, idx)
        updateRecountSummary()
    })

    // при уходе из поля возвращаем актуальное значение
    // если пользователь ввёл пустоту или мусор оно заменится на число
    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        e.target.value = recountItems[idx].actual
    })

    // первичная отрисовка отклонений и подсветки
    document.querySelectorAll('#recountGrid [data-recount-row]').forEach(row => {
        updateRecountRow(row, Number(row.dataset.idx))
    })

    updateRecountSummary()
}

// ============================================================
// блок 6. обновление одной строки
//
// считает отклонение как разницу между фактом и учётом.
// плашка отклонения меняет цвет по знаку.
// плюс это зелёный, минус это красный, ноль это нейтральный.
// ============================================================

function updateRecountRow(row, idx) {
    const it = recountItems[idx]
    if (!it) return

    // отклонение это разница между фактом и учётом
    const deviation = it.actual - it.book
    const sumDeviation = deviation * it.price

    const devEl = row.querySelector('.recount-deviation')
    if (devEl) {
        // три состояния, плюс, минус и ноль
        let cls = 'recount-deviation'
        if (deviation > 0) cls += ' positive'
        else if (deviation < 0) cls += ' negative'
        else cls += ' zero'

        const sign = deviation > 0 ? '+' : ''
        devEl.className = cls
        devEl.textContent = `${sign}${fmt(deviation)} шт · ${sign}${fmt(sumDeviation)} ₴`
    }

    // подсвечиваем строку если есть отклонение
    row.classList.toggle('picked', deviation !== 0)
}

// ============================================================
// блок 7. итоги в подвале
//
// считает сумму всех отклонений в штуках и деньгах.
// кнопка отправки активна только если есть хоть одно отклонение.
// ============================================================

function updateRecountSummary() {
    const summary = document.getElementById('recountSummary')
    const btn = document.getElementById('recountSendBtn')
    if (!summary || !btn) return

    let totalQty = 0
    let totalSum = 0

    recountItems.forEach(it => {
        const dev = it.actual - it.book
        totalQty += dev
        totalSum += dev * it.price
    })

    const signQty = totalQty > 0 ? '+' : ''
    const signSum = totalSum > 0 ? '+' : ''

    summary.innerHTML = `Разом: <b>${signQty}${fmt(totalQty)} шт</b> на <b>${signSum}${fmt(totalSum)} ₴</b>`

    // если отклонений нет отправлять нечего
    btn.disabled = recountSending || totalQty === 0
}

// ============================================================
// блок 8. отправка перерасчёта в 1с
//
// порядок такой
// 1. проверяем флаг отправки и наличие точки
// 2. считаем суммарное отклонение
// 3. отсекаем отправку без сети
// 4. собираем payload со всеми позициями
// 5. отправляем post на /recount
// 6. проверяем поле conduct_error в ответе
//
// в 1с отправляем все позиции, даже с нулевым отклонением.
// сервер сам решит что писать в документ.
//
// request_id защищает от дублей при обрыве связи.
// ============================================================

async function submitRecount() {
    // защита от двойного клика
    if (recountSending) return

    const pointId = recountPointId
    if (!pointId) return

    // суммарное отклонение, если ноль то и отправлять нечего
    let totalQty = 0
    recountItems.forEach(it => { totalQty += (it.actual - it.book) })

    if (!totalQty) {
        showToast('Немає відхилень — нічого відправляти', true)
        return
    }

    // перерасчёт только онлайн
    if (!navigator.onLine) {
        showToast('Немає мережі! Перерахунок можна відправити лише онлайн.', true)
        return
    }

    // в 1с отправляем все позиции
    const items = recountItems.map(it => ({
        code: it.Code,
        name: it.Name,
        price: it.price,
        book: it.book,
        actual: it.actual
    }))

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        // id для защиты от дублей
        request_id: recountRequestId || newRequestId(),
        items
    }

    const btn = document.getElementById('recountSendBtn')
    const closeBtn = document.querySelector('#recountOverlay .modal-close')

    // блокируем форму на время отправки
    recountSending = true
    if (closeBtn) closeBtn.disabled = true
    setBtnLoading(btn, 'Відправка...')

    let success = false
    let conductError = ''

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/recount?v=${APP_CONFIG.apiVersion}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // код курьера и в заголовке и в теле
                    'X-User-Code': currentUser ? currentUser.id : ''
                },
                body: JSON.stringify(payload)
            },
            APP_CONFIG.sendTimeoutMs
        )

        if (!res.ok) {
            const errText = await res.text()
            throw new Error((errText && errText.slice(0, 200)) || 'Помилка сервера 1С')
        }

        let body = null
        try { body = await res.json() } catch (e) {}

        // 1с может ответить 200 но с полем conduct_error
        // значит документ записался, но не провёлся
        const raw = (body && body.conduct_error != null) ? String(body.conduct_error) : ''

        // пустое поле или слеш считаем успехом
        conductError = isBlankServerError(raw) ? '' : raw

        success = true

    } catch (err) {
        const message = err && err.message ? err.message : String(err)

        // отделяем сетевые ошибки от ошибок сервера
        const msg = (message.includes('Failed to fetch') || message.toLowerCase().includes('timeout'))
            ? '1С не відповідає. Перерахунок не відправлено.'
            : `Не вдалося відправити: ${message}`

        showToast(msg, true)

    } finally {
        recountSending = false
        if (closeBtn) closeBtn.disabled = false
        resetBtn(btn, 'Відправити в 1С')

        if (success) {
            // если 1с вернула ошибку проведения показываем её отдельно
            if (conductError) {
                console.error('[1С] перерахунок не проведено:', conductError)
                showToast('Документ створено, але НЕ ПРОВЕДЕНО: ' + conductError.slice(0, 150), true)
            } else {
                showSuccessAnimation()
                showToast('Перерахунок відправлено в 1С')
            }

            // чистим состояние и закрываем модалку
            recountItems = []
            recountPointId = null
            closeRecountModal()

            // тихо тянем свежие остатки
            loadData({ silent: true })
        } else {
            // отправка не прошла, оставляем форму как есть
            // пересчитываем итог чтобы кнопка не залипла в loading
            updateRecountSummary()
        }
    }
}