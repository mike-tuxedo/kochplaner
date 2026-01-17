/**
 * utils.js - Utility functions for DOM manipulation
 */

console.log('[Utils] Loaded');

/**
 * Shorthand for document.getElementById
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
const $id = id => document.getElementById(id);

/**
 * Shorthand for document.querySelector
 * @param {string} selector - CSS selector
 * @returns {Element|null}
 */
const $ = selector => document.querySelector(selector);

/**
 * Shorthand for document.querySelectorAll
 * @param {string} selector - CSS selector
 * @returns {NodeList}
 */
const $$ = selector => document.querySelectorAll(selector);

/**
 * Generate a UUID (with fallback for non-secure contexts)
 * @returns {string}
 */
function generateUUID() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Escapes HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
}
