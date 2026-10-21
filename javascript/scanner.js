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
let _scanAnimationFrame = null;
let _barcodeDetector = null;

async function openBarcodeScanner() {
    // Проверяем поддержку API (в основном работает в Chrome на Android)
    if (!('BarcodeDetector' in window)) {
        if (typeof showToast === 'function') {
            showToast('На жаль, ваш браузер не підтримує сканер штрих-кодів. Введіть код вручну.', true);
        }
        return;
    }

    // Создаем оверлей со сканером, если его еще нет
    let overlay = document.getElementById('barcodeScannerOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'barcodeScannerOverlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="scanner-box">
                <video id="scannerVideo" playsinline></video>
                <div class="scanner-laser"></div>
                <button id="scannerCloseBtn" type="button">Закрити</button>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#scannerCloseBtn').addEventListener('click', closeBarcodeScanner);
        // Закрытие по клику вне видео (на черном фоне)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeBarcodeScanner();
        });
    }

    overlay.classList.add('active');

    try {
        // Запрашиваем камеру (facingMode: environment - задняя камера)
        _videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        
        const video = document.getElementById('scannerVideo');
        video.srcObject = _videoStream;
        await video.play();

        // Настраиваем детектор (какие форматы ищем)
        _barcodeDetector = new BarcodeDetector({
            formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e']
        });

        startScanLoop();

    } catch (err) {
        console.error('Помилка камери:', err);
        if (typeof showToast === 'function') {
            showToast('Немає доступу до камери або вона зайнята іншим додатком', true);
        }
        closeBarcodeScanner();
    }
}

async function startScanLoop() {
    const video = document.getElementById('scannerVideo');
    if (!video || video.paused || video.ended) return;

    try {
        const barcodes = await _barcodeDetector.detect(video);
        
        if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code) {
                if (navigator.vibrate) navigator.vibrate(100); // Вибро-отклик
                
                // Вставляем код в поиск
                const input = document.getElementById('goodsSearch');
                if (input) {
                    input.value = code;
                    const clearBtn = document.getElementById('goodsClear');
                    if (clearBtn) clearBtn.hidden = false;
                    
                    closeBarcodeScanner();
                    
                    // Вызываем поиск из goods.js
                    if (typeof goodsOnSearch === 'function') {
                        goodsOnSearch();
                    }
                    return;
                }
            }
        }
    } catch (e) {
        // Игнорируем ошибки распознавания на лету
    }

    // Если не нашли — продолжаем сканировать
    _scanAnimationFrame = requestAnimationFrame(startScanLoop);
}

function closeBarcodeScanner() {
    if (_scanAnimationFrame) {
        cancelAnimationFrame(_scanAnimationFrame);
        _scanAnimationFrame = null;
    }
    
    if (_videoStream) {
        _videoStream.getTracks().forEach(track => track.stop());
        _videoStream = null;
    }
    
    const overlay = document.getElementById('barcodeScannerOverlay');
    if (overlay) overlay.classList.remove('active');
}