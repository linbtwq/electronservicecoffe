// ============================================================
// javascript/machines.js
//
// назначение
// этот файл отвечает за встроенный блок остатков по автоматам.
//
// ответственность
// - открыть блок остатков под карточкой точки
// - загрузить список товаров и количеств с сервера
// - дать пользователю поиск, фильтр и сортировку
// - показать итоги по складу
//
// особенность
// одновременно открыт только один блок.
// при выборе другой точки предыдущий закрывается.
// ============================================================

let _me = null;
let _meOutsideClickHandler = null;

// кеш ответов
const _machinesCache = new Map();
const _machinesCacheTTL = 30000;

function _machinesCacheGet(pointId) {
    const entry = _machinesCache.get(String(pointId));
    if (!entry) return null;
    if (Date.now() - entry.at > _machinesCacheTTL) {
        _machinesCache.delete(String(pointId));
        return null;
    }
    return entry.data;
}

function _machinesCacheSet(pointId, data) {
    if (_machinesCache.size > 50) _machinesCache.clear();
    _machinesCache.set(String(pointId), { data, at: Date.now() });
}

async function toggleMachineExpand(pointId) {
    const pid = String(pointId);

    if (_me && (!_me.card || !_me.card.isConnected)) {
        _me = null;
        _meOutsideClickHandler = null;
    }

    const card = Array.from(document.querySelectorAll('.point-card')).find(el => el.dataset.id === pid);
    if (!card) return;

    if (_me && _me.pointId === pid) {
        closeMachineExpand();
        return;
    }
    if (_me) closeMachineExpand();

    const box = card.querySelector('.machine-expand');
    if (!box) return;

    box.hidden = false;
    card.classList.add('machine-card-open');
    box.innerHTML = `
        <div class="mt-loading">
            <div class="skeleton skeleton-text" style="width:70%;"></div>
            <div class="skeleton skeleton-text" style="width:90%;"></div>
            <div class="skeleton skeleton-text" style="width:55%;"></div>
        </div>
    `;

    _me = { pointId: pid, card, box, data: [], query: '', filter: 'all', sort: 'name' };

    const cached = _machinesCacheGet(pid);
    if (cached) {
        if (isStubResponse(cached)) return box.innerHTML = emptyStateHtml(cached[0].Name, '24px 16px');
        if (!cached.length) return box.innerHTML = emptyStateHtml('Залишки відсутні', '24px 16px');
        _me.data = cached;
        return renderMachineExpand();
    }

    try {
        const u = currentUser ? encodeURIComponent(currentUser.id) : '';
        const res = await fetchWithTimeout(
            `${apiBase}/machines?u=${u}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        );

        if (!res.ok) throw new Error('Помилка мережі');
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С');

        if (!_me || _me.pointId !== pid) return;
        if (isStubResponse(data)) return box.innerHTML = emptyStateHtml(data[0].Name, '24px 16px');
        if (!data.length) return box.innerHTML = emptyStateHtml('Залишки відсутні', '24px 16px');

        _machinesCacheSet(pid, data);
        _me.data = data;
        renderMachineExpand();

    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (_me && _me.pointId === pid) {
            box.innerHTML = `<div class="assort-error" style="margin:0;">Не вдалося завантажити: ${escapeHtml(message)}</div>`;
        }
    }
}

function closeMachineExpand() {
    if (!_me) return;
    const { card, box } = _me;
    if (box) {
        if (_meOutsideClickHandler) {
            box.removeEventListener('click', _meOutsideClickHandler);
            _meOutsideClickHandler = null;
        }
        box.hidden = true;
        box.innerHTML = '';
        box.removeAttribute('data-ready');
    }
    if (card) card.classList.remove('machine-card-open');
    _me = null;
}

function renderMachineExpand() {
    if (!_me) return;
    const { box, data } = _me;

    const total = data.length;
    const cntIn = data.filter(it => (Number(it.quantity) || 0) > 0).length;
    const cntZero = data.filter(it => (Number(it.quantity) || 0) === 0).length;
    const cntNeg = data.filter(it => (Number(it.quantity) || 0) < 0).length;

    box.innerHTML = `
        <div class="machines-toolbar">
            <div class="machines-search-wrap">
                <input type="search" class="machines-search" placeholder="Пошук товару..." autocomplete="off" data-me="search">
            </div>
            <div class="machines-filters" data-me="filters">
                <button type="button" class="mf-chip active" data-filter="all">Всі<span class="mf-chip-count">${total}</span></button>
                <button type="button" class="mf-chip" data-filter="in">В наявності<span class="mf-chip-count">${cntIn}</span></button>
                <button type="button" class="mf-chip" data-filter="zero">Немає<span class="mf-chip-count">${cntZero}</span></button>
                <button type="button" class="mf-chip" data-filter="neg">Від'ємні<span class="mf-chip-count">${cntNeg}</span></button>
            </div>
            <div class="machines-sort">
                <span class="machines-sort-label">Сортування</span>
                <div class="machines-sort-control">
                    <button type="button" class="machines-sort-select" data-me="sort-btn" aria-haspopup="listbox" aria-expanded="false">
                        <span data-me="sort-value">За назвою (А–Я)</span>
                        <svg class="machines-sort-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="machines-sort-menu" data-me="sort-menu" role="listbox" hidden>
                        <button type="button" class="machines-sort-option active" role="option" aria-selected="true" data-sort="name">За назвою (А–Я)</button>
                        <button type="button" class="machines-sort-option" role="option" aria-selected="false" data-sort="qty_desc">Спочатку більше</button>
                        <button type="button" class="machines-sort-option" role="option" aria-selected="false" data-sort="qty_asc">Спочатку менше</button>
                        <button type="button" class="machines-sort-option" role="option" aria-selected="false" data-sort="price_desc">Дорожче спочатку</button>
                        <button type="button" class="machines-sort-option" role="option" aria-selected="false" data-sort="price_asc">Дешевше спочатку</button>
                    </div>
                </div>
            </div>
        </div>
        <div data-me="list"></div>
    `;

    const searchInput = box.querySelector('[data-me="search"]');
    searchInput.addEventListener('input', () => {
        _me.query = searchInput.value.trim().toLowerCase();
        renderMachineList();
    });

    const filtersBox = box.querySelector('[data-me="filters"]');
    filtersBox.addEventListener('click', (e) => {
        const chip = e.target.closest('.mf-chip');
        if (!chip) return;
        _me.filter = chip.dataset.filter;
        filtersBox.querySelectorAll('.mf-chip').forEach(c => c.classList.toggle('active', c === chip));
        renderMachineList();
    });

    const sortControl = box.querySelector('.machines-sort-control');
    const sortBtn = box.querySelector('[data-me="sort-btn"]');
    const sortMenu = box.querySelector('[data-me="sort-menu"]');
    const sortValue = box.querySelector('[data-me="sort-value"]');

    const closeSortMenu = (restoreFocus = false) => {
        sortMenu.hidden = true;
        if (sortControl) sortControl.classList.remove('is-open');
        sortBtn.setAttribute('aria-expanded', 'false');
        if (restoreFocus) sortBtn.focus();
    };
    const openSortMenu = () => {
        sortMenu.hidden = false;
        if (sortControl) sortControl.classList.add('is-open');
        sortBtn.setAttribute('aria-expanded', 'true');
    };

    sortBtn.addEventListener('click', () => { if (sortMenu.hidden) openSortMenu(); else closeSortMenu(); });

    sortMenu.addEventListener('click', (e) => {
        const option = e.target.closest('.machines-sort-option');
        if (!option) return;
        _me.sort = option.dataset.sort;
        sortMenu.querySelectorAll('.machines-sort-option').forEach(item => {
            const selected = item === option;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-selected', String(selected));
        });
        sortValue.textContent = option.textContent;
        closeSortMenu(true);
        renderMachineList();
    });

    if (_meOutsideClickHandler) box.removeEventListener('click', _meOutsideClickHandler);
    _meOutsideClickHandler = (e) => { if (!e.target.closest('.machines-sort-control')) closeSortMenu(); };
    box.addEventListener('click', _meOutsideClickHandler);

    renderMachineList();
}

function renderMachineList() {
    if (!_me) return;
    const listBox = _me.box.querySelector('[data-me="list"]');
    if (!listBox) return;

    let list = _me.data.slice();
    if (_me.filter === 'in') list = list.filter(it => (Number(it.quantity) || 0) > 0);
    if (_me.filter === 'zero') list = list.filter(it => (Number(it.quantity) || 0) === 0);
    if (_me.filter === 'neg') list = list.filter(it => (Number(it.quantity) || 0) < 0);

    if (_me.query) {
        list = list.filter(it => {
            const name = String(it.Name || '').toLowerCase();
            const code = String(it.Code || '').toLowerCase();
            return name.includes(_me.query) || code.includes(_me.query);
        });
    }

    if (_me.sort === 'name') list.sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || ''), 'uk'));
    else if (_me.sort === 'qty_desc') list.sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
    else if (_me.sort === 'qty_asc') list.sort((a, b) => (Number(a.quantity) || 0) - (Number(b.quantity) || 0));
    else if (_me.sort === 'price_desc') list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    else if (_me.sort === 'price_asc') list.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

    if (!list.length) return listBox.innerHTML = emptyStateHtml('Нічого не знайдено', '24px 16px');

    let sumQty = 0, sumMoney = 0;
    list.forEach(it => {
        const q = Number(it.quantity) || 0, p = Number(it.price) || 0;
        sumQty += q; sumMoney += q * p;
    });

    listBox.innerHTML = `
        <div class="mt-list">
            ${list.map((it, index) => {
                const qty = Number(it.quantity) || 0;
                const price = Number(it.price) || 0;
                const code = it.Code ? String(it.Code) : '';
                const cls = qty > 0 ? 'has' : (qty < 0 ? 'neg' : 'zero');
                const priceHtml = price > 0 ? `<div class="mt-row-price">${fmt(price)} ₴</div>` : '';
                return `
                    <div class="mt-row ${cls} mt-row-${cls}" style="--machine-row-index:${Math.min(index, 7)}">
                        <div class="mt-row-main">
                            <div class="mt-row-name">${escapeHtml(it.Name ?? '—')}</div>
                            ${code ? `<div class="mt-row-code">код ${escapeHtml(code)}</div>` : ''}
                        </div>
                        <div class="mt-row-side">
                            ${priceHtml}
                            <div class="mt-row-qty ${cls}">${fmt(qty)}</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="mt-summary">
            <div class="mt-summary-row"><span>Всього на складі:</span><b>${fmt(sumQty)}</b></div>
            <div class="mt-summary-row"><span>Сума за цінами:</span><b>${fmt(sumMoney)} ₴</b></div>
        </div>
    `;
}