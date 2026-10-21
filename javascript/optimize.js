// ============================================================
// optimize.js
//
// назначение
// этот файл содержит небольшие оптимизации интерфейса.
//
// ответственность
// ограничить частоту вызовов, паузить анимации в скрытой вкладке
// и упростить карточки во время быстрой прокрутки.
//
// философия
// тут нет бизнес-логики.
// все что делает этот файл можно отключить без потери функциональности.
// поэтому весь код обернут в немедленно вызываемую функцию
// чтобы не засорять глобальную область.
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // блок 1. общий ограничитель частоты вызовов
    // ============================================================

    if (typeof window.throttle !== 'function') {
        window.throttle = function (fn, wait) {
            let last = 0;
            let timer = null;

            return function (...args) {
                const now = Date.now();
                const remain = wait - (now - last);

                if (remain <= 0) {
                    last = now;
                    fn.apply(this, args);
                } else if (!timer) {
                    timer = setTimeout(() => {
                        last = Date.now();
                        timer = null;
                        fn.apply(this, args);
                    }, remain);
                }
            };
        };
    }

    // ============================================================
    // блок 2. пауза анимаций в скрытой вкладке
    // ============================================================

    document.addEventListener('visibilitychange', () => {
        document.body.classList.toggle('is-hidden', document.hidden);
    });

    // ============================================================
    // блок 3. пропуск обновления статуса в скрытой вкладке
    // ============================================================

    function wrapRenderStatus() {
        if (typeof window.renderStatus !== 'function') return;

        const origRenderStatus = window.renderStatus;
        window.renderStatus = function (...args) {
            if (document.hidden) return;
            return origRenderStatus.apply(this, args);
        };
    }

    // ============================================================
    // блок 4. упрощение карточек во время быстрой прокрутки
    // ============================================================

    function attachResultsScroll() {
        const resultsContainer = document.getElementById('resultsContainer');
        if (!resultsContainer) return;

        let scrollTimer = null;

        resultsContainer.addEventListener('scroll', () => {
            if (!resultsContainer.classList.contains('is-scrolling')) {
                resultsContainer.classList.add('is-scrolling');
            }
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                resultsContainer.classList.remove('is-scrolling');
            }, 200);
        }, { passive: true });
    }

    // ============================================================
    // блок 5. автозапуск инициализации
    // ============================================================

    function initOptimizations() {
        wrapRenderStatus();
        attachResultsScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOptimizations);
    } else {
        initOptimizations();
    }

})();