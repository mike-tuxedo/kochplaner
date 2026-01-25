# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

No build tools or bundler required. The app uses vanilla ES modules served directly.

**Run the app:** Serve the project root with any static file server (e.g., `python -m http.server 3000`).

**Run the WebSocket sync server:**
```bash
cd websocket
npm install
npm start  # PORT=8080 by default
```

**After modifying cached files:** Bump the cache version in `sw.js` (`CACHE_NAME = 'kochplaner-vN'`) and add any new files to the `STATIC_ASSETS` array.

## Architecture

**Kochplaner** is an offline-first PWA meal planner with multi-device sync.

### Frontend Stack
- **petite-vue** (reactive framework, lightweight Vue alternative) — `js/app.js` is the main reactive store
- **Pico CSS** for base styling + custom CSS in `css/style.css`
- **Custom Web Components**: `<app-drawer>` (bottom sheet), `<app-modal>` (dialog)
- Hash-based routing: `#plan`, `#recipes`, `#shopping`, `#settings` → pages loaded from `routes/*.html`

### Data Flow
```
User Action → petite-vue reactive state → IndexedDB (js/storage.js)
                                        → Loro CRDT doc (js/sync.js) → WebSocket → other devices
```

### Storage
- **App data** (`homecooking` IDB): recipes, weekplans, settings — managed by `js/storage.js`
- **Sync data** (`kochplaner-loro` IDB): Loro CRDT binary snapshots — managed by `js/sync.js`
- Both IndexedDB databases coexist; the Loro doc is the sync source of truth when sync is active

### Sync System (js/sync.js)
- **Loro CRDT** (WebAssembly) for conflict-free merging
- Document maps: `recipes`, `weekplan`, `shoppingListChecked`, `settings`
- WebSocket protocol: `{ type: 'get'|'update', payload: { id, binary, encoding } }`
- Server is a dumb relay (stores latest snapshot per doc ID, broadcasts to peers)
- **Performance pattern**: WebSocket sends debounced at 150ms; IndexedDB saves deferred at 3s
- Version tracking via `doc.oplogVersion().encode()` to skip redundant sends
- After merging remote data, sends merged state back (version check prevents echo loops)

### Encryption (js/crypto.js)
- AES-256-GCM with HKDF key derivation from a shared sync key
- `crypto.subtle` required (HTTPS/localhost only); graceful fallback for HTTP (no encryption, FNV hash for doc ID)
- QR code sharing for sync key distribution (`js/qr.js`)

### petite-vue Reactivity Quirks

**Array/Object replacement**: When replacing array/object data that drives `v-for`, set it to an empty skeleton first, then use `setTimeout(() => { ... }, 0)` to assign the real data. This forces petite-vue to re-render the list correctly.

**v-if inside v-for breaks DOM**: Adding `v-if` to elements inside a `v-for` loop destabilizes petite-vue's DOM anchors and causes `insertBefore` errors. **Solution**: Use CSS-based visibility (add class to parent, hide/show children via CSS) instead of `v-if`. Example: `shopping.html` uses `.shopping-edit-mode` class on the article, CSS rules hide/show drag handles and action buttons.

**Reactive checks in event handlers cause lag**: Avoid patterns like `@dragover="condition && handler()"` - the reactive property access fires constantly during drag. Keep event handlers static.

**Setting multiple reactive properties**: Use `requestAnimationFrame()` to delay dependent state changes. Example: `startEditItem()` sets text/amount/unit first, then uses rAF to set the editing index.

### Shopping List Sync
`syncShoppingList(item)` syncs only the single toggled item (not the full list). This calls `saveShoppingListItem(name, checked)` which does a single `checkedMap.set()` in Loro.

### Sync Connection Flow
1. On connect: only request state from server (don't send immediately)
2. Server responds to 'get' with data or `{ binary: null }` if empty
3. Client merges server data (if any), then sends merged state back
4. This prevents race conditions where empty local state overwrites server data

### Mixed Content (Local Development)
HTTP pages cannot connect to WSS (secure WebSocket). For local testing on mobile:
- Run local WebSocket server: `cd websocket && npm start`
- Set sync server URL to `ws://LOCAL_IP:8080` (not wss://)

### Speech Recognition (js/speech.js)
- **Vosk-Browser** for offline German speech recognition
- Model (~45MB) cached by browser HTTP cache after first download
- `initSpeechModel(onProgress)` - async, returns when model ready
- `startListening(onResult, onPartial)` - starts mic capture
- Smart ingredient parsing in `_parseIngredient()`: recognizes German number words (eins, zwei, fünf...) and units (Stück, Gramm, Liter...)

## Key Files

| File | Purpose |
|------|---------|
| `js/app.js` | Main reactive store, all page logic, sync UI state machine |
| `js/sync.js` | SyncManager: Loro doc, WebSocket, encryption integration |
| `js/storage.js` | IndexedDB CRUD for recipes/weekplans/settings |
| `js/crypto.js` | AES-256-GCM encryption, key derivation, FNV hash fallback |
| `js/speech.js` | Vosk offline speech recognition, model loading, mic capture |
| `routes/*.html` | Page templates with petite-vue directives |
| `css/style.css` | Custom styles, CSS-based edit mode visibility |
| `sw.js` | Service Worker: cache-first for assets, network-first for APIs |
| `websocket/websocket-server.js` | Node.js WebSocket relay + SQLite storage |
