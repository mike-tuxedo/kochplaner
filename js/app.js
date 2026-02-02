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
    deleteWeekplan,
    getSetting,
    setSetting,
    exportRecipes as exportRecipesToFile,
    importRecipes as importRecipesFromFile,
    loadDefaultRecipes as loadDefaultRecipesFromDB,
    generateUUID
} from './storage.js';
import { generateSyncKey, storeSyncKey, loadSyncKey, clearSyncKey } from './crypto.js';
import { renderQR, startScanner, stopScanner } from './qr.js';


// Modal helper
const modal = () => $id('appModal');

// Load pages first, then initialize store
await loadPages();
await initDB();

// Days of week
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Hash routing maps (page 0 = welcome, not in hash routing)
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

// Check if welcome page should be shown
const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
const welcomeSkipped = localStorage.getItem('welcomeSkipped');
const showWelcome = !isStandaloneMode && !welcomeSkipped;

// iOS install instructions helper
async function showIOSInstallInstructions() {
    await modal().custom({
        title: 'App installieren',
        html: `
            <p><strong>So installierst du auf iOS:</strong></p>
            <ol style="margin: 0.5rem 0; padding-left: 1.5rem;">
                <li>Tippe auf das Teilen-Symbol <span style="font-size: 1.1em;">&#9094;</span></li>
                <li>Scrolle und wähle "Zum Home-Bildschirm"</li>
            </ol>
        `,
        confirmText: 'Verstanden',
        showCancel: false
    });
}

// Navigate to main app (skip welcome)
function goToApp() {
    localStorage.setItem('welcomeSkipped', 'true');
    store.activePage = 1;
    history.replaceState(null, '', '#plan');
}

function getPageFromHash() {
    // Show welcome page on first visit if not installed
    if (showWelcome) return 0;
    const hash = window.location.hash || '#plan';
    return hashToPage[hash] || 1;
}

/**
 * Reactive Store
 */
// Detect iOS for welcome page hint
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

const store = reactive({
    // Navigation
    activePage: getPageFromHash(),
    theme: localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    bubblesEnabled: localStorage.getItem('bubblesEnabled') !== 'false',

    // Welcome page
    isIOSDevice: isIOS,
    canInstall: !isStandaloneMode,

    // Storage persistence
    storagePersisted: false,

    // Sync state
    syncEnabled: false,
    syncConnected: false,
    syncLoading: false,
    syncServerUrl: localStorage.getItem('syncServerUrl') || 'wss://kochplaner-server.mike.fm-media-staging.at',
    syncState: (loadSyncKey() && localStorage.getItem('syncEnabled') === 'true') ? 'active' : 'none',
    syncKey: loadSyncKey() || '',
    syncKeyInput: '',
    syncDecryptError: false,

    // Speech recognition
    speechEnabled: localStorage.getItem('speechEnabled') === 'true',
    speechLoading: false,
    speechProgress: 0,
    speechListening: false,
    speechPartial: '',
    speechTarget: null, // 'shopping' | 'recipeName' | 'ingredient'

    // Data
    recipes: [],
    weekplan: null,
    shoppingList: [],
    customShoppingItems: [],
    shoppingEditMode: false,
    newShoppingItem: '',
    editingShoppingIndex: -1,
    editingShoppingText: '',
    editingShoppingAmount: '',
    editingShoppingUnit: '',
    dragIndex: -1,
    dragOverIndex: -2,
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
            description: '',
            photo: null,
            ingredients: [{ name: '', amount: '', unit: '' }]
        };
        $id('recipeEditDrawer')?.open();
    },

    editRecipe(recipe) {
        const parsed = deepClone(recipe);
        // Ensure optional fields have default values
        this.editingRecipe = {
            description: '',
            photo: null,
            ...parsed
        };
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

        // Filter out empty ingredients (ingredients are optional)
        this.editingRecipe.ingredients = this.editingRecipe.ingredients.filter(
            ing => ing.name.trim()
        );

        // Convert reactive proxy to plain object for IndexedDB
        const recipeData = deepClone(this.editingRecipe);
        await saveRecipe(recipeData);

        // Sync if enabled
        if (window.syncManager?.isInitialized) {
            window.syncManager.saveRecipe(recipeData);
        }

        await this.loadRecipes();
        $id('recipeEditDrawer')?.close();
    },

    async deleteRecipe(id) {
        if (await modal().confirm('Rezept wirklich löschen?')) {
            await deleteRecipeFromDB(id);

            // Sync if enabled
            if (window.syncManager?.isInitialized) {
                window.syncManager.deleteRecipe(id);
            }

            await this.loadRecipes();
        }
    },

    async loadRecipes() {
        // When sync is enabled, load from sync manager to stay consistent
        let recipes;
        if (window.syncManager?.isInitialized) {
            recipes = window.syncManager.getRecipes();
        } else {
            recipes = await getAllRecipes();
        }
        // Sort by creation date (newest first)
        this.recipes = recipes.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
            const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
            return dateB - dateA;
        });
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
            let count;
            if (window.syncManager?.isInitialized) {
                // When sync is active, save to syncManager in batch mode
                const text = await file.text();
                const recipes = JSON.parse(text);
                if (!Array.isArray(recipes)) throw new Error('Ungültiges Format');
                count = 0;
                window.syncManager.beginBatch();
                for (const recipe of recipes) {
                    if (recipe.name && Array.isArray(recipe.ingredients)) {
                        recipe.id = generateUUID();
                        recipe.createdAt = Date.now();
                        window.syncManager.saveRecipe(recipe);
                        count++;
                    }
                }
                window.syncManager.endBatch();
            } else {
                count = await importRecipesFromFile(file);
            }
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
            if (window.syncManager?.isInitialized) {
                // When sync is active, save to syncManager in batch mode
                const response = await fetch('rezepte-export.json');
                if (!response.ok) throw new Error('Datei nicht gefunden');
                const recipes = await response.json();
                if (!Array.isArray(recipes)) throw new Error('Ungültiges Format');
                let imported = 0;
                window.syncManager.beginBatch();
                for (const recipe of recipes) {
                    if (recipe.name && Array.isArray(recipe.ingredients)) {
                        recipe.id = generateUUID();
                        recipe.createdAt = Date.now();
                        window.syncManager.saveRecipe(recipe);
                        imported++;
                    }
                }
                window.syncManager.endBatch();
                await modal().alert(`${imported} Standardrezept(e) erfolgreich geladen!`);
            } else {
                const count = await loadDefaultRecipesFromDB();
                await modal().alert(`${count} Standardrezept(e) erfolgreich geladen!`);
            }
            await this.loadRecipes();
        } catch (err) {
            await modal().alert('Fehler: ' + err.message);
        }
    },

    async resetAllData() {
        const confirmed = await modal().confirm(
            'Wirklich alle Daten löschen?',
            'Alle Rezepte und Wochenpläne werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden!'
        );
        if (!confirmed) return;

        try {
            // Disable sync if active
            if (window.syncManager?.isInitialized) {
                this.disableSync();
            }

            // Delete all recipes from IndexedDB
            for (const recipe of (await getAllRecipes())) {
                await deleteRecipeFromDB(recipe.id);
            }

            // Clear weekplan from IndexedDB
            const weekId = await getSetting('currentWeekId');
            if (weekId) {
                await deleteWeekplan(weekId);
            }
            await setSetting('currentWeekId', null);
            await setSetting('customShoppingItems', []);
            await setSetting('shoppingListOrder', []);

            // Delete Loro sync database
            indexedDB.deleteDatabase('kochplaner-loro');

            // Reset UI state
            this.recipes = [];
            this.weekplan = null;
            this.shoppingList = [];
            this.customShoppingItems = [];

            await this.generateShoppingList();
            await modal().alert('Alle Daten wurden gelöscht.');
        } catch (err) {
            await modal().alert('Fehler: ' + err.message);
        }
    },

    // === PHOTO HANDLING ===
    async handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const compressedBase64 = await compressImage(file, {
                maxWidth: 800,
                maxHeight: 800,
                quality: 0.7
            });
            this.editingRecipe.photo = compressedBase64;
        } catch (err) {
            console.error('Fehler beim Bildupload:', err);
            await modal().alert('Fehler beim Verarbeiten des Bildes.');
        }
        event.target.value = '';
    },

    removePhoto() {
        this.editingRecipe.photo = null;
    },

    // === TOAST ===
    toastVisible: false,
    toastMessage: '',

    // === RECIPE SUGGESTIONS ===
    suggestedRecipe: null,
    suggestionLoading: false,

    async showSuggestionDrawer() {
        $id('suggestionDrawer')?.open();
        await this.getNewSuggestion();
    },

    // Translate text using MyMemory API (free: 1000 words/day, max 500 chars/request)
    async translateToGerman(text) {
        if (!text) return '';

        // MyMemory has 500 char limit per request, split long texts
        const MAX_CHARS = 450;

        const translateChunk = async (chunk) => {
            try {
                const response = await fetch(
                    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|de`
                );
                const data = await response.json();
                if (data.responseStatus === 200 && data.responseData?.translatedText) {
                    return data.responseData.translatedText;
                }
            } catch (err) {
                console.warn('Übersetzung fehlgeschlagen:', err);
            }
            return chunk;
        };

        // Short text: translate directly
        if (text.length <= MAX_CHARS) {
            return translateChunk(text);
        }

        // Long text: split by sentences and translate in chunks
        const sentences = text.split(/(?<=[.!?])\s+/);
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + ' ' + sentence).length > MAX_CHARS && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }
        if (currentChunk) chunks.push(currentChunk.trim());

        // Translate all chunks in parallel
        const translatedChunks = await Promise.all(chunks.map(translateChunk));
        return translatedChunks.join(' ');
    },

    async getNewSuggestion() {
        this.suggestionLoading = true;
        try {
            // Use TheMealDB API for random recipes
            const response = await fetch('https://www.themealdb.com/api/json/v1/1/random.php');
            if (!response.ok) throw new Error('API nicht erreichbar');
            const data = await response.json();
            const meal = data.meals?.[0];
            if (!meal) throw new Error('Kein Rezept gefunden');

            // Convert TheMealDB format to our format
            const ingredients = [];
            for (let i = 1; i <= 20; i++) {
                const name = meal[`strIngredient${i}`];
                const measure = meal[`strMeasure${i}`]?.trim() || '';
                if (name && name.trim()) {
                    // Parse measure into amount and unit
                    const parsed = this.parseMeasure(measure);
                    ingredients.push({
                        name: name.trim(),
                        amount: parsed.amount,
                        unit: parsed.unit
                    });
                }
            }

            // Translate name, instructions and ingredients to German
            const [translatedName, translatedInstructions, ...translatedIngredientNames] = await Promise.all([
                this.translateToGerman(meal.strMeal),
                this.translateToGerman(meal.strInstructions || ''),
                ...ingredients.map(ing => this.translateToGerman(ing.name))
            ]);

            // Update ingredient names with translations
            ingredients.forEach((ing, i) => {
                ing.name = translatedIngredientNames[i];
            });

            this.suggestedRecipe = {
                name: translatedName,
                description: translatedInstructions,
                ingredients,
                photo: meal.strMealThumb
            };
        } catch (err) {
            console.error('Fehler beim Laden der Vorschläge:', err);
            // Fallback to local suggestions
            try {
                const response = await fetch('rezepte-vorschlaege.json');
                const suggestions = await response.json();
                if (suggestions.length > 0) {
                    const randomIndex = Math.floor(Math.random() * suggestions.length);
                    this.suggestedRecipe = suggestions[randomIndex];
                    return;
                }
            } catch { }
            this.suggestedRecipe = null;
        } finally {
            this.suggestionLoading = false;
        }
    },

    // Parse measure string like "200g", "1 cup", "1/2 tsp" into amount and unit
    parseMeasure(measure) {
        if (!measure) return { amount: '', unit: '' };

        // English to German unit translations
        const unitTranslations = {
            // Volume
            'cup': 'Tasse', 'cups': 'Tassen', '1/2 cup': '1/2 Tasse', '1/4 cup': '1/4 Tasse',
            'tsp': 'TL', 'teaspoon': 'TL', 'teaspoons': 'TL',
            'tbsp': 'EL', 'tbs': 'EL', 'tablespoon': 'EL', 'tablespoons': 'EL',
            'ml': 'ml', 'l': 'l', 'liter': 'l', 'liters': 'l',
            'drop': 'Tropfen', 'drops': 'Tropfen',
            // Weight
            'g': 'g', 'gram': 'g', 'grams': 'g',
            'kg': 'kg', 'kilogram': 'kg',
            'oz': 'g', 'ounce': 'g', 'ounces': 'g',
            'lb': 'Pfund', 'lbs': 'Pfund', 'pound': 'Pfund', 'pounds': 'Pfund',
            // Count/Pieces
            'piece': 'Stück', 'pieces': 'Stück', 'pcs': 'Stück',
            'slice': 'Scheibe', 'slices': 'Scheiben', 'sliced': 'Scheibe',
            'clove': 'Zehe', 'cloves': 'Zehen',
            'can': 'Dose', 'cans': 'Dosen', 'tin': 'Dose',
            'bunch': 'Bund', 'bunches': 'Bund',
            'sprig': 'Zweig', 'sprigs': 'Zweige',
            'leaf': 'Blatt', 'leaves': 'Blätter',
            'head': 'Kopf', 'heads': 'Köpfe',
            'stalk': 'Stange', 'stalks': 'Stangen',
            // Descriptive
            'pinch': 'Prise', 'handful': 'Handvoll',
            'dash': 'Spritzer', 'splash': 'Schuss',
            'sprinkling': 'etwas', 'sprinkle': 'etwas',
            'large': 'groß', 'medium': 'mittel', 'small': 'klein',
            'to taste': 'nach Geschmack',
        };

        const translateUnit = (unit) => {
            const lower = unit.toLowerCase();
            return unitTranslations[lower] || unit;
        };

        // Match number (including fractions) followed by optional unit
        const match = measure.match(/^([\d.,\/]+)\s*(.*)$/);
        if (match) {
            let amount = match[1].trim();
            let unit = translateUnit(match[2].trim());

            // Convert fractions like "1/2" to decimal
            if (amount.includes('/')) {
                const parts = amount.split('/');
                if (parts.length === 2) {
                    const num = parseFloat(parts[0]);
                    const denom = parseFloat(parts[1]);
                    if (!isNaN(num) && !isNaN(denom) && denom !== 0) {
                        amount = (num / denom).toFixed(2).replace(/\.?0+$/, '');
                    }
                }
            }

            return { amount, unit };
        }

        // No number found, treat entire string as unit (e.g., "pinch", "to taste")
        return { amount: '', unit: translateUnit(measure) };
    },

    async adoptSuggestion() {
        if (!this.suggestedRecipe) return;

        // Convert reactive proxy to plain object for IndexedDB
        const recipe = deepClone(this.suggestedRecipe);
        recipe.id = null;
        const savedRecipe = await saveRecipe(recipe);

        // Sync if enabled
        if (window.syncManager?.isInitialized) {
            window.syncManager.saveRecipe(savedRecipe);
        }

        await this.loadRecipes();
        $id('suggestionDrawer')?.close();
        await modal().alert('Rezept wurde zu deiner Sammlung hinzugefügt!');
    },

    // === WEEKPLAN ACTIONS ===
    async loadWeekplan() {
        const weekId = await getSetting('currentWeekId');
        if (weekId) {
            this.weekplan = await getWeekplan(weekId);
        }
        await this.generateShoppingList();
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
            days,
            updatedAt: Date.now()
        };

        await saveWeekplan(weekplan);
        await setSetting('currentWeekId', weekplan.weekId);
        this.weekplan = weekplan;

        // Ask if shopping list should be generated
        const generateList = await modal().confirm(
            'Einkaufsliste erstellen?',
            'Soll aus dem neuen Wochenplan automatisch eine Einkaufsliste erstellt werden? Vorhandene Einträge werden dabei gelöscht.'
        );

        if (generateList) {
            // Clear custom items and saved order
            this.customShoppingItems = [];
            await setSetting('customShoppingItems', []);
            await setSetting('shoppingListOrder', []);

            // Clear shopping list checked state in sync
            if (window.syncManager?.isInitialized) {
                const checkedMap = window.syncManager.doc?.getMap('shoppingListChecked');
                if (checkedMap) {
                    const keys = Object.keys(checkedMap.toJSON());
                    for (const key of keys) {
                        checkedMap.delete(key);
                    }
                }
            }

            await this.generateShoppingList();
        }

        // Sync if enabled
        if (window.syncManager?.isInitialized) {
            window.syncManager.saveWeekplan(weekplan);
        }
    },

    openRecipeDrawer(dayIndex) {
        this.selectedDayIndex = dayIndex;
        $id('recipeSelectDrawer')?.open();
    },

    async selectRecipeForDay(recipeId) {
        if (this.selectedDayIndex === null || !this.weekplan) return;

        this.weekplan.days[this.selectedDayIndex].recipeId = recipeId;
        this.weekplan.updatedAt = Date.now();
        // Convert reactive proxy to plain object for IndexedDB
        const weekplanData = deepClone(this.weekplan);
        await saveWeekplan(weekplanData);
        await this.generateShoppingList();

        // Sync if enabled
        if (window.syncManager?.isInitialized) {
            window.syncManager.saveWeekplan(weekplanData);
        }

        $id('recipeSelectDrawer')?.close();
        this.selectedDayIndex = null;
    },

    // === SHOPPING LIST ===
    async generateShoppingList() {
        const ingredientsMap = new Map();

        if (this.weekplan) {
            for (const day of this.weekplan.days) {
                const recipe = this.getRecipeById(day.recipeId);
                if (!recipe) continue;

                for (const ing of recipe.ingredients) {
                    const key = `${ing.name.toLowerCase()}|${(ing.unit || '').toLowerCase()}`;
                    if (ingredientsMap.has(key)) {
                        ingredientsMap.get(key).amount += parseFloat(ing.amount) || 0;
                    } else {
                        ingredientsMap.set(key, {
                            name: ing.name,
                            amount: parseFloat(ing.amount) || 0,
                            unit: ing.unit || '',
                            checked: false,
                            custom: false
                        });
                    }
                }
            }
        }

        // Load custom items from storage
        const saved = await getSetting('customShoppingItems');
        this.customShoppingItems = saved || [];

        // Merge: auto-generated first, then custom items
        const autoItems = Array.from(ingredientsMap.values());
        const allItems = [...autoItems, ...this.customShoppingItems.map(ci => ({
            ...ci,
            custom: true
        }))];

        // Apply saved order if exists
        const savedOrder = await getSetting('shoppingListOrder');
        if (savedOrder && savedOrder.length > 0) {
            allItems.sort((a, b) => {
                const keyA = `${a.name.toLowerCase()}|${a.custom ? 'custom' : 'auto'}`;
                const keyB = `${b.name.toLowerCase()}|${b.custom ? 'custom' : 'auto'}`;
                const idxA = savedOrder.indexOf(keyA);
                const idxB = savedOrder.indexOf(keyB);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return 1;
                return idxA - idxB;
            });
        }

        this.shoppingList = allItems;
    },

    syncShoppingList(item) {
        // Sync only the changed item's checked state
        if (window.syncManager?.isInitialized && item) {
            window.syncManager.saveShoppingListItem(item.name, item.checked);
        }
    },

    async addShoppingItem() {
        const name = this.newShoppingItem.trim();
        if (!name) return;

        const newItem = { name, amount: 0, unit: '', checked: false };
        this.customShoppingItems.push(newItem);
        await setSetting('customShoppingItems', this.customShoppingItems);

        this.shoppingList.push({ ...newItem, custom: true });
        this.newShoppingItem = '';
    },

    async removeShoppingItem(index) {
        const item = this.shoppingList[index];
        if (!item) return;

        if (item.custom) {
            // Remove from custom items
            const ci = this.customShoppingItems.findIndex(c => c.name === item.name);
            if (ci !== -1) this.customShoppingItems.splice(ci, 1);
            await setSetting('customShoppingItems', this.customShoppingItems);
        }

        this.shoppingList.splice(index, 1);
        await this._saveShoppingOrder();
    },

    startEditItem(index) {
        const item = this.shoppingList[index];
        // Set index first to show the edit template
        this.editingShoppingIndex = index;
        // Then populate values on next frame after inputs exist in DOM
        requestAnimationFrame(() => {
            this.editingShoppingText = item.name;
            this.editingShoppingAmount = item.amount || '';
            this.editingShoppingUnit = item.unit || '';
        });
    },

    cancelEditItem() {
        this.editingShoppingIndex = -1;
        this.editingShoppingText = '';
        this.editingShoppingAmount = '';
        this.editingShoppingUnit = '';
    },

    async saveEditItem(index) {
        const item = this.shoppingList[index];
        if (!item || !this.editingShoppingText.trim()) {
            this.cancelEditItem();
            return;
        }

        const oldName = item.name;
        item.name = this.editingShoppingText.trim();
        item.amount = parseFloat(this.editingShoppingAmount) || 0;
        item.unit = this.editingShoppingUnit.trim();

        if (item.custom) {
            const ci = this.customShoppingItems.find(c => c.name === oldName);
            if (ci) {
                ci.name = item.name;
                ci.amount = item.amount;
                ci.unit = item.unit;
            }
            await setSetting('customShoppingItems', this.customShoppingItems);
        }

        this.cancelEditItem();
        await this._saveShoppingOrder();
    },

    // Drag & Drop for reordering
    onDragStart(index, event) {
        // Prevent native drag when touch is active - touch handlers manage it
        if (this._touchDragState) {
            event.preventDefault();
            return;
        }
        this.dragIndex = index;
        this.dragOverIndex = -2;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
    },

    onDragOver(index, event) {
        event.preventDefault();
        const wrapper = event.currentTarget;
        const itemEl = wrapper.querySelector('.item');
        if (!itemEl) return;
        const rect = itemEl.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        this.dragOverIndex = event.clientY > middle ? index : index - 1;
    },

    onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            this.dragOverIndex = -2;
        }
    },

    async onDragEnd() {
        if (this.dragOverIndex > -2 && this.dragIndex > -1) {
            const to = this.dragOverIndex < this.dragIndex
                ? this.dragOverIndex + 1
                : this.dragOverIndex;
            if (to !== this.dragIndex) {
                this._flipReorder(this.dragIndex, to);
            }
        }
        this.dragIndex = -1;
        this.dragOverIndex = -2;
    },

    // Touch drag & drop
    _touchDragState: null,

    onTouchStart(index, event) {
        const touch = event.touches[0];
        const itemEl = event.target.closest('.item');
        if (!itemEl) return;

        this._touchDragState = {
            index,
            startY: touch.clientY,
            currentY: touch.clientY,
            itemEl,
            moved: false
        };

        // Long press to start drag
        this._touchTimer = setTimeout(() => {
            if (this._touchDragState) {
                this._touchDragState.moved = true;
                this.dragIndex = index;
                this.dragOverIndex = -2;
            }
        }, 200);
    },

    onTouchMove(event) {
        if (!this._touchDragState || !this._touchDragState.moved) {
            if (this._touchDragState) {
                const touch = event.touches[0];
                const dy = Math.abs(touch.clientY - this._touchDragState.startY);
                if (dy > 10) {
                    clearTimeout(this._touchTimer);
                    this._touchDragState = null;
                }
            }
            return;
        }

        event.preventDefault();
        const touch = event.touches[0];
        this._touchDragState.currentY = touch.clientY;

        // Find item-wrapper under touch and calculate separator position
        const wrappers = document.querySelectorAll('.shopping-list .item-wrapper');
        let found = false;
        for (const wrapper of wrappers) {
            const rect = wrapper.getBoundingClientRect();
            if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                const index = parseInt(wrapper.dataset.index);
                const middle = rect.top + rect.height / 2;
                this.dragOverIndex = touch.clientY > middle ? index : index - 1;
                found = true;
                break;
            }
        }
        if (!found) this.dragOverIndex = -2;
    },

    async onTouchEnd() {
        clearTimeout(this._touchTimer);
        if (this._touchDragState?.moved) {
            if (this.dragOverIndex > -2 && this.dragIndex > -1) {
                const to = this.dragOverIndex < this.dragIndex
                    ? this.dragOverIndex + 1
                    : this.dragOverIndex;
                if (to !== this.dragIndex) {
                    this._flipReorder(this.dragIndex, to);
                }
            }
            this.dragIndex = -1;
            this.dragOverIndex = -2;
        }
        this._touchDragState = null;
    },

    _flipReorder(fromIndex, toIndex) {
        const container = document.querySelector('.shopping-list');
        if (!container) return;

        const wrappers = [...container.querySelectorAll('.item-wrapper')];

        // FIRST: record positions
        const firstRects = wrappers.map(el => el.getBoundingClientRect());

        // Compute old→new index mapping directly (no identity keys needed)
        // Moving fromIndex to toIndex shifts items in between by one position
        const oldToNew = new Array(wrappers.length);
        for (let i = 0; i < wrappers.length; i++) {
            if (i === fromIndex) {
                oldToNew[i] = toIndex;
            } else if (fromIndex < toIndex && i > fromIndex && i <= toIndex) {
                oldToNew[i] = i - 1;
            } else if (fromIndex > toIndex && i >= toIndex && i < fromIndex) {
                oldToNew[i] = i + 1;
            } else {
                oldToNew[i] = i;
            }
        }

        // Reorder array
        const items = [...this.shoppingList];
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        this.shoppingList = items;

        // LAST + INVERT + PLAY
        requestAnimationFrame(() => {
            const newWrappers = [...container.querySelectorAll('.item-wrapper')];
            for (let oldIdx = 0; oldIdx < oldToNew.length; oldIdx++) {
                const newIdx = oldToNew[oldIdx];
                if (newIdx === oldIdx) continue;

                const el = newWrappers[newIdx];
                if (!el) continue;

                const dy = firstRects[oldIdx].top - firstRects[newIdx].top;
                if (Math.abs(dy) < 1) continue;

                el.style.transform = `translateY(${dy}px)`;
                el.style.transition = 'none';
                el.offsetHeight; // force reflow
                el.style.transition = 'transform 200ms ease';
                el.style.transform = '';
                el.addEventListener('transitionend', () => {
                    el.style.transition = '';
                }, { once: true });
            }
        });

        this._saveShoppingOrder();
    },

    async _saveShoppingOrder() {
        const order = this.shoppingList.map(item =>
            `${item.name.toLowerCase()}|${item.custom ? 'custom' : 'auto'}`
        );
        await setSetting('shoppingListOrder', order);
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

    async shareWeekplan() {
        if (!this.weekplan) {
            await modal().alert('Kein Wochenplan zum Teilen!');
            return;
        }

        let text = '📅 Wochenplan\n\n';
        for (const day of this.weekplan.days) {
            const recipe = this.getRecipeById(day.recipeId);
            const recipeName = recipe?.name || '—';
            text += `${day.dayName}: ${recipeName}\n`;
        }
        text += '\n— Erstellt mit Kochplaner';

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Wochenplan', text });
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

    async shareApp() {
        const url = window.location.origin + window.location.pathname;
        const text = '🍳 Kochplaner - Dein Wochenplaner fürs Kochen!\n\n' + url;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Kochplaner',
                    text: '🍳 Kochplaner - Dein Wochenplaner fürs Kochen!',
                    url
                });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            await modal().alert('Link in Zwischenablage kopiert!');
        } catch {
            await modal().alert(text);
        }
    },

    showSharePopup() {
        const shareModal = $id('appModal');

        // Add event listener BEFORE showing modal
        const handleClick = async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            shareModal.removeEventListener('click', handleClick);
            shareModal._resolve(false);

            const action = btn.dataset.action;
            if (action === 'weekplan') await this.shareWeekplan();
            else if (action === 'shopping') await this.shareShoppingList();
            else if (action === 'app') await this.shareApp();
        };

        shareModal.addEventListener('click', handleClick);

        // Show modal (don't await - we handle clicks ourselves)
        modal().custom({
            title: 'Teilen',
            html: `
                <div class="share-options">
                    <button class="primary mt-2" data-action="weekplan">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M17 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H7V1H9V3H15V1H17V3ZM4 9V19H20V9H4ZM6 11H8V13H6V11ZM6 15H8V17H6V15ZM10 11H18V13H10V11ZM10 15H15V17H10V15Z"></path></svg>
                        <span>Wochenplan teilen</span>
                    </button>
                    <button class="secondary mt-2" data-action="shopping">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M4.00436 6.41686L0.761719 3.17422L2.17593 1.76001L5.41857 5.00265H20.6603C21.2126 5.00265 21.6603 5.45037 21.6603 6.00265C21.6603 6.09997 21.6461 6.19678 21.6182 6.29L19.2182 14.29C19.0913 14.713 18.7019 15.0027 18.2603 15.0027H6.00436V17.0027H17.0044V19.0027H5.00436C4.45207 19.0027 4.00436 18.5549 4.00436 18.0027V6.41686ZM6.00436 7.00265V13.0027H17.5163L19.3163 7.00265H6.00436ZM5.50436 23.0027C4.67593 23.0027 4.00436 22.3311 4.00436 21.5027C4.00436 20.6742 4.67593 20.0027 5.50436 20.0027C6.33279 20.0027 7.00436 20.6742 7.00436 21.5027C7.00436 22.3311 6.33279 23.0027 5.50436 23.0027ZM17.5044 23.0027C16.6759 23.0027 16.0044 22.3311 16.0044 21.5027C16.0044 20.6742 16.6759 20.0027 17.5044 20.0027C18.3328 20.0027 19.0044 20.6742 19.0044 21.5027C19.0044 22.3311 18.3328 23.0027 17.5044 23.0027Z"></path></svg>
                        <span>Einkaufsliste teilen</span>
                    </button>
                    <button class="contrast mt-2 mb-2" data-action="app">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 1L21.5 6.5V17.5L12 23L2.5 17.5V6.5L12 1ZM12 3.311L4.5 7.65311V16.3469L12 20.689L19.5 16.3469V7.65311L12 3.311ZM12 16C9.79086 16 8 14.2091 8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12C16 14.2091 14.2091 16 12 16ZM12 14C13.1046 14 14 13.1046 14 12C14 10.8954 13.1046 10 12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14Z"></path></svg>
                        <span>App teilen</span>
                    </button>
                </div>
            `,
            showTitle: false,
            showConfirm: false,
            showCancel: true,
            cancelText: 'Abbrechen'
        }).then(() => {
            // Cleanup listener when modal is closed via cancel/backdrop
            shareModal.removeEventListener('click', handleClick);
        });
    },

    // === THEME ===
    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', this.theme);
        localStorage.setItem('theme', this.theme);
    },

    // === BUBBLES ===
    toggleBubbles() {
        this.bubblesEnabled = !this.bubblesEnabled;
        document.body.classList.toggle('bubbles-disabled', !this.bubblesEnabled);
        localStorage.setItem('bubblesEnabled', this.bubblesEnabled);
    },

    // === SYNC ===

    /**
     * Start a new sync session: generate key and connect
     */
    async startNewSync() {
        const key = generateSyncKey();
        this.syncKey = key;
        storeSyncKey(key);
        await this._connectSync(key);
    },

    /**
     * Show the import key UI
     */
    showImportKey() {
        this.syncKeyInput = '';
        this.syncState = 'importing';
    },

    /**
     * Import a sync key from text input and connect
     */
    async importSyncKey() {
        const key = this.syncKeyInput.trim();
        if (!key || key.length < 16) {
            await modal().alert('Ungültiger Schlüssel. Bitte prüfe die Eingabe.');
            return;
        }
        this.syncKey = key;
        storeSyncKey(key);
        await this._connectSync(key, true);
    },

    /**
     * Start QR code scanner for key import
     */
    async startQRScanner() {
        this.syncState = 'scanning';
        try {
            const video = document.getElementById('qr-video');
            await startScanner(video, async (data) => {
                stopScanner();
                const key = data.trim();
                if (key && key.length >= 16) {
                    this.syncKey = key;
                    this.syncKeyInput = key;
                    storeSyncKey(key);
                    await this._connectSync(key, true);
                } else {
                    await modal().alert('Ungültiger QR-Code. Bitte versuche es erneut.');
                    this.syncState = 'importing';
                }
            });
        } catch (err) {
            console.error('[App] Camera error:', err);
            await modal().alert('Kamera konnte nicht gestartet werden. Bitte gib den Schlüssel manuell ein.');
            this.syncState = 'importing';
        }
    },

    /**
     * Stop QR scanner
     */
    cancelQRScanner() {
        stopScanner();
        this.syncState = 'importing';
    },

    /**
     * Show the key sharing UI (QR + text)
     */
    async showShareKey() {
        this.syncState = 'sharing';
        // Render QR code after DOM update
        setTimeout(async () => {
            const canvas = document.getElementById('qr-canvas');
            if (canvas) {
                await renderQR(canvas, this.syncKey, 200);
            }
        }, 50);
    },

    /**
     * Share sync key via Web Share API or clipboard
     */
    async shareSyncKey() {
        const text = this.syncKey;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Kochplaner Sync-Key', text });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            await modal().alert('Schlüssel in Zwischenablage kopiert!');
        } catch {
            // Fallback: select text for manual copy
            await modal().alert('Bitte kopiere den Schlüssel manuell.');
        }
    },

    /**
     * Go back to active sync state from sharing
     */
    backToSyncActive() {
        this.syncState = 'active';
    },

    /**
     * Internal: connect to sync server with a key
     */
    async _connectSync(syncKey, isJoining = false) {
        if (this.syncLoading) return;
        this.syncLoading = true;
        this.syncDecryptError = false;

        try {
            const { syncManager } = await import('./sync.js');

            // Initialize encryption and Loro
            await syncManager.initWithKey(syncKey);
            await syncManager.init();

            // Migrate existing data to Loro only if Loro doc is empty (first time)
            const loroRecipes = syncManager.getRecipes();
            const hasLocalData = this.recipes.length > 0 || this.weekplan;

            if (loroRecipes.length === 0 && hasLocalData) {
                if (isJoining) {
                    // Joining existing sync with local data - inform user about merge
                    await modal().alert(
                        'Daten werden zusammengeführt',
                        'Deine lokalen Rezepte werden mit dem anderen Gerät zusammengeführt. ' +
                        'Für den Wochenplan wird der jeweils neueste verwendet.'
                    );
                }

                const existingRecipes = await getAllRecipes();
                syncManager.beginBatch();
                for (const recipe of existingRecipes) {
                    syncManager.saveRecipe(recipe);
                }

                if (this.weekplan) {
                    syncManager.saveWeekplan(deepClone(this.weekplan));
                }
                syncManager.endBatch();
            }

            // Track local weekplan timestamp for conflict resolution
            const localWeekplanUpdatedAt = this.weekplan?.updatedAt || 0;

            // Subscribe to sync updates
            syncManager.subscribe(() => {
                this.recipes = syncManager.getRecipes();

                const weekplan = syncManager.getWeekplan();
                const checked = syncManager.getShoppingListChecked();

                if (weekplan) {
                    this.weekplan = { weekId: '', startDate: '', days: [], updatedAt: 0 };
                    setTimeout(async () => {
                        this.weekplan = weekplan;
                        await this.generateShoppingList();
                        if (Object.keys(checked).length > 0) {
                            this._applyShoppingListChecked(checked);
                        }
                    }, 0);
                } else if (Object.keys(checked).length > 0) {
                    this._applyShoppingListChecked(checked);
                }
            });

            // Handle decryption errors
            syncManager.onDecryptError = () => {
                this.syncDecryptError = true;
            };

            // Update connection status
            syncManager.onStatusChange = (connected) => {
                this.syncConnected = connected;
            };

            // Handle weekplan conflicts (both devices have different weekplans)
            syncManager.onWeekplanConflict = async (localWeekplan, remoteWeekplan) => {
                const localDate = new Date(localWeekplan.startDate).toLocaleDateString('de-DE');
                const remoteDate = new Date(remoteWeekplan.startDate).toLocaleDateString('de-DE');

                const choice = await modal().custom({
                    title: 'Wochenplan-Konflikt',
                    html: `<p>Beide Geräte haben unterschiedliche Wochenpläne.</p>
                           <p><strong>Dieses Gerät:</strong> Woche ab ${localDate}</p>
                           <p><strong>Anderes Gerät:</strong> Woche ab ${remoteDate}</p>
                           <p>Welchen Wochenplan möchtest du verwenden?</p>`,
                    confirmText: 'Anderes Gerät',
                    cancelText: 'Dieses Gerät',
                    showCancel: true
                });

                // choice = true means "Anderes Gerät" (remote), false means "Dieses Gerät" (local)
                return choice ? remoteWeekplan : localWeekplan;
            };

            // Connect to server
            localStorage.setItem('syncServerUrl', this.syncServerUrl);
            syncManager.connect(this.syncServerUrl);

            this.syncEnabled = true;
            this.syncState = 'active';
            localStorage.setItem('syncEnabled', 'true');
            window.syncManager = syncManager;

            // Load recipes from sync (merged set)
            this.recipes = syncManager.getRecipes();
            const syncedWeekplan = syncManager.getWeekplan();
            if (syncedWeekplan) {
                // Use the weekplan with the later updatedAt timestamp
                if (!this.weekplan || (syncedWeekplan.updatedAt || 0) >= localWeekplanUpdatedAt) {
                    this.weekplan = syncedWeekplan;
                } else {
                    // Local is newer, re-save it to ensure it propagates
                    syncManager.saveWeekplan(deepClone(this.weekplan));
                }
                await this.generateShoppingList();
            }

        } catch (err) {
            console.error('[App] Sync init failed:', err);
            await modal().alert('Sync konnte nicht aktiviert werden: ' + err.message);
            this.syncState = 'none';
        }
        this.syncLoading = false;
    },

    disableSync() {
        if (window.syncManager) {
            window.syncManager.onStatusChange = null;
            window.syncManager.onDecryptError = null;
            window.syncManager.onWeekplanConflict = null;
            window.syncManager.disconnect();
            window.syncManager = null;
        }
        this.syncEnabled = false;
        this.syncConnected = false;
        this.syncState = 'none';
        this.syncKey = '';
        this.syncDecryptError = false;
        clearSyncKey();
        localStorage.removeItem('syncEnabled');
    },

    syncNow() {
        if (window.syncManager) {
            window.syncManager.syncNow();
        }
    },

    // === SPEECH RECOGNITION ===

    async enableSpeech() {
        if (this.speechLoading) return;
        this.speechLoading = true;
        this.speechProgress = 0;

        try {
            const { initSpeechModel } = await import('./speech.js');
            await initSpeechModel((progress) => {
                this.speechProgress = Math.round(progress * 100);
            });
            this.speechEnabled = true;
            localStorage.setItem('speechEnabled', 'true');
        } catch (err) {
            console.error('[App] Speech init failed:', err);
            await modal().alert('Spracherkennung konnte nicht aktiviert werden: ' + err.message);
        }
        this.speechLoading = false;
        this.speechProgress = 0;
    },

    disableSpeech() {
        import('./speech.js').then(({ terminateSpeech }) => {
            terminateSpeech();
        });
        this.speechEnabled = false;
        this.speechListening = false;
        this.speechPartial = '';
        localStorage.removeItem('speechEnabled');
        localStorage.removeItem('speechModelLoaded');
    },

    async toggleSpeechListening(target) {
        if (!this.speechEnabled) return;

        if (this.speechListening) {
            this._stopSpeech();
            return;
        }

        this.speechTarget = target;
        this.speechPartial = '';

        try {
            const { startListening, initSpeechModel } = await import('./speech.js');

            // Ensure model is loaded (might be a page reload with speechEnabled=true)
            // Show loading state while initializing
            this.speechLoading = true;
            this.speechProgress = 0;
            try {
                await initSpeechModel((progress) => {
                    this.speechProgress = Math.round(progress * 100);
                });
            } catch {
                this.speechLoading = false;
                this.speechProgress = 0;
                await modal().alert('Sprachmodell konnte nicht geladen werden. Bitte erneut aktivieren.');
                this.speechEnabled = false;
                localStorage.removeItem('speechEnabled');
                return;
            }
            this.speechLoading = false;
            this.speechProgress = 0;

            await startListening(
                (text) => this._onSpeechResult(text),
                (partial) => { this.speechPartial = partial; }
            );
            this.speechListening = true;
        } catch (err) {
            console.error('[App] Speech start failed:', err);
            if (err.name === 'NotAllowedError') {
                await modal().alert('Mikrofonzugriff wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.');
            } else {
                await modal().alert('Mikrofon konnte nicht gestartet werden: ' + err.message);
            }
        }
    },

    _onSpeechResult(text) {
        if (!text) return;

        switch (this.speechTarget) {
            case 'shopping':
                this.newShoppingItem = text;
                this.addShoppingItem();
                break;
            case 'recipeName':
                if (this.editingRecipe) {
                    this.editingRecipe.name = text;
                }
                break;
            case 'description':
                if (this.editingRecipe) {
                    // Append to existing description with space/newline
                    const current = this.editingRecipe.description || '';
                    this.editingRecipe.description = current
                        ? current + '\n' + text
                        : text;
                }
                break;
            case 'ingredient':
                if (this.editingRecipe) {
                    // Smart parse: "Tomaten fünf Stück" → name, amount, unit
                    const parsed = this._parseIngredient(text);
                    this.editingRecipe.ingredients.push(parsed);
                }
                break;
        }

        this.speechPartial = '';
    },

    /**
     * Parse spoken ingredient into name, amount, unit
     * Handles patterns like: "Tomaten fünf Stück", "500 Gramm Mehl", "eine Zwiebel"
     */
    _parseIngredient(text) {
        // German number words to digits
        const numberWords = {
            'null': 0, 'ein': 1, 'eine': 1, 'einer': 1, 'einen': 1, 'eins': 1,
            'zwei': 2, 'zwo': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
            'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
            'elf': 11, 'zwölf': 12, 'dreizehn': 13, 'vierzehn': 14, 'fünfzehn': 15,
            'zwanzig': 20, 'dreißig': 30, 'vierzig': 40, 'fünfzig': 50,
            'hundert': 100, 'halbe': 0.5, 'halbes': 0.5, 'halben': 0.5,
            'einhalb': 1.5, 'anderthalb': 1.5, 'viertel': 0.25
        };

        // Common units
        const units = [
            'stück', 'stk', 'gramm', 'g', 'kilogramm', 'kg', 'kilo',
            'liter', 'l', 'milliliter', 'ml', 'deziliter', 'dl',
            'teelöffel', 'tl', 'esslöffel', 'el', 'löffel',
            'tasse', 'tassen', 'becher', 'dose', 'dosen', 'glas', 'gläser',
            'prise', 'prisen', 'bund', 'bunde', 'scheibe', 'scheiben',
            'packung', 'packungen', 'päckchen', 'pkg', 'pck'
        ];

        const words = text.toLowerCase().split(/\s+/);
        let amount = '';
        let unit = '';
        let nameWords = [];
        let foundNumber = false;
        let foundUnit = false;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Check for number (digit or word)
            if (!foundNumber) {
                // Digit number
                const numMatch = word.match(/^(\d+(?:[.,]\d+)?)$/);
                if (numMatch) {
                    amount = numMatch[1].replace(',', '.');
                    foundNumber = true;
                    continue;
                }
                // Number word
                if (numberWords[word] !== undefined) {
                    amount = numberWords[word].toString();
                    foundNumber = true;
                    continue;
                }
            }

            // Check for unit
            if (!foundUnit && units.includes(word)) {
                unit = word.charAt(0).toUpperCase() + word.slice(1);
                foundUnit = true;
                continue;
            }

            // Everything else is the name
            nameWords.push(word);
        }

        // Capitalize first letter of name
        let name = nameWords.join(' ');
        if (name) {
            name = name.charAt(0).toUpperCase() + name.slice(1);
        }

        return { name, amount, unit };
    },

    async _stopSpeech() {
        const { stopListening } = await import('./speech.js');
        stopListening();
        this.speechListening = false;
        this.speechPartial = '';
    },

    _applyShoppingListChecked(checkedItems) {
        for (const item of this.shoppingList) {
            if (checkedItems[item.name] !== undefined) {
                item.checked = checkedItems[item.name];
            }
        }
    }
});

// Initialize theme
document.documentElement.setAttribute('data-theme', store.theme);

// Initialize bubbles
if (!store.bubblesEnabled) {
    document.body.classList.add('bubbles-disabled');
}

// Load initial data
await store.loadRecipes();
await store.loadWeekplan();

// Request persistent storage (prevents browser from evicting IndexedDB data)
if (navigator.storage?.persist) {
    const persisted = await navigator.storage.persisted();
    if (persisted) {
        store.storagePersisted = true;
    } else {
        store.storagePersisted = await navigator.storage.persist();
    }
}

// Mount petite-vue
createApp(store).mount('#app');

// Export store globally
window.appStore = store;

// Auto-start sync if previously enabled and key exists (deferred to not block animations)
const savedSyncKey = loadSyncKey();
if (localStorage.getItem('syncEnabled') === 'true' && savedSyncKey) {
    const startSync = () => store._connectSync(savedSyncKey);
    if ('requestIdleCallback' in window) {
        requestIdleCallback(startSync);
    } else {
        setTimeout(startSync, 1000);
    }
}

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
    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('./sw.js');
        } catch (err) {
            console.error('[App] SW registration failed:', err);
        }
    });
}

// Check for app updates via version in localStorage
const APP_VERSION = '1.5';
const lastVersion = localStorage.getItem('appVersion');
if (lastVersion && lastVersion !== APP_VERSION) {
    // Show toast after a short delay to ensure DOM is ready
    setTimeout(() => showToast('App wurde aktualisiert'), 1000);
}
localStorage.setItem('appVersion', APP_VERSION);

// Simple toast notification
function showToast(message, duration = 3000) {
    store.toastMessage = message;
    store.toastVisible = true;

    setTimeout(() => {
        store.toastVisible = false;
    }, duration);
}

// ==========================================
// PWA Install Prompt Handler
// ==========================================
let deferredInstallPrompt = null;

// Store the install prompt event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
});

// Welcome page: Install and start
store.installAndStart = async function() {
    if (isIOS) {
        await showIOSInstallInstructions();
        goToApp();
    } else if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
            deferredInstallPrompt = null;
        }
        goToApp();
    } else {
        goToApp();
    }
};

// Welcome page: Skip install
store.skipInstall = function() {
    goToApp();
};

// Manual install function for Settings page
window.installApp = async function() {
    if (isStandaloneMode) {
        await modal().alert('App ist bereits installiert!');
        return;
    }

    if (isIOS) {
        await showIOSInstallInstructions();
        return;
    }

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
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
