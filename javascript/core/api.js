// ============================================================
// javascript/core/api.js
// ============================================================

async function fetchWithTimeout(url, options = {}, ms = APP_CONFIG.loadTimeoutMs) {
    const ctrl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        ctrl.abort()
    }, ms)

    if (options.signal) {
        if (options.signal.aborted) {
            ctrl.abort()
        } else {
            options.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
        }
    }

    try {
        return await fetch(url, { ...options, signal: ctrl.signal })
    } catch (err) {
        if (err.name === 'AbortError' && timedOut) throw new Error('Failed to fetch (timeout)')
        throw err
    } finally {
        clearTimeout(timer)
    }
}

const newRequestId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

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