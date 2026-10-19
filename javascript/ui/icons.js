// ============================================================
// javascript/ui/icons.js
//
// назначение
// этот файл собирает svg-иконки и мелкие куски разметки.
//
// ответственность
// - иконки для кнопок действий на карточке
// - иконка кофемашины
// - определение заглушки от 1с
// - красивое пустое состояние
// - контрол количества с кнопками минус и плюс
//
// зависимости
// - core/utils.js дает escapeHtml
// ============================================================


// ============================================================
// блок 1. иконки действий
//
// каждая иконка это набор путей внутри общего svg.
// ключ это значение data-action на кнопке
// ============================================================

function actionIconMarkup(action) {
    const paths = {
        open: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
        assort: '<path d="m12 3 8.5 4.25L12 11.5 3.5 7.25 12 3Z"/><path d="M3.5 7.25v9.5L12 21l8.5-4.25v-9.5"/><path d="M12 11.5V21"/>',
        pay: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 9V5a2 2 0 0 1 2-2h14"/><path d="M16 14h5"/><circle cx="16" cy="14" r=".7"/>',
        stock: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8 10h8M8 14h8M8 18h5"/>',
        shipment: '<path d="M3 6h11v12H3z"/><path d="M14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="17.5" cy="19" r="1.5"/>',
        recount: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M18.4 15A7 7 0 0 1 6 18l-2-6"/>',
        note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>'
    }

    return `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[action] || ''}</svg>`
}

// иконка кофемашины, одна на все места
function machineIconMarkup() {
    return '<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8Z"/><path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/><path d="M9 13h6"/><path d="M10 16h4"/></svg>'
}


// ============================================================
// блок 2. разбор ответов 1с
// ============================================================

// проверка что 1с вернула заглушку
// это массив из одного элемента с кодом 0
function isStubResponse(data) {
    return Array.isArray(data) && data.length === 1 && String(data[0].Code) === '0'
}


// ============================================================
// блок 3. пустое состояние
//
// используется когда данных нет или сервер вернул заглушку.
// иконка выбирается по имени
// ============================================================

function emptyStateHtml(text, padding, icon) {
    const pad = padding || '36px 20px'

    const paths = {
        search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
        box: '<path d="M3.5 7h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5V7Z"/><path d="M3.5 9h17"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    }

    const svg = paths[icon] || paths.box

    return `<div class="empty-state" style="padding:${pad};">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg>
        <span class="empty-text">${escapeHtml(text)}</span>
    </div>`
}


// ============================================================
// блок 4. контрол количества
//
// три элемента, минус, поле ввода и плюс.
// обработчики вешаются делегированно в родительском модуле.
// ============================================================

function qtyControlHtml(opts) {
    const o = opts || {}
    const value = Number(o.value) || 0
    const aria = o.aria || 'Кількість'

    return `
        <div class="qty">
            <button type="button" class="qty-btn" data-step="-1" aria-label="Менше">−</button>
            <input type="text" class="qty-input" inputmode="numeric" value="${value}" aria-label="${escapeHtml(aria)}">
            <button type="button" class="qty-btn" data-step="1" aria-label="Більше">+</button>
        </div>
    `
}