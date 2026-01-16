/**
 * shopping.js - Einkaufslisten-Generator
 */

import { getRecipe } from './storage.js';
import { getCurrentWeekplan } from './weekplan.js';

/**
 * Generiert die Einkaufsliste aus dem aktuellen Wochenplan
 */
export async function generateShoppingList() {
    const weekplan = await getCurrentWeekplan();

    if (!weekplan) {
        return [];
    }

    const ingredientsMap = new Map();

    // Alle Zutaten der Woche sammeln
    for (const day of weekplan.days) {
        const recipe = await getRecipe(day.recipeId);
        if (!recipe) continue;

        for (const ingredient of recipe.ingredients) {
            const key = `${ingredient.name.toLowerCase()}|${ingredient.unit}`;

            if (ingredientsMap.has(key)) {
                const existing = ingredientsMap.get(key);
                existing.amount += ingredient.amount;
            } else {
                ingredientsMap.set(key, {
                    name: ingredient.name,
                    amount: ingredient.amount,
                    unit: ingredient.unit,
                    checked: false
                });
            }
        }
    }

    return Array.from(ingredientsMap.values());
}

/**
 * Rendert die Einkaufsliste
 */
export async function renderShoppingList() {
    const shoppingList = await generateShoppingList();

    let html = `
        <header class="page-header">
            <h2>📝 Einkaufsliste</h2>
            <button class="secondary" onclick="window.shareShoppingList()">↗ Teilen</button>
        </header>
    `;

    if (shoppingList.length === 0) {
        html += `
            <div class="empty-state">
                <p>Keine Einkaufsliste verfügbar.</p>
                <p>Erstelle zuerst einen Wochenplan!</p>
                <a href="#/weekplan" role="button">Einkaufsliste erstellen</a>
            </div>
        `;
        return html;
    }

    html += '<article><div class="shopping-list">';

    for (let i = 0; i < shoppingList.length; i++) {
        const item = shoppingList[i];
        html += `
            <div class="item" id="item-${i}">
                <input
                    type="checkbox"
                    id="check-${i}"
                    onchange="window.toggleShoppingItem(${i})"
                >
                <label for="check-${i}" class="ingredient-info">
                    <div>${item.name}</div>
                    <div class="amount">${item.amount} ${item.unit}</div>
                </label>
            </div>
        `;
    }

    html += '</div></article>';

    return html;
}

/**
 * Toggle Checkbox einer Zutat
 */
export function toggleShoppingItem(index) {
    const item = document.getElementById(`item-${index}`);
    const checkbox = document.getElementById(`check-${index}`);

    if (checkbox.checked) {
        item.classList.add('checked');
    } else {
        item.classList.remove('checked');
    }
}

/**
 * Teilt die Einkaufsliste via Web Share API oder Zwischenablage
 */
export async function shareShoppingList() {
    const shoppingList = await generateShoppingList();

    if (shoppingList.length === 0) {
        alert('Keine Einkaufsliste zum Teilen!');
        return;
    }

    let text = '🛒 Einkaufsliste\n\n';

    for (const item of shoppingList) {
        text += `☐ ${item.amount} ${item.unit} ${item.name}\n`;
    }

    text += '\n—\nErstellt mit Kochplaner';

    // Web Share API verwenden wenn verfügbar (nur in sicheren Kontexten)
    const shareData = { title: 'Einkaufsliste', text: text };
    const canShare = typeof navigator.share === 'function' &&
                     (!navigator.canShare || navigator.canShare(shareData));

    if (canShare) {
        try {
            await navigator.share(shareData);
            return;
        } catch (err) {
            // User hat abgebrochen - kein Fehler
            if (err.name === 'AbortError') {
                return;
            }
            console.error('Share error:', err);
            // Fallthrough zum Clipboard-Fallback
        }
    }

    // Fallback: Text in Zwischenablage kopieren
    try {
        await navigator.clipboard.writeText(text);
        alert('Einkaufsliste in Zwischenablage kopiert!');
    } catch (err) {
        // Letzter Fallback: Text anzeigen
        alert(text);
    }
}
