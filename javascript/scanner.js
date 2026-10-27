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
// особенности
// нативный BarcodeDetector есть не везде.
// на ios safari и части firefox его нет вообще.
// поэтому подключаем полифилл: barcode-polyfill.js + zbar-wasm.js.
// полифилл экспортирует класс BarcodeDetectorPolyfill в глобальной области.
// если ни нативного, ни полифилла нет — показываем тост и выходим.
//
// порядок подключения в index.html:
//   zbar-wasm.js -> barcode-polyfill.js -> scanner.js
// полифилл тянет zbar.wasm с cdn при первом детекторе,
// значит первый скан требует интернет.
//
// зависимости
// - BarcodeDetector API (chrome на android) или BarcodeDetectorPolyfill
// - goods.js для searchGoodsByBarcode
// - shipment.js для searchShipmentByBarcode
// - ui/toast.js для showToast
// ============================================================

// состояние сканера
// пока сканер открыт, эти переменные живут.
// после closeBarcodeScanner всё обнуляется.
let _videoStream = null;
let _scanTimerId = null;
let _barcodeDetector = null;
let _scanInFlight = false;

// короткий бип на успешный скан
// на ios вибро нет, без звука пользователь не поймёт что сработало
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

// ============================================================
// блок 1. выбор класса детектора
//
// порядок такой
// 1. нативный BarcodeDetector (chrome на android)
// 2. полифилл BarcodeDetectorPolyfill (ios/firefox с wasm)
// 3. null значит ни того ни другого нет
//
// возвращаем сам класс а не инстанс,
// потому что форматы поддерживаемые мы узнаём до создания.
// ============================================================

function resolveBarcodeDetectorClass() {
    if (typeof window !== 'undefined' && window.BarcodeDetector) {
        return window.BarcodeDetector;
    }
    if (typeof barcodeDetectorPolyfill !== 'undefined' && barcodeDetectorPolyfill.BarcodeDetectorPolyfill) {
        return barcodeDetectorPolyfill.BarcodeDetectorPolyfill;
    }
    return null;
}

// ============================================================
// блок 2. открытие камеры
// ============================================================

async function openBarcodeScanner() {
    // сначала решаем каким классом будем пользоваться
    const DetectorClass = resolveBarcodeDetectorClass();
    if (!DetectorClass) {
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
        // запрашиваем камеру (facingMode: environment - задняя камера)
        _videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });

        const video = document.getElementById('scannerVideo');
        video.srcObject = _videoStream;
        await video.play();

        // настраиваем детектор.
        // запрашиваем поддерживаемые форматы у самого класса,
        // чтобы не уронить конструктор полифилла лишними именами.
        const desiredFormats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'];
        let formats = desiredFormats;

        if (typeof DetectorClass.getSupportedFormats === 'function') {
            const available = await DetectorClass.getSupportedFormats();
            formats = desiredFormats.filter(f => available.includes(f));
            // если нужных форматов нет, но какие-то есть — берём всё что умеет
            if (formats.length === 0) formats = available;
        }

        // пустой список форматов роняет конструктор.
        // поэтому проверяем и не запускаем скан если совсем ничего нет.
        if (!formats || formats.length === 0) {
            if (typeof showToast === 'function') {
                showToast('Сканер штрих-кодів не підтримує жодного формату', true);
            }
            closeBarcodeScanner();
            return;
        }

        _barcodeDetector = new DetectorClass({ formats });

        startScanLoop();

    } catch (err) {
        console.error('Помилка камери:', err);
        if (typeof showToast === 'function') {
            showToast('Немає доступу до камери або вона зайнята іншим додатком', true);
        }
        closeBarcodeScanner();
    }
}

// ============================================================
// блок 3. цикл распознавания
//
// защита от параллельных detect().
// если видео на паузе — не убиваем цикл, а ждём.
// между кадрами пауза 150 мс чтобы не жечь батарею.
// ============================================================

async function startScanLoop() {
    const video = document.getElementById('scannerVideo');
    if (!video) return;
    if (video.ended) return;

    if (video.paused) {
        _scanTimerId = setTimeout(startScanLoop, 300);
        return;
    }

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
                    // убрали input.value = code, так как searchGoodsByBarcode сам очистит поле
                    if (typeof searchGoodsByBarcode === 'function') {
                        searchGoodsByBarcode(code);
                    }
                    return;
                }
            }
        }
    } catch (e) {
        // ошибка распознавания — просто продолжаем
    } finally {
        _scanInFlight = false;
    }

    _scanTimerId = setTimeout(startScanLoop, 150);
}

// ============================================================
// блок 4. закрытие сканера
//
// останавливаем таймер, гасим камеру,
// сбрасываем флаг inflight и детектор,
// иначе следующий запуск может подхватить полуживое состояние.
// ============================================================

function closeBarcodeScanner() {
    if (_scanTimerId) {
        clearTimeout(_scanTimerId);
        _scanTimerId = null;
    }

    _scanInFlight = false;
    _barcodeDetector = null;

    if (_videoStream) {
        _videoStream.getTracks().forEach(track => track.stop());
        _videoStream = null;
    }

    const overlay = document.getElementById('barcodeScannerOverlay');
    if (overlay) overlay.classList.remove('active');
}

// ============================================================
// блок 5. возврат на вкладку
//
// если пользователь свернул вкладку во время скана,
// браузер поставит видео на паузу.
// при возврате надо запустить play() и цикл заново.
// ============================================================

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