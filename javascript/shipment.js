// ============================================================
// shipment.js
//
// назначение
// этот файл отвечает за перемещение товаров со склада на точку.
//
// ответственность
// - открыть форму отгрузки по выбранной точке
// - загрузить складские остатки курьера
// - принять количества для каждой позиции
// - отправить расходную накладную в 1с
//
// сценарий работы
// 1. сотрудник открывает отгрузку из карточки точки
// 2. приложение загружает доступные товары со склада
// 3. сотрудник указывает количество по каждой позиции
// 4. приложение отправляет в 1с данные для накладной
//
// про ограничение количества
// ввести больше чем есть на складе нельзя
// на каждое изменение проверяется остаток позиции
//
// зависимости
// - globalData из script.js даёт список точек
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из script.js
// - setBtnLoading и resetBtn из script.js
// - isStubResponse и emptyStateHtml из script.js
// - qtyControlHtml из script.js
//
// порядок подключения
// index.html подключает shipment.js после script.js
// ============================================================

// ============================================================
// блок 1. состояние формы отгрузки
//
// переменные живут между открытием и закрытием окна.
// при закрытии окна значения сбрасываются в closeShipmentModal.
// ============================================================

// не допускает параллельную загрузку складских остатков
let shipmentLoading = false

// блокирует повторную отправку документа
let shipmentSending = false

// идентификатор выбранной точки или null
let shipmentPointId = null

// уникальный идентификатор защищает документ от повторного создания
let shipmentRequestId = null

// выбранные товары и их количества
// количество для позиции не может превышать складской остаток
let shipmentItems = []

// строка поиска в нижнем регистре для фильтрации списка
let shipmentSearchQuery = ''

// ============================================================
// блок 2. создание окна
//
// окно создаётся один раз и дальше переиспользуется.
// список позиций заполняется отдельно в renderShipmentBody.
// ============================================================

function ensureShipmentModal() {
    // используем существующее окно если оно уже создано
    let el = document.getElementById('shipmentOverlay')
    if (el) return el

    // создаём контейнер окна
    el = document.createElement('div')
    el.className = 'modal-overlay'
    el.id = 'shipmentOverlay'
    el.style.zIndex = '1005'

    // содержимое списка добавляется отдельно при открытии окна
    el.innerHTML = `
        <div class="modal-box assort-box">
            <div class="modal-header">
                <div class="assort-head">
                    <h3>Відвантаження на точку</h3>
                    <div class="assort-sub" id="shipmentSub"></div>
                </div>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>
            <div class="modal-body" id="shipmentBody"></div>
            <div class="modal-footer order-footer">
                <div class="order-summary" id="shipmentSummary"></div>
                <button class="action-btn btn-success" type="button" id="shipmentSendBtn" disabled>Відвантажити</button>
            </div>
        </div>
    `

    document.body.appendChild(el)

    // кнопка в заголовке закрывает окно
    el.querySelector('.modal-close').addEventListener('click', closeShipmentModal)

    // кнопка отправляет документ после проверки формы
    el.querySelector('#shipmentSendBtn').addEventListener('click', submitShipment)

    // нажатие вне окна закрывает форму
    el.addEventListener('click', (e) => {
        if (e.target === el) closeShipmentModal()
    })

    return el
}

// ============================================================
// блок 3. закрытие окна и очистка состояния
//
// во время отправки окно не закрывается.
// после закрытия сбрасываем данные текущей отгрузки.
// ============================================================

function closeShipmentModal() {
    // оставляем окно открытым пока сервер обрабатывает документ
    if (shipmentSending) return

    document.getElementById('shipmentOverlay')?.classList.remove('active')

    // очищаем данные предыдущей отгрузки
    shipmentPointId = null
    shipmentRequestId = null
    shipmentItems = []
    shipmentSearchQuery = ''

    // возвращаем фокус только если другое окно не перекрывает это
    if (typeof getTopModal === 'function' && !getTopModal() && typeof restoreFocus === 'function') {
        restoreFocus()
    }
}

// ============================================================
// блок 4. открытие формы и загрузка складских остатков
//
// порядок такой
// 1. ищем точку в общем списке
// 2. сбрасываем данные прошлой формы
// 3. показываем шапку и скелетон
// 4. грузим складские остатки курьера
// 5. нормализуем поля и рендерим список
//
// из 1с приходят поля Code, Name, price и quantity.
// quantity это доступное количество на складе.
// qty изначально ноль, курьер сам его увеличивает.
// ============================================================

async function openShipmentModal(pointId) {
    // находим точку в общем списке
    const point = globalData.find(i => String(i.id) === String(pointId))

    // не открываем форму без точки или во время другой загрузки
    if (!point || shipmentLoading) return

    // сохраняем текущий фокус для восстановления после закрытия
    rememberFocus()

    const overlay = ensureShipmentModal()
    const sub = document.getElementById('shipmentSub')
    const body = document.getElementById('shipmentBody')
    const summary = document.getElementById('shipmentSummary')
    const sendBtn = document.getElementById('shipmentSendBtn')

    // сбрасываем данные предыдущей формы и создаём ключ запроса
    shipmentPointId = point.id
    shipmentRequestId = newRequestId()
    shipmentItems = []
    shipmentSearchQuery = ''

    // показываем название и код точки
    sub.textContent = [point.point_name || 'Точка', `код ${point.id}`].join(' · ')

    // очищаем итог и блокируем отправку до загрузки данных
    summary.textContent = ''
    sendBtn.disabled = true

    // показываем скелетон пока грузятся данные
    body.innerHTML = `
        <div class="assort-loading">
            <div class="skeleton skeleton-text" style="width:60%;"></div>
            <div class="skeleton skeleton-text" style="width:80%;"></div>
            <div class="skeleton skeleton-text" style="width:50%;"></div>
        </div>
    `

    overlay.classList.add('active')
    shipmentLoading = true

    try {
        // запрашиваем список товаров у которых есть остаток на складе курьера
        // u это код сотрудника, t это метка времени для обхода кеша
        const u = currentUser ? encodeURIComponent(currentUser.id) : ''
        const res = await fetchWithTimeout(
            `${apiBase}/shipment?u=${u}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        )

        if (!res.ok) throw new Error('Помилка мережі')

        const data = await res.json()
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С')

        // заглушка от 1с, например склад не настроен
        if (isStubResponse(data)) {
            body.innerHTML = emptyStateHtml(data[0].Name, '36px 20px', 'alert')
            return
        }

        // нормализуем поля из 1с в единый формат
        // qty всегда начинается с нуля, это то что введёт курьер
        shipmentItems = data.map(it => ({
            code: String(it.Code || ''),
            name: String(it.Name || ''),
            price: Number(it.price) || 0,
            maxQty: Number(it.quantity) || 0,
            qty: 0
        }))

        // склад пустой, показываем пустое состояние
        if (!shipmentItems.length) {
            body.innerHTML = emptyStateHtml('На складі немає товарів', '36px 20px', 'box')
            return
        }

        // все ок, рисуем список
        renderShipmentBody()

    } catch (err) {
        const message = err && err.message ? err.message : String(err)
        body.innerHTML = `<div class="assort-error">Не вдалося завантажити товари: ${escapeHtml(message)}</div>`
    } finally {
        shipmentLoading = false
    }
}

// ============================================================
// блок 5. отрисовка тела модалки
//
// тело состоит из трёх частей.
// сверху поиск по названию и коду.
// посередине счётчик позиций и список строк.
// внизу заглушка если поиск ничего не нашёл.
//
// после отрисовки навешиваем обработчики через делегирование.
// клик по кнопкам плюс и минус, ручной ввод и уход из поля.
// ============================================================

function renderShipmentBody() {
    const body = document.getElementById('shipmentBody')
    if (!body) return

    body.innerHTML = `
        <div class="assort-top">
            <div class="assort-search-wrap">
                <input type="search" class="assort-search" id="shipmentSearch"
                    placeholder="Пошук товару за назвою або кодом"
                    autocomplete="off" value="${escapeHtml(shipmentSearchQuery)}">
            </div>
        </div>

        <div class="assort-panel">
            <div class="assort-pills" style="margin-top:0;">
                <span class="assort-pill" id="shipmentCounter">${shipmentItems.length} поз.</span>
            </div>
            <div id="shipmentGrid" class="assort-grid" style="margin-top:14px;">
                ${renderShipmentRows()}
            </div>
            <div id="shipmentNoMatch" class="empty-state" style="display:none; margin-top:14px;">
                Нічого не знайдено
            </div>
        </div>
    `

    // поиск по названию и коду
    const searchInput = document.getElementById('shipmentSearch')
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            shipmentSearchQuery = searchInput.value.trim().toLowerCase()
            applyShipmentSearch()
        })
    }

    const grid = document.getElementById('shipmentGrid')

    // клик по кнопкам минус и плюс
    // количество зажимается в диапазон от нуля до складского остатка
    grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn')
        if (!btn) return

        const row = btn.closest('[data-shipment-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!shipmentItems[idx]) return

        const step = Number(btn.dataset.step) || 0
        const maxQ = shipmentItems[idx].maxQty

        // считаем новое значение и зажимаем в диапазон
        let next = shipmentItems[idx].qty + step
        if (next < 0) next = 0
        if (next > maxQ) next = maxQ

        shipmentItems[idx].qty = next

        // синхронизируем инпут в этой же строке
        const inp = row.querySelector('.qty-input')
        if (inp) inp.value = next

        updateShipmentRow(row, idx)
        updateShipmentSummary()
    })

    // ручной ввод количества с клавиатуры
    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-shipment-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!shipmentItems[idx]) return

        // оставляем только цифры максимум шесть знаков
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)

        let val = Number(e.target.value) || 0
        const maxQ = shipmentItems[idx].maxQty
        if (val > maxQ) val = maxQ

        shipmentItems[idx].qty = val

        updateShipmentRow(row, idx)
        updateShipmentSummary()
    })

    // при уходе из поля возвращаем нормальное значение
    // если пользователь ввёл мусор он заменится на актуальное число
    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-shipment-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!shipmentItems[idx]) return

        e.target.value = shipmentItems[idx].qty
    })

    // первичная отрисовка сумм и подсветки по каждой строке
    document.querySelectorAll('#shipmentGrid [data-shipment-row]').forEach(row => {
        updateShipmentRow(row, Number(row.dataset.idx))
    })

    // применяем текущий поиск и считаем итог
    applyShipmentSearch()
    updateShipmentSummary()
}

// ============================================================
// блок 6. html для списка строк
//
// каждая строка это товар на складе.
// показываем название, цену, складской остаток
// и поле для ввода количества к отгрузке.
// ============================================================

function renderShipmentRows() {
    return shipmentItems.map((it, i) => `
        <div class="meter-input-group assort-row" data-shipment-row data-idx="${i}">
            <div class="assort-row-head">
                <strong class="assort-tile-name">${escapeHtml(it.name) || '—'}</strong>
                <span class="assort-row-price">Ціна: <strong>${fmt(it.price)} ₴</strong></span>
            </div>
            <div class="assort-row-fields">
                <div>
                    <label>На складі</label>
                    <div class="assort-field-static">${fmt(it.maxQty)}</div>
                </div>
                <div>
                    <label>Відвантажити</label>
                    ${qtyControlHtml({ value: 0, aria: 'Кількість' })}
                </div>
                <div>
                    <label>Сума</label>
                    <div class="assort-row-total">0 ₴</div>
                </div>
            </div>
        </div>
    `).join('')
}

// ============================================================
// блок 7. обновление одной строки
//
// считает сумму по строке как qty умножить на цену.
// подсвечивает строку если количество больше нуля.
// ============================================================

function updateShipmentRow(row, idx) {
    const it = shipmentItems[idx]
    if (!it) return

    // сумма это qty умножить на цену
    const totalEl = row.querySelector('.assort-row-total')
    if (totalEl) totalEl.textContent = `${fmt(it.qty * it.price)} ₴`

    // визуальная подсветка выбранных позиций
    row.classList.toggle('picked', it.qty > 0)
}

// ============================================================
// блок 8. итоги в подвале
//
// считает сколько позиций выбрано и на какую сумму.
// кнопка отправки активна только если выбрана хоть одна позиция.
// ============================================================

function updateShipmentSummary() {
    const summary = document.getElementById('shipmentSummary')
    const btn = document.getElementById('shipmentSendBtn')
    if (!summary || !btn) return

    let count = 0
    let sum = 0

    shipmentItems.forEach(it => {
        if (it.qty > 0) {
            count++
            sum += it.qty * it.price
        }
    })

    // ничего не выбрано, подсказываем и блокируем кнопку
    if (!count) {
        summary.textContent = 'Вкажіть кількість товарів для відвантаження'
        btn.disabled = true
        return
    }

    // есть позиции, показываем итог и включаем кнопку
    summary.innerHTML = `Відвантажуємо: <b>${count} поз.</b> на <b>${fmt(sum)} ₴</b>`
    btn.disabled = shipmentSending
}

// ============================================================
// блок 9. фильтрация списка по поиску
//
// ищем одновременно по названию и по коду.
// строки которые не подходят просто прячем.
// если ничего не подошло показываем заглушку.
// ============================================================

function applyShipmentSearch() {
    const q = shipmentSearchQuery
    let shown = 0

    document.querySelectorAll('#shipmentGrid [data-shipment-row]').forEach(row => {
        const idx = Number(row.dataset.idx)
        const it = shipmentItems[idx]
        if (!it) return

        // собираем строку для поиска из названия и кода
        const hay = (it.name + ' ' + it.code).toLowerCase()
        const ok = !q || hay.includes(q)

        row.style.display = ok ? '' : 'none'
        if (ok) shown++
    })

    // если ничего не нашли показываем заглушку
    const noMatch = document.getElementById('shipmentNoMatch')
    if (noMatch) noMatch.style.display = shown ? 'none' : 'block'
}

// ============================================================
// блок 10. отправка формы в 1с
//
// порядок такой
// 1. проверяем флаг отправки и наличие точки
// 2. собираем только позиции с количеством больше нуля
// 3. отсекаем отправку без сети
// 4. собираем payload с request_id
// 5. отправляем post на /shipment
// 6. проверяем поле conduct_error в ответе
//
// request_id защищает от дублей при обрыве связи.
// ============================================================

async function submitShipment() {
    // защита от двойного клика
    if (shipmentSending) return

    const pointId = shipmentPointId
    if (!pointId) return

    // собираем только позиции с количеством больше нуля
    const items = []
    shipmentItems.forEach(it => {
        if (it.qty > 0) {
            items.push({
                code: it.code,
                name: it.name,
                price: it.price,
                qty: it.qty
            })
        }
    })

    // нечего отправлять
    if (!items.length) {
        showToast('Додайте хоча б одну позицію', true)
        return
    }

    // отгрузка это онлайн операция, без сети нельзя
    if (!navigator.onLine) {
        showToast('Немає мережі! Відвантаження можна відправити лише онлайн.', true)
        return
    }

    // payload который ждёт 1с
    // request_id для защиты от дублей на стороне сервера
    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: shipmentRequestId || newRequestId(),
        items
    }

    const btn = document.getElementById('shipmentSendBtn')
    const closeBtn = document.querySelector('#shipmentOverlay .modal-close')

    // блокируем форму на время отправки
    shipmentSending = true
    if (closeBtn) closeBtn.disabled = true
    setBtnLoading(btn, 'Відправка...')

    let success = false
    let conductError = ''

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/shipment?v=${APP_CONFIG.apiVersion}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // код курьера уходит и в заголовке и в теле
                    // на всякий случай, 1с может проверить любой из них
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

        // 1с может ответить 200 но с полем conduct_error
        // это значит что документ записался но не провёлся
        let body = null
        try { body = await res.json() } catch (e) {}

        const raw = (body && body.conduct_error != null) ? String(body.conduct_error) : ''

        // пустое поле или слеш считаются успехом
        conductError = isBlankServerError(raw) ? '' : raw

        success = true

    } catch (err) {
        const message = err && err.message ? err.message : String(err)

        // отделяем сетевые ошибки от ошибок сервера
        // для курьера формулировки разные
        const msg = (message.includes('Failed to fetch') || message.toLowerCase().includes('timeout'))
            ? '1С не відповідає. Відвантаження не відправлено.'
            : `Не вдалося відвантажити: ${message}`

        showToast(msg, true)

    } finally {
        shipmentSending = false
        if (closeBtn) closeBtn.disabled = false
        resetBtn(btn, 'Відвантажити')

        if (success) {
            // если 1с вернула ошибку проведения показываем отдельно
            // документ уже создан, но в учёт не пошёл
            if (conductError) {
                console.error('[1С] відвантаження не проведено:', conductError)
                showToast('Документ створено, але НЕ ПРОВЕДЕНО: ' + conductError.slice(0, 150), true)
            } else {
                showSuccessAnimation()
                showToast('Відвантаження створено в 1С')
            }

            // чистим состояние и закрываем модалку
            shipmentItems = []
            shipmentPointId = null
            closeShipmentModal()

            // тихо обновляем данные точек, чтобы везде подтянулись свежие
            loadData({ silent: true })
        } else {
            // отправка не прошла, оставляем форму как есть
            // пересчитываем итог, на случай если кнопка подвисла в loading
            updateShipmentSummary()
        }
    }
}