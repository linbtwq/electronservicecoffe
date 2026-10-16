// ============================================================
// notes.js
//
// назначение
// этот файл отвечает за примечания к точкам.
//
// ответственность
// - создать модалку с формой и историей
// - загрузить историю примечаний для выбранной точки
// - отправить новое примечание в 1с
// - отрисовать список примечаний с тегами и датами
//
// особенности
// сервер использует request_id чтобы не создавать дубликаты.
// если пользователь дважды нажмёт сохранить
// повторный запрос с тем же request_id не создаст вторую запись.
//
// зависимости
// - globalData из script.js даёт список точек
// - fetchWithTimeout и newRequestId из script.js
// - showToast и escapeHtml из script.js
// - rememberFocus и restoreFocus из script.js
//
// порядок подключения
// index.html подключает notes.js после script.js
// ============================================================

// ============================================================
// блок 1. состояние окна примечаний
//
// все переменные живут между открытием и закрытием окна.
// при закрытии окна значения сбрасываются в closeNoteModal.
// ============================================================

// флаг загрузки истории примечаний
let noteLoading = false;

// флаг отправки нового примечания
let noteSending = false;

// идентификатор точки к которой относится открытое окно
let notePointId = null;

// один идентификатор на одну примечание
// повторная отправка с тем же id не создаст дубль на сервере
let noteRequestId = null;

// выбранный тег примечания
// пустая строка значит тег не выбран
let noteTag = '';

// массив загруженных примечаний для текущей точки
let noteItems = [];

// ============================================================
// блок 2. константы
//
// максимальная длина текста и список доступных тегов.
// список используется и в форме и при отрисовке истории.
// ============================================================

// максимальная длина текста примечания в символах
const NOTE_MAX = 500;

// список доступных тегов примечания
// каждый тег это объект с идентификатором и подписью
const NOTE_TAGS = [
    { id: 'access', label: 'Ключ / доступ' },
    { id: 'service', label: 'Потрібен сервіс' },
    { id: 'broken', label: 'Не працює' },
    { id: 'other', label: 'Інше' }
];

// ============================================================
// блок 3. вспомогательные функции
//
// мелкие утилиты для работы с тегами и датами.
// обе функции чистые и не зависят от состояния приложения.
// ============================================================

// возвращает подпись тега по его идентификатору
// для неизвестного тега возвращает пустую строку
function noteTagLabel(id) {
    const t = NOTE_TAGS.find(x => x.id === id);
    return t ? t.label : '';
}

// преобразует дату с сервера в читаемый вид
// сервер присылает строку вида 2026-10-06 14 20 00
// на выходе получается 06.10.2026, 14 20
// если строка не подходит под шаблон возвращается как есть
function noteDateText(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}` : String(s || '');
}

// ============================================================
// блок 4. создание модального окна
//
// окно создаётся один раз при первом открытии.
// дальше ensureNoteModal просто возвращает существующий элемент.
//
// так экономится время на повторной сборке разметки
// и не теряются обработчики событий.
// ============================================================

function ensureNoteModal() {
    // повторно используем уже созданное окно
    let el = document.getElementById('noteOverlay');
    if (el) return el;

    // создаём корневой контейнер окна
    el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'noteOverlay';
    // z-index выше чем у обычных модалок
    // примечание может открываться поверх других окон
    el.style.zIndex = '1006';

    // разметка окна
    // шапка с названием точки
    // тело с формой и историей
    // футер с кнопкой сохранения
    el.innerHTML = `
        <div class="modal-box assort-box note-box">
            <div class="modal-header">
                <div class="assort-head">
                    <h3>Примітка</h3>
                    <div class="assort-sub" id="noteSub"></div>
                </div>
                <button class="modal-close" type="button" aria-label="Закрити">✕</button>
            </div>
            <div class="modal-body" id="noteBody">
                <div class="note-new">
                    <textarea id="noteText" class="note-text" rows="3" maxlength="${NOTE_MAX}"
                        placeholder="Напишіть примітку..." aria-label="Нова примітка"></textarea>
                    <div class="note-meta">
                        <span>Нова примітка</span>
                        <span id="noteCounter">0 / ${NOTE_MAX}</span>
                    </div>
                    <div class="note-chips" id="noteChips">
                        ${NOTE_TAGS.map(t => `<button type="button" class="note-chip" data-tag="${t.id}">${t.label}</button>`).join('')}
                    </div>
                </div>
                <div class="note-history">
                    <div class="note-history-title" id="noteHistoryTitle">Історія</div>
                    <div id="noteList"></div>
                </div>
            </div>
            <div class="modal-footer order-footer">
                <div class="order-summary">Бачать усі співробітники</div>
                <button class="action-btn btn-success" type="button" id="noteSendBtn" disabled>Зберегти</button>
            </div>
        </div>
    `;

    // вставляем окно в конец body
    document.body.appendChild(el);

    // блок 4.1 обработчики шапки и футера
    // кнопка крестика закрывает окно
    el.querySelector('.modal-close').addEventListener('click', closeNoteModal);
    // кнопка сохранения отправляет примечание
    el.querySelector('#noteSendBtn').addEventListener('click', submitNote);
    // клик по затемнению вокруг окна тоже закрывает
    el.addEventListener('click', (e) => {
        if (e.target === el) closeNoteModal();
    });

    // блок 4.2 работа с текстовым полем
    const ta = el.querySelector('#noteText');
    // при вводе текста обновляем счётчик и кнопку
    ta.addEventListener('input', updateNoteForm);
    // сочетание ctrl + enter или cmd + enter отправляет примечание
    ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submitNote();
        }
    });

    // блок 4.3 выбор тега
    // клик по тому же тегу снимает выбор
    el.querySelector('#noteChips').addEventListener('click', e => {
        const chip = e.target.closest('.note-chip');
        if (!chip) return;
        noteTag = (noteTag === chip.dataset.tag) ? '' : chip.dataset.tag;
        updateNoteForm();
    });

    return el;
}

// ============================================================
// блок 5. синхронизация состояния формы
//
// обновляет три вещи
// счётчик введённых символов
// подсветку активного тега
// доступность кнопки сохранения
// ============================================================

function updateNoteForm() {
    const ta = document.getElementById('noteText');
    const counter = document.getElementById('noteCounter');
    const btn = document.getElementById('noteSendBtn');
    // если хоть одного элемента нет выходим
    if (!ta || !counter || !btn) return;

    // счётчик символов
    counter.textContent = `${ta.value.length} / ${NOTE_MAX}`;

    // подсветка выбранного тега
    document.querySelectorAll('#noteChips .note-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.tag === noteTag);
    });

    // кнопка активна только если не идёт отправка и есть текст
    btn.disabled = noteSending || !ta.value.trim();
}

// ============================================================
// блок 6. закрытие окна
//
// во время отправки окно не закрывается.
// это нужно чтобы показать пользователю результат запроса.
//
// после закрытия сбрасываем состояние и возвращаем фокус.
// ============================================================

function closeNoteModal() {
    // если идёт отправка, закрывать нельзя
    if (noteSending) return;

    document.getElementById('noteOverlay')?.classList.remove('active');

    // сбрасываем данные текущей сессии
    notePointId = null;
    noteRequestId = null;
    noteTag = '';
    noteItems = [];

    // возвращаем фокус только если поверх нет другого окна
    if (typeof getTopModal === 'function' && !getTopModal() && typeof restoreFocus === 'function') {
        restoreFocus();
    }
}

// ============================================================
// блок 7. открытие окна для точки
//
// порядок такой
// 1. ищем точку в общем списке
// 2. запоминаем текущий фокус
// 3. создаём окно если его ещё нет
// 4. заполняем шапку и сбрасываем поле
// 5. показываем скелетон истории
// 6. показываем окно
// 7. загружаем историю с сервера
//
// фокус в текстовое поле ставим только на устройствах с мышью
// на мобильных это вызвало бы экранную клавиатуру
// и она бы закрыла половину окна
// ============================================================

async function openNoteModal(pointId) {
    const point = globalData.find(i => String(i.id) === String(pointId));
    // без точки или во время другой загрузки не открываем
    if (!point || noteLoading) return;

    // запоминаем элемент на котором был фокус
    rememberFocus();

    const overlay = ensureNoteModal();

    // готовим состояние под новую точку
    notePointId = point.id;
    noteRequestId = newRequestId();
    noteTag = '';
    noteItems = [];

    // заполняем шапку окна
    document.getElementById('noteSub').textContent =
        [point.point_name || 'Точка', `код ${point.id}`].join(' · ');

    // чистим поле ввода
    document.getElementById('noteText').value = '';

    // сбрасываем заголовок истории
    document.getElementById('noteHistoryTitle').textContent = 'Історія';

    // показываем скелетон пока идёт загрузка
    document.getElementById('noteList').innerHTML = `
        <div class="assort-loading">
            <div class="skeleton skeleton-text" style="width:70%;"></div>
            <div class="skeleton skeleton-text" style="width:90%;"></div>
        </div>
    `;
    updateNoteForm();

    // показываем окно
    overlay.classList.add('active');

    // фокус в поле только на устройствах с точным указателем
    if (window.matchMedia('(pointer: fine)').matches) {
        setTimeout(() => document.getElementById('noteText')?.focus(), 60);
    }

    // загружаем историю примечаний
    await loadNotes();
}

// ============================================================
// блок 8. загрузка истории с сервера
//
// важный момент
// пока идёт запрос пользователь мог закрыть окно
// или открыть его для другой точки.
// в конце проверяем что notePointId всё ещё совпадает
// иначе результат устарел и его нужно выбросить.
// ============================================================

async function loadNotes() {
    const list = document.getElementById('noteList');
    // запоминаем точку чтобы отловить смену контекста
    const pointId = notePointId;
    noteLoading = true;

    try {
        // id пользователя уходит в url, сервер использует его для доступа
        const u = currentUser ? encodeURIComponent(currentUser.id) : '';
        const res = await fetchWithTimeout(
            `${apiBase}/notes?point=${encodeURIComponent(pointId)}&u=${u}&t=${Date.now()}`,
            { method: 'GET', cache: 'no-store' },
            APP_CONFIG.loadTimeoutMs
        );
        // сервер вернул ошибку
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error((t && t.slice(0, 160)) || 'Помилка мережі');
        }
        const data = await res.json();
        // ожидаем массив
        if (!Array.isArray(data)) throw new Error('Невірна відповідь 1С');

        // окно могли закрыть или открыть для другой точки
        if (String(notePointId) !== String(pointId)) return;

        // сохраняем и отрисовываем
        noteItems = data;
        renderNoteList();
    } catch (err) {
        // ошибку от устаревшего запроса не показываем
        if (String(notePointId) !== String(pointId)) return;
        const message = err && err.message ? err.message : String(err);
        list.innerHTML = `<div class="assort-error" style="margin:0;">Не вдалося завантажити історію: ${escapeHtml(message)}</div>`;
    } finally {
        noteLoading = false;
    }
}

// ============================================================
// блок 9. отрисовка истории
//
// если примечаний нет показываем заглушку.
// иначе идём по массиву и собираем разметку.
//
// все данные от сервера прогоняются через escapeHtml
// потому что имя автора и текст примечания приходят с сервера
// и могут содержать html символы
// ============================================================

function renderNoteList() {
    const list = document.getElementById('noteList');
    const title = document.getElementById('noteHistoryTitle');
    if (!list || !title) return;

    // обновляем заголовок с количеством
    title.textContent = `Історія · ${noteItems.length}`;

    // пустая история
    if (!noteItems.length) {
        list.innerHTML = '<div class="note-empty">Приміток ще немає</div>';
        return;
    }

    // собираем разметку каждой примечания
    list.innerHTML = noteItems.map(n => {
        const tag = noteTagLabel(n.tag);
        // плашка тега если тег известен
        const tagHtml = tag
            ? `<span class="note-tag ${escapeHtml(n.tag)}">${escapeHtml(tag)}</span>`
            : '';
        return `
            <div class="note-item">
                <div class="note-item-head">
                    <b>${escapeHtml(n.author || '—')}</b>
                    <span>${escapeHtml(noteDateText(n.date))}</span>
                </div>
                <div class="note-item-text">${tagHtml}${escapeHtml(n.text)}</div>
            </div>
        `;
    }).join('');
}

// ============================================================
// блок 10. отправка примечания
//
// порядок такой
// 1. проверяем флаги и наличие текста
// 2. отсекаем отправку без сети
// 3. собираем payload с request_id
// 4. блокируем кнопки и показываем загрузку
// 5. отправляем post на /notes
// 6. при успехе добавляем примечание в начало списка
//
// request_id гарантирует что повторная отправка
// при обрыве связи не создаст вторую запись на сервере
// ============================================================

async function submitNote() {
    // не допускаем повторную отправку или отправку без точки
    if (noteSending || !notePointId) return;

    const ta = document.getElementById('noteText');
    const text = ta.value.trim();
    // пустое сообщение не отправляем
    if (!text) return;

    // примечания только онлайн
    if (!navigator.onLine) {
        showToast('Немає мережі! Примітку можна зберегти лише онлайн.', true);
        return;
    }

    // тело запроса
    // request_id либо уже созданный либо новый
    // если пользователь нажал сохранить второй раз
    // тот же request_id защитит от дубля
    const payload = {
        point_id: notePointId,
        technician_id: currentUser ? currentUser.id : '',
        request_id: noteRequestId || newRequestId(),
        tag: noteTag,
        text: text.slice(0, NOTE_MAX)
    };

    const btn = document.getElementById('noteSendBtn');
    const closeBtn = document.querySelector('#noteOverlay .modal-close');

    // блокируем форму на время отправки
    noteSending = true;
    if (closeBtn) closeBtn.disabled = true;
    setBtnLoading(btn, 'Збереження...');

    // сюда запишется подтверждённая сервером примечание
    let saved = null;

    try {
        const res = await fetchWithTimeout(
            `${apiBase}/notes?v=${APP_CONFIG.apiVersion}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // код курьера уходит и в заголовке
                    // сервер может проверить любой из источников
                    'X-User-Code': currentUser ? currentUser.id : ''
                },
                body: JSON.stringify(payload)
            },
            APP_CONFIG.sendTimeoutMs
        );

        // сервер вернул ошибку
        if (!res.ok) {
            const errText = await res.text();
            throw new Error((errText && errText.slice(0, 200)) || 'Помилка сервера 1С');
        }

        // ответ может быть без json тела
        let body = null;
        try { body = await res.json(); } catch (e) {}

        // если сервер вернул запись берём её
        // иначе строим локальную копию чтобы сразу показать в списке
        saved = (body && body.note) ? body.note : {
            author: currentUser ? currentUser.name : '',
            date: '',
            tag: payload.tag,
            text: payload.text
        };
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        // различаем таймаут и другие ошибки
        const msg = (message.includes('Failed to fetch') || message.toLowerCase().includes('timeout'))
            ? '1С не відповідає. Примітку не збережено.'
            : `Не вдалося зберегти: ${message}`;
        showToast(msg, true);
    } finally {
        // снимаем блокировку в любом случае
        noteSending = false;
        if (closeBtn) closeBtn.disabled = false;
        resetBtn(btn, 'Зберегти');

        // если сохранение прошло успешно обновляем интерфейс
        if (saved) {
            // новая примечание встаёт первой в списке
            noteItems.unshift(saved);
            renderNoteList();

            // чистим форму
            ta.value = '';
            noteTag = '';

            // следующая примечание получит новый request_id
            // чтобы не конфликтовать с только что отправленной
            noteRequestId = newRequestId();

            showToast('Примітку збережено');
        }

        // синхронизируем счётчик и кнопку
        updateNoteForm();
    }
}