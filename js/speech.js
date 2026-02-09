/**
 * speech.js - Offline speech recognition using Vosk-Browser
 *
 * Loads Vosk WASM + German language model on demand.
 * Model is cached by the browser after first download (~45MB).
 */

const VOSK_CDN = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
const MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-de-0.15.tar.gz';

let model = null;
let recognizer = null;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let isListening = false;
let isModelLoaded = false;

/**
 * Load Vosk library via script tag (exposes global Vosk)
 */
function loadVoskLibrary() {
    return new Promise((resolve, reject) => {
        if (window.Vosk) {
            resolve(window.Vosk);
            return;
        }

        const script = document.createElement('script');
        script.src = VOSK_CDN;
        script.onload = () => {
            if (window.Vosk) {
                resolve(window.Vosk);
            } else {
                reject(new Error('Vosk library not found after loading'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load Vosk library'));
        document.head.appendChild(script);
    });
}

/**
 * Pre-fetch the model with progress tracking.
 * The browser's HTTP cache will store it for Vosk's subsequent fetch.
 * @param {function} onProgress - Progress callback (0-1)
 */
async function prefetchModelWithProgress(onProgress, url) {
    // Always fetch - browser HTTP cache makes it instant if already downloaded
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`);

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = response.body.getReader();
    let received = 0;

    // Read through the stream for progress (browser caches the response)
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (onProgress && total > 0) {
            onProgress(received / total);
        }
    }

    if (onProgress) onProgress(1);
}

/**
 * Initialize the speech recognition model.
 * Downloads ~45MB model on first call (cached by browser afterwards).
 * @param {function} onProgress - Progress callback (0-1)
 * @returns {Promise<boolean>} true if model loaded successfully
 */
export async function initSpeechModel(onProgress, modelUrl) {
    if (isModelLoaded && model) return true;

    const url = modelUrl || MODEL_URL;
    const Vosk = await loadVoskLibrary();

    // Always prefetch for progress display (HTTP cache makes it instant if already cached)
    await prefetchModelWithProgress(onProgress, url);

    // Create model - vosk-browser createModel returns a Promise that resolves when ready
    model = await Vosk.createModel(url);
    isModelLoaded = true;
    localStorage.setItem('speechModelLoaded', 'true');
    return true;
}

/**
 * Start listening to microphone and recognize speech.
 * @param {function} onResult - Called with final recognized text
 * @param {function} onPartial - Called with partial recognition text
 * @returns {Promise<void>}
 */
export async function startListening(onResult, onPartial) {
    if (!isModelLoaded || !model) {
        throw new Error('Model not loaded. Call initSpeechModel() first.');
    }

    if (isListening) return;

    // Create recognizer
    recognizer = new model.KaldiRecognizer(16000);

    recognizer.on('result', (message) => {
        const text = message.result?.text?.trim();
        if (text && onResult) {
            onResult(text);
        }
    });

    recognizer.on('partialresult', (message) => {
        const partial = message.result?.partial?.trim();
        if (partial && onPartial) {
            onPartial(partial);
        }
    });

    // Request microphone
    mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
            sampleRate: 16000
        }
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // Use ScriptProcessor (AudioWorklet not supported by vosk-browser)
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (event) => {
        if (recognizer) {
            try {
                recognizer.acceptWaveform(event.inputBuffer);
            } catch (e) {
                // Ignore processing errors during cleanup
            }
        }
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    isListening = true;
}

/**
 * Stop listening and clean up audio resources.
 */
export function stopListening() {
    if (!isListening) return;

    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }

    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (recognizer) {
        recognizer.remove();
        recognizer = null;
    }

    isListening = false;
}

/**
 * Check if speech recognition is currently active.
 */
export function isSpeechListening() {
    return isListening;
}

/**
 * Check if the model has been loaded (from localStorage cache flag).
 */
export function wasModelPreviouslyLoaded() {
    return localStorage.getItem('speechModelLoaded') === 'true';
}

/**
 * Terminate the model and free all resources.
 */
export function terminateSpeech() {
    stopListening();
    if (model) {
        model.terminate();
        model = null;
    }
    isModelLoaded = false;
}
