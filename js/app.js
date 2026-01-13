/**
 * app.js - Haupt-App mit Routing & Initialisierung
 */

import { initDB, loadDefaultRecipes } from './storage.js';
import { renderRecipesList, renderRecipeForm, saveRecipeFromForm, deleteRecipeById, addIngredientRow, exportRecipesAction, importRecipesAction } from './recipes.js';
import { renderWeekplan, renderDashboard, generateWeekplan, changeRecipeForDay, initWeekplanDragDrop, moveWeekplanItem } from './weekplan.js';
import { renderShoppingList, toggleShoppingItem, shareShoppingList } from './shopping.js';

// Globale Funktionen für onclick-Handler
window.showRecipeForm = showRecipeForm;
window.editRecipe = editRecipe;
window.deleteRecipeConfirm = deleteRecipeById;
window.addIngredientRow = addIngredientRow;
window.generateNewWeek = generateNewWeek;
window.changeRecipeForDay = changeRecipeForDay;
window.toggleShoppingItem = toggleShoppingItem;
window.shareShoppingList = shareShoppingList;
window.moveWeekplanItem = moveWeekplanItem;
window.exportRecipesAction = exportRecipesAction;
window.importRecipesAction = importRecipesAction;
window.loadDefaultRecipes = loadDefaultRecipesAction;

/**
 * App-Initialisierung
 */
async function init() {
    console.log('🍳 HomeCooking App startet...');

    // IndexedDB initialisieren
    await initDB();
    console.log('✓ IndexedDB initialisiert');

    // Service Worker registrieren
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./sw.js');
            console.log('✓ Service Worker registriert');
        } catch (err) {
            console.error('Service Worker Fehler:', err);
        }
    }

    // Hash-Routing initialisieren
    window.addEventListener('hashchange', router);

    // Initial Route
    await router();

    console.log('✓ App bereit!');
}

/**
 * Router - verarbeitet Hash-Navigation
 */
async function router() {
    const hash = window.location.hash.slice(1) || '/';
    const appContainer = document.getElementById('app');

    // Navigation aktiv markieren
    updateNavigation(hash);

    // Loading anzeigen
    appContainer.innerHTML = '<article aria-busy="true">Lädt...</article>';

    let content = '';

    try {
        switch (hash) {
            case '/':
                content = await renderDashboard();
                break;

            case '/recipes':
                content = await renderRecipesList();
                break;

            case '/recipes/new':
                content = await renderRecipeForm();
                setupRecipeFormHandler();
                break;

            case '/weekplan':
                content = await renderWeekplan();
                // Initialize drag & drop after content is rendered
                setTimeout(() => initWeekplanDragDrop(), 50);
                break;

            case '/shopping':
                content = await renderShoppingList();
                break;

            case '/discover':
                content = await renderDiscover();
                break;

            default:
                if (hash.startsWith('/recipes/edit/')) {
                    const recipeId = hash.replace('/recipes/edit/', '');
                    content = await renderRecipeForm(recipeId);
                    setupRecipeFormHandler();
                } else {
                    content = '<h2>404 - Seite nicht gefunden</h2>';
                }
        }

        appContainer.innerHTML = content;
    } catch (error) {
        console.error('Router Fehler:', error);
        appContainer.innerHTML = `
            <article>
                <h3>Fehler</h3>
                <p>Beim Laden der Seite ist ein Fehler aufgetreten.</p>
                <pre>${error.message}</pre>
            </article>
        `;
    }
}

/**
 * Aktualisiert die Navigation (aktive Links)
 */
function updateNavigation(currentHash) {
    const links = document.querySelectorAll('.nav-link');
    links.forEach(link => {
        const href = link.getAttribute('href').slice(1);
        if (href === currentHash || (href === '/' && currentHash === '')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

/**
 * Setup für Rezept-Formular
 */
function setupRecipeFormHandler() {
    setTimeout(() => {
        const form = document.getElementById('recipe-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                await saveRecipeFromForm(formData);
                window.location.hash = '/recipes';
            });
        }
    }, 100);
}

/**
 * Hilfsfunktionen für Navigation
 */
function showRecipeForm() {
    window.location.hash = '/recipes/new';
}

function editRecipe(recipeId) {
    window.location.hash = `/recipes/edit/${recipeId}`;
}

async function generateNewWeek() {
    const confirmed = confirm('Möchtest du einen neuen Wochenplan generieren? Der aktuelle Plan wird überschrieben.');
    if (confirmed) {
        await generateWeekplan();
        window.location.reload();
    }
}

async function loadDefaultRecipesAction() {
    try {
        const count = await loadDefaultRecipes();
        alert(`${count} Standardrezept(e) wurden geladen!`);
        window.location.hash = '/recipes';
    } catch (err) {
        alert('Fehler beim Laden: ' + err.message);
    }
}

/**
 * Discover-Seite (TheMealDB API)
 */
async function renderDiscover() {
    let html = `
        <header class="discover-header">
            <h2>🌍 Rezept entdecken</h2>
            <button onclick="window.fetchRandomRecipe()">🎲 Zufälliges Rezept</button>
        </header>
        <div id="api-recipe-container">
            <p>Klicke auf "Zufälliges Rezept" um ein neues Gericht zu entdecken!</p>
        </div>
    `;

    return html;
}

/**
 * Lädt ein zufälliges Rezept von TheMealDB
 */
window.fetchRandomRecipe = async function() {
    const container = document.getElementById('api-recipe-container');
    container.innerHTML = '<article aria-busy="true">Lädt Rezept...</article>';

    try {
        const response = await fetch('https://www.themealdb.com/api/json/v1/1/random.php');
        const data = await response.json();
        const meal = data.meals[0];

        // Zutaten extrahieren
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
            const ingredient = meal[`strIngredient${i}`];
            const measure = meal[`strMeasure${i}`];
            if (ingredient && ingredient.trim()) {
                ingredients.push({ ingredient, measure });
            }
        }

        let html = `
            <article class="api-recipe-card">
                <h3>${meal.strMeal}</h3>
                <p><strong>Kategorie:</strong> ${meal.strCategory} | <strong>Region:</strong> ${meal.strArea}</p>
                <img src="${meal.strMealThumb}" alt="${meal.strMeal}" class="recipe-image">

                <h4>Zutaten:</h4>
                <ul>
                    ${ingredients.map(ing => `<li>${ing.measure} ${ing.ingredient}</li>`).join('')}
                </ul>

                <h4>Anleitung:</h4>
                <p class="instructions">${meal.strInstructions}</p>

                <button onclick="window.importApiRecipe('${meal.idMeal}')">
                    Als eigenes Rezept speichern
                </button>
            </article>
        `;

        container.innerHTML = html;

        // Rezept temporär speichern für Import
        window.currentApiRecipe = {
            name: meal.strMeal,
            ingredients: ingredients.map(ing => ({
                name: ing.ingredient,
                amount: parseFloat(ing.measure) || 1,
                unit: ing.measure.replace(/[0-9.]/g, '').trim() || 'x'
            }))
        };

    } catch (error) {
        console.error('API Fehler:', error);
        container.innerHTML = `
            <article>
                <h4>Offline oder API nicht erreichbar</h4>
                <p>Die App funktioniert offline, aber externe Rezepte können nur mit Internetverbindung geladen werden.</p>
            </article>
        `;
    }
};

/**
 * Importiert API-Rezept als eigenes
 */
window.importApiRecipe = async function() {
    if (!window.currentApiRecipe) return;

    try {
        const { saveRecipe } = await import('./storage.js');
        await saveRecipe(window.currentApiRecipe);
        alert('✓ Rezept erfolgreich gespeichert!');
        window.location.hash = '/recipes';
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message);
    }
};

// App starten
init();
