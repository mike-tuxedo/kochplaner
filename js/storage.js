/**
 * storage.js - IndexedDB Management
 * Nutzt idb Library für Promise-basierte DB-Operationen
 */

import { openDB } from './lib/idb.js';

const DB_NAME = 'homecooking';
const DB_VERSION = 1;

let db = null;

/**
 * Initialisiert die IndexedDB
 */
export async function initDB() {
    if (db) return db;

    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
            // Object Store: recipes
            if (!db.objectStoreNames.contains('recipes')) {
                const recipeStore = db.createObjectStore('recipes', { keyPath: 'id' });
                recipeStore.createIndex('createdAt', 'createdAt');
            }

            // Object Store: weekplans
            if (!db.objectStoreNames.contains('weekplans')) {
                const weekplanStore = db.createObjectStore('weekplans', { keyPath: 'weekId' });
                weekplanStore.createIndex('startDate', 'startDate');
            }

            // Object Store: settings
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
        }
    });

    return db;
}

/**
 * Recipes CRUD
 */
export async function getAllRecipes() {
    const database = await initDB();
    return await database.getAll('recipes');
}

export async function getRecipe(id) {
    const database = await initDB();
    return await database.get('recipes', id);
}

export async function saveRecipe(recipe) {
    const database = await initDB();
    if (!recipe.id) {
        recipe.id = crypto.randomUUID();
        recipe.createdAt = Date.now();
    }
    await database.put('recipes', recipe);
    return recipe;
}

export async function deleteRecipe(id) {
    const database = await initDB();
    await database.delete('recipes', id);
}

/**
 * Weekplans CRUD
 */
export async function getAllWeekplans() {
    const database = await initDB();
    return await database.getAll('weekplans');
}

export async function getWeekplan(weekId) {
    const database = await initDB();
    return await database.get('weekplans', weekId);
}

export async function saveWeekplan(weekplan) {
    const database = await initDB();
    if (!weekplan.weekId) {
        weekplan.weekId = crypto.randomUUID();
    }
    await database.put('weekplans', weekplan);
    return weekplan;
}

export async function deleteWeekplan(weekId) {
    const database = await initDB();
    await database.delete('weekplans', weekId);
}

/**
 * Settings
 */
export async function getSetting(key) {
    const database = await initDB();
    const setting = await database.get('settings', key);
    return setting ? setting.value : null;
}

export async function setSetting(key, value) {
    const database = await initDB();
    await database.put('settings', { key, value });
}
