// ============================================================
// auth.js
//
// назначение
// этот файл отвечает за авторизацию пользователя.
//
// ответственность
// - восстановить сохраненную сессию при запуске
// - показать форму входа если сессии нет
// - проверить пин-код на сервере 1с
// - сохранить пользователя в localStorage
// - корректно выйти из системы по кнопке
//
// как устроена сессия
// после успешного входа объект пользователя кладется в localStorage
// под ключом currentUser.
// при следующем запуске сессия поднимается оттуда.
//
// зависимости
// - config.js дает адрес сервиса через APP_CONFIG
// - app/init.js, app/reset.js, core/storage.js дает startApp, resetAppState, clearLocalDb
// - drawer.js подхватывает имя и роль пользователя
//
// порядок подключения
// index.html подключает auth.js после config.js
// но до ядра и функциональных модулей
// ============================================================

// текущий пользователь
// null пока сессии нет
// объект вида id, name, isAdmin когда вход выполнен
let currentUser = null;

// ============================================================
// блок 1. восстановление сессии при запуске
//
// этот код выполняется сразу при подключении файла.
// он пытается поднять сохраненного пользователя из localStorage.
// если данные битые или пустые ключ удаляется.
// ============================================================

(function checkInitialAuth() {
    try {
        const saved = localStorage.getItem('currentUser');
        if (!saved) return;

        const parsed = JSON.parse(saved);
        if (parsed && parsed.id) {
            currentUser = parsed;
        } else {
            // ключ есть а валидного пользователя внутри нет
            localStorage.removeItem('currentUser');
        }
    } catch (e) {
        // json битый, чистим ключ и продолжаем как гость
        localStorage.removeItem('currentUser');
        currentUser = null;
    }
})();

// ============================================================
// блок 2. настройка формы входа после загрузки страницы
//
// тут два сценария.
// если пользователь уже сохранен, форма входа скрывается
// и приложение запускается через startApp.
// иначе форма показывается и ставится фокус в поле пин-кода.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    const authOverlay = document.getElementById('authOverlay');
    const pinInput = document.getElementById('pinInput');

    if (currentUser) {
        // сессия есть, прячем форму и стартуем приложение
        if (authOverlay) authOverlay.style.display = 'none';
        showUserInfo();
        if (typeof startApp === 'function') startApp();
    } else {
        // сессии нет, показываем форму
        if (authOverlay) authOverlay.style.display = 'flex';
        // на устройствах с мышью сразу ставим фокус в поле
        if (pinInput && window.matchMedia('(pointer: fine)').matches) pinInput.focus();
    }

    if (pinInput) {
        // пропускаем в поле только цифры
        // и убираем сообщение об ошибке как только пользователь начал печатать
        pinInput.addEventListener('input', () => {
            pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 12);
            const err = document.getElementById('authError');
            if (err) err.style.display = 'none';
        });

        // enter запускает вход
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                login();
            }
        });
    }
});

// ============================================================
// блок 3. вход по пин-коду
//
// порядок такой
// 1. читаем пин из поля, отсекаем пустой ввод
// 2. блокируем кнопку и показываем текст «проверка»
// 3. делаем POST на /login
// 4. проверяем что сервер вернул код пользователя
// 5. сохраняем пользователя и запускаем приложение
//
// при ошибке различаем два случая.
// неверный пин и отсутствие связи с 1с.
// ============================================================

async function login() {
    const pinInput = document.getElementById('pinInput');
    const errorMsg = document.getElementById('authError');
    const authOverlay = document.getElementById('authOverlay');
    const loginBtn = authOverlay ? authOverlay.querySelector('.action-btn') : null;

    // если хоть одного элемента нет выходим
    if (!pinInput || !errorMsg || !authOverlay || !loginBtn) return;

    const pin = pinInput.value.trim();
    if (!pin) {
        errorMsg.textContent = 'Введіть ПІН-код';
        errorMsg.style.display = 'block';
        pinInput.focus();
        return;
    }

    // блокируем повторные нажатия на время запроса
    loginBtn.disabled = true;
    loginBtn.textContent = 'Перевірка...';
    errorMsg.style.display = 'none';

    try {
        // адрес сервиса берем из настроек и убираем завершающий слеш
        const apiBaseUrl = String(APP_CONFIG.apiBase).replace(/\/+$/, '');
        const response = await fetch(`${apiBaseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });

        // сеть ответила но статус плохой
        if (!response.ok) throw new Error('server');

        const data = await response.json();

        // пустой код или код 0 значит пин неверный
        if (!data || !data.Code || String(data.Code) === '0') {
            throw new Error('pin');
        }

        // сохраняем пользователя
        currentUser = {
            id: String(data.Code),
            name: data.Name || 'Користувач',
            isAdmin: data.IsAdmin === true
        };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        // плавно прячем форму входа
        authOverlay.classList.add('fade-out');
        setTimeout(() => {
            authOverlay.style.display = 'none';
            authOverlay.classList.remove('fade-out');
        }, 250);

        // чистим поле и запускаем приложение
        pinInput.value = '';
        showUserInfo();
        if (typeof startApp === 'function') startApp();
    } catch (err) {
        const isPin = err && err.message === 'pin';
        errorMsg.textContent = isPin ? 'Невірний ПІН-код' : 'Немає зв\'язку з 1С';
        errorMsg.style.display = 'block';

        // короткая вибрация на мобильных
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        // анимация тряски поля
        pinInput.classList.remove('shake');
        void pinInput.offsetWidth;
        pinInput.classList.add('shake');
        pinInput.value = '';
    } finally {
        // снимаем блокировку кнопки в любом случае
        loginBtn.disabled = false;
        loginBtn.textContent = 'Увійти';
        pinInput.focus();
    }
}

// ============================================================
// блок 4. выход из системы
//
// задача аккуратно обнулить все что связано с прошлой сессией.
// порядок такой
// 1. чистим кеш поиска номенклатуры
// 2. закрываем боковую панель
// 3. закрываем все открытые модалки
// 4. удаляем пользователя из localStorage
// 5. чистим локальную базу кроме очереди
// 6. показываем форму входа
// 7. сбрасываем состояние приложения через resetAppState
// ============================================================

function logout() {
    // сбрасываем кеш поиска товаров
    if (typeof goodsSearchCache !== 'undefined') {
        goodsSearchCache.clear();
    }

    // закрываем боковую панель если она открыта
    if (typeof closeDrawer === 'function') {
        try { closeDrawer(); } catch (e) {}
    }

    // принудительно закрываем все активные модалки
    document.querySelectorAll('.modal-overlay.active')
        .forEach(m => m.classList.remove('active'));

    // стираем пользователя
    localStorage.removeItem('currentUser');
    currentUser = null;

    // чистим локальную базу кеша
    // очередь и список отклоненных записей сохраняются
    // их нельзя терять при выходе из системы
    if (typeof window.clearLocalDb === 'function') {
        try { window.clearLocalDb().catch(() => {}); } catch (e) {}
    }

    // показываем форму входа
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';

    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.value = '';
        if (window.matchMedia('(pointer: fine)').matches) pinInput.focus();
    }

    // чистим визуальные следы прошлого пользователя
    const userBadge = document.getElementById('userBadge');
    if (userBadge) userBadge.replaceChildren();

    const resultsContainer = document.getElementById('resultsContainer');
    if (resultsContainer) resultsContainer.innerHTML = '';

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    // сбрасываем состояние приложения
    if (typeof resetAppState === 'function') resetAppState();
}

// ============================================================
// блок 5. показ имени пользователя и кнопки выхода
//
// создает два элемента в блоке userBadge
// первый это имя с иконкой
// второй это кнопка выхода
//
// метод replaceChildren полностью заменяет содержимое блока
// это дешевле чем удалять старое вручную
// ============================================================

function showUserInfo() {
    const userBadge = document.getElementById('userBadge');
    if (!userBadge || !currentUser) return;

    // имя пользователя
    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = `👤 ${currentUser.name}`;

    // кнопка выхода
    const btn = document.createElement('button');
    btn.className = 'logout-btn';
    btn.type = 'button';
    btn.textContent = 'Вийти';
    btn.addEventListener('click', logout);

    userBadge.replaceChildren(name, btn);

    // синхронизируем имя и роль в боковой панели
    if (typeof updateDrawerUser === 'function') {
        updateDrawerUser();
    }
}