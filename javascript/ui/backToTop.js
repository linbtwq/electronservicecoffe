// ============================================================
// javascript/ui/backToTop.js
//
// назначение
// этот файл отвечает за кнопку возврата к началу списка.
//
// ответственность
// - показать кнопку при скролле вниз
// - скрыть кнопку при возврате к верху
// - плавно проскроллить контейнер результатов в начало
//
// зависимости
// - optimize.js дает window.throttle
// ============================================================


// ============================================================
// блок 1. состояние кнопки
// ============================================================

let _backToTopVisible = false
let _backToTopTimer = null


// ============================================================
// блок 2. инициализация
//
// слушаем скролл контейнера результатов.
// проверка состояния ограничена по частоте через throttle.
// если throttle недоступен используем свой таймер
// ============================================================

function initBackToTop() {
    const btn = document.getElementById('backToTop')
    const results = document.getElementById('resultsContainer')
    if (!btn || !results) return

    // ограничивает частоту проверки во время прокрутки
    const onScroll = typeof window.throttle === 'function'
        ? window.throttle(updateBackToTop, 120)
        : () => {
            if (_backToTopTimer) return
            _backToTopTimer = setTimeout(() => {
                _backToTopTimer = null
                updateBackToTop()
            }, 120)
        }

    results.addEventListener('scroll', onScroll, { passive: true })

    // клик по кнопке плавно скроллит в начало
    btn.addEventListener('click', () => {
        results.scrollTo({ top: 0, behavior: 'smooth' })
    })
}


// ============================================================
// блок 3. проверка состояния кнопки
//
// показываем только если прокрутили больше четырехсот пикселей.
// если состояние не изменилось ничего не трогаем
// ============================================================

function updateBackToTop() {
    const results = document.getElementById('resultsContainer')
    const btn = document.getElementById('backToTop')
    if (!results || !btn) return

    const show = results.scrollTop > 400
    if (show === _backToTopVisible) return

    _backToTopVisible = show
    btn.classList.toggle('visible', show)
}