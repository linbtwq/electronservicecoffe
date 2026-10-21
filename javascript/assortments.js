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
// если сети нет, показываем сохраненный ассортимент из indexedDB.
// заказывать в офлайне нельзя, кнопка отправки появится только онлайн.
//
// про работу с состоянием
// все мутации заказа идут через appStore:
//   appStore.setQty        обновить количество одной позиции
//   appStore.setOrder      обновить набор полей
//   appStore.resetOrder    сбросить заказ
// все чтения идут через appStore.getOrder() в начале функции.
// напрямую order.qty = ... не пишем.
//
// зависимости
// - globalData из core/state.js дает точки
// - appStore из core/store.js дает состояние заказа
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из core/api.js, core/api.js, ui/toast.js, core/utils.js
// - setBtnLoading и resetBtn из features/meter.js
// - isStubResponse и emptyStateHtml из ui/icons.js
// - qtyControlHtml из ui/icons.js
// - localDB для кеша ассортимента core/storage.js
//
// порядок подключения
// index.html подключает assortments.js после app-модулей
// ============================================================

// флаги текущего заказа
let assortLoading = false;
let orderSending = false;

// ============================================================
// блок 1. создание окна ассортимента
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
// ============================================================

async function loadPointAssortment(pointId) {
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
        try { await localDB.save(key, data); } catch (e) {}
        return { data, offline: false };
    } catch (err) {
        try {
            const cached = await localDB.load(key);
            if (Array.isArray(cached)) return { data: cached, offline: true };
        } catch (e) {}
        throw err;
    }
}

// ============================================================
// блок 3. расчет итогов заказа
// ============================================================

function orderTotals() {
    const order = appStore.getOrder();
    let count = 0;
    let sum = 0;

    for (const code in order.qty) {
        const q = order.qty[code];
        if (!q) continue;
        const item = order.items[code];
        if (!item) continue;
        const price = Number(item.price) || 0;
        count++;
        sum += q * price;
    }
    return { count, sum };
}

// ============================================================
// блок 4. обновление подвала окна
// ============================================================

function updateOrderBar() {
    const order = appStore.getOrder();
    const summary = document.getElementById('orderSummary');
    const btn = document.getElementById('orderSendBtn');
    if (!summary || !btn) return;

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
// appStore.setQty сам сбрасывает requestId,
// потому что изменение количества делает текущий ключ запроса неактуальным
// ============================================================

function setQty(code, value, tile, syncInput) {
    const q = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));

    appStore.setQty(code, q);

    tile.classList.toggle('picked', q > 0);

    if (syncInput) {
        const inp = tile.querySelector('.qty-input');
        if (inp) inp.value = q;
    }

    const totalEl = tile.querySelector('.assort-row-total');
    if (totalEl) totalEl.textContent = `${fmt(q * (Number(tile.dataset.price) || 0))} ₴`;
    updateOrderBar();
}

// ============================================================
// блок 6. отправка заказа в 1с
// ============================================================

async function submitOrder() {
    const order = appStore.getOrder();
    if (orderSending || !order.canOrder) return;
    const { count, sum } = orderTotals();
    if (!count) return;

    if (!navigator.onLine) {
        showToast('Немає мережі! Замовлення можна відправити лише онлайн.', true);
        return;
    }

    const items = Object.entries(order.qty)
        .filter(([code]) => order.items[code])
        .map(([code, qty]) => ({
            code,
            name: order.items[code].name,
            qty,
            price: order.items[code].price
        }));

    if (!items.length) {
        showToast('Немає валідних позицій', true);
        return;
    }

    // ключ защиты от дублей, генерируется один раз на попытку
    let requestId = order.requestId;
    if (!requestId) {
        requestId = newRequestId();
        appStore.setOrder({ requestId });
    }

    const payload = {
        point_id: order.pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: requestId,
        total: sum,
        items
    };

    const btn = document.getElementById('orderSendBtn');
    const closeBtn = document.querySelector('#assortOverlay .modal-close');

    orderSending = true;

    await submitDocument({
        endpoint: 'orders',
        payload,
        btn,
        closeBtn,
        loadingText: 'Відправка...',
        successText: `Замовлення відправлено: ${count} поз. на ${fmt(sum)} ₴`,
        errorPrefix: 'Не вдалося відправити замовлення',
        onSuccess: () => {
            // сначала флаг, потом close (чтобы окно закрылось)
            orderSending = false;
            document.getElementById('orderConfirmOverlay')?.classList.remove('active');
            closeAssortModal();
        }
    });

    orderSending = false;
    if (appStore.getOrder().canOrder) updateOrderBar();
}

// ============================================================
// блок 7. отрисовка тела модалки
// ============================================================

function renderAssortBody(data, offline) {
    const body = document.getElementById('assortBody');
    appStore.setOrder({ canOrder: false });

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

    const newItems = {};
    data.forEach(it => {
        newItems[String(it.Code)] = { name: String(it.Name || ''), price: Number(it.price) || 0 };
    });
    appStore.setOrder({ items: newItems, canOrder: !offline });

    const order = appStore.getOrder();

    const prices = data.map(i => Number(i.price) || 0);
    const priceText = Math.min(...prices) === Math.max(...prices)
        ? `${fmt(prices[0])} ₴` : `${fmt(Math.min(...prices))}–${fmt(Math.max(...prices))} ₴`;

    body.innerHTML = `
        ${data.length > 8 ? `<div class="assort-top"><div class="assort-search-wrap"><input type="search" class="assort-search" id="assortSearch" placeholder="Пошук напою" autocomplete="off"></div></div>` : ''}
        ${offline ? `<div class="assort-offline">Офлайн. Показані збережені дані. Замовлення можна відправити лише онлайн.</div>` : ''}
        <div class="assort-panel">
            <div class="assort-pills" style="margin-top:0;">
                <span class="assort-pill">${data.length} поз.</span>
                <span class="assort-pill price">${priceText}</span>
            </div>
            <div id="assortGrid" class="assort-grid" style="margin-top:14px;">
                ${data.map((it, i) => renderProductRow({
                    idx: i, code: it.Code, name: it.Name, price: it.price, showHeadPrice: true,
                    col1: { label: 'Мін. запас', value: it.minStock > 0 ? fmt(it.minStock) : '—', isStatic: true },
                    col2: order.canOrder ? { label: 'Кількість', isInput: true, inputValue: 0 } : { label: 'Кількість', value: '—', isStatic: true },
                    col3: { label: 'Сума', value: '0 ₴', isTotal: true }
                })).join('')}
            </div>
            <div id="assortNoMatch" class="empty-state" style="display:none; margin-top:14px;">Нічого не знайдено</div>
        </div>
    `;

    const input = document.getElementById('assortSearch');
    if (input) {
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            document.querySelectorAll('#assortGrid .assort-row').forEach(tile => {
                const ok = !q || (tile.querySelector('.assort-tile-name')?.textContent.toLowerCase().includes(q));
                tile.style.display = ok ? '' : 'none';
                if (ok) shown++;
            });
            document.getElementById('assortNoMatch').style.display = shown ? 'none' : 'block';
        });
    }

    const grid = document.getElementById('assortGrid');
    if (!grid) return updateOrderBar();

    grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn');
        if (!btn) return;
        const tile = btn.closest('.assort-row');
        if (!tile) return;
        const current = appStore.getOrder().qty[tile.dataset.code] || 0;
        setQty(tile.dataset.code, current + Number(btn.dataset.step), tile, true);
    });

    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return;
        const tile = e.target.closest('.assort-row');
        if (!tile) return;
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
        setQty(tile.dataset.code, e.target.value, tile, false);
    });

    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return;
        const tile = e.target.closest('.assort-row');
        if (tile) e.target.value = appStore.getOrder().qty[tile.dataset.code] || 0;
    });

    updateOrderBar();
}

// ============================================================
// блок 8. скелетон загрузки
// ============================================================

function assortSkeleton() {
    return `<div class="assort-loading"><div class="skeleton skeleton-title" style="width:50%;"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-title" style="width:40%; margin-top:10px;"></div><div class="skeleton skeleton-text" style="width:65%;"></div></div>`;
}

// ============================================================
// блок 9. открытие окна ассортимента
// ============================================================

async function openAssortModal(pointId) {
    const point = globalData.find(i => String(i.id) === String(pointId));
    if (!point || assortLoading) return;

    rememberFocus();
    const overlay = ensureAssortModal();

    appStore.resetOrder();
    appStore.setOrder({ pointId: point.id });

    updateOrderBar();

    const subParts = [point.point_name || 'Точка', `код ${point.id}`];
    if (point.coffee_machine) subParts.push(point.coffee_machine + (point.coffee_machine_code ? ` (${point.coffee_machine_code})` : ''));
    document.getElementById('assortSub').textContent = subParts.join(' · ');
    document.getElementById('assortBody').innerHTML = assortSkeleton();
    overlay.classList.add('active');

    assortLoading = true;
    try {
        const { data, offline } = await loadPointAssortment(point.id);
        renderAssortBody(data, offline);
    } catch (err) {
        document.getElementById('assortBody').innerHTML = `<div class="assort-error">Не вдалося завантажити: ${escapeHtml(err.message || String(err))}</div>`;
        updateOrderBar();
    } finally {
        assortLoading = false;
    }
}

// ============================================================
// блок 10. закрытие окна
// ============================================================

function closeAssortModal() {
    if (orderSending) return;
    document.getElementById('assortOverlay')?.classList.remove('active');
    appStore.resetOrder();
    if (!getTopModal()) restoreFocus();
}

// ============================================================
// блок 11. окно подтверждения заказа
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
            <div class="modal-header"><h3>Перевірка замовлення</h3><button class="modal-close" type="button">✕</button></div>
            <div class="modal-body">
                <p style="text-align: center; margin-bottom: 15px; color: #64748b;">Перевірте склад перед відправкою</p>
                <div class="confirm-summary">
                    <div class="confirm-item"><span>Всього позицій:</span><strong id="orderConfirmCount" style="color: #0f172a; font-size: 1.2rem;">0</strong></div>
                    <div class="confirm-item"><span>На суму:</span><strong id="orderConfirmSum" style="color: #10b981; font-size: 1.2rem;">0 ₴</strong></div>
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
    el.addEventListener('click', (e) => { if (e.target === el) closeOrderConfirmModal(); });
    return el;
}

function showOrderConfirm() {
    const order = appStore.getOrder();
    if (orderSending || !order.canOrder) return;
    const { count, sum } = orderTotals();
    if (!count) return;

    const el = ensureOrderConfirmModal();
    document.getElementById('orderConfirmCount').textContent = count;
    document.getElementById('orderConfirmSum').textContent = `${fmt(sum)} ₴`;
    el.classList.add('active');
}

function closeOrderConfirmModal() {
    if (orderSending) return;
    document.getElementById('orderConfirmOverlay')?.classList.remove('active');
}