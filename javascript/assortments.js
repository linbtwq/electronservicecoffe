// ============================================================
// assortments.js
//
// назначение
// этот файл отвечает за просмотр ассортимента и заказ пополнения точки.
//
// ответственность
// - загрузить список товаров для точки
// - дать пользователю собрать заказ
// - посчитать итоги заказа
// - отправить документ заказа в 1с
//
// особенности
// если сети нет, показываем сохранённый ассортимент из indexedDB.
// заказывать в офлайне нельзя, кнопка отправки появится только онлайн.
//
// зависимости
// - globalData из script.js даёт точки
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из script.js
// - setBtnLoading и resetBtn из script.js
// - isStubResponse и emptyStateHtml из script.js
// - qtyControlHtml из script.js
// - localDB из script.js для кеша ассортимента
//
// порядок подключения
// index.html подключает assortments.js после script.js
// ============================================================

// флаги и объект состояния текущего заказа
let assortLoading = false;
let orderSending = false;

// текущий заказ пользователя
// pointId это точка
// qty это словарь код на количество
// items это словарь код на название и цену
// requestId защищает от дублей на сервере
// canOrder показывает разрешён ли заказ
const order = {
    pointId: null,
    qty: {},
    items: {},
    requestId: null,
    canOrder: false
};

// сброс заказа в начальное состояние
function resetOrder() {
    order.pointId = null;
    order.qty = {};
    order.items = {};
    order.requestId = null;
    order.canOrder = false;
}

// ============================================================
// блок 1. создание окна ассортимента
//
// окно создаётся один раз.
// тело заполняется отдельно в renderAssortBody.
// футер по умолчанию скрыт, показывается только если заказ разрешён.
// ============================================================

function ensureAssortModal() {
    let el = document.getElementById('assortOverlay');

    if (el) return el;

    el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'assortOverlay';
    el.style.zIndex = '1005';

    el.innerHTML = `
        <div class="modal-box assort-box">
            <div class="modal-header">
                <div class="assort-head">
                    <h3>Асортимент</h3>
                    <div class="assort-sub" id="assortSub"></div>
                </div>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>

            <div class="modal-body" id="assortBody"></div>

            <div class="modal-footer order-footer">
                <div class="order-summary" id="orderSummary" style="display:none;"></div>
                <button class="action-btn btn-success" type="button" id="orderSendBtn" style="display:none;" disabled>Замовити</button>
            </div>
        </div>
    `;

    document.body.appendChild(el);

    // кнопка крестика закрывает окно
    el.querySelector('.modal-close').addEventListener('click', closeAssortModal);
    // кнопка заказа открывает окно подтверждения
    el.querySelector('#orderSendBtn').addEventListener('click', showOrderConfirm);
    // нажатие вне окна закрывает форму
    el.addEventListener('click', (e) => {
        if (e.target === el) closeAssortModal();
    });

    return el;
}

// ============================================================
// блок 2. загрузка ассортимента
//
// сначала пробуем сеть.
// если сети нет достаём сохранённый ассортимент из indexedDB.
// если и там пусто бросаем ошибку.
// ============================================================

async function loadPointAssortment(pointId) {
    // ключ под которым кешируется ассортимент точки
    const key = `assortment_${pointId}`;

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/assortments?point=${encodeURIComponent(pointId)}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        );

        if (!res.ok) throw new Error('Помилка мережі');

        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С');

        // кладём в кеш на будущее
        try { await localDB.save(key, data); } catch (e) {}

        return { data, offline: false };
    } catch (err) {
        // сеть не ответила, пробуем кеш
        try {
            const cached = await localDB.load(key);
            if (Array.isArray(cached)) {
                return { data: cached, offline: true };
            }
        } catch (e) {}

        throw err;
    }
}

// ============================================================
// блок 3. расчёт итогов заказа
//
// считает количество позиций и общую сумму.
// используется в подвале окна и в окне подтверждения.
// ============================================================

function orderTotals() {
    let count = 0;
    let sum = 0;

    for (const code in order.qty) {
        const q = order.qty[code];
        if (!q) continue;
        const price = (order.items[code] && Number(order.items[code].price)) || 0;
        count++;
        sum += q * price;
    }

    return { count, sum };
}

// ============================================================
// блок 4. обновление подвала окна
//
// подвал показывается только если заказ разрешён.
// если позиции не выбраны, кнопка отправки заблокирована.
// ============================================================

function updateOrderBar() {
    const summary = document.getElementById('orderSummary');
    const btn = document.getElementById('orderSendBtn');

    if (!summary || !btn) return;

    // в офлайне заказывать нельзя, подвал скрыт
    if (!order.canOrder) {
        summary.style.display = 'none';
        btn.style.display = 'none';
        return;
    }

    const { count, sum } = orderTotals();

    summary.style.display = 'block';
    btn.style.display = '';

    summary.innerHTML = count
        ? `У замовленні: <b>${count} поз.</b> на <b>${fmt(sum)} ₴</b>`
        : 'Виберіть кількість потрібних позицій';

    btn.disabled = orderSending || count === 0;
}

// ============================================================
// блок 5. установка количества по позиции
//
// код это код товара.
// значение обрезается до диапазона от нуля до 9999.
// при нуле запись удаляется из словаря заказа.
//
// syncInput нужен чтобы отличить клик по кнопке от ручного ввода.
// при клике инпут нужно обновить, при вводе нет.
// ============================================================

function setQty(code, value, tile, syncInput) {
    const q = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));

    if (q) {
        order.qty[code] = q;
    } else {
        delete order.qty[code];
    }

    // сбрасываем requestId потому что состав заказа изменился
    order.requestId = null;
    tile.classList.toggle('picked', q > 0);

    // обновляем инпут если это клик по кнопке
    if (syncInput) {
        const inp = tile.querySelector('.qty-input');
        if (inp) inp.value = q;
    }

    // пересчитываем сумму по строке
    const totalEl = tile.querySelector('.assort-row-total');
    if (totalEl) {
        const price = Number(tile.dataset.price) || 0;
        totalEl.textContent = `${fmt(q * price)} ₴`;
    }

    updateOrderBar();
}

// ============================================================
// блок 6. отправка заказа в 1с
//
// порядок такой
// 1. проверяем флаги и наличие позиций
// 2. отсекаем отправку без сети
// 3. собираем payload с request_id
// 4. блокируем форму и показываем загрузку
// 5. отправляем post на /orders
// 6. проверяем поле conduct_error в ответе
// ============================================================

async function submitOrder() {
    // защита от двойного клика или от отправки пустого заказа
    if (orderSending || !order.canOrder) return;

    const { count, sum } = orderTotals();
    if (!count) return;

    // заказ только онлайн
    if (!navigator.onLine) {
        showToast('Немає мережі! Замовлення можна відправити лише онлайн.', true);
        return;
    }

    // сохраняем точку до сброса формы
    const pointId = order.pointId;

    // собираем позиции из словаря
    const items = Object.keys(order.qty).map(code => ({
        code,
        name: order.items[code].name,
        qty: order.qty[code],
        price: order.items[code].price
    }));

    // request_id либо уже созданный либо новый
    order.requestId = order.requestId || newRequestId();

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: order.requestId,
        total: sum,
        items
    };

    const btn = document.getElementById('orderSendBtn');
    const closeBtn = document.querySelector('#assortOverlay .modal-close');

    // блокируем форму на время отправки
    orderSending = true;
    if (closeBtn) closeBtn.disabled = true;
    setBtnLoading(btn, 'Відправка...');

    let success = false;
    let finalSum = sum;
    let conductError = '';

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/orders?v=${APP_CONFIG.apiVersion}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // код курьера уходит и в заголовке и в теле
                    'X-User-Code': currentUser ? currentUser.id : ''
                },
                body: JSON.stringify(payload)
            },
            APP_CONFIG.sendTimeoutMs
        );

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText.slice(0, 150) || 'Помилка сервера 1С');
        }

        let body = null;
        try { body = await res.json(); } catch (e) {}

        // 1с может ответить 200 но с полем conduct_error
        // это значит что документ создан но не проведён
        if (body && body.conduct_error != null) {
            const raw = String(body.conduct_error);
            if (!isBlankServerError(raw)) conductError = raw;
        }

        success = true;
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        const msg = (message.includes('Failed to fetch') || message.toLowerCase().includes('timeout'))
            ? '1С не відповідає. Замовлення не відправлено, спробуйте ще раз.'
            : `Не вдалося відправити замовлення: ${message}`;
        showToast(msg, true);
    } finally {
        orderSending = false;
        if (closeBtn) closeBtn.disabled = false;
        resetBtn(btn, 'Замовити');

        if (success) {
            // отдельно сообщаем если документ не проведён
            if (conductError) {
                console.error('[1С] замовлення не проведено:', conductError);
                showToast('Замовлення створено, але НЕ ПРОВЕДЕНО: ' + conductError.slice(0, 150), true);
            } else {
                showSuccessAnimation();
                showToast(`Замовлення відправлено: ${count} поз. на ${fmt(finalSum)} ₴`);
            }

            // чистим состояние и закрываем окна
            resetOrder();
            document.getElementById('orderConfirmOverlay')?.classList.remove('active');
            closeAssortModal();

            // тихо тянем свежие данные
            loadData({ silent: true });
        } else {
            // отправка не прошла, оставляем форму как есть
            updateOrderBar();
        }
    }
}

// ============================================================
// блок 7. отрисовка тела модалки
//
// первое это пилюля с количеством позиций и диапазоном цен.
// второе это информационная плашка если офлайн.
// третье это список строк с ценами и контролом количества.
//
// после отрисовки вешаем поиск и обработчики на строки.
// ============================================================

function renderAssortBody(data, offline) {
    const body = document.getElementById('assortBody');

    // по умолчанию заказ запрещён
    order.canOrder = false;

    // заглушка от 1с
    if (isStubResponse(data)) {
        body.innerHTML = emptyStateHtml(data[0].Name);
        updateOrderBar();
        return;
    }

    if (!data.length) {
        body.innerHTML = emptyStateHtml('Асортимент порожній');
        updateOrderBar();
        return;
    }

    // заказ разрешён только онлайн
    order.canOrder = !offline;
    order.items = {};

    // сохраняем справочник товаров в состоянии заказа
    data.forEach(it => {
        const code = String(it.Code);
        order.items[code] = {
            name: String(it.Name || ''),
            price: Number(it.price) || 0
        };
    });

    // считаем диапазон цен для пилюли
    const prices = data.map(i => Number(i.price) || 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    const priceText = min === max
        ? `${fmt(min)} ₴`
        : `${fmt(min)}–${fmt(max)} ₴`;

    // поиск показываем только если позиций много
    const showSearch = data.length > 8;

    body.innerHTML = `
        ${
            showSearch
                ? `
                    <div class="assort-top">
                        <div class="assort-search-wrap">
                            <input
                                type="search"
                                class="assort-search"
                                id="assortSearch"
                                placeholder="Пошук напою"
                                autocomplete="off"
                            >
                        </div>
                    </div>
                `
                : ''
        }

        ${
            offline
                ? `
                    <div class="assort-offline">
                        Офлайн. Показані збережені дані.
                        Замовлення можна відправити лише онлайн.
                    </div>
                `
                : ''
        }

        <div class="assort-panel">
            <div class="assort-pills" style="margin-top:0;">
                <span class="assort-pill">${data.length} поз.</span>
                <span class="assort-pill price">${priceText}</span>
            </div>

            <div id="assortGrid" class="assort-grid" style="margin-top:14px;">
                ${data.map((it) => {
                    const minStock = Number(it.minStock) || 0;
                    const price = Number(it.price) || 0;
                    const code = escapeHtml(String(it.Code));
                    const name = String(it.Name || '');

                    return `
                        <div
                            class="meter-input-group assort-row"
                            data-code="${code}"
                            data-price="${price}"
                        >
                            <div class="assort-row-head">
                                <strong class="assort-tile-name">
                                    ${escapeHtml(name) || '—'}
                                </strong>
                                <span class="assort-row-price">
                                    Ціна: <strong>${fmt(price)} ₴</strong>
                                </span>
                            </div>

                            <div class="assort-row-fields">
                                <div>
                                    <label>Мін. запас</label>
                                    <div class="assort-field-static">
                                        ${minStock > 0 ? fmt(minStock) : '—'}
                                    </div>
                                </div>

                                <div>
                                    <label>Кількість</label>
                                    ${
                                        order.canOrder
                                        ? qtyControlHtml({ value: 0, aria: 'Кількість' })
                                        : `<div class="assort-field-static">—</div>`
                                    }
                                </div>
                                <div>
                                    <label>Сума</label>
                                    <div class="assort-row-total">0 ₴</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div id="assortNoMatch" class="empty-state" style="display:none; margin-top:14px;">
                Нічого не знайдено
            </div>
        </div>
    `;

    // фильтрация позиций по названию
    const input = document.getElementById('assortSearch');
    if (input) {
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;

            document.querySelectorAll('#assortGrid .assort-row').forEach(tile => {
                const nameEl = tile.querySelector('.assort-tile-name');
                const name = nameEl ? nameEl.textContent.toLowerCase() : '';
                const ok = !q || name.includes(q);
                tile.style.display = ok ? '' : 'none';
                if (ok) shown++;
            });

            const noMatch = document.getElementById('assortNoMatch');
            if (noMatch) {
                noMatch.style.display = shown ? 'none' : 'block';
            }
        });
    }

    const grid = document.getElementById('assortGrid');
    if (!grid) {
        updateOrderBar();
        return;
    }

    // клик по кнопкам плюс и минус
    grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn');
        if (!btn) return;

        const tile = btn.closest('.assort-row');
        if (!tile) return;

        const code = tile.dataset.code;

        setQty(
            code,
            (order.qty[code] || 0) + Number(btn.dataset.step),
            tile,
            true
        );
    });

    // ручной ввод количества
    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return;

        const tile = e.target.closest('.assort-row');
        if (!tile) return;

        // только цифры, не больше четырёх знаков
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);

        setQty(tile.dataset.code, e.target.value, tile, false);
    });

    // при уходе из поля нормализуем значение
    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return;

        const tile = e.target.closest('.assort-row');
        if (!tile) return;

        e.target.value = order.qty[tile.dataset.code] || 0;
    });

    updateOrderBar();
}

// ============================================================
// блок 8. скелетон загрузки
// ============================================================

function assortSkeleton() {
    return `
        <div class="assort-loading">
            <div class="skeleton skeleton-title" style="width:50%;"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-title" style="width:40%; margin-top:10px;"></div>
            <div class="skeleton skeleton-text" style="width:65%;"></div>
        </div>
    `;
}

// ============================================================
// блок 9. открытие окна ассортимента
//
// порядок такой
// 1. ищем точку в общем списке
// 2. сбрасываем состояние заказа
// 3. заполняем шапку и показываем скелетон
// 4. показываем окно
// 5. грузим ассортимент и рендерим тело
// ============================================================

async function openAssortModal(pointId) {
    const point = globalData.find(i => String(i.id) === String(pointId));

    if (!point || assortLoading) return;

    rememberFocus();

    const overlay = ensureAssortModal();

    // сбрасываем состояние прошлого заказа
    resetOrder();
    order.pointId = point.id;

    updateOrderBar();

    // показываем название точки и установленную машину
    const subParts = [point.point_name || 'Точка', `код ${point.id}`];
    if (point.coffee_machine) {
        subParts.push(point.coffee_machine + (point.coffee_machine_code ? ` (${point.coffee_machine_code})` : ''));
    }
    document.getElementById('assortSub').textContent = subParts.join(' · ');

    document.getElementById('assortBody').innerHTML = assortSkeleton();

    overlay.classList.add('active');

    assortLoading = true;

    try {
        const { data, offline } = await loadPointAssortment(point.id);
        renderAssortBody(data, offline);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);

        document.getElementById('assortBody').innerHTML = `
            <div class="assort-error">
                Не вдалося завантажити асортимент:
                ${escapeHtml(message)}
            </div>
        `;

        updateOrderBar();
    } finally {
        assortLoading = false;
    }
}

// ============================================================
// блок 10. закрытие окна
//
// во время отправки окно не закрывается.
// после закрытия сбрасываем состояние заказа.
// ============================================================

function closeAssortModal() {
    if (orderSending) return;

    document.getElementById('assortOverlay')?.classList.remove('active');
    resetOrder();

    if (!getTopModal()) {
        restoreFocus();
    }
}

// ============================================================
// блок 11. окно подтверждения заказа
//
// показываем количество позиций и общую сумму.
// кнопка назад возвращает к списку, кнопка отправить отправляет.
// ============================================================

function ensureOrderConfirmModal() {
    let el = document.getElementById('orderConfirmOverlay');
    if (el) return el;

    el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'orderConfirmOverlay';
    el.style.zIndex = '1011';

    el.innerHTML = `
        <div class="modal-box confirm-box">
            <div class="modal-header">
                <h3>Перевірка замовлення</h3>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>
            <div class="modal-body">
                <p style="text-align: center; margin-bottom: 15px; color: #64748b; font-size: 0.95rem;">
                    Перевірте склад замовлення перед відправкою в 1С
                </p>
                <div class="confirm-summary">
                    <div class="confirm-item">
                        <span>Всього позицій:</span>
                        <strong id="orderConfirmCount" style="color: #0f172a; font-size: 1.2rem;">0</strong>
                    </div>
                    <div class="confirm-item">
                        <span>На суму:</span>
                        <strong id="orderConfirmSum" style="color: #10b981; font-size: 1.2rem;">0 ₴</strong>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content: space-between;">
                <button class="action-btn btn-secondary" type="button" id="orderConfirmBack">Назад</button>
                <button class="action-btn btn-success" type="button" id="orderConfirmSend">Відправити в 1С</button>
            </div>
        </div>
    `;

    document.body.appendChild(el);

    el.querySelector('.modal-close').addEventListener('click', closeOrderConfirmModal);
    el.querySelector('#orderConfirmBack').addEventListener('click', closeOrderConfirmModal);
    el.querySelector('#orderConfirmSend').addEventListener('click', submitOrder);

    el.addEventListener('click', (e) => {
        if (e.target === el) closeOrderConfirmModal();
    });

    return el;
}

// показ окна подтверждения с актуальными цифрами
function showOrderConfirm() {
    if (orderSending || !order.canOrder) return;

    const { count, sum } = orderTotals();
    if (!count) return;

    const el = ensureOrderConfirmModal();

    document.getElementById('orderConfirmCount').textContent = count;
    document.getElementById('orderConfirmSum').textContent = `${fmt(sum)} ₴`;

    el.classList.add('active');
}

// закрытие окна подтверждения
function closeOrderConfirmModal() {
    if (orderSending) return;
    document.getElementById('orderConfirmOverlay')?.classList.remove('active');
}