// ============================================================
// recount.js
//
// назначение
// этот файл отвечает за перерасчет фактических остатков.
//
// ответственность
// - открыть форму перерасчета по точке
// - загрузить учетные количества и цены из 1с
// - принять от курьера фактические остатки
// - посчитать отклонения по каждой позиции
// - отправить документ перерасчета в 1с
//
// сценарий работы
// 1. сотрудник открывает перерасчет из карточки точки
// 2. приложение загружает товары и их учетные количества
// 3. сотрудник вводит фактические остатки
// 4. приложение отправляет в 1с разницу между фактом и учетом
//
// про знак отклонения
// положительное отклонение значит излишек
// отрицательное отклонение значит недостача
//
// зависимости
// - globalData из core/state.js дает список точек
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из core/api.js
// - setBtnLoading и resetBtn из features/meter.js
// - isStubResponse и emptyStateHtml из ui/icons.js
// - qtyControlHtml из ui/icons.js
//
// порядок подключения
// index.html подключает recount.js после после app-модулей
// ============================================================

// ============================================================
// блок 1. состояние формы перерасчета
//
// переменные живут между открытием и закрытием окна.
// при закрытии окна значения сбрасываются в closeRecountModal.
// ============================================================

// не допускает параллельную загрузку списка товаров
let recountLoading = false

// блокирует повторную отправку документа
let recountSending = false

// товары формы с учетным и фактическим количеством
// фактическое изначально равно учетному
let recountItems = []

// идентификатор точки для которой открыта форма
let recountPointId = null

// уникальный идентификатор защищает документ от повторного создания
let recountRequestId = null

// ============================================================
// блок 2. создание окна
//
// окно создается один раз и дальше переиспользуется.
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
// после закрытия сбрасываем данные текущего перерасчета.
// ============================================================

function closeRecountModal() {
    // оставляем окно открытым пока сервер обрабатывает документ
    if (recountSending) return

    document.getElementById('recountOverlay')?.classList.remove('active')

    // очищаем данные текущего перерасчета
    recountPointId = null
    recountRequestId = null
    recountItems = []

    // возвращаем фокус только если другое окно не перекрывает это
    if (typeof getTopModal === 'function' && !getTopModal() && typeof restoreFocus === 'function') {
        restoreFocus()
    }
}

// ============================================================
// блок 4. открытие формы и загрузка учетных остатков
//
// порядок такой
// 1. ищем точку в общем списке
// 2. сбрасываем данные прошлой формы
// 3. показываем шапку и скелетон
// 4. грузим учетные количества с сервера
// 5. нормализуем поля и рендерим список
//
// из 1с приходят поля Code, Name, price и book.
// в book лежит учетное количество.
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

    // сбрасываем данные предыдущей формы и создаем ключ запроса
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
        // запрашиваем учетные остатки и цены по точке
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
// тело состоит из трех частей.
// первое это пилюля со счетчиком позиций.
// второе это легенда что значит плюс и минус.
// третье это список строк с учетным и фактическим количеством.
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
                    // если число дробное (есть остаток от деления на 1), шаг 0.01. Иначе 1.
                    const step = Number(it.book) % 1 !== 0 ? 0.01 : 1;
                    
                    return renderProductRow({
                        idx: i,
                        code: it.Code,
                        name: it.Name,
                        price: it.price,
                        showHeadPrice: true,
                        dataAttr: 'data-recount-row',
                        col1: { label: 'Облікове', value: fmt(it.book), isStatic: true },
                        col2: { label: 'Фактичне', isInput: true, inputValue: it.actual, step: step },
                        col3: { label: 'Відхилення', value: '0 шт · 0 ₴', isStatic: true, className: 'recount-deviation zero' }
                    });
                }).join('')}
            </div>
        </div>
    `

    const grid = document.getElementById('recountGrid')

        grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn')
        if (!btn) return

        const row = btn.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        const step = Number(btn.dataset.step) || 0
        
        // убрали Math.max(0, ...). добавили округление до 3 знаков после запятой.
        const newValue = recountItems[idx].actual + step;
        recountItems[idx].actual = Math.round(newValue * 1000) / 1000;

        const inp = row.querySelector('.qty-input')
        if (inp) inp.value = recountItems[idx].actual

        updateRecountRow(row, idx)
        updateRecountSummary()
    })

    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        // разрешаем вводить минус и точку (для дробных остатков)
        let val = e.target.value.replace(/[^\d.-]/g, '');
        
        // Оставляем только один минус в самом начале
        if (val.includes('-')) {
            val = '-' + val.replace(/-/g, '');
        }
        
        e.target.value = val.slice(0, 7);
        recountItems[idx].actual = Number(val) || 0;

        updateRecountRow(row, idx)
        updateRecountSummary()
    })

    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return

        const row = e.target.closest('[data-recount-row]')
        if (!row) return

        const idx = Number(row.dataset.idx)
        if (!recountItems[idx]) return

        e.target.value = recountItems[idx].actual
    })

    document.querySelectorAll('#recountGrid [data-recount-row]').forEach(row => {
        updateRecountRow(row, Number(row.dataset.idx))
    })

    updateRecountSummary()
}

// ============================================================
// блок 6. обновление одной строки
//
// считает отклонение как разницу между фактом и учетом.
// плашка отклонения меняет цвет по знаку.
// плюс это зеленый, минус это красный, ноль это нейтральный.
// ============================================================

function updateRecountRow(row, idx) {
    const it = recountItems[idx]
    if (!it) return

    // отклонение это разница между фактом и учетом
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
// блок 8. отправка перерасчета в 1с
// ============================================================

async function submitRecount() {
    if (recountSending) return;
    const pointId = recountPointId;
    if (!pointId) return;

    let totalQty = 0;
    recountItems.forEach(it => { totalQty += (it.actual - it.book) });
    if (!totalQty) {
        showToast('Немає відхилень — нічого відправляти', true);
        return;
    }

    if (!navigator.onLine) {
        showToast('Немає мережі! Перерахунок можна відправити лише онлайн.', true);
        return;
    }

    const items = recountItems.map(it => ({
        code: it.Code, name: it.Name, price: it.price, book: it.book, actual: it.actual
    }));

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: recountRequestId || newRequestId(),
        items
    };

    const btn = document.getElementById('recountSendBtn');
    const closeBtn = document.querySelector('#recountOverlay .modal-close');

    recountSending = true;

    await submitDocument({
        endpoint: 'recount',
        payload,
        btn,
        closeBtn,
        loadingText: 'Відправка...',
        successText: 'Перерахунок відправлено в 1С',
        errorPrefix: 'Не вдалося відправити',
        onSuccess: () => {
            // сначала флаг, потом close
            recountSending = false;
            recountItems = [];
            recountPointId = null;
            closeRecountModal();
        }
    });

    recountSending = false;
    if (recountPointId) updateRecountSummary();
}