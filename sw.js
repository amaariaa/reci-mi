const CACHE = 'reci-mi-v1.6.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.6.0',
  './app.js?v=1.6.0',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './lora.woff',
  './lora-italic.woff',
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

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
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
