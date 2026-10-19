// ============================================================
// javascript/ui/dialog.js
//
// назначение
// этот файл дает универсальный диалог подтверждения.
//
// ответственность
// - показать диалог с заголовком, текстом и списком деталей
// - вернуть promise с ответом пользователя
// - обработать escape и enter
//
// зависимости
// - core/utils.js дает escapeHtml
// ============================================================


// ============================================================
// блок 1. определение поля формы
//
// нужно чтобы enter в активном поле не подтверждал диалог
// иначе пользователь не сможет ввести текст с новой строки
// ============================================================

const _isFormField = (el) => {
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}


// ============================================================
// блок 2. показ диалога
//
// диалог уже есть в разметке index.html.
// тут только заполняем тексты и вешаем обработчики.
// обработчики снимаются после закрытия чтобы не накопились
// ============================================================

function showConfirmDialog({ title, message, details, okText, cancelText, danger }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmDialogOverlay')
        const titleEl = document.getElementById('confirmDialogTitle')
        const msgEl = document.getElementById('confirmDialogMessage')
        const detailsEl = document.getElementById('confirmDialogDetails')
        const okBtn = document.getElementById('confirmDialogOk')
        const cancelBtn = document.getElementById('confirmDialogCancel')

        // если разметки нет просто отдаем отказ
        if (!overlay || !okBtn || !cancelBtn) {
            resolve(false)
            return
        }

        // заполняем заголовок и текст
        titleEl.textContent = title || 'Підтвердіть дію'
        msgEl.textContent = message || ''
        msgEl.style.display = message ? '' : 'none'

        // список деталей опциональный
        if (Array.isArray(details) && details.length) {
            detailsEl.innerHTML = '<ul>' + details.map(d => `<li>${escapeHtml(d)}</li>`).join('') + '</ul>'
            detailsEl.style.display = ''
        } else {
            detailsEl.innerHTML = ''
            detailsEl.style.display = 'none'
        }

        // тексты и стиль кнопок
        okBtn.textContent = okText || 'OK'
        cancelBtn.textContent = cancelText || 'Скасувати'
        okBtn.className = 'action-btn ' + (danger ? 'btn-danger' : 'btn-success')

        // удаляет обработчики чтобы они не сработали повторно
        const cleanup = () => {
            overlay.classList.remove('active')
            okBtn.removeEventListener('click', onOk)
            cancelBtn.removeEventListener('click', onCancel)
            overlay.removeEventListener('click', onOverlayClick)
            document.removeEventListener('keydown', onKey)
        }

        const onOk = () => { cleanup(); resolve(true) }
        const onCancel = () => { cleanup(); resolve(false) }
        const onOverlayClick = (e) => { if (e.target === overlay) onCancel() }

        // клавиши закрывают диалог
        // enter не срабатывает если фокус в поле ввода
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
            } else if (e.key === 'Enter' && !_isFormField(document.activeElement)) {
                e.preventDefault()
                onOk()
            }
        }

        okBtn.addEventListener('click', onOk)
        cancelBtn.addEventListener('click', onCancel)
        overlay.addEventListener('click', onOverlayClick)
        document.addEventListener('keydown', onKey)

        overlay.classList.add('active')
        setTimeout(() => okBtn.focus(), 80)
    })
}