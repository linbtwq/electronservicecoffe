// ============================================================
// javascript/features/cards.js
//
// назначение
// этот файл отвечает за карточки точек.
//
// ответственность
// - собрать разметку одной карточки
// - отрисовать порцию карточек
// - перерисовать список после фильтрации
//
// особенности
// рендер порционный, по PAGE_SIZE карточек за раз.
// под списком показывается кнопка показать еще
//
// зависимости
// - core/state.js дает PAGE_SIZE, globalData, searchMode, lastResults, renderedCount, _dataRevision, _lockRevision, _lockSnapshot
// - core/utils.js дает fmt и escapeHtml
// - core/locks.js дает buildLockSnapshot, lockTimeText, isUnlimitedUser
// - ui/icons.js дает actionIconMarkup, machineIconMarkup
// - ui/backToTop.js дает updateBackToTop
// ============================================================


// ============================================================
// блок 1. карточка одной точки
//
// два вида.
// обычная карточка для режимов все и точка.
// компактная карточка для режима машина.
// ============================================================

function cardHtml(item, idx) {
    const lockSnap = _lockSnapshot[String(item.id)] || { meter: null, order: null }
    const meterLock = lockSnap.meter
    const orderLock = lockSnap.order
    const unlimited = isUnlimitedUser()
    const meterBlocked = meterLock && !unlimited
    const id = escapeHtml(item.id)

    // блок долга
    const debt = Number(item.debt) || 0
    const debtHtml = debt > 0
        ? `<div class="info-item debt-positive"><span class="debt-label">Борг:</span><span class="debt-value red">${fmt(debt)} ₴</span></div>`
        : `<div class="info-item"><span class="debt-label">Борг:</span><span class="debt-value green">0 ₴</span></div>`

    // название машины и опционально код
    let machineDisplay = escapeHtml(item.coffee_machine) || '—'
    if (item.coffee_machine_code) {
        const machineCode = `<span class="machine-code">Код <code>${escapeHtml(item.coffee_machine_code)}</code></span>`
        machineDisplay = item.coffee_machine ? `${machineDisplay} ${machineCode}` : machineCode
    }

    // режим машина, компактная карточка без кнопок
    if (searchMode === 'machine') {
        const machineName = escapeHtml(item.coffee_machine) || 'Обладнання без назви'
        const machineCode = item.coffee_machine_code
            ? `<span class="machine-card-code"><span class="machine-card-code-prefix">код</span>${escapeHtml(item.coffee_machine_code)}</span>`
            : ''
        const pointLabel = `${escapeHtml(item.point_name) || 'Без назви'}${item.id ? ' · ' + escapeHtml(item.id) : ''}`

        return `
            <div class="point-card point-card-machine${(meterLock || orderLock) ? ' locked' : ''}"
                 style="--i:${idx}"
                 data-rendered="1"
                 data-action="machines"
                 data-id="${id}"
                 role="button"
                 tabindex="0">
                <div class="machine-card-head">
                    <div class="machine-card-icon">${machineIconMarkup()}</div>
                    <div class="machine-card-info">
                        <div class="machine-card-title">${machineName}</div>
                        <div class="machine-card-meta">
                            ${machineCode}
                            <span class="machine-card-point">${pointLabel}</span>
                        </div>
                    </div>
                    ${meterBlocked ? '<span class="lock-badge">Показники зняті</span>' : ''}
                </div>

                <div class="machine-cta">
                    <span>Показати залишки</span>
                    <svg class="machine-cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </div>

                <div class="machine-expand" hidden></div>
            </div>
        `
    }

    // обычная карточка точки
    const badges = []
    if (meterBlocked) badges.push('<span class="lock-badge">Показники зняті</span>')

    // блоки примечаний под карточкой
    let notes = ''
    if (meterLock) {
        notes += `<div class="lock-note">
            Показники по цій точці вже внесені${lockTimeText(meterLock)}.${unlimited ? '' : ' Для змін зателефонуйте в 1С.'}
            ${meterLock.pending ? '<br><b>Очікує відправки в 1С (немає зв\'язку).</b>' : ''}
        </div>`
    }
    if (orderLock) {
        notes += `<div class="lock-note order">
            Поповнення по цій точці вже внесено${lockTimeText(orderLock)}.
        </div>`
    }
    if (item.recount_locked === true) {
        const at = item.recount_locked_at ? ` (${item.recount_locked_at})` : ''
        notes += `<div class="lock-note recount">
            Перерахунок по цій точці вже внесено${at}.
        </div>`
    }

    return `
        <div class="point-card${(meterLock || orderLock) ? ' locked' : ''}" style="--i:${idx}" data-rendered="1" data-id="${id}">
            <div class="point-header">
                <div>
                    <span class="point-title">${escapeHtml(item.point_name) || 'Без назви'}</span>
                    <span class="point-code">Код: ${id}</span>
                </div>
                ${badges.join('')}
            </div>

            <div class="point-grid">
                <div class="info-item"><label>Контрагент</label><span>${escapeHtml(item.counterparty) || '—'}</span></div>
                <div class="info-item"><label>Адреса</label><span>${escapeHtml(item.address) || '—'}</span></div>
                <div class="info-item machine-info"><label>Обладнання</label><span class="${item.coffee_machine ? 'machine-tag' : ''}">${machineDisplay}</span></div>

                ${debtHtml}
            </div>

            <div class="card-actions">
                <button class="action-btn" data-action="open" data-id="${id}" ${meterBlocked ? 'disabled' : ''}>${actionIconMarkup('open')}<span>Показники</span></button>
                <button class="action-btn" data-action="assort" data-id="${id}">${actionIconMarkup('assort')}<span>Поповнення</span></button>
                <button class="action-btn btn-success" data-action="pay" data-id="${id}" ${debt > 0 ? '' : 'disabled'}>${actionIconMarkup('pay')}<span>ПКО</span></button>
                <button class="action-btn" data-action="stock" data-id="${id}">${actionIconMarkup('stock')}<span>Залишки</span></button>
                <button class="action-btn" data-action="shipment" data-id="${id}">${actionIconMarkup('shipment')}<span>Відвантаж.</span></button>
                <button class="action-btn" data-action="recount" data-id="${id}">${actionIconMarkup('recount')}<span>Перерах.</span></button>
                <button class="action-btn" data-action="note" data-id="${id}">${actionIconMarkup('note')}<span>Примітка</span></button>
            </div>

            ${notes}

            ${searchMode === 'all' ? `
            <div class="machine-cta" data-action="machines" data-id="${id}" role="button" tabindex="0">
                ${machineIconMarkup()}
                <span>Показати залишки</span>
                <svg class="machine-cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>
            <div class="machine-expand" hidden></div>
            ` : ''}
        </div>`
}


// ============================================================
// блок 2. порционный рендер
//
// доклеивает PAGE_SIZE карточек за один вызов.
// если остались еще, добавляет кнопку показать еще.
// ============================================================

function appendCards(container, replace) {
    const start = renderedCount
    const end = Math.min(start + PAGE_SIZE, lastResults.length)
    const remaining = lastResults.length - end

    let html = ''
    for (let i = start; i < end; i++) {
        html += cardHtml(lastResults[i], i - start)
    }

    // кнопка показать еще если остались карточки
    if (remaining > 0) {
        const shown = end
        const total = lastResults.length
        const nextBatch = Math.min(PAGE_SIZE, remaining)

        html += `<div class="show-more-wrap">
            <div class="show-more-progress">${shown} із ${total}</div>
            <button class="action-btn btn-secondary" data-action="more">Показати ще ${nextBatch}</button>
        </div>`
    }

    renderedCount = end

    if (replace) {
        container.innerHTML = html
    } else {
        // при дозаклейке убираем старую кнопку показать еще
        const old = container.querySelector('.show-more-wrap')
        if (old) old.remove()
        container.insertAdjacentHTML('beforeend', html)
    }
}


// ============================================================
// блок 3. точка входа в рендер результатов
//
// собирает ключ рендера и если он не менялся ничего не делает.
// ключ включает ревизию данных, ревизию блокировок, режим,
// строку поиска и признак админа
// ============================================================

function renderResults(data) {
    const container = document.getElementById('resultsContainer')
    if (!container) return

    buildLockSnapshot()

    const searchInput = document.getElementById('searchInput')
    const query = searchInput ? searchInput.value.trim().toLowerCase() : ''
    const key = `${_dataRevision}:${_lockRevision}:${searchMode}:${query}:${isUnlimitedUser() ? 1 : 0}`

    // одиночный результат растягивается на всю ширину
    container.classList.toggle('single-result', data.length === 1)

    // если ключ не менялся и карточки уже отрисованы, выходим
    const first = container.firstElementChild
    if (container.dataset.renderKey === key && first && first.hasAttribute('data-rendered')) return
    container.dataset.renderKey = key

    lastResults = data
    renderedCount = 0

    if (data.length === 0) {
        container.innerHTML = `<div class="empty-state" data-rendered="1">${SEARCH_MODES[searchMode].empty}</div>`
    } else {
        appendCards(container, true)
    }

    container.scrollTop = 0
    updateBackToTop()
}