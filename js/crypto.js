/**
 * crypto.js - E2E Encryption for Sync
 *
 * Uses Web Crypto API:
 * - AES-256-GCM for authenticated encryption
 * - HKDF for key derivation
 * - SHA-256 for document ID derivation
 *
 * Fallback: On non-secure contexts (HTTP, not localhost), crypto.subtle
 * is unavailable. In that case, encryption is skipped (data sent unencrypted)
 * but doc ID derivation still works via a JS hash fallback.
 *
 * Sync Key: 128-bit random, base64url-encoded (22 chars)
 * Doc ID: SHA-256(key) → first 16 hex chars (or JS hash fallback)
 * AES Key: HKDF(key, info='kochplaner-e2ee') → 256-bit (null if unavailable)
 */

const HKDF_INFO = new TextEncoder().encode('kochplaner-e2ee');
const HKDF_SALT = new Uint8Array(32); // Zero salt (key is already random)

const hasSubtle = !!(crypto && crypto.subtle);

if (!hasSubtle) {
    console.warn('[Crypto] crypto.subtle not available (non-secure context). Encryption disabled.');
}

/**
 * Simple JS hash fallback (FNV-1a 64-bit, returns 16 hex chars)
 */
function fnvHash(bytes) {
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0xcbf29ce4 >>> 0;
    for (let i = 0; i < bytes.length; i++) {
        h1 ^= bytes[i];
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= bytes[i] ^ 0xff;
        h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/**
 * Generate a new sync key (128-bit random, base64url)
 */
export function generateSyncKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return uint8ToBase64url(bytes);
}

/**
 * Derive document ID from sync key (non-reversible)
 * Returns 16 hex chars
 * Always uses JS hash (not crypto.subtle) so all devices derive the same ID
 */
export async function deriveDocId(syncKey) {
    const keyBytes = base64urlToUint8(syncKey);
    return fnvHash(keyBytes);
}

/**
 * Derive AES-256-GCM key from sync key via HKDF
 * Returns null if crypto.subtle is unavailable (encryption will be skipped)
 */
export async function deriveAesKey(syncKey) {
    if (!hasSubtle) return null;

    const raw = base64urlToUint8(syncKey);
    const material = await crypto.subtle.importKey(
        'raw', raw, 'HKDF', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt plaintext bytes with AES-256-GCM
 * Returns: [12 bytes IV | ciphertext + auth tag]
 */
export async function encryptData(aesKey, plainBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        plainBytes
    );
    const result = new Uint8Array(12 + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), 12);
    return result;
}

/**
 * Decrypt encrypted bytes with AES-256-GCM
 * Input: [12 bytes IV | ciphertext + auth tag]
 * Throws on wrong key or tampered data
 */
export async function decryptData(aesKey, encryptedBytes) {
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertext
    );
    return new Uint8Array(plaintext);
}

/**
 * Store sync key in localStorage
 */
export function storeSyncKey(key) {
    localStorage.setItem('syncKey', key);
}

/**
 * Load sync key from localStorage
 */
export function loadSyncKey() {
    return localStorage.getItem('syncKey');
}

/**
 * Clear sync key from localStorage
 */
export function clearSyncKey() {
    localStorage.removeItem('syncKey');
}

/**
 * Convert Uint8Array to base64url string
 */
export function uint8ToBase64url(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Convert base64url string to Uint8Array
 */
export function base64urlToUint8(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const uint8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        uint8[i] = binary.charCodeAt(i);
    }
    return uint8;
}
