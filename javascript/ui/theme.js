// ============================================================
// javascript/ui/theme.js
//
// назначение
// этот файл отвечает за темную тему.
//
// ответственность
// - восстановить выбор темы из localStorage
// - переключить тему по кнопке
// - обновить иконку и подпись кнопки
//
// зависимости
// нет. работает только с dom и localStorage
// ============================================================


// ============================================================
// блок 1. инициализация темы
//
// вызывается один раз при запуске приложения.
// если тема темная, сразу ставим класс на body
// ============================================================

function initTheme() {
    let isDarkMode = localStorage.getItem('darkMode') === 'true'
    if (isDarkMode) document.body.classList.add('dark-theme')

    const themeBtn = document.getElementById('themeToggle')
    if (!themeBtn) return

    // обновляет значок и подпись в соответствии с выбранной темой
    const setThemeIcon = (isDark) => {
        const path = isDark
            ? '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>'
            : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'

        themeBtn.setAttribute('aria-label', isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему')
        themeBtn.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
    }

    setThemeIcon(isDarkMode)

    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme')
        const isDark = document.body.classList.contains('dark-theme')
        localStorage.setItem('darkMode', isDark)
        setThemeIcon(isDark)
    })
}