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
import { generateSyncKey, storeSyncKey, loadSyncKey, clearSyncKey } from './crypto.js';
import { renderQR, startScanner, stopScanner } from './qr.js';

console.log('[App] Starting Kochplaner...');

// Modal helper
const modal = () => $id('appModal');

// Load pages first, then initialize store
await loadPages();
await initDB();
console.log('[App] Database initialized');

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

    // Sync state
    syncEnabled: false,
    syncConnected: false,
    syncLoading: false,
    syncServerUrl: localStorage.getItem('syncServerUrl') || 'wss://kochplaner-server.mike.fm-media-staging.at',
    syncState: (loadSyncKey() && localStorage.getItem('syncEnabled') === 'true') ? 'active' : 'none',
    syncKey: loadSyncKey() || '',
    syncKeyInput: '',
    syncDecryptError: false,

    // Data
    recipes: [],
    weekplan: null,
    shoppingList: [],
    customShoppingItems: [],
    newShoppingItem: '',
    editingShoppingIndex: -1,
    editingShoppingText: '',
    editingShoppingAmount: '',
    editingShoppingUnit: '',
    dragIndex: -1,
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
        const parsed = JSON.parse(JSON.stringify(recipe));
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
        const recipeData = JSON.parse(JSON.stringify(this.editingRecipe));
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
        if (window.syncManager?.isInitialized) {
            this.recipes = window.syncManager.getRecipes();
        } else {
            this.recipes = await getAllRecipes();
        }
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

    async resetAllData() {
        const confirmed = await modal().confirm(
            'Wirklich alle Daten löschen?',
            'Alle Rezepte und Wochenpläne werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden!'
        );
        if (!confirmed) return;

        try {
            // Delete all recipes
            for (const recipe of this.recipes) {
                await deleteRecipeFromDB(recipe.id);
            }
            // Clear weekplan
            this.weekplan = null;
            await setSetting('currentWeekId', null);
            // Reload
            await this.loadRecipes();
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

    async showSuggestionDrawer() {
        await this.getNewSuggestion();
        $id('suggestionDrawer')?.open();
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
        const recipe = JSON.parse(JSON.stringify(this.suggestedRecipe));
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
            days
        };

        await saveWeekplan(weekplan);
        await setSetting('currentWeekId', weekplan.weekId);
        this.weekplan = weekplan;
        await this.generateShoppingList();

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
        // Convert reactive proxy to plain object for IndexedDB
        const weekplanData = JSON.parse(JSON.stringify(this.weekplan));
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
        this.editingShoppingIndex = index;
        this.editingShoppingText = item.name;
        this.editingShoppingAmount = item.amount || '';
        this.editingShoppingUnit = item.unit || '';
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
        this.dragIndex = index;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
        event.target.closest('.item')?.classList.add('dragging');
    },

    onDragOver(index, event) {
        event.preventDefault();
        if (this.dragIndex === index) return;

        const items = [...this.shoppingList];
        const [moved] = items.splice(this.dragIndex, 1);
        items.splice(index, 0, moved);
        this.shoppingList = items;
        this.dragIndex = index;
    },

    async onDragEnd(event) {
        event.target.closest('.item')?.classList.remove('dragging');
        this.dragIndex = -1;
        await this._saveShoppingOrder();
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
                itemEl.classList.add('dragging');
                this.dragIndex = index;
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

        // Find target item under touch
        const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
        const targetItem = elements.find(el => el.classList?.contains('item') && el !== this._touchDragState.itemEl);
        if (targetItem) {
            const targetIndex = parseInt(targetItem.dataset.index);
            if (!isNaN(targetIndex) && targetIndex !== this.dragIndex) {
                const items = [...this.shoppingList];
                const [moved] = items.splice(this.dragIndex, 1);
                items.splice(targetIndex, 0, moved);
                this.shoppingList = items;
                this.dragIndex = targetIndex;
            }
        }
    },

    async onTouchEnd() {
        clearTimeout(this._touchTimer);
        if (this._touchDragState?.moved) {
            this._touchDragState.itemEl.classList.remove('dragging');
            this.dragIndex = -1;
            await this._saveShoppingOrder();
        }
        this._touchDragState = null;
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
        await this._connectSync(key);
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
                    await this._connectSync(key);
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
    async _connectSync(syncKey) {
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
            if (loroRecipes.length === 0) {
                const existingRecipes = await getAllRecipes();
                for (const recipe of existingRecipes) {
                    syncManager.saveRecipe(recipe);
                }

                if (this.weekplan) {
                    syncManager.saveWeekplan(JSON.parse(JSON.stringify(this.weekplan)));
                }
            }

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

            // Connect to server
            localStorage.setItem('syncServerUrl', this.syncServerUrl);
            syncManager.connect(this.syncServerUrl);

            this.syncEnabled = true;
            this.syncState = 'active';
            localStorage.setItem('syncEnabled', 'true');
            window.syncManager = syncManager;

            // Load recipes from sync
            this.recipes = syncManager.getRecipes();
            const syncedWeekplan = syncManager.getWeekplan();
            if (syncedWeekplan) {
                this.weekplan = syncedWeekplan;
                await this.generateShoppingList();
            }

            console.log('[App] Sync enabled (encrypted)');
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
        console.log('[App] Sync disabled');
    },

    syncNow() {
        if (window.syncManager) {
            window.syncManager.syncNow();
        }
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
            console.log('[App] Service Worker registered');
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
    console.log('[App] Install prompt available');
});

// Welcome page: Install and start
store.installAndStart = async function() {
    if (isIOS) {
        // iOS: Show instructions, then go to app
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
        localStorage.setItem('welcomeSkipped', 'true');
        store.activePage = 1;
        history.replaceState(null, '', '#plan');
    } else if (deferredInstallPrompt) {
        // Android/Desktop: Trigger native install prompt
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log('[App] Install outcome:', outcome);
        if (outcome === 'accepted') {
            deferredInstallPrompt = null;
        }
        // Go to app regardless of outcome
        localStorage.setItem('welcomeSkipped', 'true');
        store.activePage = 1;
        history.replaceState(null, '', '#plan');
    } else {
        // No install prompt available, just go to app
        localStorage.setItem('welcomeSkipped', 'true');
        store.activePage = 1;
        history.replaceState(null, '', '#plan');
    }
};

// Welcome page: Skip install
store.skipInstall = function() {
    localStorage.setItem('welcomeSkipped', 'true');
    store.activePage = 1;
    history.replaceState(null, '', '#plan');
};

// Manual install function for Settings page
window.installApp = async function() {
    if (isStandaloneMode) {
        await modal().alert('App ist bereits installiert!');
        return;
    }

    if (isIOS) {
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

console.log('[App] Ready!');
