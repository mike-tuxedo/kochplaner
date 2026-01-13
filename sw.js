/**
 * Service Worker - HomeCooking App
 * Caching-Strategie für Offline-Fähigkeit
 */

const CACHE_NAME = 'homecooking-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/pico.min.css',
    '/css/style.css',
    '/js/app.js',
    '/js/storage.js',
    '/js/recipes.js',
    '/js/weekplan.js',
    '/js/shopping.js',
    '/js/lib/idb.js',
    '/js/lib/wrap-idb-value.js',
    '/manifest.json'
];

/**
 * Installation - Cache statische Assets
 */
self.addEventListener('install', (event) => {
    console.log('[SW] Installation...');

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching statische Assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );

    self.skipWaiting();
});

/**
 * Aktivierung - Alte Caches löschen
 */
self.addEventListener('activate', (event) => {
    console.log('[SW] Aktivierung...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Lösche alten Cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );

    return self.clients.claim();
});

/**
 * Fetch - Caching-Strategie
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // API-Requests: Network First
    if (request.url.includes('themealdb.com')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // Statische Assets: Cache First
    event.respondWith(cacheFirst(request));
});

/**
 * Cache First Strategie
 * Für statische Assets (HTML, CSS, JS)
 */
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);

        // Nur erfolgreiche Responses cachen
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.error('[SW] Fetch fehlgeschlagen:', error);

        // Fallback für HTML-Requests
        if (request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
        }

        throw error;
    }
}

/**
 * Network First Strategie
 * Für API-Requests (TheMealDB)
 */
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.error('[SW] Network fehlgeschlagen, versuche Cache:', error);

        const cachedResponse = await caches.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        throw error;
    }
}
