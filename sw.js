/* Service worker: aplikasi tetap dapat dibuka tanpa koneksi. */
const CACHE = 'skp-harian-v1';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './Kementerian_Sosial.png',
    './vendor/html2canvas.min.js',
    './vendor/jspdf.umd.min.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => {
                if (cached) return cached;
                if (request.mode === 'navigate') return caches.match('./index.html');
                return Response.error();
            }))
    );
});
