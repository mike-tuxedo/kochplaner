# Kochplaner

Einfache Wochenplan-App zum Kochen mit automatischer Einkaufsliste. Offline-first, datenschutzfreundlich, kein Tracking, keine Werbung.

## Features

- **Rezeptverwaltung** — Eigene Rezepte mit Zutaten und Fotos anlegen, bearbeiten und importieren
- **Wochenplan** — Automatische Erstellung eines 7-Tage-Plans aus deinen Rezepten
- **Einkaufsliste** — Wird automatisch aus dem Wochenplan generiert, mit Drag & Drop-Sortierung und manuellen Einträgen
- **Offline verfügbar** — Vollständig offline nutzbar als installierbare PWA (Progressive Web App)
- **Multi-Device Sync** — Ende-zu-Ende-verschlüsselte Synchronisierung zwischen Geräten via Loro CRDT
- **Spracheingabe** — Offline-Spracherkennung (Deutsch) für Rezepte und Einkaufsliste
- **QR-Code Sharing** — Sync-Schlüssel und Listen per QR-Code teilen
- **Backup** — Rezepte als JSON exportieren und importieren
- **Dark/Light Theme** — Zwischen hellen und dunklen Design wechseln

## Tech Stack

| Bereich | Technologie |
|---------|------------|
| Frontend | Vanilla ES Modules (kein Bundler) |
| Reaktivität | [petite-vue](https://github.com/vuejs/petite-vue) |
| CSS Framework | [Pico CSS](https://picocss.com/) |
| Icons | [Remix Icons](https://remixicon.com/) |
| Illustrationen | [unDraw](https://undraw.co/) |
| Storage | IndexedDB via [idb](https://github.com/jakearchibald/idb) |
| Sync | [Loro CRDT](https://loro.dev/) (WebAssembly) + WebSocket |
| Verschlüsselung | Web Crypto API (AES-256-GCM, HKDF) |
| Spracherkennung | [Vosk-Browser](https://github.com/nicksiv/vosk-browser) (Offline, Deutsch) |
| QR-Codes | [qrcode.js](https://github.com/davidshimjs/qrcodejs) + [jsQR](https://github.com/nicksiv/jsQR) |
| Rezept-API | [TheMealDB](https://www.themealdb.com/) (Rezeptvorschläge) |
| WebSocket Server | Node.js, [ws](https://github.com/websockets/ws), [SQLite3](https://github.com/TryGhost/node-sqlite3) |

## Schnellstart

Das Projekt benötigt keinen Build-Schritt. Einfach mit einem statischen Webserver ausliefern:

```bash
# Projekt klonen
git clone https://github.com/dein-user/homecooking.git
cd homecooking

# Mit beliebigem Static-Server starten
python -m http.server 3000
# oder
npx serve .
```

Dann im Browser `http://localhost:3000` öffnen.

### Sync-Server (optional)

Der WebSocket-Server ist ein einfacher Relay-Server, der verschlüsselte CRDT-Snapshots zwischen Geräten weiterleitet. Der Server hat keinen Zugriff auf die unverschlüsselten Daten.

```bash
cd websocket
npm install
npm start  # Startet auf Port 8080
```

Für lokales Testen auf mobilen Geräten den Sync-Server-URL auf `ws://LOKALE_IP:8080` setzen.

## Architektur

```
User Action → petite-vue Reaktiver State → IndexedDB (Daten)
                                         → Loro CRDT → WebSocket → andere Geräte
```

### Datenfluss

- **App-Daten** werden in IndexedDB (`homecooking`) gespeichert: Rezepte, Wochenpläne, Einstellungen
- **Sync-Daten** werden in einer separaten IndexedDB (`kochplaner-loro`) als Loro CRDT-Snapshots gespeichert
- Bei aktivem Sync ist das Loro-Dokument die Source of Truth
- WebSocket-Sends werden mit 150ms Debounce, IndexedDB-Saves mit 3s Verzögerung ausgeführt

### Verschlüsselung

- AES-256-GCM mit HKDF-Schlüsselableitung aus einem geteilten Sync-Schlüssel
- Erfordert HTTPS oder localhost (`crypto.subtle`)
- Graceful Fallback für HTTP (unverschlüsselt, FNV-Hash für Dokument-IDs)

### Routing

Hash-basiertes Routing (`#plan`, `#recipes`, `#shopping`, `#settings`) mit HTML-Templates in `routes/`.

## Projektstruktur

```
├── index.html              # Hauptseite, App-Shell
├── manifest.json           # PWA-Manifest
├── sw.js                   # Service Worker (Cache-Strategien)
├── css/
│   ├── pico.min.css        # Pico CSS Framework
│   └── style.css           # Custom Styles
├── js/
│   ├── app.js              # Hauptlogik, petite-vue Store
│   ├── storage.js          # IndexedDB CRUD
│   ├── sync.js             # Loro CRDT + WebSocket Sync
│   ├── crypto.js           # AES-256-GCM Verschlüsselung
│   ├── speech.js           # Vosk Offline-Spracherkennung
│   ├── qr.js               # QR-Code Generierung & Scanning
│   ├── components/
│   │   ├── drawer.js       # <app-drawer> Bottom-Sheet
│   │   └── modal.js        # <app-modal> Dialog-Komponente
│   └── lib/                # Third-Party Libraries
├── routes/
│   ├── weekplan.html       # Wochenplan-Seite
│   ├── recipes.html        # Rezepte-Seite
│   ├── shopping.html       # Einkaufsliste
│   ├── settings.html       # Einstellungen
│   └── welcome.html        # Willkommensseite
├── images/                 # SVG-Illustrationen (unDraw)
├── icons/                  # App-Icons & UI-Icons
└── websocket/
    ├── websocket-server.js # Node.js WebSocket Relay
    └── package.json
```

## Lizenz

MIT

## Credits

- Illustrationen von [unDraw](https://undraw.co/)
- Icons von [Remix Icon](https://remixicon.com/)
- CSS Framework: [Pico CSS](https://picocss.com/)
- Reaktivität: [petite-vue](https://github.com/vuejs/petite-vue)
- CRDT Sync: [Loro](https://loro.dev/)
- Spracherkennung: [Vosk](https://alphacephei.com/vosk/)
- Rezeptvorschläge: [TheMealDB](https://www.themealdb.com/)
- QR-Code: [qrcode.js](https://github.com/davidshimjs/qrcodejs) & [jsQR](https://github.com/nicksiv/jsQR)
- IndexedDB Wrapper: [idb](https://github.com/jakearchibald/idb)
