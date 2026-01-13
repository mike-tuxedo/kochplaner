/**
 * recipes.js - Rezepte-Verwaltung
 */

import { getAllRecipes, getRecipe, saveRecipe, deleteRecipe, exportRecipes, importRecipes } from './storage.js';

/**
 * Rendert die Rezepte-Liste
 */
export async function renderRecipesList() {
    const recipes = await getAllRecipes();

    let html = `
        <header class="page-header">
            <h2>Meine Rezepte</h2>
            <button onclick="window.showRecipeForm()">+ Neues Rezept</button>
        </header>
    `;

    if (recipes.length === 0) {
        html += `
            <div class="empty-state">
                <p>Noch keine Rezepte vorhanden.</p>
                <p>Füge dein erstes Lieblingsrezept hinzu!</p>
            </div>
        `;
    } else {
        html += '<div class="recipes-container">';
        for (const recipe of recipes) {
            html += renderRecipeCard(recipe);
        }
        html += '</div>';
    }

    // Export/Import Buttons
    html += `
        <div class="import-export-actions">
            <button class="secondary" onclick="window.exportRecipesAction()">📤 Rezepte exportieren</button>
            <label class="import-btn secondary" role="button">
                📥 Rezepte importieren
                <input type="file" accept=".json" onchange="window.importRecipesAction(this.files[0])" hidden>
            </label>
        </div>
    `;

    return html;
}

/**
 * Rendert eine einzelne Rezept-Karte
 */
function renderRecipeCard(recipe) {
    return `
        <article class="recipe-card">
            <div class="header">
                <h4>${recipe.name}</h4>
            </div>
            <details>
                <summary>Zutaten (${recipe.ingredients.length})</summary>
                <ul class="ingredients">
                    ${recipe.ingredients.map(ing => `
                        <li>${ing.amount} ${ing.unit} ${ing.name}</li>
                    `).join('')}
                </ul>
            </details>
            <div class="actions">
                <button class="secondary" onclick="window.editRecipe('${recipe.id}')">Bearbeiten</button>
                <button class="contrast" onclick="window.deleteRecipeConfirm('${recipe.id}')">Löschen</button>
            </div>
        </article>
    `;
}

/**
 * Zeigt das Rezept-Formular (Neu oder Bearbeiten)
 */
export async function renderRecipeForm(recipeId = null) {
    let recipe = null;
    if (recipeId) {
        recipe = await getRecipe(recipeId);
    }

    const ingredients = recipe?.ingredients || [{ name: '', amount: '', unit: '' }];

    let html = `
        <header class="page-header">
            <h2>${recipe ? 'Rezept bearbeiten' : 'Neues Rezept'}</h2>
        </header>
        <form id="recipe-form" class="recipe-form">
            <input type="hidden" name="id" value="${recipe?.id || ''}">

            <label>
                Rezeptname
                <input type="text" name="name" value="${recipe?.name || ''}" required>
            </label>

            <label>Zutaten</label>
            <div class="ingredients-list" id="ingredients-container">
                ${ingredients.map((ing, index) => `
                    <div class="ingredient-row">
                        <input type="text" name="ing_name[]" placeholder="Zutat" value="${ing.name}" required>
                        <input type="number" name="ing_amount[]" placeholder="Menge" value="${ing.amount}" step="0.1" required>
                        <input type="text" name="ing_unit[]" placeholder="Einheit" value="${ing.unit}" required>
                        <button type="button" class="contrast" onclick="this.parentElement.remove()">-</button>
                    </div>
                `).join('')}
            </div>
            <button type="button" class="secondary add-ingredient-btn" onclick="window.addIngredientRow()">+ Zutat hinzufügen</button>

            <div class="form-actions">
                <button type="button" class="secondary" onclick="window.location.hash = '/recipes'">Abbrechen</button>
                <button type="submit">${recipe ? 'Speichern' : 'Rezept erstellen'}</button>
            </div>
        </form>
    `;

    return html;
}

/**
 * Speichert ein Rezept aus dem Formular
 */
export async function saveRecipeFromForm(formData) {
    const recipe = {
        id: formData.get('id') || undefined,
        name: formData.get('name'),
        ingredients: []
    };

    const names = formData.getAll('ing_name[]');
    const amounts = formData.getAll('ing_amount[]');
    const units = formData.getAll('ing_unit[]');

    for (let i = 0; i < names.length; i++) {
        if (names[i].trim()) {
            recipe.ingredients.push({
                name: names[i].trim(),
                amount: parseFloat(amounts[i]),
                unit: units[i].trim()
            });
        }
    }

    await saveRecipe(recipe);
}

/**
 * Löscht ein Rezept
 */
export async function deleteRecipeById(id) {
    if (confirm('Rezept wirklich löschen?')) {
        await deleteRecipe(id);
        window.location.hash = '/recipes';
    }
}

/**
 * Fügt eine neue Zutaten-Zeile hinzu
 */
export function addIngredientRow() {
    const container = document.getElementById('ingredients-container');
    const row = document.createElement('div');
    row.className = 'ingredient-row';
    row.innerHTML = `
        <input type="text" name="ing_name[]" placeholder="Zutat" required>
        <input type="number" name="ing_amount[]" placeholder="Menge" step="0.1" required>
        <input type="text" name="ing_unit[]" placeholder="Einheit" required>
        <button type="button" class="contrast" onclick="this.parentElement.remove()">-</button>
    `;
    container.appendChild(row);
}

/**
 * Export-Aktion
 */
export async function exportRecipesAction() {
    await exportRecipes();
}

/**
 * Import-Aktion
 */
export async function importRecipesAction(file) {
    if (!file) return;

    try {
        const count = await importRecipes(file);
        alert(`${count} Rezept(e) erfolgreich importiert!`);
        window.location.reload();
    } catch (err) {
        alert('Fehler beim Import: ' + err.message);
    }
}
