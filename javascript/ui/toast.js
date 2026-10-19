// ============================================================
// javascript/ui/toast.js
//
// назначение
// этот файл отвечает за короткие уведомления.
//
// ответственность
// - показать тост сверху экрана
// - показать большую галочку успеха в центре
//
// зависимости
// - core/state.js дает toastTimer
// ============================================================


// ============================================================
// блок 1. большая галочка успеха
//
// используется после успешной отправки документа.
// добавляет элемент в body, потом удаляет его через полторы секунды.
// на мобильных коротко вибрирует
// ============================================================

function showSuccessAnimation() {
    const el = document.createElement('div')
    el.className = 'success-burst'
    el.innerHTML = '<svg viewBox="0 0 52 52"><path fill="none" d="M14 27l8 8 16-17"/></svg>'
    document.body.appendChild(el)

    if (navigator.vibrate) navigator.vibrate(40)

    setTimeout(() => el.classList.add('out'), 1000)
    setTimeout(() => el.remove(), 1450)
}


// ============================================================
// блок 2. тост
//
// всплывающая плашка сверху экрана.
// перезапуск анимации через принудительный reflow.
// исчезает через три с половиной секунды.
//
// isError меняет цвет и иконку
// ============================================================

function showToast(message, isError = false) {
    const toast = document.getElementById('toast')
    if (!toast) return

    const msgEl = document.getElementById('toastMessage')
    if (msgEl) msgEl.textContent = message

    clearTimeout(toastTimer)
    toast.classList.remove('show')
    void toast.offsetWidth
    toast.className = `toast show ${isError ? 'error' : ''}`

    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500)
}