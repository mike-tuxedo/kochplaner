/**
 * i18n.js - Internationalization module
 *
 * Provides translation functions and locale management.
 * Locale files are ES modules loaded dynamically from js/locales/.
 */

const SUPPORTED_LOCALES = ['de', 'en'];
const DEFAULT_LOCALE = 'de';

let currentLocale = DEFAULT_LOCALE;
let messages = {};
let data = {};

/**
 * Translate a key with optional parameter interpolation.
 * @param {string} key - Dot-notation key, e.g. 'nav.plan'
 * @param {object} [params] - Interpolation values, e.g. { count: 5 }
 * @returns {string}
 */
export function t(key, params) {
    let text = messages[key] || key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}

/**
 * Access structured locale data (days, numberWords, units, speechModelUrl).
 * @param {string} key
 * @returns {*}
 */
export function getData(key) {
    return data[key];
}

/**
 * Get the Intl-compatible locale string (e.g. 'de-DE', 'en-US').
 * @returns {string}
 */
export function getIntlLocale() {
    return data.intlLocale || 'de-DE';
}

/**
 * Get the current locale code (e.g. 'de', 'en').
 * @returns {string}
 */
export function getLocale() {
    return currentLocale;
}

/**
 * Detect and load the appropriate locale.
 * Priority: localStorage > navigator.language > default ('de').
 */
export async function initI18n() {
    // Determine locale
    const stored = localStorage.getItem('locale');
    if (stored && SUPPORTED_LOCALES.includes(stored)) {
        currentLocale = stored;
    } else {
        const browserLang = (navigator.language || '').split('-')[0].toLowerCase();
        currentLocale = SUPPORTED_LOCALES.includes(browserLang) ? browserLang : DEFAULT_LOCALE;
    }

    // Load locale module
    const mod = await import(`./locales/${currentLocale}.js`);
    messages = mod.default.messages;
    data = mod.default.data;

    // Set <html lang>
    document.documentElement.lang = currentLocale;

    // Set modal defaults via globals (modal.js is not an ES module)
    window.__i18n_modal_cancel = t('common.cancel');
    window.__i18n_modal_ok = t('common.ok');
}

/**
 * Switch locale, persist to localStorage, and reload the page.
 * @param {string} locale
 */
export function setLocale(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) return;
    localStorage.setItem('locale', locale);
    location.reload();
}
