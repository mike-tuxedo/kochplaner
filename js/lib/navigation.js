/**
 * navigation.js - Dynamic page loading system
 * Fetches HTML templates from /routes/ and injects them into the DOM
 */

console.log('[Navigation] Loaded');

/**
 * Page configuration
 */
const PAGES = [
    { id: 1, name: 'weekplan', file: 'weekplan.html' },
    { id: 2, name: 'recipes', file: 'recipes.html' },
    { id: 3, name: 'shopping', file: 'shopping.html' },
    { id: 4, name: 'settings', file: 'settings.html' }
];

/**
 * Fetches a page template and injects it into the container
 * @param {Object} page - Page config object
 * @returns {Promise<boolean>}
 */
async function getPageContent(page) {
    const container = $id(`page${page.id}`);
    if (!container) {
        console.error(`[Navigation] Container #page${page.id} not found`);
        return false;
    }

    try {
        const response = await fetch(`routes/${page.file}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const content = await response.text();
        container.innerHTML = content;
        return true;
    } catch (error) {
        console.error(`[Navigation] Failed to load ${page.file}:`, error.message);
        container.innerHTML = `
            <article class="error-state">
                <h3>Seite konnte nicht geladen werden</h3>
                <p>${error.message}</p>
                <button onclick="location.reload()">Erneut versuchen</button>
            </article>
        `;
        return false;
    }
}

/**
 * Loads all page templates
 * @returns {Promise<{success: boolean, loaded: number, failed: number}>}
 */
export async function loadPages() {
    console.log('[Navigation] Loading pages...');

    const results = await Promise.all(PAGES.map(page => getPageContent(page)));

    const loaded = results.filter(Boolean).length;
    const failed = results.length - loaded;

    console.log(`[Navigation] Pages loaded: ${loaded}/${results.length}`);

    window.dispatchEvent(new CustomEvent('pagesReady', {
        detail: { loaded, failed }
    }));

    return { success: failed === 0, loaded, failed };
}
