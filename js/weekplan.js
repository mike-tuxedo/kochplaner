/**
 * weekplan.js - Wochenplan-Generator
 */

import { getAllRecipes, getRecipe } from './storage.js';
import { getSetting, setSetting, saveWeekplan, getWeekplan } from './storage.js';

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * Generiert einen neuen randomisierten Wochenplan
 */
export async function generateWeekplan() {
    const recipes = await getAllRecipes();

    if (recipes.length === 0) {
        alert('Du hast noch keine Rezepte. Füge zuerst Rezepte hinzu!');
        window.location.hash = '/recipes';
        return null;
    }

    // Kopie für Zufallsauswahl
    const availableRecipes = [...recipes];
    const days = [];

    // Startdatum: Montag der aktuellen Woche
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sonntag = 0, Montag = 1
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);

        // Zufälliges Rezept auswählen
        let recipe = null;
        if (availableRecipes.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableRecipes.length);
            recipe = availableRecipes.splice(randomIndex, 1)[0];
        } else {
            // Wenn nicht genug Rezepte, von vorne beginnen
            const randomIndex = Math.floor(Math.random() * recipes.length);
            recipe = recipes[randomIndex];
        }

        days.push({
            dayName: DAYS[i],
            date: dayDate.toISOString(),
            recipeId: recipe.id
        });
    }

    const weekplan = {
        weekId: crypto.randomUUID(),
        startDate: monday.toISOString(),
        days
    };

    await saveWeekplan(weekplan);
    await setSetting('currentWeekId', weekplan.weekId);

    return weekplan;
}

/**
 * Lädt den aktuellen Wochenplan
 */
export async function getCurrentWeekplan() {
    const currentWeekId = await getSetting('currentWeekId');
    if (!currentWeekId) {
        return null;
    }
    return await getWeekplan(currentWeekId);
}

/**
 * Rendert den Wochenplan
 */
export async function renderWeekplan() {
    let weekplan = await getCurrentWeekplan();

    let html = `
        <header>
            <h2>Wochenplan</h2>
            <button onclick="window.generateNewWeek()">🎲 Neue Woche generieren</button>
        </header>
    `;

    if (!weekplan) {
        html += `
            <div class="empty-state">
                <p>Noch kein Wochenplan vorhanden.</p>
                <p>Generiere deinen ersten Wochenplan!</p>
            </div>
        `;
        return html;
    }

    html += '<div class="weekplan-grid">';

    for (const day of weekplan.days) {
        const recipe = await getRecipe(day.recipeId);
        const date = new Date(day.date);
        const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

        html += `
            <article class="day-slot">
                <div class="day-header">${day.dayName}</div>
                <small>${dateStr}</small>
                ${recipe ? `
                    <h4 class="recipe-name">${recipe.name}</h4>
                    <details>
                        <summary>Zutaten</summary>
                        <ul>
                            ${recipe.ingredients.map(ing => `
                                <li>${ing.amount} ${ing.unit} ${ing.name}</li>
                            `).join('')}
                        </ul>
                    </details>
                    <button class="change-btn secondary" onclick="window.changeRecipeForDay('${day.dayName}')">
                        Ändern
                    </button>
                ` : `
                    <p><em>Kein Rezept</em></p>
                `}
            </article>
        `;
    }

    html += '</div>';

    return html;
}

/**
 * Ändert das Rezept für einen bestimmten Tag
 */
export async function changeRecipeForDay(dayName) {
    const weekplan = await getCurrentWeekplan();
    if (!weekplan) return;

    const recipes = await getAllRecipes();
    if (recipes.length === 0) {
        alert('Keine Rezepte verfügbar!');
        return;
    }

    // Einfacher Prompt (später durch Modal ersetzen)
    const recipeList = recipes.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
    const choice = prompt(`Wähle ein Rezept für ${dayName}:\n\n${recipeList}\n\nGib die Nummer ein:`);

    if (choice) {
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < recipes.length) {
            const selectedRecipe = recipes[index];
            const day = weekplan.days.find(d => d.dayName === dayName);
            if (day) {
                day.recipeId = selectedRecipe.id;
                await saveWeekplan(weekplan);
                window.location.reload();
            }
        }
    }
}

/**
 * Rendert das Dashboard (Übersicht)
 */
export async function renderDashboard() {
    const weekplan = await getCurrentWeekplan();

    let html = '';

    if (!weekplan) {
        html += `
            <article>
                <h3>Erste Schritte</h3>
                <p>1. Füge deine Lieblingsrezepte hinzu</p>
                <p>2. Generiere einen Wochenplan</p>
                <p>3. Erstelle deine Einkaufsliste</p>
                <br>
                <a href="#/recipes" role="button">Rezepte hinzufügen</a>
            </article>
        `;
    } else {
        html += `
            <article>
                <h3>Dein Wochenplan</h3>
                <p>Aktuelle Woche ab ${new Date(weekplan.startDate).toLocaleDateString('de-DE')}</p>
                <div class="cta-buttons">
                    <a href="#/weekplan" role="button">Zum Wochenplan</a>
                    <a href="#/shopping" role="button" class="secondary">Zur Einkaufsliste</a>
                </div>
            </article>
        `;

        // Quick-Preview der nächsten 3 Tage
        html += '<h4>Die nächsten Tage:</h4>';
        for (let i = 0; i < Math.min(3, weekplan.days.length); i++) {
            const day = weekplan.days[i];
            const recipe = await getRecipe(day.recipeId);
            if (recipe) {
                html += `<p><strong>${day.dayName}:</strong> ${recipe.name}</p>`;
            }
        }
    }

    return html;
}
