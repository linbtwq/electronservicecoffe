// ============================================================
// javascript/core/api.js
//
// назначение
// этот файл отвечает за сетевые запросы к сервису 1с.
//
// ответственность
// - выполнять fetch с ограничением по времени
// - собирать уникальные идентификаторы запросов
// - публиковать общий помощник postJson
// - управлять полосой загрузки вверху экрана
//
// зависимости
// - config.js дает APP_CONFIG
// - core/state.js дает apiBase
// - auth.js дает currentUser (для заголовка X-User-Code)
// ============================================================


// ============================================================
// блок 1. сетевые запросы
// ============================================================

// завершает зависший запрос по таймауту
// по умолчанию время ожидания берется из настроек
async function fetchWithTimeout(url, options = {}, ms = APP_CONFIG.loadTimeoutMs) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)

    try {
        return await fetch(url, { ...options, signal: ctrl.signal })
    } catch (err) {
        // превращаем ошибку отмены в понятный текст
        // по нему другие модули различают таймаут и прочие ошибки
        if (err.name === 'AbortError') throw new Error('Failed to fetch (timeout)')
        throw err
    } finally {
        clearTimeout(timer)
    }
}

// создает уникальный ключ запроса
// сервер использует его чтобы не создавать документ дважды
const newRequestId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

// отправляет данные в формате json с общим таймаутом отправки.
// код пользователя уходит и в заголовке X-User-Code
// (как во всех остальных ручных вызовах fetchWithTimeout),
// и в теле payload через technician_id.
const postJson = (path, payload) => fetchWithTimeout(
    `${apiBase}/${path}?v=${APP_CONFIG.apiVersion}`,
    {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(typeof currentUser !== 'undefined' && currentUser
                ? { 'X-User-Code': currentUser.id }
                : {})
        },
        body: JSON.stringify(payload)
    },
    APP_CONFIG.sendTimeoutMs
)


// ============================================================
// блок 2. полоса загрузки вверху экрана
//
// показывается при старте fetch и уходит сама через секунду с лишним.
// перезапуск анимации делается через принудительный reflow
// чтобы полоса мигнула даже если уже была активна.
//
// таймер скрытия хранится в переменной и сбрасывается
// при новом вызове hideTopProgress, иначе несколько параллельных
// fetch'ей могли погасить полоску раньше времени.
// ============================================================

let _topProgressHideTimer = null

function showTopProgress() {
    const el = document.getElementById('topProgress')
    if (!el) return
    el.classList.remove('active')
    void el.offsetWidth
    el.classList.add('active')
}

function hideTopProgress() {
    const el = document.getElementById('topProgress')
    if (!el) return
    clearTimeout(_topProgressHideTimer)
    _topProgressHideTimer = setTimeout(() => el.classList.remove('active'), 1800)
}