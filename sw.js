/**
 * Service Worker - Kochplaner App
 * Caching-Strategie für Offline-Fähigkeit
 */

const CACHE_NAME = 'kochplaner-v10';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/pico.min.css',
    './css/theme.css',
    './css/style.css',
    './js/app.js',
    './js/storage.js',
    './js/crypto.js',
    './js/qr.js',
    './js/sync.js',
    './js/lib/idb.js',
    './js/lib/wrap-idb-value.js',
    './js/lib/petite-vue.es.js',
    './js/lib/utils.js',
    './js/lib/navigation.js',
    './js/lib/qrcode.js',
    './js/lib/jsqr.js',
    './js/components/drawer.js',
    './js/components/modal.js',
    './routes/welcome.html',
    './routes/weekplan.html',
    './routes/recipes.html',
    './routes/shopping.html',
    './routes/settings.html',
    './manifest.json'
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

    // Auto-update: activate new SW immediately
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
 */
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.error('[SW] Fetch fehlgeschlagen:', error);

        if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
        }

        throw error;
    }
}

/**
 * Network First Strategie
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
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        throw error;
    }
}
