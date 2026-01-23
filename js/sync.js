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

// Constants
const DB_NAME = 'kochplaner-loro';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const DOC_ID = 'main';

// Default WebSocket server URL (can be configured)
const DEFAULT_WS_URL = 'ws://localhost:8080';

/**
 * SyncManager - Manages Loro document and synchronization
 */
class SyncManager {
    constructor() {
        this.doc = null;
        this.db = null;
        this.ws = null;
        this.wsUrl = null;
        this.isInitialized = false;
        this.isConnected = false;
        this.lastSyncVersion = null;
        this.onChangeCallback = null;
        this.onStatusChange = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
    }

    /**
     * Initialize Loro WASM and load document from IndexedDB
     */
    async init() {
        if (this.isInitialized) return this;

        console.log('[Sync] Initializing Loro...');

        // Initialize WASM
        await init();
        console.log('[Sync] WASM initialized');

        // Open IndexedDB
        this.db = await this._openDB();
        console.log('[Sync] IndexedDB opened');

        // Load or create document
        const snapshot = await this._loadSnapshot();
        if (snapshot) {
            console.log('[Sync] Loading document from snapshot...');
            this.doc = LoroDoc.fromSnapshot(snapshot);
        } else {
            console.log('[Sync] Creating new document...');
            this.doc = new LoroDoc();
            this._initializeDocument();
        }

        this.isInitialized = true;
        console.log('[Sync] Initialization complete');
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
            const request = store.get(DOC_ID);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result?.snapshot || null);
            };
        });
    }

    /**
     * Save snapshot to IndexedDB (debounced)
     */
    _saveSnapshot() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }

        this._saveTimeout = setTimeout(async () => {
            try {
                const snapshot = this.doc.export({ mode: 'snapshot' });
                const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);

                await new Promise((resolve, reject) => {
                    const request = store.put({ id: DOC_ID, snapshot });
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => resolve();
                });

                console.log('[Sync] Snapshot saved to IndexedDB');
            } catch (err) {
                console.error('[Sync] Failed to save snapshot:', err);
            }
        }, 500); // Debounce 500ms
    }

    /**
     * Connect to WebSocket server
     */
    connect(wsUrl = DEFAULT_WS_URL) {
        if (this.ws) {
            this.ws.close();
        }

        this.wsUrl = wsUrl;
        console.log('[Sync] Connecting to', wsUrl);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[Sync] WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                if (this.onStatusChange) this.onStatusChange(true);

                // Request current state from server
                this._requestState();
            };

            this.ws.onmessage = (event) => {
                this._handleServerMessage(event.data);
            };

            this.ws.onclose = () => {
                console.log('[Sync] WebSocket disconnected');
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
            console.log('[Sync] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`[Sync] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

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
            payload: { id: DOC_ID }
        }));
    }

    /**
     * Send update to server
     */
    _sendUpdate() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        try {
            // Reuse cached snapshot if available, otherwise export
            const snapshot = this._lastSnapshot || this.doc.export({ mode: 'snapshot' });
            this._lastSnapshot = null;

            // Convert Uint8Array to base64 string (much more efficient than byte-by-byte JSON)
            const base64 = this._uint8ToBase64(snapshot);

            this.ws.send(JSON.stringify({
                type: 'update',
                payload: {
                    id: DOC_ID,
                    binary: base64,
                    encoding: 'base64'
                }
            }));

            console.log('[Sync] Update sent to server');
        } catch (err) {
            console.error('[Sync] Failed to send update:', err);
        }
    }

    /**
     * Handle message from server
     */
    _handleServerMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('[Sync] Received message:', message.type);

            if (message.type === 'get' || message.type === 'update') {
                if (message.payload?.binary) {
                    this._mergeRemoteData(message.payload.binary, message.payload.encoding);
                }
            }
        } catch (err) {
            console.error('[Sync] Failed to handle server message:', err);
        }
    }

    /**
     * Merge remote data into local document
     */
    _mergeRemoteData(binaryData, encoding) {
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

            // Capture state before merge for comparison
            const weekplanBefore = JSON.stringify(this.doc.getMap('weekplan').toJSON());

            // Create a temporary doc from remote snapshot to read remote state
            let remoteDoc;
            try {
                remoteDoc = LoroDoc.fromSnapshot(binary);
            } catch (e) {
                // Not a snapshot format, try as update
                remoteDoc = null;
            }

            // Import the remote snapshot/update
            this.doc.import(binary);

            const weekplanAfter = JSON.stringify(this.doc.getMap('weekplan').toJSON());
            const weekplanChanged = weekplanBefore !== weekplanAfter;
            console.log('[Sync] Remote data merged. Weekplan changed:', weekplanChanged);

            // If Loro merge didn't change the weekplan but remote has a newer one, apply it manually
            if (!weekplanChanged && remoteDoc) {
                const remoteWeekplan = remoteDoc.getMap('weekplan').toJSON();
                const localWeekplan = this.doc.getMap('weekplan').toJSON();
                const remoteHasWeekplan = remoteWeekplan.weekId && remoteWeekplan.updatedAt;
                const localHasWeekplan = localWeekplan.weekId && localWeekplan.updatedAt;

                if (remoteHasWeekplan && (!localHasWeekplan || remoteWeekplan.updatedAt > localWeekplan.updatedAt)) {
                    console.log('[Sync] Applying newer remote weekplan manually');
                    const weekplanMap = this.doc.getMap('weekplan');
                    weekplanMap.set('weekId', remoteWeekplan.weekId);
                    weekplanMap.set('startDate', remoteWeekplan.startDate);
                    weekplanMap.set('days', remoteWeekplan.days);
                    weekplanMap.set('updatedAt', remoteWeekplan.updatedAt);
                }
            }

            // Save to IndexedDB
            this._saveSnapshot();

            // Notify UI immediately for remote changes
            if (this.onChangeCallback) {
                console.log('[Sync] Notifying UI of remote changes');
                this.onChangeCallback();
            } else {
                console.warn('[Sync] No onChangeCallback set!');
            }
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
            console.log('[Sync] Recipe saved:', id);

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
                console.log('[Sync] Recipe deleted:', id);

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
        console.log('[Sync] getWeekplan raw keys:', Object.keys(json));

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

        console.log('[Sync] Weekplan saved');

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

        console.log('[Sync] Shopping list checked state saved');

        // Trigger sync
        this._triggerSync();
    }

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Trigger sync: save to IndexedDB and send to server (debounced)
     */
    _triggerSync() {
        // Save to IndexedDB (already debounced at 500ms)
        this._saveSnapshot();

        // Notify UI (debounced)
        this._notifyUI();

        // Debounce server update to avoid excessive network calls
        if (this._syncTimeout) {
            clearTimeout(this._syncTimeout);
        }

        this._syncTimeout = setTimeout(() => {
            if (this.isConnected) {
                // Cache the snapshot so _sendUpdate can reuse it
                this._lastSnapshot = this.doc.export({ mode: 'snapshot' });
                this._sendUpdate();
            }
        }, 750);
    }

    /**
     * Notify UI of state changes (debounced)
     */
    _notifyUI() {
        if (!this.onChangeCallback) return;

        if (this._notifyTimeout) {
            clearTimeout(this._notifyTimeout);
        }

        this._notifyTimeout = setTimeout(() => {
            if (this.onChangeCallback) {
                this.onChangeCallback();
            }
        }, 300);
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
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
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
            this._requestState();
            this._sendUpdate();
        }
    }
}

// Export singleton instance
export const syncManager = new SyncManager();
