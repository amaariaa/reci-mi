const CACHE = 'reci-mi-v3.5';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=3.5',
  './app.js?v=3.5',
  './manifest.webmanifest?v=3.5',
  './mond-192.png',
  './mond-512.png',
  './mond-maskable-512.png',
  './moon.webp',
  './lora.ttf',
  './lora-italic.ttf',
  './inter-regular.woff',
  './inter-medium.woff',
  './inter-semibold.woff'
];

self.addEventListener('install', event => {
  // Jede Datei einzeln: fehlt eine, scheitert nicht gleich das ganze Update
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(ASSETS.map(url => cache.add(url).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Wetter und Ortssuche immer frisch aus dem Netz, nie aus dem Speicher
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
