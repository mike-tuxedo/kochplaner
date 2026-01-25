# HomeCooking App - Implementierungsplan

## 🎯 Projektziel
Eine einfache, offline-fähige Wochenplan-App für Lieblingsgerichte mit Einkaufslisten-Funktion.

## 📋 Projektstruktur

```
homecooking/
├── index.html              # Haupt-HTML-Datei (SPA)
├── manifest.json           # PWA Manifest für Offline-Fähigkeit
├── sw.js                   # Service Worker
├── css/
│   ├── pico.min.css        # Pico CSS lokal (herunterladen)
│   └── style.css           # Custom Styles (nested CSS)
├── js/
│   ├── lib/
│   │   └── idb.js          # IndexedDB Wrapper (lokal)
│   ├── app.js              # Haupt-App-Logik & Routing
│   ├── storage.js          # IndexedDB-Management
│   ├── recipes.js          # Rezepte-Verwaltung
│   ├── weekplan.js         # Wochenplan-Generator
│   └── shopping.js         # Einkaufslisten-Generator
└── icons/                  # PWA Icons (optional)
```

## 🎯 Funktionale Module

### 1. Rezepte-Verwaltung (recipes.js)
- CRUD-Operationen für Gerichte
- Datenstruktur:
  ```js
  {
    id: string,
    name: string,
    ingredients: [
      { name: string, amount: number, unit: string }
    ],
    createdAt: timestamp
  }
  ```
- Speicherung in IndexedDB

### 2. Wochenplan-Generator (weekplan.js)
- Randomisierter Algorithmus für 7 Tage (Montag-Sonntag)
- Vermeidung von Wiederholungen in kurzer Zeit
- Editierfunktion (Rezept austauschen)
- Datenstruktur:
  ```js
  {
    weekId: string,
    startDate: date,
    days: [
      { dayName: string, date: date, recipeId: string }
    ]
  }
  ```

### 3. Einkaufsliste (shopping.js)
- Aggregiert alle Zutaten des aktuellen Wochenplans
- Zusammenfassen gleicher Zutaten (z.B. 3x Zwiebeln → 3 Zwiebeln)
- Abhak-Funktion für erledigte Einkäufe
- Export als Textliste

### 4. API-Integration (app.js)
- TheMealDB API für zufällige Rezeptvorschläge
- Endpoint: `https://www.themealdb.com/api/json/v1/1/random.php`
- Fallback-Meldung wenn offline
- Import-Funktion für externe Rezepte

## 🎨 SPA-Navigation

### Ansichten (Hash-Routing)
1. **`#/` - Dashboard**
   - Übersicht aktueller Wochenplan (7 Tage)
   - Quick-Actions (Neue Woche, Einkaufsliste)

2. **`#/recipes` - Meine Rezepte**
   - Liste aller Rezepte
   - Hinzufügen/Bearbeiten/Löschen

3. **`#/weekplan` - Wochenplan**
   - 7-Tage-Ansicht
   - Edit-Modus (Rezept pro Tag ändern)
   - "Neue Woche generieren" Button

4. **`#/shopping` - Einkaufsliste**
   - Generierte Liste aus aktuellem Wochenplan
   - Checkbox zum Abhaken
   - Text-Export

5. **`#/discover` - Rezept entdecken**
   - Zufälliges Rezept von TheMealDB
   - "Als eigenes Rezept speichern" Button

### Navigation
- Hamburger-Menü (mobil) / Sidebar (desktop)
- Hash-basiertes Client-Side-Routing
- Browser Back/Forward funktionsfähig

## 💾 Datenpersistenz

### IndexedDB Schema
**Datenbank:** `homecooking`

**Object Stores:**
1. **recipes** (keyPath: `id`)
   - Index: `createdAt`

2. **weekplans** (keyPath: `weekId`)
   - Index: `startDate`

3. **settings** (keyPath: `key`)
   - z.B. `{ key: 'currentWeekId', value: '...' }`

**Library:** idb v7 (Jake Archibald)
- Kleiner Wrapper für IndexedDB (~1KB)
- Promise-basiert
- Download: https://cdn.jsdelivr.net/npm/idb@7/build/umd.js
- Lokal speichern unter `js/lib/idb.js`

## 🎨 Styling-Ansatz

### Pico CSS als Basis
- Download: https://unpkg.com/@picocss/pico@latest/css/pico.min.css
- Lokal speichern unter `css/pico.min.css`
- Nutzt semantisches HTML (kein class-overload)

### Custom CSS (style.css)
Nested CSS für:
```css
.recipe-card {
  & .header { ... }
  & .ingredients { ... }
}

.weekplan-grid {
  & .day-slot {
    & .recipe-name { ... }
  }
}

.shopping-list {
  & .item {
    & input[type="checkbox"] { ... }
  }
}
```

### Design-Prinzipien
- Mobile-first
- Pico CSS Default Theme
- Minimale Custom-Styles
- CSS Grid für Layouts

## 🔧 Technische Details

### Keine Build-Tools
- Vanilla JavaScript (ES6+)
- Native Modules (`type="module"`)
- Keine Transpilation
- Keine Bundler

### Service Worker
- Caching-Strategie: Cache First für statische Assets
- Network First für API-Calls
- Fallback für Offline-Modus

### Progressive Web App
- Installierbar auf Smartphone/Desktop
- Funktioniert offline
- App-Icons (optional später)

### Browser-Anforderungen
- Moderne Browser (Chrome, Firefox, Safari, Edge)
- IndexedDB Support (alle modernen Browser)
- ES6 Modules Support
- CSS Nesting (oder Fallback auf flaches CSS)

## 🚀 Implementierungs-Reihenfolge

### Phase 1: Grundgerüst ✅
- [x] Projektstruktur anlegen
- [x] Pico CSS lokal einbinden
- [x] idb Library lokal einbinden
- [x] HTML-Grundstruktur (SPA-Shell)
- [x] Service Worker Setup
- [x] Hash-Routing implementieren

### Phase 2: Datenschicht ✅
- [x] IndexedDB initialisieren (storage.js)
- [x] CRUD-Funktionen für Rezepte
- [x] CRUD-Funktionen für Wochenpläne

### Phase 3: Rezepte-Modul ✅
- [x] Rezepte-Liste anzeigen
- [x] Rezept hinzufügen (Formular)
- [x] Rezept bearbeiten/löschen
- [x] Zutaten dynamisch hinzufügen/entfernen

### Phase 4: Wochenplan ✅
- [x] Random-Algorithmus implementieren
- [x] Wochenplan-Ansicht (7 Tage)
- [x] Edit-Modus (Rezept pro Tag ändern)
- [x] "Neue Woche generieren" Funktion

### Phase 5: Einkaufsliste ✅
- [x] Zutaten aus Wochenplan aggregieren
- [x] Gleiche Zutaten zusammenfassen
- [x] Abhak-Funktion
- [x] Text-Export / Share
- [x] Sortierbar am Handy (Drag & Drop)
- [x] Manuell bearbeitbar:
  - [x] Einträge hinzufügen
  - [x] Einträge löschen
  - [x] Einträge umschreiben

### Phase 6: API-Integration ✅
- [x] TheMealDB API einbinden
- [x] Zufälliges Rezept abrufen
- [x] Rezept-Import-Funktion
- [x] Offline-Fallback
- [x] Auto-Übersetzung (MyMemory API)

### Phase 7: Polish ✅
- [x] Custom CSS (nested)
- [x] Responsive Design
- [x] PWA-Icons erstellen
- [x] UX-Verbesserungen
- [x] Animationen (Bubbles-Hintergrund)

### Phase 8: Multi-Device Sync ✅
- [x] Loro CRDT für konfliktfreies Merging
- [x] WebSocket Relay Server
- [x] Ende-zu-Ende Verschlüsselung (AES-256-GCM)
- [x] Sync-Key Generierung & Import
- [x] QR-Code Sharing
- [x] Shopping-List Sync (Checked-State)
- [x] Sync UI zum Teilen überarbeiten (Icon im Key-Feld)
- [x] Wochenplan-Konflikt: Popup bei unterschiedlichen Plänen

### Phase 9: Spracheingabe (Vosk) ✅
- [x] Vosk WebAssembly Integration
- [x] Rezepte per Sprache eingeben (Name, Zubereitung, Zutaten)
- [x] Einkaufslisteneinträge per Sprache hinzufügen
- [x] Smart Ingredient Parsing (deutsche Zahlwörter & Einheiten)

### Phase 10: Projekt-Cleanup & Refactoring ✅
- [x] Ungenutzten Code/Dateien löschen (empty package-lock.json, .gitignore aktualisiert)
- [x] CSS konsequent nested gestalten (bereits umgesetzt)
- [x] Duplicate CSS-Variable in theme.css entfernt
- [x] Code Refactoring (iOS Install Dialog & goToApp Helfer konsolidiert)
- [x] Rezeptidee Loading Indicator hinzugefügt

## 📚 Externe Ressourcen

### Zu downloaden & lokal hosten:
1. **Pico CSS**: https://unpkg.com/@picocss/pico@latest/css/pico.min.css
2. **idb Library**: https://cdn.jsdelivr.net/npm/idb@7/build/umd.js

### API
- **TheMealDB**: https://www.themealdb.com/api.php
  - Random Meal: `https://www.themealdb.com/api/json/v1/1/random.php`
  - Kostenlos, keine API-Key erforderlich

## 🔒 Datensicherheit

- Alle Daten bleiben lokal im Browser
- Keine Server-Kommunikation außer TheMealDB API
- Kein User-Tracking
- Export-Funktion für Backup (optional später)

## ✅ Definition of Done

Die App ist fertig, wenn:
- ✅ Rezepte können angelegt, bearbeitet und gelöscht werden
- ✅ Ein randomisierter Wochenplan kann generiert werden
- ✅ Der Wochenplan ist editierbar (einzelne Tage ändern)
- ✅ Eine Einkaufsliste wird automatisch erstellt
- ✅ Externe Rezepte können über TheMealDB importiert werden
- ✅ Die App funktioniert komplett offline
- ✅ Daten bleiben nach Cache-Clearing erhalten (IndexedDB)
- ✅ Mobile und Desktop responsive

---

**Stand:** 2026-01-25
**Technologie-Stack:** HTML, CSS (Pico CSS), Vanilla JavaScript (petite-vue), IndexedDB, Service Worker, Loro CRDT, WebSocket, Vosk-Browser
**Besonderheit:** Keine Build-Tools, komplett offline-fähig, local-first, E2E-verschlüsselter Multi-Device Sync, Offline-Spracheingabe
