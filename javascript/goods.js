// ============================================================
// goods.js
//
// назначение
// этот файл отвечает за каталог номенклатуры в боковой панели.
//
// ответственность
// - инициализировать разметку и обработчики каталога
// - грузить уровни дерева групп и товаров
// - искать по названию и коду с отменой устаревших запросов
// - искать по штрих-коду (вызывается из scanner.js или вручную)
//
// особенности
// распознаем штрихкод при ручном вводе или блютуз-сканере.
// если ввели 8 и более цифр подряд, это точно штрихкод.
// в этом случае запрос уходит на поиск по штрихкоду, а не по имени.
// также ловим клавишу Enter, которую посылают аппаратные сканеры.
//
// три независимых канала отмены:
//   goodsLevelAbort/goodsLevelSeq — уровни дерева
//   goodsSearchAbort/goodsSearchSeq — текстовый поиск
//   goodsBarcodeAbort/goodsBarcodeSeq — поиск по штрих-коду
// ============================================================

const GOODS_MIN_QUERY = 2;
let goodsRendered = false;
let goodsCurrentParent = '';
let goodsSearchSeq = 0;
let goodsTimer = null;
let goodsSearchAbort = null;
let goodsBarcodeSeq = 0;
let goodsBarcodeAbort = null;
let goodsLevelSeq = 0;
let goodsLevelAbort = null;
const goodsSearchCache = new Map();

// ============================================================
// блок 1. вспомогательные функции
// ============================================================

function goodsUrl(params) {
    const u = currentUser ? encodeURIComponent(currentUser.id) : '';
    const extra = Object.keys(params)
        .map(k => `&${k}=${encodeURIComponent(params[k])}`)
        .join('');
    return `${apiBase}/goods?u=${u}${extra}&t=${Date.now()}`;
}

async function goodsFetch(params, signal) {
    const res = await fetchWithTimeout(
        goodsUrl(params),
        { method: 'GET', cache: 'no-store', signal },
        APP_CONFIG.loadTimeoutMs
    );
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error((t && t.slice(0, 160)) || 'Помилка мережі');
    }
    return res.json();
}

const goodsSkeleton = `
    <div class="assort-loading" style="padding: 12px 16px;">
        <div class="skeleton skeleton-text" style="width:70%;"></div>
        <div class="skeleton skeleton-text" style="width:90%;"></div>
        <div class="skeleton skeleton-text" style="width:55%;"></div>
    </div>
`;

function goodsPriceHtml(it) {
    const p = Number(it.price);
    if (!p || p <= 0) return '';
    const txt = p.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<span class="dg-price">${escapeHtml(txt)} ₴</span>`;
}

function goodsIconMarkup(kind) {
    const paths = kind === 'folder'
        ? '<path d="M3.5 7h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5V7Z"/><path d="M3.5 9h17"/>'
        : '<path d="M6 8h11v8a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4V8Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 4c0 1 1 1 1 2M12 4c0 1 1 1 1 2"/>';
    return `<svg class="dg-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function goodsStockHtml(it) {
    if (it.stock === undefined || it.stock === null) return '';
    const n = Number(it.stock);
    if (!isFinite(n)) return '';
    if (n <= 0) return '<span class="dg-stock dg-stock-out">Немає на складі</span>';
    const txt = n.toLocaleString('uk-UA', { maximumFractionDigits: 3 });
    return `<span class="dg-stock dg-stock-in">Залишок: ${escapeHtml(txt)}</span>`;
}

function goodsItemHtml(it) {
    const rawName = String(it.name || '').trim();
    const displayName = rawName.length ? rawName : 'Позиція без назви';
    const rawCode = String(it.code || '').trim();
    const cleanCode = rawCode.replace(/\s+/g, '');

    return `
        <div class="dg-row dg-item" data-id="${escapeHtml(it.id)}" data-type="item">
            <div class="dg-item-icon">${goodsIconMarkup('product')}</div>
            <div class="dg-item-info">
                <span class="dg-name${rawName ? '' : ' unnamed'}">${escapeHtml(displayName)}</span>
                ${goodsPriceHtml(it)}
                ${goodsStockHtml(it)}
            </div>
            ${cleanCode ? `
                <button type="button" class="dg-code-chip" data-copy="${escapeHtml(cleanCode)}" title="Натисніть, щоб скопіювати">
                    <span class="dg-code-prefix">код</span>
                    <span class="dg-code-val">${escapeHtml(cleanCode)}</span>
                </button>
            ` : ''}
        </div>
    `;
}

function goodsErrorHtml(err, withRetry) {
    const message = err && err.message ? err.message : String(err);
    return `
        <div class="dg-error">
            Не вдалося завантажити: ${escapeHtml(message)}
            ${withRetry ? '<button type="button" class="dg-retry">Повторити</button>' : ''}
        </div>
    `;
}

// ============================================================
// блок 2. инициализация разметки панели
// ============================================================

function initDrawerGoods() {
    const host = document.getElementById('drawerGoods');
    if (!host || host.dataset.ready) return;
    host.dataset.ready = '1';

    host.innerHTML = `
        <div class="dg-title">Номенклатура</div>
        
        <div class="dg-search-wrap">
            <div class="dg-search-inner">
                <input type="text" id="goodsSearch" autocomplete="off"
                    placeholder="Пошук за назвою, кодом або штрихкодом" aria-label="Пошук номенклатури">
                <button type="button" class="dg-clear" id="goodsClear" aria-label="Очистити" hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <button type="button" class="dg-scan-btn" id="goodsScanBtn" aria-label="Сканувати штрих-код">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
                    <line x1="7" y1="12" x2="7" y2="12.01"/>
                    <line x1="10" y1="9" x2="10" y2="15"/>
                    <line x1="14" y1="9" x2="14" y2="15"/>
                    <line x1="17" y1="12" x2="17" y2="12.01"/>
                </svg>
            </button>
        </div>

        <div class="dg-nav" id="goodsNav"></div>
        <div id="goodsList">${goodsSkeleton}</div>
    `;

    const searchInput = host.querySelector('#goodsSearch');
    const clearBtn = host.querySelector('#goodsClear');
    const scanBtn = host.querySelector('#goodsScanBtn');

    if (searchInput) {
        // 1. Обычный ввод (ждем паузу 250мс)
        searchInput.addEventListener('input', () => {
            if (clearBtn) clearBtn.hidden = !searchInput.value;
            clearTimeout(goodsTimer);
            goodsTimer = setTimeout(goodsOnSearch, 250);
        });

        // 2. Обработка Enter (для блютуз-сканеров)
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(goodsTimer); // Отменяем ожидание паузы, ищем сразу

                const q = searchInput.value.trim();
                if (!q) return;

                // Если 8 и более цифр подряд — это точно штрихкод
                if (/^\d{8,}$/.test(q)) {
                    if (typeof searchGoodsByBarcode === 'function') {
                        searchGoodsByBarcode(q);
                    }
                } else {
                    goodsOnSearch();
                }
            }
        });
    }

    if (searchInput && clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.hidden = true;
            goodsOnSearch();
            searchInput.focus();
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            if (typeof openBarcodeScanner === 'function') {
                openBarcodeScanner();
            }
        });
    }

    host.querySelector('#goodsList').addEventListener('click', e => {
        const chip = e.target.closest('.dg-code-chip');
        if (chip) {
            e.stopPropagation();
            const code = chip.dataset.copy;
            if (code && navigator.clipboard) {
                navigator.clipboard.writeText(code).then(() => {
                    if (typeof showToast === 'function') showToast(`Код скопійовано: ${code}`);
                }).catch(() => {});
            }
            return;
        }

        if (e.target.closest('.dg-retry')) {
            loadGoodsLevel(goodsCurrentParent);
            return;
        }

        const row = e.target.closest('.dg-row');
        if (!row) return;
        if (row.dataset.type === 'folder') {
            loadGoodsLevel(row.dataset.id);
        }
    });

    host.querySelector('#goodsNav').addEventListener('click', e => {
        const back = e.target.closest('.dg-back');
        if (!back) return;
        loadGoodsLevel(back.dataset.id || '');
    });
}

// ============================================================
// блок 3. загрузка уровня каталога
// ============================================================

function refreshDrawerGoods() {
    initDrawerGoods();

    const input = document.getElementById('goodsSearch');
    if (input && input.value.trim().length >= GOODS_MIN_QUERY) return;
    if (goodsRendered) return;

    loadGoodsLevel('');
}

async function loadGoodsLevel(parentId) {
    const box = document.getElementById('goodsList');
    const navBox = document.getElementById('goodsNav');
    if (!box) return;

    const seq = ++goodsLevelSeq;
    if (goodsLevelAbort) goodsLevelAbort.abort();
    goodsLevelAbort = new AbortController();

    goodsCurrentParent = parentId || '';
    goodsRendered = false;
    box.innerHTML = goodsSkeleton;

    try {
        const data = await goodsFetch({ parent: goodsCurrentParent }, goodsLevelAbort.signal);
        if (seq !== goodsLevelSeq) return;

        renderGoodsNav(Array.isArray(data.breadcrumb) ? data.breadcrumb : []);
        renderGoodsItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
        if (err.name === 'AbortError') return;
        if (seq !== goodsLevelSeq) return;
        if (navBox) navBox.innerHTML = '';
        box.innerHTML = goodsErrorHtml(err, true);
    }
}

// ============================================================
// блок 4. навигация по дереву
// ============================================================

function renderGoodsNav(breadcrumb) {
    const navBox = document.getElementById('goodsNav');
    if (!navBox) return;

    if (!breadcrumb.length) {
        navBox.innerHTML = '<div class="dg-nav-title">Всі товари</div>';
        return;
    }

    const prevId = breadcrumb.length >= 2 ? breadcrumb[breadcrumb.length - 2].id : '';
    const current = breadcrumb[breadcrumb.length - 1];

    navBox.innerHTML = `
        <button type="button" class="dg-back" data-id="${escapeHtml(prevId)}" aria-label="Назад">←</button>
        <div class="dg-nav-title">${escapeHtml(current.name)}</div>
    `;
}

// ============================================================
// блок 5. отрисовка списка
// ============================================================

function renderGoodsItems(items) {
    const box = document.getElementById('goodsList');
    if (!box) return;
    goodsRendered = true;

    if (!items.length) {
        box.innerHTML = '<div class="dg-note">Тут поки нічого немає</div>';
        return;
    }

    const folders = items.filter(it => it.type === 'folder');
    const products = items.filter(it => it.type !== 'folder');

    let html = '';

    if (folders.length) {
        html += `<div class="dg-section-label">Папки</div>`;
        html += folders.map(it => `
            <button type="button" class="dg-row dg-folder" data-id="${escapeHtml(it.id)}" data-type="folder">
                <div class="dg-folder-badge">${goodsIconMarkup('folder')}</div>
                <span class="dg-name">${escapeHtml(it.name || 'Без назви')}</span>
                <span class="dg-chev">›</span>
            </button>
        `).join('');
    }

    if (products.length) {
        if (folders.length) {
            html += `<div class="dg-section-label" style="margin-top: 14px;">Товари (${products.length})</div>`;
        }
        html += products.map(goodsItemHtml).join('');
    }

    box.innerHTML = html;
}

// ============================================================
// блок 6. поиск по тексту
//
// добавлена проверка: если строка состоит из 8+ цифр, 
// считаем это штрихкодом и вызываем searchGoodsByBarcode
// ============================================================

async function goodsOnSearch() {
    const input = document.getElementById('goodsSearch');
    const box = document.getElementById('goodsList');
    const navBox = document.getElementById('goodsNav');
    if (!input || !box) return;

    const q = input.value.trim();

    // если ввели только цифры (8 и больше), это штрихкод
    if (/^\d{8,}$/.test(q)) {
        if (typeof searchGoodsByBarcode === 'function') {
            searchGoodsByBarcode(q);
            return;
        }
    }

    const seq = ++goodsSearchSeq;

    if (q.length < GOODS_MIN_QUERY) {
        if (navBox) navBox.style.display = '';
        if (goodsSearchAbort) goodsSearchAbort.abort();
        loadGoodsLevel(goodsCurrentParent);
        return;
    }

    if (navBox) navBox.style.display = 'none';

    if (goodsSearchCache.has(q)) {
        const cached = goodsSearchCache.get(q);
        if (cached && cached.at && (Date.now() - cached.at < 60000)) {
            renderGoodsSearchResults(cached.items, cached.truncated);
            return;
        }
    }

    box.innerHTML = goodsSkeleton;

    if (goodsSearchAbort) goodsSearchAbort.abort();
    goodsSearchAbort = new AbortController();

    try {
        const url = goodsUrl({ q });
        const res = await fetchWithTimeout(
            url,
            {
                method: 'GET',
                cache: 'no-store',
                signal: goodsSearchAbort.signal
            },
            APP_CONFIG.loadTimeoutMs
        );

        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error((t && t.slice(0, 300)) || ('HTTP ' + res.status));
        }
        const data = await res.json();

        if (seq !== goodsSearchSeq) return;

        const items = Array.isArray(data.items) ? data.items : [];
        if (goodsSearchCache.size > 200) goodsSearchCache.clear();

        goodsSearchCache.set(q, { items, truncated: !!data.truncated, at: Date.now() });

        renderGoodsSearchResults(items, !!data.truncated);
        goodsRendered = false;
    } catch (err) {
        if (err.name === 'AbortError') return;
        if (seq !== goodsSearchSeq) return;
        box.innerHTML = goodsErrorHtml(err, false);
    }
}

// ============================================================
// блок 7. поиск по штрих-коду (вызывается из scanner.js)
// ============================================================

async function searchGoodsByBarcode(barcode) {
    const box = document.getElementById('goodsList');
    const navBox = document.getElementById('goodsNav');
    const input = document.getElementById('goodsSearch');

    if (!box) return;

    const cleanBarcode = String(barcode || '').replace(/\s+/g, '');

    if (!cleanBarcode) {
        box.innerHTML = emptyStateHtml('Порожній штрих-код', '24px 16px', 'alert');
        return;
    }

    if (input) {
        input.value = cleanBarcode;
        const clearBtn = document.getElementById('goodsClear');
        if (clearBtn) clearBtn.hidden = false;
    }

    if (navBox) navBox.style.display = 'none';
    box.innerHTML = goodsSkeleton;

    const seq = ++goodsBarcodeSeq;
    if (goodsBarcodeAbort) goodsBarcodeAbort.abort();
    goodsBarcodeAbort = new AbortController();

    try {
        const u = currentUser ? encodeURIComponent(currentUser.id) : '';
        const url = `${apiBase}/goods?u=${u}&barcode=${encodeURIComponent(cleanBarcode)}&t=${Date.now()}`;

        const res = await fetchWithTimeout(
            url,
            {
                method: 'GET',
                cache: 'no-store',
                signal: goodsBarcodeAbort.signal
            },
            APP_CONFIG.loadTimeoutMs
        );

        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error((t && t.slice(0, 300)) || ('HTTP ' + res.status));
        }

        const data = await res.json();

        if (seq !== goodsBarcodeSeq) return;

        const items = Array.isArray(data.items)
            ? data.items
            : (Array.isArray(data) ? data : []);

        if (items.length === 0) {
            box.innerHTML = emptyStateHtml(
                `Товар зі штрих-кодом ${cleanBarcode} не знайдено`,
                '24px 16px',
                'search'
            );
            showToast(`Товар зі штрих-кодом ${cleanBarcode} не знайдено`, true);
            return;
        }

        renderGoodsSearchResults(items, false);
        showToast(`Знайдено: ${String(items[0].name || 'товар').trim()}`, false);

    } catch (err) {
        if (err.name === 'AbortError') return;
        if (seq !== goodsBarcodeSeq) return;
        box.innerHTML = goodsErrorHtml(err, false);
        showToast('Помилка пошуку за штрих-кодом', true);
    }
}

// ============================================================
// блок 8. отрисовка результатов поиска
// ============================================================

function renderGoodsSearchResults(items, truncated) {
    const box = document.getElementById('goodsList');
    if (!box) return;

    if (!items.length) {
        box.innerHTML = '<div class="dg-note">Нічого не знайдено</div>';
        return;
    }

    const countHeader = `<div class="dg-section-label">Знайдено: ${items.length}${truncated ? '+' : ''}</div>`;
    const rows = items.map(goodsItemHtml).join('');

    const note = truncated
        ? `<div class="dg-note" style="padding: 16px 12px; font-size: 0.8rem;">Показано перші ${items.length}. Уточніть запит для точного пошуку.</div>`
        : '';

    box.innerHTML = countHeader + rows + note;
}