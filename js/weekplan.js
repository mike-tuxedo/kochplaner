/**
 * weekplan.js - Wochenplan-Generator
 */

import { getAllRecipes, getRecipe, generateUUID } from './storage.js';
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
        weekId: generateUUID(),
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
        <header class="page-header">
            <h2>Wochenplan</h2>
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

    html += '<div class="weekplan-grid" id="weekplan-grid">';

    for (let i = 0; i < weekplan.days.length; i++) {
        const day = weekplan.days[i];
        const recipe = await getRecipe(day.recipeId);
        const date = new Date(day.date);
        const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

        const isFirst = i === 0;
        const isLast = i === weekplan.days.length - 1;

        html += `
            <article class="day-slot" draggable="true" data-index="${i}" data-day="${day.dayName}">
                <div class="slot-controls">
                    <button class="move-btn" ${isFirst ? 'disabled' : ''} onclick="window.moveWeekplanItem(${i}, -1)" title="Nach oben">▲</button>
                    <div class="drag-handle" title="Ziehen zum Verschieben">⋮⋮</div>
                    <button class="move-btn" ${isLast ? 'disabled' : ''} onclick="window.moveWeekplanItem(${i}, 1)" title="Nach unten">▼</button>
                </div>
                <div class="day-info">
                    <span class="day-header" onclick="window.changeRecipeForDay('${day.dayName}')">${day.dayName} - ${recipe.name}</span>
                    <small>${dateStr}</small>
                </div>
                ${recipe ? `
                    <div class="recipe-info">
                        <details>
                            <summary>Zutaten</summary>
                            <ul>
                                ${recipe.ingredients.map(ing => `
                                    <li>${ing.amount} ${ing.unit} ${ing.name}</li>
                                `).join('')}
                            </ul>
                        </details>
                        <div class="spacer"></div>
                    </div>

                ` : `
                    <p><em>Kein Rezept</em></p>
                `}
            </article>
        `;
    }

    html += '</div>';
            
    html += '<button class="create-weekplan" onclick="window.generateNewWeek()">Neuen Wochenplan erstellen</button>';

    return html;
}

/**
 * Initialisiert Drag & Drop für den Wochenplan
 */
export function initWeekplanDragDrop() {
    const grid = document.getElementById('weekplan-grid');
    if (!grid) return;

    let draggedElement = null;
    let draggedIndex = null;

    grid.addEventListener('dragstart', (e) => {
        const slot = e.target.closest('.day-slot');
        if (!slot) return;

        draggedElement = slot;
        draggedIndex = parseInt(slot.dataset.index);
        slot.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedIndex);
    });

    grid.addEventListener('dragend', (e) => {
        const slot = e.target.closest('.day-slot');
        if (slot) {
            slot.classList.remove('dragging');
        }
        document.querySelectorAll('.day-slot').forEach(s => {
            s.classList.remove('drag-over-before', 'drag-over-after');
        });
        draggedElement = null;
        draggedIndex = null;
    });

    grid.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const slot = e.target.closest('.day-slot');
        if (!slot || slot === draggedElement) {
            return;
        }

        // Clear all indicators
        document.querySelectorAll('.day-slot').forEach(s => {
            s.classList.remove('drag-over-before', 'drag-over-after');
        });

        // Determine if we're in the left or right half of the slot
        const rect = slot.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const isBefore = e.clientX < midX;

        // Show CSS-based indicator
        if (isBefore) {
            slot.classList.add('drag-over-before');
        } else {
            slot.classList.add('drag-over-after');
        }
    });

    grid.addEventListener('dragleave', (e) => {
        // Only handle if leaving the grid entirely
        if (!e.relatedTarget || !grid.contains(e.relatedTarget)) {
            document.querySelectorAll('.day-slot').forEach(s => {
                s.classList.remove('drag-over-before', 'drag-over-after');
            });
        }
    });

    grid.addEventListener('drop', async (e) => {
        e.preventDefault();

        const targetSlot = e.target.closest('.day-slot');
        if (!targetSlot || targetSlot === draggedElement) return;

        const targetIndex = parseInt(targetSlot.dataset.index);

        // Determine drop position (left/right)
        const rect = targetSlot.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const dropBefore = e.clientX < midX;

        // Calculate final index
        let finalIndex = dropBefore ? targetIndex : targetIndex + 1;

        // Adjust if dragging from before the target
        if (draggedIndex < targetIndex) {
            finalIndex = dropBefore ? targetIndex - 1 : targetIndex;
        } else {
            finalIndex = dropBefore ? targetIndex : targetIndex + 1;
        }

        if (draggedIndex !== null && finalIndex !== draggedIndex) {
            await moveWeekplanRecipe(draggedIndex, finalIndex);
        }
    });
}

/**
 * Verschiebt ein Rezept von einem Index zu einem anderen (insert, nicht swap)
 */
async function moveWeekplanRecipe(fromIndex, toIndex) {
    const weekplan = await getCurrentWeekplan();
    if (!weekplan) return;

    // Get the recipe being moved
    const movingRecipeId = weekplan.days[fromIndex].recipeId;

    // Remove it from the source position
    const recipeIds = weekplan.days.map(d => d.recipeId);
    recipeIds.splice(fromIndex, 1);

    // Insert at the target position
    recipeIds.splice(toIndex, 0, movingRecipeId);

    // Update all days with new recipe assignments
    for (let i = 0; i < weekplan.days.length; i++) {
        weekplan.days[i].recipeId = recipeIds[i];
    }

    await saveWeekplan(weekplan);
    await refreshWeekplanUI();
}

/**
 * Aktualisiert die Wochenplan-UI ohne Seiten-Reload
 */
async function refreshWeekplanUI() {
    const appContainer = document.getElementById('app');
    if (!appContainer) return;

    const content = await renderWeekplan();
    appContainer.innerHTML = content;

    // Re-initialize drag & drop
    setTimeout(() => initWeekplanDragDrop(), 50);
}

/**
 * Bewegt ein Element um eine Position (für Pfeiltasten)
 */
export async function moveWeekplanItem(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex > 6) return;

    await moveWeekplanRecipe(index, targetIndex);
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
                await refreshWeekplanUI();
            }
        }
    }
}

/**
 * Rendert das Dashboard (zeigt Wochenplan direkt an)
 */
export async function renderDashboard() {
    const weekplan = await getCurrentWeekplan();
    const recipes = await getAllRecipes();

    // Wenn Wochenplan existiert, zeige ihn direkt an
    if (weekplan) {
        return await renderWeekplan();
    }

    // Kein Wochenplan - zeige Onboarding
    let html = `
        <header class="page-header">
            <h2>Wochenplan</h2>
        </header>
        <article class="onboarding" style="text-align: left;">
            <h3>Willkommen beim Kochplaner!</h3>
            <p>In 3 Schritten zu deinem Wochenplan:</p>
            <ol>
                <li>Füge deine Lieblingsrezepte hinzu</li>
                <li>Generiere einen Wochenplan</li>
                <li>Erstelle deine Einkaufsliste</li>
            </ol>
            <div class="cta-buttons" style="margin-top: 1.5rem; justify-content: flex-start;">
                ${recipes.length === 0 ? `
                    <button onclick="window.loadDefaultRecipes()">📥 Standardrezepte laden</button>
                ` : `
                    <button onclick="window.generateNewWeek()">🎲 Wochenplan erstellen</button>
                `}
            </div>
        </article>
    `;

    return html;
}
