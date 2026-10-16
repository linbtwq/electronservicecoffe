// ============================================================
// drawer.js
//
// назначение
// этот файл отвечает за боковую панель приложения.
//
// ответственность
// - создать панель и ручку открытия
// - показать имя и роль текущего пользователя
// - встроить каталог номенклатуры внутрь панели
// - закрывать по крестику, по затемнению и по свайпу
//
// зависимости
// - currentUser из auth.js
// - APP_VERSION из version.js
// - logout из auth.js
// - refreshDrawerGoods из goods.js
//
// порядок подключения
// index.html подключает drawer.js после script.js
// ============================================================

// флаги и ссылки на элементы панели
// создаются один раз при первом открытии
let _drawerBuilt = false;
let _drawerHandle = null;
let _drawerEl = null;
let _drawerOverlay = null;
let _drawerPrevFocus = null;

// ============================================================
// блок 1. создание разметки панели
//
// панель строится программно и вставляется в body.
// вызывается один раз, повторные вызовы просто выходят.
//
// внутри панели три части.
// шапка с аватаром и именем.
// тело куда goods.js вставит каталог.
// подвал с кнопкой выхода и версией.
// ============================================================

function ensureDrawer() {
    if (_drawerBuilt) return;
    _drawerBuilt = true;

    // ручка открытия, всегда видна слева сверху
    _drawerHandle = document.createElement('button');
    _drawerHandle.type = 'button';
    _drawerHandle.className = 'drawer-handle';
    _drawerHandle.setAttribute('aria-label', 'Відкрити меню');
    _drawerHandle.setAttribute('aria-controls', 'appDrawer');
    _drawerHandle.setAttribute('aria-expanded', 'false');
    _drawerHandle.innerHTML = '<svg class="drawer-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    _drawerHandle.addEventListener('click', openDrawer);

    // затемнение вокруг панели
    _drawerOverlay = document.createElement('div');
    _drawerOverlay.className = 'drawer-overlay';
    _drawerOverlay.addEventListener('click', closeDrawer);

    // сама панель
    _drawerEl = document.createElement('aside');
    _drawerEl.className = 'app-drawer';
    _drawerEl.id = 'appDrawer';
    _drawerEl.setAttribute('aria-hidden', 'true');
    _drawerEl.innerHTML = `
        <div class="drawer-head">
            <div class="drawer-user">
                <div class="drawer-avatar" id="drawerAvatar">?</div>
                <div class="drawer-user-text">
                    <div class="drawer-user-name" id="drawerUserName">—</div>
                    <div class="drawer-user-role" id="drawerUserRole"></div>
                </div>
            </div>
            <button type="button" class="drawer-close" id="drawerClose" aria-label="Закрити">✕</button>
        </div>
        <div class="drawer-body">
            <div id="drawerGoods"></div>
        </div>
        <div class="drawer-foot" id="drawerFoot">
            <button type="button" class="drawer-logout" id="drawerLogout">Вийти</button>
            <span class="drawer-version" id="drawerVersion"></span>
        </div>
    `;

    document.body.appendChild(_drawerHandle);
    document.body.appendChild(_drawerOverlay);
    document.body.appendChild(_drawerEl);

    // кнопки закрытия и выхода
    _drawerEl.querySelector('#drawerClose').addEventListener('click', closeDrawer);
    _drawerEl.querySelector('#drawerLogout').addEventListener('click', () => {
        if (typeof logout === 'function') logout();
    });
}

// ============================================================
// блок 2. обновление данных пользователя
//
// показываем имя, роль и первую букву имени в аватаре.
// в подвале выводим версию приложения.
// ============================================================

function updateDrawerUser() {
    if (!_drawerEl) return;
    const nameEl = _drawerEl.querySelector('#drawerUserName');
    const roleEl = _drawerEl.querySelector('#drawerUserRole');
    const avatarEl = _drawerEl.querySelector('#drawerAvatar');
    const versionEl = _drawerEl.querySelector('#drawerVersion');

    if (currentUser) {
        const name = currentUser.name || 'Користувач';
        nameEl.textContent = name;
        roleEl.textContent = currentUser.isAdmin ? 'Адміністратор' : (currentUser.role || '');
        // первая буква имени в аватар
        avatarEl.textContent = name.trim().charAt(0).toUpperCase() || '?';
    } else {
        nameEl.textContent = '—';
        roleEl.textContent = '';
        avatarEl.textContent = '?';
    }

    if (versionEl && typeof APP_VERSION !== 'undefined') {
        versionEl.textContent = 'v' + APP_VERSION;
    }
}

// ============================================================
// блок 3. открытие панели
//
// сохраняем текущий фокус чтобы вернуть его после закрытия.
// показываем панель и затемнение.
// подтягиваем имя пользователя и грузим каталог.
// ============================================================

function openDrawer() {
    ensureDrawer();
    if (_drawerEl.classList.contains('open')) return;

    // запоминаем фокус до открытия
    _drawerPrevFocus = document.activeElement;
    _drawerEl.classList.add('open');
    _drawerEl.setAttribute('aria-hidden', 'false');
    _drawerHandle.setAttribute('aria-label', 'Закрити меню');
    _drawerHandle.setAttribute('aria-expanded', 'true');
    _drawerOverlay.classList.add('active');
    document.body.classList.add('drawer-open');

    updateDrawerUser();
    if (typeof refreshDrawerGoods === 'function') {
        refreshDrawerGoods();
    }

    // фокус на кнопку закрытия
    setTimeout(() => {
        const btn = _drawerEl.querySelector('#drawerClose');
        if (btn) btn.focus();
    }, 80);
}

// ============================================================
// блок 4. закрытие панели
//
// скрываем панель и затемнение.
// возвращаем фокус на элемент который был активен до открытия.
// ============================================================

function closeDrawer() {
    if (!_drawerEl || !_drawerEl.classList.contains('open')) return;
    _drawerEl.classList.remove('open');
    _drawerEl.setAttribute('aria-hidden', 'true');
    _drawerHandle.setAttribute('aria-label', 'Відкрити меню');
    _drawerHandle.setAttribute('aria-expanded', 'false');
    _drawerOverlay.classList.remove('active');
    document.body.classList.remove('drawer-open');

    // возвращаем фокус если элемент ещё в документе
    if (_drawerPrevFocus && document.contains(_drawerPrevFocus)) {
        try { _drawerPrevFocus.focus(); } catch (e) {}
    }
    _drawerPrevFocus = null;
}

// ============================================================
// блок 5. проверка открыта ли панель
//
// используется снаружи и внутри этого файла.
// ============================================================

function isDrawerOpen() {
    return !!_drawerEl && _drawerEl.classList.contains('open');
}

// ============================================================
// блок 6. закрытие по клавише escape
// ============================================================

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDrawerOpen()) {
        e.preventDefault();
        closeDrawer();
    }
});

// ============================================================
// блок 7. закрытие свайпом влево
//
// запоминаем начальную точку касания при открытой панели.
// при завершении жеста проверяем что смещение влево заметное
// и вертикальное смещение небольшое.
// ============================================================

let _drawerTouchX = 0;
let _drawerTouchY = 0;

document.addEventListener('touchstart', (e) => {
    if (!isDrawerOpen()) return;
    const t = e.touches[0];
    _drawerTouchX = t.clientX;
    _drawerTouchY = t.clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (!isDrawerOpen()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - _drawerTouchX;
    const dy = t.clientY - _drawerTouchY;
    // свайп влево больше шестидесяти пикселей и почти горизонтальный
    if (dx < -60 && Math.abs(dy) < Math.abs(dx) / 1.5) {
        closeDrawer();
    }
}, { passive: true });

// ============================================================
// блок 8. автозапуск инициализации
//
// если документ ещё грузится ждём DOMContentLoaded.
// иначе создаём панель сразу.
// ============================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDrawer);
} else {
    ensureDrawer();
}