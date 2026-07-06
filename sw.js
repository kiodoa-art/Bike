const CACHE_NAME = 'kickr-live-v19-auto-bluetooth-reconnect';
const HISTORY_PATH = './data/training-history.json';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './spotify-controls.css',
  './app.js',
  './spotify.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Spotify API-kald og andre eksterne forespørgsler må aldrig caches af appen.
  if (url.origin !== self.location.origin) return;

  // OAuth-callbacks kan indeholde en engangskode i URL'en og må ikke gemmes i cachen.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.pathname.endsWith('/data/training-history.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`Historik svarede med ${response.status}`);
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(HISTORY_PATH, copy));
          return response;
        })
        .catch(() => caches.match(HISTORY_PATH))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => (
        cached || new Response('Indholdet er ikke tilgængeligt offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      )))
  );
});
