// ============================================================
// javascript/features/stock.js
//
// назначение
// этот файл отвечает за окно остатков по точке.
//
// ответственность
// - создать окно если его ещё нет
// - загрузить остатки с сервера
// - отсортировать по названию
// - раскрасить количество по наличию
//
// зависимости
// - core/state.js даёт globalData
// - core/utils.js даёт fmt и escapeHtml
// - core/api.js даёт fetchWithTimeout
// - ui/icons.js даёт isStubResponse, emptyStateHtml
// - ui/focus.js даёт rememberFocus, restoreFocus, getTopModal
// ============================================================


// ============================================================
// блок 1. создание окна
//
// создаётся один раз.
// тело заполняется при открытии.
// ============================================================

function ensureStockModal() {
    let el = document.getElementById('stockOverlay')
    if (el) return el

    el = document.createElement('div')
    el.className = 'modal-overlay'
    el.id = 'stockOverlay'
    el.style.zIndex = '1005'

    el.innerHTML = `
        <div class="modal-box assort-box">
            <div class="modal-header">
                <div class="assort-head">
                    <h3>Залишки по апарату</h3>
                    <div class="assort-sub" id="stockSub"></div>
                </div>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>
            <div class="modal-body" id="stockBody"></div>
            <div class="modal-footer"></div>
        </div>
    `

    document.body.appendChild(el)

    el.querySelector('.modal-close').addEventListener('click', closeStockModal)
    el.addEventListener('click', (e) => { if (e.target === el) closeStockModal() })

    return el
}

function closeStockModal() {
    document.getElementById('stockOverlay')?.classList.remove('active')
    if (!getTopModal()) restoreFocus()
}


// ============================================================
// блок 2. открытие окна остатков
//
// показываем скелетон, грузим данные, рисуем список.
// заглушку от 1с превращаем в пустое состояние.
// количество раскрашено по трём порогам, ноль, меньше десяти и больше
// ============================================================

async function openStockModal(pointId) {
    const point = globalData.find(i => String(i.id) === String(pointId))
    if (!point) return

    rememberFocus()

    const overlay = ensureStockModal()
    const sub = document.getElementById('stockSub')
    const body = document.getElementById('stockBody')

    sub.textContent = `${point.point_name || 'Точка'} · код ${point.id}`

    body.innerHTML = `
        <div class="assort-loading">
            <div class="skeleton skeleton-text" style="width:60%;"></div>
            <div class="skeleton skeleton-text" style="width:80%;"></div>
            <div class="skeleton skeleton-text" style="width:50%;"></div>
        </div>
    `

    overlay.classList.add('active')

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/stock?point=${encodeURIComponent(point.id)}&t=${Date.now()}`,
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

        if (!data.length) {
            body.innerHTML = emptyStateHtml('Залишки відсутні', '36px 20px', 'box')
            return
        }

        // сортируем по названию чтобы глазом было удобно искать
        const sorted = data.slice().sort((a, b) =>
            String(a.Name || '').localeCompare(String(b.Name || ''), 'uk')
        )

        body.innerHTML = `
            <div class="assort-panel">
                <div class="assort-pills" style="margin-top:0;">
                    <span class="assort-pill">${sorted.length} поз.</span>
                </div>
                <div class="stock-list">
                    ${sorted.map(it => {
                        const qty = Number(it.quantity) || 0
                        // цвет плашки зависит от количества
                        const qtyClass = qty <= 0 ? 'zero' : (qty < 10 ? 'low' : 'ok')

                        return `
                            <div class="stock-row">
                                <span class="stock-name">${escapeHtml(it.Name || '—')}</span>
                                <span class="stock-qty ${qtyClass}">${fmt(qty)}</span>
                            </div>
                        `
                    }).join('')}
                </div>
            </div>
        `

    } catch (err) {
        const message = err && err.message ? err.message : String(err)
        body.innerHTML = `
            <div class="assort-error">
                Не вдалося завантажити залишки: ${escapeHtml(message)}
            </div>
        `
    }
}