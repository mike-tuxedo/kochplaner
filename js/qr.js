/**
 * qr.js - QR Code generation and scanning
 *
 * Uses:
 * - qrcode-generator (Kazuhiko Arase) for QR generation
 * - jsQR for camera-based scanning
 */

let qrcodeLib = null;
let jsQRLib = null;

/**
 * Load a script dynamically and wait for it
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }

        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * Ensure QR generation library is loaded
 */
async function ensureQRCodeLib() {
    if (qrcodeLib) return qrcodeLib;
    await loadScript('./js/lib/qrcode.js');
    qrcodeLib = window.qrcode;
    return qrcodeLib;
}

/**
 * Ensure jsQR scanner library is loaded
 */
async function ensureJsQR() {
    if (jsQRLib) return jsQRLib;
    await loadScript('./js/lib/jsqr.js');
    jsQRLib = window.jsQR;
    return jsQRLib;
}

/**
 * Render a QR code onto a canvas element
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {string} text - Text to encode
 * @param {number} size - Canvas size in pixels (default 200)
 */
export async function renderQR(canvas, text, size = 200) {
    const QRCode = await ensureQRCodeLib();

    // Type 0 = auto-detect, error correction L (sufficient for short keys)
    const qr = QRCode(0, 'L');
    qr.addData(text);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = size / moduleCount;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Draw modules
    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(
                    Math.round(col * cellSize),
                    Math.round(row * cellSize),
                    Math.ceil(cellSize),
                    Math.ceil(cellSize)
                );
            }
        }
    }
}

// Scanner state
let scannerStream = null;
let scannerAnimFrame = null;

/**
 * Start QR code scanner using device camera
 * @param {HTMLVideoElement} video - Video element for camera preview
 * @param {function} onScan - Callback with decoded text
 * @returns {Promise<void>}
 */
export async function startScanner(video, onScan) {
    const jsQR = await ensureJsQR();

    // Request camera access (prefer rear camera)
    scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
    });

    video.srcObject = scannerStream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    // Create offscreen canvas for frame analysis
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function tick() {
        if (!scannerStream) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert'
            });

            if (code && code.data) {
                onScan(code.data);
                return; // Stop scanning after successful read
            }
        }

        scannerAnimFrame = requestAnimationFrame(tick);
    }

    scannerAnimFrame = requestAnimationFrame(tick);
}

/**
 * Stop the QR scanner and release camera
 */
export function stopScanner() {
    if (scannerAnimFrame) {
        cancelAnimationFrame(scannerAnimFrame);
        scannerAnimFrame = null;
    }

    if (scannerStream) {
        scannerStream.getTracks().forEach(track => track.stop());
        scannerStream = null;
    }
}
