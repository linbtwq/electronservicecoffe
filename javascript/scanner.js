// ============================================================
// javascript/scanner.js
//
// назначение
// этот файл отвечает за сканирование штрих-кодов.
//
// ответственность
// - открыть камеру устройства
// - распознать QR-код или штрих-код
// - вставить результат в строку поиска номенклатуры
//
// зависимости
// - BarcodeDetector API (работает в Chrome на Android)
// - goods.js для вызова функции поиска
// ============================================================

let _videoStream = null;
let _scanTimerId = null;
let _barcodeDetector = null;

// короткий бип на успешный скан
// на iOS вибро нет, без звука пользователь не поймёт что сработало
let _scanAudioCtx = null;

function playScanBeep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!_scanAudioCtx) _scanAudioCtx = new Ctx();
        if (_scanAudioCtx.state === 'suspended') _scanAudioCtx.resume();

        const t = _scanAudioCtx.currentTime;
        const osc = _scanAudioCtx.createOscillator();
        const gain = _scanAudioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1320, t + 0.06);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

        osc.connect(gain).connect(_scanAudioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
    } catch (e) {}
}



async function openBarcodeScanner() {
    //проверяем поддержку API (в основном работает в Chrome на Android)
    if (!('BarcodeDetector' in window)) {
        if (typeof showToast === 'function') {
            showToast('На жаль, ваш браузер не підтримує сканер штрих-кодів. Введіть код вручну.', true);
        }
        return;
    }

    // создаем оверлей со сканером, если его еще нет
    let overlay = document.getElementById('barcodeScannerOverlay');
    
    // защита от двойного клика
    if (overlay && overlay.classList.contains('active')) return;

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'barcodeScannerOverlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="scanner-box">
                <video id="scannerVideo" playsinline></video>
                <div class="scanner-overlay">
                    <div class="scanner-target">
                        <div class="scanner-laser"></div>
                    </div>
                    <p class="scanner-hint">Наведіть камеру на штрих-код</p>
                </div>
                <button id="scannerCloseBtn" type="button">Скасувати</button>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#scannerCloseBtn').addEventListener('click', closeBarcodeScanner);
        // закрытие по клику вне видео (на черном фоне)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeBarcodeScanner();
        });
    }

    overlay.classList.add('active');

    try {
        // Ззпрашиваем камеру (facingMode: environment - задняя камера)
        _videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        
        const video = document.getElementById('scannerVideo');
        video.srcObject = _videoStream;
        await video.play();

        // Настраиваем детектор (какие форматы ищем)
        // Фикс: Запрашиваем поддерживаемые форматы, чтобы избежать ошибок в Safari/iOS
        const desiredFormats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'];
        let formats = desiredFormats;

        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
            const available = await BarcodeDetector.getSupportedFormats();
            formats = desiredFormats.filter(f => available.includes(f));
            if (formats.length === 0) formats = available;
        }

        _barcodeDetector = new BarcodeDetector({ formats });

        startScanLoop();

    } catch (err) {
        console.error('Помилка камери:', err);
        if (typeof showToast === 'function') {
            showToast('Немає доступу до камери або вона зайнята іншим додатком', true);
        }
        closeBarcodeScanner();
    }
}

let _scanInFlight = false;

async function startScanLoop() {
    const video = document.getElementById('scannerVideo');
    if (!video) return;
    if (video.ended) return;

    // видео на паузе (свернули вкладку, скрыли экран) не убиваем цикл, ждём
    if (video.paused) {
        _scanTimerId = setTimeout(startScanLoop, 300);
        return;
    }

    // защита от параллельных detect()
    if (_scanInFlight) {
        _scanTimerId = setTimeout(startScanLoop, 80);
        return;
    }

    _scanInFlight = true;
    try {
        const barcodes = await _barcodeDetector.detect(video);

        if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code) {
                if (navigator.vibrate) navigator.vibrate(100);
                playScanBeep();

                closeBarcodeScanner();

                // маршрут 1 окно отгрузки
                const shipmentOverlay = document.getElementById('shipmentOverlay');
                if (shipmentOverlay && shipmentOverlay.classList.contains('active')) {
                    if (typeof searchShipmentByBarcode === 'function') {
                        searchShipmentByBarcode(code);
                    }
                    return;
                }

                // маршрут 2 каталог в drawer
                const input = document.getElementById('goodsSearch');
                if (input) {
                    input.value = code;
                    const clearBtn = document.getElementById('goodsClear');
                    if (clearBtn) clearBtn.hidden = false;

                    if (typeof searchGoodsByBarcode === 'function') {
                        searchGoodsByBarcode(code);
                    }
                    return;
                }
            }
        }
    } catch (e) {
        // ошибка распознавания  просто продолжаем
    } finally {
        _scanInFlight = false;
    }

    _scanTimerId = setTimeout(startScanLoop, 150);
}

function closeBarcodeScanner() {
    if (_scanTimerId) {
        clearTimeout(_scanTimerId);
        _scanTimerId = null;
    }
    
    if (_videoStream) {
        _videoStream.getTracks().forEach(track => track.stop());
        _videoStream = null;
    }
    
    const overlay = document.getElementById('barcodeScannerOverlay');
    if (overlay) overlay.classList.remove('active');
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    const overlay = document.getElementById('barcodeScannerOverlay');
    if (!overlay || !overlay.classList.contains('active')) return;

    const video = document.getElementById('scannerVideo');
    if (video && video.paused) {
        video.play().catch(() => {});
        if (!_scanTimerId) startScanLoop();
    }
});