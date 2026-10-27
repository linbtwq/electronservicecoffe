// ============================================================
// javascript/app/submit.js
//
// назначение
// единая точка отправки документов в 1С.
// устраняет дублирование кода в submitOrder, submitRecount,
// submitShipment, submitNote, submitPayment.
//
// ответственность
// - блокировка кнопок на время отправки
// - перехват сетевых ошибок и таймаутов
// - проверка поля conduct_error (документ создан, но не проведен)
// - показ галочки успеха и обновление данных
//
// особенности
// onSuccess — это пользовательский коллбэк который
// закрывает модалку и чистит форму.
// он не должен ронять loadData,
// поэтому обёрнут в try/catch.
//
// порядок подключения
// index.html подключает submit.js перед features-модулями,
// которые его используют: assortments, recount, shipment, notes, payment.
// ============================================================

async function submitDocument({
    endpoint,
    payload,
    btn,
    closeBtn,
    loadingText = 'Відправка...',
    successText = 'Документ створено',
    errorPrefix = 'Помилка',
    onSuccess
}) {
    // защита от повторных кликов
    if (btn && btn.disabled) {
        if (typeof showToast === 'function') showToast('Зачекайте, триває відправка...');
        return;
    }

    // включаем спиннер
    if (btn) setBtnLoading(btn, loadingText);
    if (closeBtn) closeBtn.disabled = true;

    let success = false;
    let responseBody = null;
    let conductError = '';

    try {
        const response = await postJson(endpoint, payload);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error((errText && errText.slice(0, 200)) || 'Помилка сервера 1С');
        }

        try { responseBody = await response.json(); } catch (e) {}

        // 1с может ответить 200 но с полем conduct_error
        if (responseBody && responseBody.conduct_error != null) {
            const raw = String(responseBody.conduct_error);
            if (!isBlankServerError(raw)) conductError = raw;
        }

        // явная ошибка от 1с (например, отказ в проведении)
        if (responseBody && responseBody.ok === false) {
            throw new Error(responseBody.error || responseBody.debt_error || '1С відхилила документ.');
        }

        success = true;

    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const isNetwork = msg.includes('Failed to fetch') || msg.toLowerCase().includes('timeout');

        const displayMsg = isNetwork
            ? '1С не відповідає. Перевірте інтернет і спробуйте знову.'
            : `${errorPrefix}: ${msg}`;

        if (typeof showToast === 'function') showToast(displayMsg, true);

    } finally {
        if (success) {
            if (conductError) {
                console.error('[1С] Документ не проведено:', conductError);
                if (typeof showToast === 'function') {
                    showToast('Документ створено, але НЕ ПРОВЕДЕНО: ' + conductError.slice(0, 150), true);
                }
            } else {
                if (typeof showSuccessAnimation === 'function') showSuccessAnimation();
                if (successText && typeof showToast === 'function') showToast(successText);
            }

            // вызываем коллбэк для специфических действий (очистка формы, закрытие модалки)
            // ловим ошибку чтобы не сломать последующий loadData
            if (typeof onSuccess === 'function') {
                try {
                    onSuccess(responseBody, conductError);
                } catch (e) {
                    console.error('[submitDocument] onSuccess failed:', e);
                }
            }

            // обновляем данные с сервера
            // тоже в try/catch: если 1с недоступна после отправки,
            // пользователь всё равно должен увидеть результат документа
            if (typeof loadData === 'function') {
                try {
                    loadData({ silent: true });
                } catch (e) {
                    console.error('[submitDocument] loadData failed:', e);
                }
            }
        }

        // снимаем спиннер и разблокируем крестик в самом конце, когда окно уже закрылось
        if (btn) resetBtn(btn, btn.dataset.originalText || 'OK');
        if (closeBtn) closeBtn.disabled = false;
    }
}