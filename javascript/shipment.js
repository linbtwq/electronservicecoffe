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
// зависимости
// - globalData из core/state.js дает список точек
// - fetchWithTimeout, newRequestId, showToast, escapeHtml из core/api.js
// - setBtnLoading и resetBtn из features/meter.js
// - isStubResponse и emptyStateHtml из ui/icons.js
// - qtyControlHtml из ui/icons.js
//
// порядок подключения
// index.html подключает shipment.js после после app-модулей
// ============================================================

let shipmentLoading = false
let shipmentSending = false
let shipmentPointId = null
let shipmentRequestId = null
let shipmentItems = []
let shipmentSearchQuery = ''
let shipmentSearchNumeric = false;

// ============================================================
// блок 2. создание окна
// ============================================================

function ensureShipmentModal() {
    let el = document.getElementById('shipmentOverlay')
    if (el) return el

    el = document.createElement('div')
    el.className = 'modal-overlay'
    el.id = 'shipmentOverlay'
    el.style.zIndex = '1005'

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
    el.querySelector('.modal-close').addEventListener('click', closeShipmentModal)
    el.querySelector('#shipmentSendBtn').addEventListener('click', submitShipment)
    el.addEventListener('click', (e) => { if (e.target === el) closeShipmentModal() })
    return el
}

// ============================================================
// блок 3. закрытие окна и очистка состояния
// ============================================================

function closeShipmentModal() {
    if (shipmentSending) return
    clearShipmentScanHighlight();
    document.getElementById('shipmentOverlay')?.classList.remove('active')
    shipmentPointId = null
    shipmentRequestId = null
    shipmentItems = []
    shipmentSearchQuery = ''
    shipmentSearchNumeric = false 
    if (typeof getTopModal === 'function' && !getTopModal() && typeof restoreFocus === 'function') {
        restoreFocus()
    }
}

// ============================================================
// блок 4. открытие формы и загрузка складских остатков
// ============================================================

async function openShipmentModal(pointId) {
    const point = globalData.find(i => String(i.id) === String(pointId))
    if (!point || shipmentLoading) return

    rememberFocus()
    const overlay = ensureShipmentModal()
    const sub = document.getElementById('shipmentSub')
    const body = document.getElementById('shipmentBody')
    const summary = document.getElementById('shipmentSummary')
    const sendBtn = document.getElementById('shipmentSendBtn')

    shipmentPointId = point.id
    shipmentRequestId = newRequestId()
    shipmentItems = []
    shipmentSearchQuery = ''

    sub.textContent = [point.point_name || 'Точка', `код ${point.id}`].join(' · ')
    summary.textContent = ''
    sendBtn.disabled = true

    body.innerHTML = `<div class="assort-loading"><div class="skeleton skeleton-text" style="width:60%;"></div><div class="skeleton skeleton-text" style="width:80%;"></div><div class="skeleton skeleton-text" style="width:50%;"></div></div>`
    overlay.classList.add('active')
    shipmentLoading = true

    try {
        const u = currentUser ? encodeURIComponent(currentUser.id) : ''
        const res = await fetchWithTimeout(
            `${apiBase}/shipment?u=${u}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        )

        if (!res.ok) throw new Error('Помилка мережі')
        const data = await res.json()
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С')

        if (isStubResponse(data)) {
            body.innerHTML = emptyStateHtml(data[0].Name, '36px 20px', 'alert')
            return
        }

        shipmentItems = data.map(it => ({
            code: String(it.Code || ''),
            name: String(it.Name || ''),
            price: Number(it.price) || 0,
            maxQty: Number(it.quantity) || 0,
            qty: 0
        }))

        if (!shipmentItems.length) {
            body.innerHTML = emptyStateHtml('На складі немає товарів', '36px 20px', 'box')
            return
        }

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
// ============================================================

function renderShipmentBody() {
    const body = document.getElementById('shipmentBody')
    if (!body) return

    body.innerHTML = `
        <div class="assort-top">
            <div class="assort-search-wrap" style="display: flex; gap: 8px;">
                <input type="search" class="assort-search" id="shipmentSearch"
                       placeholder="Пошук товару..." autocomplete="off"
                       value="${escapeHtml(shipmentSearchQuery)}"
                       inputmode="${shipmentSearchNumeric ? 'numeric' : 'text'}"
                       style="flex: 1;">
                <button type="button" class="dg-scan-btn numeric-toggle ${shipmentSearchNumeric ? 'active' : ''}"
                        id="shipmentNumericBtn"
                        aria-label="Цифрова клавіатура"
                        aria-pressed="${shipmentSearchNumeric ? 'true' : 'false'}"
                        title="Цифрова клавіатура">123</button>
                <button type="button" class="dg-scan-btn" id="shipmentScanBtn" aria-label="Сканувати">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="7" y2="12.01"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/><line x1="17" y1="12" x2="17" y2="12.01"/></svg>
                </button>
            </div>
        </div>
        <div id="shipmentGrid" class="assort-grid" style="margin-top:14px;">
            ${renderShipmentRows()}
        </div>
        <div id="shipmentNoMatch" class="empty-state" style="display:none; margin-top:14px;">Нічого не знайдено</div>
    `

    const searchInput = document.getElementById('shipmentSearch')
    if (searchInput) {
        // обычный ввод (фильтрация по буквам)
        searchInput.addEventListener('input', () => {
            shipmentSearchQuery = searchInput.value.trim().toLowerCase()
            applyShipmentSearch()
        })

        // обработка Enter (для ручного ввода и блютуз-сканеров)
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = searchInput.value.trim();
                if (!q) return;

                // Если это штрихкод (8+ цифр)
                if (/^\d{8,}$/.test(q)) {
                    searchShipmentByBarcode(q);
                }
            }
        })
    }

    // нопка переключения клавиатуры (numeric ↔ text)
    const numericBtn = document.getElementById('shipmentNumericBtn')
    if (numericBtn && searchInput) {
        numericBtn.addEventListener('click', () => {
            shipmentSearchNumeric = !shipmentSearchNumeric
            numericBtn.classList.toggle('active', shipmentSearchNumeric)
            numericBtn.setAttribute('aria-pressed', shipmentSearchNumeric ? 'true' : 'false')
            searchInput.setAttribute('inputmode', shipmentSearchNumeric ? 'numeric' : 'text')
            searchInput.focus()
        })
    }

    const scanBtn = document.getElementById('shipmentScanBtn')
    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            if (typeof openBarcodeScanner === 'function') openBarcodeScanner();
        })
    }

    const grid = document.getElementById('shipmentGrid')

    grid.addEventListener('click', e => {
        const btn = e.target.closest('.qty-btn')
        if (!btn) return
        const row = btn.closest('[data-shipment-row]')
        if (!row) return
        const idx = Number(row.dataset.idx)
        if (!shipmentItems[idx]) return
        const step = Number(btn.dataset.step) || 0
        const maxQ = shipmentItems[idx].maxQty
        let next = shipmentItems[idx].qty + step
        if (next < 0) next = 0
        if (next > maxQ) next = maxQ
        shipmentItems[idx].qty = next
        const inp = row.querySelector('.qty-input')
        if (inp) inp.value = next
        updateShipmentRow(row, idx)
        updateShipmentSummary()
    })

    grid.addEventListener('input', e => {
        if (!e.target.classList.contains('qty-input')) return
        const row = e.target.closest('[data-shipment-row]')
        if (!row) return
        const idx = Number(row.dataset.idx)
        if (!shipmentItems[idx]) return
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
        let val = Number(e.target.value) || 0
        const maxQ = shipmentItems[idx].maxQty
        if (val > maxQ) val = maxQ
        shipmentItems[idx].qty = val
        updateShipmentRow(row, idx)
        updateShipmentSummary()
    })

    grid.addEventListener('focusout', e => {
        if (!e.target.classList.contains('qty-input')) return
        const row = e.target.closest('[data-shipment-row]')
        if (!row) return
        const idx = Number(row.dataset.idx)
        if (shipmentItems[idx]) e.target.value = shipmentItems[idx].qty
    })

    document.querySelectorAll('#shipmentGrid [data-shipment-row]').forEach(row => {
        updateShipmentRow(row, Number(row.dataset.idx))
    })

    applyShipmentSearch()
    updateShipmentSummary()
}

// ============================================================
// блок 6. html для списка строк
// ============================================================

function renderShipmentRows() {
    return shipmentItems.map((it, i) => {
        return renderProductRow({
            idx: i, code: it.code, name: it.name, price: it.price, showHeadPrice: false,
            dataAttr: 'data-shipment-row', fieldsClass: 'shipment-row-fields',
            col1: { label: 'На складі', value: fmt(it.maxQty), isStatic: true, isLarge: true },
            col2: { label: 'Ціна', value: `${fmt(it.price)} ₴`, isStatic: true },
            col3: { label: 'Відвантажити', isInput: true, inputValue: 0 },
            col4: { label: 'Сума', value: '0 ₴', isTotal: true }
        });
    }).join('')
}

// ============================================================
// блок 7. обновление одной строки
// ============================================================

function updateShipmentRow(row, idx) {
    const it = shipmentItems[idx]
    if (!it) return
    const totalEl = row.querySelector('.assort-row-total')
    if (totalEl) totalEl.textContent = `${fmt(it.qty * it.price)} ₴`
    row.classList.toggle('picked', it.qty > 0)
}

// ============================================================
// блок 8. итоги в подвале
// ============================================================

function updateShipmentSummary() {
    const summary = document.getElementById('shipmentSummary')
    const btn = document.getElementById('shipmentSendBtn')
    if (!summary || !btn) return

    let count = 0, sum = 0
    shipmentItems.forEach(it => { if (it.qty > 0) { count++; sum += it.qty * it.price; } })

    if (!count) {
        summary.textContent = 'Вкажіть кількість товарів'
        btn.disabled = true
        return
    }
    summary.innerHTML = `Відвантажуємо: <b>${count} поз.</b> на <b>${fmt(sum)} ₴</b>`
    btn.disabled = shipmentSending
}

// ============================================================
// блок 9. фильтрация списка по поиску
// ============================================================

function applyShipmentSearch() {
    const q = shipmentSearchQuery
    let shown = 0
    document.querySelectorAll('#shipmentGrid [data-shipment-row]').forEach(row => {
        const idx = Number(row.dataset.idx)
        const it = shipmentItems[idx]
        if (!it) return
        const hay = (it.name + ' ' + it.code).toLowerCase()
        const ok = !q || hay.includes(q)
        row.style.display = ok ? '' : 'none'
        if (ok) shown++
    })
    document.getElementById('shipmentNoMatch').style.display = shown ? 'none' : 'block'
}

// ============================================================
// блок 10. отправка формы в 1с
// ============================================================

async function submitShipment() {
    if (shipmentSending) return;
    const pointId = shipmentPointId;
    if (!pointId) return;

    const items = [];
    shipmentItems.forEach(it => {
        if (it.qty > 0) items.push({ code: it.code, name: it.name, price: it.price, qty: it.qty });
    });

    if (!items.length) return showToast('Додайте хоча б одну позицію', true);
    if (!navigator.onLine) return showToast('Немає мережі! Відвантаження лише онлайн.', true);

    const payload = {
        point_id: pointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: shipmentRequestId || newRequestId(),
        items
    };

    const btn = document.getElementById('shipmentSendBtn');
    const closeBtn = document.querySelector('#shipmentOverlay .modal-close');

    shipmentSending = true;

    await submitDocument({
        endpoint: 'shipment',
        payload, btn, closeBtn,
        successText: 'Відвантаження створено в 1С',
        errorPrefix: 'Не вдалося відвантажити',
        onSuccess: () => {
            // сначала флаг, потом close
            shipmentSending = false;
            shipmentItems = [];
            shipmentPointId = null;
            closeShipmentModal();
        }
    });

    shipmentSending = false;
    if (shipmentPointId) updateShipmentSummary();
}

// ============================================================
// поиск товара по штрих-коду в окне отгрузки
// три сценария:
//   1) товар не найден в номенклатуре - красная ошибка
//   2) товар найден, но нет остатка - красная ошибка с остатком
//   3) товар найден и есть на складе - зелёный тост + подсветка + скролл
// ============================================================

let _shipmentHighlightTimer = null;
let _shipmentScanSeq = 0;

async function searchShipmentByBarcode(barcode) {
    const searchInput = document.getElementById('shipmentSearch');
    if (!searchInput) return;

    // нормализуем: убираем пробелы и переводы строк
    const cleanBarcode = String(barcode || '').replace(/\s+/g, '');

    if (!cleanBarcode) {
        showToast('Порожній штрих-код', true);
        return;
    }

    // отменяем предыдущий запрос и старую подсветку
    const seq = ++_shipmentScanSeq;
    clearShipmentScanHighlight();

    // НЕ оставляем штрих-код в поле, чтобы он не мешал фильтру
    searchInput.value = '';
    searchInput.disabled = true;

    const scanBtn = document.getElementById('shipmentScanBtn');
    if (scanBtn) scanBtn.disabled = true;

    // сбрасываем предыдущий фильтр, чтобы подсвеченная строка была видна
    shipmentSearchQuery = '';
    applyShipmentSearch();

    try {
        const u = currentUser ? encodeURIComponent(currentUser.id) : '';
        const res = await fetchWithTimeout(
            `${apiBase}/goods?u=${u}&barcode=${encodeURIComponent(cleanBarcode)}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        );

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error((errText && errText.slice(0, 160)) || 'Помилка мережі');
        }

        const data = await res.json();
        const items = Array.isArray(data.items)
            ? data.items
            : (Array.isArray(data) ? data : []);

        // гонка пользователь успел отсканировать другой код
        if (seq !== _shipmentScanSeq) return;

        //  сценарий 1 товара нет в номенклатуре
        if (!items.length) {
            showToast(
                `Товар зі штрих-кодом ${cleanBarcode} не знайдено в номенклатурі 1С`,
                true
            );
            return;
        }

        const foundItem = items[0];
        const foundName = String(foundItem.name || '').trim() || 'Без назви';

        // сценарий 2 товар есть в номенклатуре, ищем на складе
        const idx = findShipmentItemIndex(foundItem);

        if (idx < 0) {
            const stock = Number(foundItem.stock);
            const stockText = isFinite(stock) && stock > 0
                ? ` (залишок у 1С: ${stock})`
                : '';
            showToast(
                `Товар «${foundName}» знайдено в номенклатурі, ` +
                `але на складі немає залишку${stockText}`,
                true
            );
            return;
        }

        //сценарий 3 товар найден и есть на складе 
        const shipmentItem = shipmentItems[idx];
        const priceIsZero = !Number(shipmentItem.price);

        highlightShipmentRow(idx);

        if (priceIsZero) {
            showToast(
                `Знайдено: ${foundName}. Увага: ціна в 1С не вказана (0 ₴)`,
                true
            );
        } else {
            showToast(`Знайдено: ${foundName}`, false);
        }

    } catch (err) {
        if (seq !== _shipmentScanSeq) return;
        const msg = err && err.message ? err.message : String(err);
        showToast(`Помилка пошуку: ${msg}`, true);
    } finally {
        if (seq === _shipmentScanSeq) {
            searchInput.disabled = false;
            if (scanBtn) scanBtn.disabled = false;
        }
    }
}

// ищет индекс товара в shipmentItems по нормализованному коду или имени
function findShipmentItemIndex(foundItem) {
    const normCode = normalizeCode(foundItem.code);
    const normName = String(foundItem.name || '').trim().toLowerCase();

    if (normCode) {
        const i = shipmentItems.findIndex(it => normalizeCode(it.code) === normCode);
        if (i >= 0) return i;
    }

    if (normName) {
        const i = shipmentItems.findIndex(
            it => String(it.name || '').trim().toLowerCase() === normName
        );
        if (i >= 0) return i;
    }

    return -1;
}

function clearShipmentScanHighlight() {
    if (_shipmentHighlightTimer) {
        clearTimeout(_shipmentHighlightTimer);
        _shipmentHighlightTimer = null;
    }
    document.querySelectorAll('#shipmentGrid .assort-row.scanned').forEach(row => {
        row.classList.remove('scanned');
    });
}

function highlightShipmentRow(idx) {
    const row = document.querySelector(
        `#shipmentGrid [data-shipment-row][data-idx="${idx}"]`
    );
    if (!row) return;

    row.style.display = '';
    row.classList.add('scanned');

    try {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
        try { row.scrollIntoView(); } catch (e2) {}
    }

    if (navigator.vibrate) navigator.vibrate(40);

    _shipmentHighlightTimer = setTimeout(() => {
        row.classList.remove('scanned');
        _shipmentHighlightTimer = null;
    }, 2200);
}