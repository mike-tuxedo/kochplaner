/**
 * sync.js - CRDT-based synchronization using Loro
 *
 * Architecture:
 * - Each client is source of truth for its own state
 * - Loro document stored as binary snapshot in IndexedDB
 * - WebSocket connection to server for sync
 * - Server stores/relays binary updates (no knowledge of content)
 * - End-to-end encryption optional
 */

import init, { LoroDoc } from './lib/loro/loro_wasm.js';
import { deriveDocId, deriveAesKey, encryptData, decryptData } from './crypto.js';

// Constants
const DB_NAME = 'kochplaner-loro';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

// Default WebSocket server URL (can be configured)
const DEFAULT_WS_URL = 'wss://kochplaner-server.mike.fm-media-staging.at';

/**
 * SyncManager - Manages Loro document and synchronization
 */
class SyncManager {
    constructor() {
        this.doc = null;
        this.db = null;
        this.ws = null;
        this.wsUrl = null;
        this.docId = null;
        this.aesKey = null;
        this.isInitialized = false;
        this.isConnected = false;
        this._lastSentVersion = null;
        this.onChangeCallback = null;
        this.onStatusChange = null;
        this.onWeekplanConflict = null;
        this._initialSyncDone = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
    }

    /**
     * Initialize encryption with a sync key
     * Derives document ID and AES key from the sync key
     */
    async initWithKey(syncKey) {
        this.docId = await deriveDocId(syncKey);
        this.aesKey = await deriveAesKey(syncKey);
    }

    /**
     * Initialize Loro WASM and load document from IndexedDB
     */
    async init() {
        if (this.isInitialized) return this;
        if (!this.docId) throw new Error('Call initWithKey() before init()');

        await init();
        this.db = await this._openDB();

        const snapshot = await this._loadSnapshot();
        if (snapshot) {
            this.doc = LoroDoc.fromSnapshot(snapshot);
        } else {
            this.doc = new LoroDoc();
            this._initializeDocument();
        }

        this.isInitialized = true;
        return this;
    }

    /**
     * Initialize document structure
     */
    _initializeDocument() {
        // Get root containers (this creates them if they don't exist)
        this.doc.getMap('recipes');
        this.doc.getMap('weekplan');
        this.doc.getMap('shoppingListChecked');
        this.doc.getMap('settings');
    }

    /**
     * Open IndexedDB
     */
    _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    /**
     * Load snapshot from IndexedDB
     */
    async _loadSnapshot() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(this.docId);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result?.snapshot || null);
            };
        });
    }

    /**
     * Save snapshot to IndexedDB (immediate, called from debounced _triggerSync)
     */
    async _saveSnapshotNow() {
        try {
            const snapshot = this.doc.export({ mode: 'snapshot' });
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            await new Promise((resolve, reject) => {
                const request = store.put({ id: this.docId, snapshot });
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });

        } catch (err) {
            console.error('[Sync] Failed to save snapshot:', err);
        }
    }

    /**
     * Connect to WebSocket server
     */
    connect(wsUrl = DEFAULT_WS_URL) {
        if (this.ws) {
            this.ws.close();
        }

        this.wsUrl = wsUrl;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                if (this.onStatusChange) this.onStatusChange(true);

                // Request current state from server first
                // Local state will be sent after receiving server response (in _handleServerMessage)
                this._requestState();
            };

            this.ws.onmessage = (event) => {
                this._handleServerMessage(event.data);
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                if (this.onStatusChange) this.onStatusChange(false);
                this._scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('[Sync] WebSocket error:', error);
            };
        } catch (err) {
            console.error('[Sync] Connection failed:', err);
            this._scheduleReconnect();
        }
    }

    /**
     * Schedule reconnection attempt
     */
    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;

        setTimeout(() => {
            if (!this.isConnected && this.wsUrl) {
                this.connect(this.wsUrl);
            }
        }, delay);
    }

    /**
     * Request current state from server
     */
    _requestState() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: 'get',
            payload: { id: this.docId }
        }));
    }

    /**
     * Send update to server (encrypts if key is set)
     * Skips if document hasn't changed since last send.
     */
    async _sendUpdate() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        try {
            // Skip if nothing changed since last send
            const currentVersion = this.doc.oplogVersion().encode();
            if (this._lastSentVersion && this._bytesEqual(currentVersion, this._lastSentVersion)) {
                return;
            }

            const snapshot = this.doc.export({ mode: 'snapshot' });

            // Encrypt if key is available
            let payload;
            if (this.aesKey) {
                const encrypted = await encryptData(this.aesKey, snapshot);
                payload = this._uint8ToBase64(encrypted);
            } else {
                payload = this._uint8ToBase64(snapshot);
            }

            this.ws.send(JSON.stringify({
                type: 'update',
                payload: {
                    id: this.docId,
                    binary: payload,
                    encoding: 'base64'
                }
            }));

            this._lastSentVersion = currentVersion;
        } catch (err) {
            console.error('[Sync] Failed to send update:', err);
        }
    }

    /**
     * Compare two Uint8Array byte arrays for equality
     */
    _bytesEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Handle message from server
     */
    async _handleServerMessage(data) {
        try {
            const message = JSON.parse(data);

            if (message.type === 'get') {
                // Server response to our state request
                if (message.payload?.binary) {
                    // Merge server data first
                    await this._mergeRemoteData(message.payload.binary, message.payload.encoding);
                } else {
                    // Server has no data - send our local state
                    this._lastSentVersion = null; // Force full send
                    await this._sendUpdate();
                }
            } else if (message.type === 'update') {
                // Broadcast from another client
                if (message.payload?.binary) {
                    await this._mergeRemoteData(message.payload.binary, message.payload.encoding);
                }
            }
        } catch (err) {
            console.error('[Sync] Failed to handle server message:', err);
        }
    }

    /**
     * Merge remote data into local document (decrypts if key is set)
     */
    async _mergeRemoteData(binaryData, encoding) {
        try {
            let binary;
            if (encoding === 'base64' || typeof binaryData === 'string') {
                binary = this._base64ToUint8(binaryData);
            } else {
                // Legacy: object format
                const length = Object.keys(binaryData).length;
                binary = new Uint8Array(length);
                for (let i = 0; i < length; i++) {
                    binary[i] = binaryData[i];
                }
            }

            // Decrypt if key is available
            if (this.aesKey) {
                try {
                    binary = await decryptData(this.aesKey, binary);
                } catch (decErr) {
                    console.warn('[Sync] Decryption failed, trying raw import as fallback');
                }
            }

            // Save local weekplan before merge for conflict detection
            const localWeekplan = this.getWeekplan();

            // Import the remote data (Loro handles merge automatically)
            this.doc.import(binary);

            // Get the merged weekplan
            const mergedWeekplan = this.getWeekplan();

            // Detect weekplan conflict: only on initial sync, when both had different weekplans
            if (!this._initialSyncDone &&
                localWeekplan && mergedWeekplan &&
                localWeekplan.weekId !== mergedWeekplan.weekId &&
                this.onWeekplanConflict) {
                // Pass both weekplans to the conflict handler
                // Handler should return chosen weekplan or null to keep merged
                const chosen = await this.onWeekplanConflict(localWeekplan, mergedWeekplan);
                if (chosen && chosen.weekId === localWeekplan.weekId) {
                    // User chose local - restore it
                    this.saveWeekplan(localWeekplan);
                }
            }

            // Mark initial sync as done (conflict popup only once per session)
            this._initialSyncDone = true;

            // Notify UI of remote changes immediately
            if (this.onChangeCallback) {
                this.onChangeCallback();
            }

            // Send merged state to server if it includes local ops the server doesn't have
            if (this.isConnected) {
                await this._sendUpdate();
            }

            // Defer IndexedDB save (batches rapid incoming updates)
            this._scheduleSave();
        } catch (err) {
            console.error('[Sync] Failed to merge remote data:', err);
        }
    }

    /**
     * Subscribe to state changes
     */
    subscribe(callback) {
        this.onChangeCallback = callback;
    }


    // ==========================================
    // Recipe Methods
    // ==========================================

    getRecipes() {
        if (!this.doc) return [];

        try {
            const recipesMap = this.doc.getMap('recipes');
            const recipes = [];

            // Use toJSON() to get plain objects
            const json = recipesMap.toJSON();

            for (const [id, recipe] of Object.entries(json)) {
                // Validate recipe has required properties
                if (recipe && typeof recipe === 'object' && recipe.name && !recipe.deleted) {
                    recipes.push({ ...recipe, id });
                }
            }

            return recipes;
        } catch (err) {
            console.error('[Sync] getRecipes error:', err);
            return [];
        }
    }

    saveRecipe(recipe) {
        if (!this.doc) return;

        try {
            const recipesMap = this.doc.getMap('recipes');
            const id = recipe.id || this._generateId();

            // Store as plain JSON object
            const recipeData = JSON.parse(JSON.stringify({
                ...recipe,
                id,
                updatedAt: Date.now()
            }));

            recipesMap.set(id, recipeData);

            // Trigger sync
            this._triggerSync();

            return id;
        } catch (err) {
            console.error('[Sync] saveRecipe error:', err);
        }
    }

    deleteRecipe(id) {
        if (!this.doc) return;

        try {
            const recipesMap = this.doc.getMap('recipes');

            // Get recipe as plain object via toJSON()
            const allRecipes = recipesMap.toJSON();
            const recipe = allRecipes[id];

            if (recipe && typeof recipe === 'object') {
                // Tombstone deletion - store as plain JSON
                recipesMap.set(id, JSON.parse(JSON.stringify({
                    ...recipe,
                    deleted: true,
                    deletedAt: Date.now()
                })));

                // Trigger sync
                this._triggerSync();
            }
        } catch (err) {
            console.error('[Sync] deleteRecipe error:', err);
        }
    }

    // ==========================================
    // Weekplan Methods
    // ==========================================

    getWeekplan() {
        if (!this.doc) return null;
        const weekplanMap = this.doc.getMap('weekplan');
        const json = weekplanMap.toJSON();

        // Return null if empty
        if (!json.weekId) return null;

        // Return a clean plain object for petite-vue reactivity
        return JSON.parse(JSON.stringify(json));
    }

    saveWeekplan(weekplan) {
        if (!this.doc) return;

        const weekplanMap = this.doc.getMap('weekplan');

        // Set each property
        weekplanMap.set('weekId', weekplan.weekId);
        weekplanMap.set('startDate', weekplan.startDate);
        weekplanMap.set('days', weekplan.days);
        weekplanMap.set('updatedAt', Date.now());


        // Trigger sync
        this._triggerSync();
    }

    // ==========================================
    // Shopping List Methods
    // ==========================================

    getShoppingListChecked() {
        if (!this.doc) return {};
        const checkedMap = this.doc.getMap('shoppingListChecked');
        return JSON.parse(JSON.stringify(checkedMap.toJSON()));
    }

    saveShoppingListChecked(checkedItems) {
        if (!this.doc) return;

        const checkedMap = this.doc.getMap('shoppingListChecked');

        // Set each item's checked state
        for (const [name, checked] of Object.entries(checkedItems)) {
            checkedMap.set(name, checked);
        }

        // Trigger sync
        this._triggerSync();
    }

    /**
     * Save a single shopping list item's checked state (optimized for toggle)
     */
    saveShoppingListItem(name, checked) {
        if (!this.doc) return;

        const checkedMap = this.doc.getMap('shoppingListChecked');
        checkedMap.set(name, checked);

        // Trigger sync
        this._triggerSync();
    }

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Trigger sync: send to server quickly, defer IndexedDB save
     */
    _triggerSync() {
        // Send over WebSocket with short debounce (150ms)
        if (this._sendTimeout) {
            clearTimeout(this._sendTimeout);
        }
        this._sendTimeout = setTimeout(async () => {
            if (this.isConnected) {
                await this._sendUpdate();
            }
        }, 150);

        // Defer IndexedDB save (3s debounce, batches rapid changes)
        this._scheduleSave();
    }

    /**
     * Schedule a deferred IndexedDB save (resets on each call)
     */
    _scheduleSave() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        this._saveTimeout = setTimeout(() => {
            this._saveSnapshotNow();
        }, 3000);
    }

    /**
     * Convert Uint8Array to base64 string
     */
    _uint8ToBase64(uint8) {
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < uint8.length; i += chunk) {
            binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    /**
     * Convert base64 string to Uint8Array
     */
    _base64ToUint8(base64) {
        const binary = atob(base64);
        const uint8 = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            uint8[i] = binary.charCodeAt(i);
        }
        return uint8;
    }

    _generateId() {
        return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
            Math.floor(Math.random() * 16).toString(16)
        );
    }

    /**
     * Disconnect from server and reset state
     */
    disconnect() {
        // Flush pending save before disconnect
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            if (this.doc && this.db) this._saveSnapshotNow();
        }
        if (this._sendTimeout) clearTimeout(this._sendTimeout);

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isInitialized = false;
        this.doc = null;
        this.docId = null;
        this.aesKey = null;
        this._lastSentVersion = null;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            connected: this.isConnected,
            wsUrl: this.wsUrl
        };
    }

    /**
     * Force sync now
     */
    syncNow() {
        if (this.isConnected) {
            // Request state from server - response handler will merge and send back
            this._requestState();
        }
    }
}

// Export singleton instance
export const syncManager = new SyncManager();
