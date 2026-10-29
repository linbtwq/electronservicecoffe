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
// - снять boot-класс, который предотвращает FOUC
// - обновить meta[name=theme-color] под текущую тему
//
// зависимости
// нет. работает только с dom и localStorage
// ============================================================


// ============================================================
// блок 1. инициализация темы
//
// вызывается один раз при запуске приложения.
// если тема темная, сразу ставим класс на body.
// убираем boot-класс с html, который до этого
// предотвращал мигание светлой темы.
// ============================================================

function initTheme() {
    let isDarkMode = localStorage.getItem('darkMode') === 'true'
    if (isDarkMode) document.body.classList.add('dark-theme')

    // убираем класс, который предотвращал FOUC при загрузке
    document.documentElement.classList.remove('dark-theme-boot')

    updateThemeColor(isDarkMode)

    const themeBtn = document.getElementById('themeToggle')
    if (!themeBtn) return

    // обновляет значок и подпись в соответствии с выбранной темой
    const setThemeIcon = (isDark) => {
        const path = isDark
            ? '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>'
            : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'

        themeBtn.setAttribute('aria-label', isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему')
        
        // сохраняем текст, если он есть
        const label = themeBtn.querySelector('.settings-label');
        const iconSvg = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
        
        themeBtn.innerHTML = iconSvg + (label ? label.outerHTML : '');
    }

    setThemeIcon(isDarkMode)

    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme')
        const isDark = document.body.classList.contains('dark-theme')
        localStorage.setItem('darkMode', isDark)
        setThemeIcon(isDark)
        updateThemeColor(isDark)
    })
}


// ============================================================
// блок 2. обновление theme-color meta
//
// на android влияет на цвет системного статус-бара.
// значение должно совпадать с фоном текущей темы,
// иначе панель будет выбиваться из интерфейса.
// ============================================================

function updateThemeColor(isDark) {
    try {
        let meta = document.querySelector('meta[name="theme-color"]')
        if (!meta) {
            meta = document.createElement('meta')
            meta.name = 'theme-color'
            document.head.appendChild(meta)
        }
        // #146b55 = --primary светлой темы, #111916 = --bg темной
        meta.content = isDark ? '#111916' : '#146b55'
    } catch (e) {}
}

// ============================================================
// блок 3. управление размером шрифта (A / A+ / A++)
// ============================================================

function initFontScale() {
    const btn = document.getElementById('fontScaleBtn');
    if (!btn) return;

    // Доступные размеры базового шрифта (в пикселях)
    // По умолчанию браузер использует 16px. 
    // 19px - крупный, 22px - очень крупный.
    const sizes = ['16px', '19px', '22px'];
    const labels = ['A', 'A+', 'A++'];

    // Восстанавливаем сохраненный размер
    let current = localStorage.getItem('fontScale') || '16px';
    let idx = sizes.indexOf(current);
    if (idx === -1) idx = 0; // если в кеше мусор, ставим стандартный

     // Функция применения
    const apply = (size, index) => {
        document.documentElement.style.fontSize = size;
        // Обновляем только текст внутри иконки, чтобы не стереть подпись
        const iconText = btn.querySelector('.settings-icon-text');
        if (iconText) {
            iconText.textContent = labels[index];
        } else {
            btn.textContent = labels[index];
        }
    };

    // Применяем при загрузке
    apply(sizes[idx], idx);

    // По клику переключаем по кругу: 16 -> 19 -> 22 -> 16
    btn.addEventListener('click', () => {
        idx = (idx + 1) % sizes.length;
        const newSize = sizes[idx];
        
        localStorage.setItem('fontScale', newSize);
        apply(newSize, idx);
    });
}

// Вызываем инициализацию при загрузке страницы
document.addEventListener('DOMContentLoaded', initFontScale);

// ============================================================
// блок 4. логика выпадающего меню настроек
// ============================================================

function initSettingsMenu() {
    const container = document.getElementById('settingsContainer');
    const trigger = document.getElementById('settingsTrigger');
    const menu = document.getElementById('settingsMenu');

    if (!trigger || !menu || !container) return;

    const close = () => {
        menu.classList.remove('active');
        container.classList.remove('active');
    };

    const open = () => {
        menu.classList.add('active');
        container.classList.add('active');
    };

    // клик по шестеренке переключает меню
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.classList.contains('active')) close();
        else open();
    });

    // клик в любом другом месте закрывает
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) close();
    });

    // escape тоже закрывает
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('active')) {
            close();
        }
    });
}

// вызываем инициализацию меню при загрузке
document.addEventListener('DOMContentLoaded', initSettingsMenu);