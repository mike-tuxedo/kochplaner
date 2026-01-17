/**
 * app.js - Main Application with petite-vue
 */

import { createApp, reactive } from './lib/petite-vue.es.js';
import { loadPages } from './lib/navigation.js';
import {
    initDB,
    getAllRecipes,
    saveRecipe,
    deleteRecipe as deleteRecipeFromDB,
    getWeekplan,
    saveWeekplan,
    getSetting,
    setSetting,
    exportRecipes as exportRecipesToFile,
    importRecipes as importRecipesFromFile,
    loadDefaultRecipes as loadDefaultRecipesFromDB,
    generateUUID
} from './storage.js';

console.log('[App] Starting Kochplaner...');

// Modal helper
const modal = () => $id('appModal');

// Load pages first, then initialize store
await loadPages();
await initDB();
console.log('[App] Database initialized');

// Days of week
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Hash routing maps
const hashToPage = {
    '#plan': 1, '#': 1, '': 1,
    '#recipes': 2,
    '#shopping': 3,
    '#settings': 4
};
const pageToHash = {
    1: '#plan',
    2: '#recipes',
    3: '#shopping',
    4: '#settings'
};

function getPageFromHash() {
    const hash = window.location.hash || '#plan';
    return hashToPage[hash] || 1;
}

/**
 * Reactive Store
 */
const store = reactive({
    // Navigation
    activePage: getPageFromHash(),
    theme: localStorage.getItem('theme') || 'dark',

    // Data
    recipes: [],
    weekplan: null,
    shoppingList: [],
    editingRecipe: null,
    selectedDayIndex: null,

    // Format date helper
    formatDate(isoDate) {
        const date = new Date(isoDate);
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    },

    // Get recipe by ID
    getRecipeById(id) {
        return this.recipes.find(r => r.id === id);
    },

    // === RECIPE ACTIONS ===
    showRecipeForm() {
        this.editingRecipe = {
            id: null,
            name: '',
            ingredients: [{ name: '', amount: '', unit: '' }]
        };
        $id('recipeEditDrawer')?.open();
    },

    editRecipe(recipe) {
        this.editingRecipe = JSON.parse(JSON.stringify(recipe));
        $id('recipeEditDrawer')?.open();
    },

    cancelEdit() {
        $id('recipeEditDrawer')?.close();
    },

    addIngredient() {
        this.editingRecipe.ingredients.push({ name: '', amount: '', unit: '' });
    },

    removeIngredient(index) {
        if (this.editingRecipe.ingredients.length > 1) {
            this.editingRecipe.ingredients.splice(index, 1);
        }
    },

    async saveRecipe() {
        if (!this.editingRecipe.name.trim()) {
            await modal().alert('Bitte gib einen Rezeptnamen ein.');
            return;
        }

        // Filter out empty ingredients
        this.editingRecipe.ingredients = this.editingRecipe.ingredients.filter(
            ing => ing.name.trim()
        );

        if (this.editingRecipe.ingredients.length === 0) {
            await modal().alert('Bitte füge mindestens eine Zutat hinzu.');
            return;
        }

        // Convert reactive proxy to plain object for IndexedDB
        const recipeData = JSON.parse(JSON.stringify(this.editingRecipe));
        await saveRecipe(recipeData);
        await this.loadRecipes();
        $id('recipeEditDrawer')?.close();
    },

    async deleteRecipe(id) {
        if (await modal().confirm('Rezept wirklich löschen?')) {
            await deleteRecipeFromDB(id);
            await this.loadRecipes();
        }
    },

    async loadRecipes() {
        this.recipes = await getAllRecipes();
    },

    async exportRecipes() {
        await exportRecipesToFile();
    },

    async importRecipes(event) {
        const file = event.target.files[0];
        if (!file) return;

        const confirmed = await modal().confirm(
            'Rezepte importieren?',
            'Deine vorhandenen Rezepte bleiben erhalten. Neue Rezepte werden hinzugefügt.'
        );
        if (!confirmed) {
            event.target.value = '';
            return;
        }

        try {
            const count = await importRecipesFromFile(file);
            await modal().alert(`${count} Rezept(e) erfolgreich importiert!`);
            await this.loadRecipes();
        } catch (err) {
            await modal().alert('Fehler beim Import: ' + err.message);
        }
        event.target.value = '';
    },

    async loadDefaultRecipes() {
        const confirmed = await modal().confirm(
            'Standardrezepte laden?',
            'Deine vorhandenen Rezepte bleiben erhalten. Neue Rezepte werden hinzugefügt.'
        );
        if (!confirmed) return;

        try {
            const count = await loadDefaultRecipesFromDB();
            await modal().alert(`${count} Standardrezept(e) erfolgreich geladen!`);
            await this.loadRecipes();
        } catch (err) {
            await modal().alert('Fehler: ' + err.message);
        }
    },

    // === WEEKPLAN ACTIONS ===
    async loadWeekplan() {
        const weekId = await getSetting('currentWeekId');
        if (weekId) {
            this.weekplan = await getWeekplan(weekId);
        }
        this.generateShoppingList();
    },

    async generateNewWeek() {
        if (this.recipes.length === 0) {
            await modal().alert('Füge zuerst Rezepte hinzu!');
            return;
        }

        const confirmed = await modal().confirm(
            'Neuen Wochenplan generieren?',
            'Der aktuelle Plan wird überschrieben.'
        );
        if (!confirmed) return;

        const availableRecipes = [...this.recipes];
        const days = [];

        // Get Monday of current week
        const now = new Date();
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        monday.setHours(0, 0, 0, 0);

        for (let i = 0; i < 7; i++) {
            const dayDate = new Date(monday);
            dayDate.setDate(monday.getDate() + i);

            let recipe;
            if (availableRecipes.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableRecipes.length);
                recipe = availableRecipes.splice(randomIndex, 1)[0];
            } else {
                const randomIndex = Math.floor(Math.random() * this.recipes.length);
                recipe = this.recipes[randomIndex];
            }

            days.push({
                dayName: DAYS[i],
                date: dayDate.toISOString(),
                recipeId: recipe.id
            });
        }

        const weekplan = {
            weekId: generateUUID(),
            startDate: monday.toISOString(),
            days
        };

        await saveWeekplan(weekplan);
        await setSetting('currentWeekId', weekplan.weekId);
        this.weekplan = weekplan;
        this.generateShoppingList();
    },

    openRecipeDrawer(dayIndex) {
        this.selectedDayIndex = dayIndex;
        $id('recipeSelectDrawer')?.open();
    },

    async selectRecipeForDay(recipeId) {
        if (this.selectedDayIndex === null || !this.weekplan) return;

        this.weekplan.days[this.selectedDayIndex].recipeId = recipeId;
        // Convert reactive proxy to plain object for IndexedDB
        const weekplanData = JSON.parse(JSON.stringify(this.weekplan));
        await saveWeekplan(weekplanData);
        this.generateShoppingList();

        $id('recipeSelectDrawer')?.close();
        this.selectedDayIndex = null;
    },

    // === SHOPPING LIST ===
    generateShoppingList() {
        if (!this.weekplan) {
            this.shoppingList = [];
            return;
        }

        const ingredientsMap = new Map();

        for (const day of this.weekplan.days) {
            const recipe = this.getRecipeById(day.recipeId);
            if (!recipe) continue;

            for (const ing of recipe.ingredients) {
                const key = `${ing.name.toLowerCase()}|${ing.unit}`;
                if (ingredientsMap.has(key)) {
                    ingredientsMap.get(key).amount += parseFloat(ing.amount) || 0;
                } else {
                    ingredientsMap.set(key, {
                        name: ing.name,
                        amount: parseFloat(ing.amount) || 0,
                        unit: ing.unit,
                        checked: false
                    });
                }
            }
        }

        this.shoppingList = Array.from(ingredientsMap.values());
    },

    async shareShoppingList() {
        // Filter out checked items
        const uncheckedItems = this.shoppingList.filter(item => !item.checked);

        if (uncheckedItems.length === 0) {
            await modal().alert('Keine Artikel zum Teilen!', 'Alle Artikel wurden bereits abgehakt.');
            return;
        }

        let text = '🛒 Einkaufsliste\n\n';
        for (const item of uncheckedItems) {
            text += `☐ ${item.amount} ${item.unit} ${item.name}\n`;
        }
        text += '\n— Erstellt mit Kochplaner';

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Einkaufsliste', text });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            await modal().alert('In Zwischenablage kopiert!');
        } catch {
            await modal().alert(text);
        }
    },

    // === THEME ===
    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', this.theme);
        localStorage.setItem('theme', this.theme);
    }
});

// Initialize theme
document.documentElement.setAttribute('data-theme', store.theme);

// Load initial data
await store.loadRecipes();
await store.loadWeekplan();

// Mount petite-vue
createApp(store).mount('#app');

// Export store globally
window.appStore = store;

// Navigation function
window.navigateTo = function (page) {
    if (page >= 1 && page <= 4 && page !== store.activePage) {
        store.activePage = page;
        history.pushState(null, '', pageToHash[page]);
    }
};

// Set initial hash
if (!window.location.hash || window.location.hash === '#') {
    history.replaceState(null, '', pageToHash[store.activePage]);
}

// Handle back/forward
window.addEventListener('hashchange', () => {
    const page = getPageFromHash();
    if (page !== store.activePage) {
        store.activePage = page;
    }
});

// Dark/Light toggle (global)
window.darkLightToggle = function () {
    store.toggleTheme();
};

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('[App] Service Worker registered'))
            .catch(err => console.error('[App] SW registration failed:', err));
    });
}

// ==========================================
// PWA Install Prompt Handler
// ==========================================
let deferredInstallPrompt = null;
let isAppInstalled = false;

// Check if app is running in standalone mode
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

// Check if app is installed (more reliable method)
async function checkIfInstalled() {
    // Already in standalone = definitely installed
    if (isStandalone) return true;

    // Use getInstalledRelatedApps API if available
    if ('getInstalledRelatedApps' in navigator) {
        try {
            const relatedApps = await navigator.getInstalledRelatedApps();
            if (relatedApps.length > 0) {
                console.log('[App] App is installed:', relatedApps);
                return true;
            }
        } catch (e) {
            console.log('[App] getInstalledRelatedApps not supported');
        }
    }

    return false;
}

// Run install check
checkIfInstalled().then(installed => {
    isAppInstalled = installed;
    store.canInstall = !installed;
    console.log('[App] Install status:', installed ? 'installed' : 'not installed');
});

// Check if user dismissed install prompt before
const installDismissed = localStorage.getItem('installDismissed');

// Detect iOS
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// Store the install prompt event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[App] Install prompt available');

    // Show install modal if not dismissed and not standalone
    if (!installDismissed && !isStandalone) {
        showInstallModal();
    }
});

// Show install modal
async function showInstallModal() {
    // Wait for modal component to be ready
    await new Promise(r => setTimeout(r, 500));

    const isIOSDevice = isIOS;
    let html;

    if (isIOSDevice) {
        html = `
            <p>Installiere die App für schnelleren Zugriff und Offline-Nutzung.</p>
            <p style="margin-top: 1rem;"><strong>So geht's auf iOS:</strong></p>
            <ol style="margin: 0.5rem 0; padding-left: 1.5rem;">
                <li>Tippe auf das Teilen-Symbol <span style="font-size: 1.2em;">⎙</span></li>
                <li>Scrolle und wähle "Zum Home-Bildschirm"</li>
            </ol>
        `;
    } else {
        html = `<p>Installiere die App für schnelleren Zugriff und Offline-Nutzung.</p>`;
    }

    const result = await modal().custom({
        title: 'App installieren?',
        html,
        confirmText: isIOSDevice ? 'Verstanden' : 'Installieren',
        cancelText: 'Später',
        showCancel: true
    });

    if (result) {
        if (!isIOSDevice && deferredInstallPrompt) {
            // Trigger install prompt on Android/Desktop
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log('[App] Install outcome:', outcome);
            deferredInstallPrompt = null;
        }
    } else {
        // User chose "Later" - remember this
        localStorage.setItem('installDismissed', 'true');
    }
}

// Manual install function for Settings page
window.installApp = async function() {
    if (isStandalone || isAppInstalled) {
        await modal().alert('App ist bereits installiert!');
        return;
    }

    if (isIOS) {
        await modal().custom({
            title: 'App installieren',
            html: `
                <p><strong>So installierst du auf iOS:</strong></p>
                <ol style="margin: 0.5rem 0; padding-left: 1.5rem;">
                    <li>Tippe auf das Teilen-Symbol <span style="font-size: 1.2em;">⎙</span></li>
                    <li>Scrolle und wähle "Zum Home-Bildschirm"</li>
                </ol>
            `,
            confirmText: 'Verstanden',
            showCancel: false
        });
        return;
    }

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log('[App] Install outcome:', outcome);
        if (outcome === 'accepted') {
            deferredInstallPrompt = null;
        }
    } else {
        await modal().alert(
            'Installation nicht verfügbar',
            'Öffne die App im Browser und versuche es erneut.'
        );
    }
};

// Check if app can be installed (for Settings button visibility)
window.canInstallApp = function() {
    return !isStandalone && (deferredInstallPrompt !== null || isIOS);
};

// Update store with install capability
store.canInstall = !isStandalone;
store.isStandalone = isStandalone;

console.log('[App] Ready!');
