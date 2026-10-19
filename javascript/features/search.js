// ============================================================
// javascript/features/search.js
//
// назначение
// этот файл отвечает за поиск и фильтрацию точек.
//
// ответственность
// - навесить обработчики на кнопки фильтра
// - применить тексты и классы под текущий режим
// - фильтровать точки по запросу с учетом режима
// - строить ленивый индекс по каждой точке
// - показывать скелетоны пока данных нет
// - переключать вид поиска с центра на верх и обратно
//
// зависимости
// - core/state.js дает SEARCH_MODES, globalData, searchMode, searchTimer, renderFrame, lastDeleteTime, isAtTop, isLoading
// - core/utils.js дает stripZeros и normalizeCode
// - features/cards.js дает renderResults
// ============================================================


// ============================================================
// блок 1. инициализация фильтров
//
// навешивает обработчики на три кнопки.
// при переключении режима сохраняет его в localStorage.
// ============================================================

function initSearchFilters() {
    const searchInput = document.getElementById('searchInput')

    applySearchMode()

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            searchMode = chip.dataset.mode
            localStorage.setItem('searchMode', searchMode)
            applySearchMode()

            if (searchMode === 'machine') {
                // в режиме машина поле поиска не нужно
                if (searchInput) searchInput.value = ''
                showAllMachines()
            } else {
                if (searchInput) {
                    if (window.matchMedia('(pointer: fine)').matches) searchInput.focus()

                    if (searchInput.value.trim() !== '') {
                        handleSearch({ target: searchInput })
                    } else {
                        resetSearchView()
                    }
                }
            }
        })
    })
}


// ============================================================
// блок 2. применение режима поиска
//
// меняет плейсхолдер, подсказку и активную кнопку.
// в режиме машина добавляет класс который скрывает поле поиска.
// ============================================================

function applySearchMode() {
    const cfg = SEARCH_MODES[searchMode]

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.mode === searchMode)
    })

    const searchInput = document.getElementById('searchInput')
    const hint = document.getElementById('searchHint')
    const searchContainer = document.getElementById('searchContainer')

    if (searchInput) {
        searchInput.placeholder = cfg.placeholder
    }
    if (hint) hint.textContent = cfg.hint

    if (searchContainer) {
        searchContainer.classList.toggle('machine-mode', cfg.hideSearch === true)
    }
}


// ============================================================
// блок 3. обработка ввода в поле поиска
//
// пустой запрос возвращает поиск в центр.
// при быстром стирании показываем подсказку.
// при обычном вводе переключаем поиск на верх и запускаем фильтрацию.
//
// на больших списках добавляем задержку чтобы не фильтровать на каждый символ.
// ============================================================

function handleSearch(e) {
    const query = e.target.value?.trim().toLowerCase() || ''
    const searchContainer = document.getElementById('searchContainer')
    const resultsContainer = document.getElementById('resultsContainer')
    if (!searchContainer || !resultsContainer) return

    // пока данных нет, показываем скелетоны
    if (!globalData.length && isLoading && query !== '') {
        showSkeletons()
        return
    }

    const now = Date.now()
    const isDeleting = e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward'

    if (query === '') {
        // хитрое поведение чтобы быстро показать подсказку когда стирают запрос
        if (isDeleting && (now - lastDeleteTime < 400) && isAtTop) {
            resultsContainer.innerHTML = `<div class="empty-state">Введіть код точки для пошуку</div>`
            resultsContainer.classList.add('active')
        } else {
            searchContainer.classList.remove('top')
            searchContainer.classList.add('center')
            resultsContainer.classList.remove('active')
            isAtTop = false
        }
        return
    }

    if (isDeleting) lastDeleteTime = now

    // как только начали печатать, поднимаем поиск вверх
    if (!isAtTop) {
        searchContainer.classList.remove('center')
        searchContainer.classList.add('top')
        resultsContainer.classList.add('active')
        isAtTop = true
    }

    clearTimeout(searchTimer)

    const run = () => {
        cancelAnimationFrame(renderFrame)
        renderFrame = requestAnimationFrame(() => renderResults(filterPoints(query)))
    }

    // на больших списках добавляем задержку чтобы не фильтровать каждый раз
    if (globalData.length > 300) searchTimer = setTimeout(run, 120)
    else run()
}


// ============================================================
// блок 4. скелетоны пока данных нет
// ============================================================

function showSkeletons() {
    const container = document.getElementById('resultsContainer')
    if (!container) return

    if (container.dataset.renderKey === 'skeletons') return
    container.dataset.renderKey = 'skeletons'

    container.innerHTML = Array(3).fill(`
        <div class="point-card skeleton-card">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text" style="width:60%"></div>
        </div>
    `).join('')

    container.classList.add('active')
}


// ============================================================
// блок 5. ленивый индекс по точке
//
// первый вызов считает строки для поиска и кладет их в саму точку.
// повторные вызовы берут готовое.
// поле не участвует в json-сериализации чтобы не попадало в кеш.
// ============================================================

function ix(item) {
    let ix = item._ix
    if (ix) return ix

    // склеиваем название, контрагента и адрес в одну строку
    const name = ((item.point_name || '') + '\n' + (item.counterparty || '') + '\n' + (item.address || '')).toLowerCase()
    // склеиваем название оборудования и код
    const machine = ((item.coffee_machine || '') + '\n' + (item.coffee_machine_code || '')).toLowerCase()
    // код машины без пробелов для точного сравнения
    const mcRaw = String(item.coffee_machine_code ?? '').toLowerCase().replace(/\s+/g, '')

    ix = {
        id: stripZeros(item.id),
        mc: normalizeCode(item.coffee_machine_code),
        mcRaw,
        name,
        machine,
        all: name + '\n' + machine,
        numId: Number(item.id) || 0
    }

    // enumerable false чтобы не мешало json-сериализации
    Object.defineProperty(item, '_ix', { enumerable: false, value: ix })
    return ix
}


// ============================================================
// блок 6. сортировка точек по id
//
// результат кешируется до следующего обновления данных.
// ============================================================

function getSortedData() {
    if (_sortedDataSource !== globalData) {
        _sortedDataSource = globalData
        _sortedData = globalData.slice().sort((a, b) =>
            (Number(a.id) || 0) - (Number(b.id) || 0)
        )
    }
    return _sortedData
}


// ============================================================
// блок 7. главная функция фильтрации
//
// в зависимости от режима ищет по разным полям.
// запрос из одних нулей значит показать все.
// цифровой запрос сортирует точные совпадения вверх.
// ============================================================

function filterPoints(query, mode = searchMode) {
    const q = String(query || '').trim().toLowerCase()
    const isDigits = /^\d+$/.test(q)
    const num = stripZeros(q)

    // запрос из нулей значит показать все
    if (isDigits && num === '') {
        const sorted = getSortedData()
        return mode === 'machine'
            ? sorted.filter(i => i.coffee_machine_code || i.coffee_machine)
            : sorted
    }

    const results = []

    for (let i = 0; i < globalData.length; i++) {
        const item = globalData[i]
        const data = ix(item)

        const matchId = isDigits && (data.id === num)
        const matchMachineCode = isDigits && (data.mc === num)
        const matchMachineRaw = data.mcRaw.includes(q)

        let hit

        if (mode === 'machine') {
            // ищем и по машине и по точке чтобы можно было найти по любому полю
            hit = data.machine.includes(q)
                || matchMachineCode
                || matchMachineRaw
                || matchId
                || data.name.includes(q)
        } else if (mode === 'point') {
            hit = data.name.includes(q) || matchId
        } else {
            hit = data.all.includes(q) || matchId || matchMachineCode || matchMachineRaw
        }

        if (hit) results.push(item)
    }

    // если запрос цифровой, точные совпадения идут вверх
    if (isDigits) {
        results.sort((a, b) => {
            const aExact = (ix(a).id === num || ix(a).mc === num) ? 1 : 0
            const bExact = (ix(b).id === num || ix(b).mc === num) ? 1 : 0
            if (aExact !== bExact) return bExact - aExact
            return (Number(a.id) || 0) - (Number(b.id) || 0)
        })
    }

    return results
}


// ============================================================
// блок 8. переключение вида поиска
// ============================================================

// показать все аппараты в режиме машина
function showAllMachines() {
    const searchContainer = document.getElementById('searchContainer')
    const resultsContainer = document.getElementById('resultsContainer')
    if (!searchContainer || !resultsContainer) return

    searchContainer.classList.remove('center')
    searchContainer.classList.add('top')
    resultsContainer.classList.add('active')
    isAtTop = true

    clearTimeout(searchTimer)
    cancelAnimationFrame(renderFrame)
    renderFrame = requestAnimationFrame(() => renderResults(filterPoints('0')))
}

// вернуть поиск в центральное положение
function resetSearchView() {
    const searchContainer = document.getElementById('searchContainer')
    const resultsContainer = document.getElementById('resultsContainer')
    if (!searchContainer || !resultsContainer) return

    searchContainer.classList.remove('top')
    searchContainer.classList.add('center')
    resultsContainer.classList.remove('active')
    isAtTop = false
}


// ============================================================
// блок 9. перерисовка результатов
//
// используется после обновления данных или смены пользователя
// ============================================================

function refreshResults() {
    if (searchMode === 'machine') {
        showAllMachines()
        return
    }

    const input = document.getElementById('searchInput')
    if (input && input.value.trim() !== '') handleSearch({ target: input })
}