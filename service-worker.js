const CACHE = 'fat-v3-2026-07-18-24';
const CORE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/site.css',
  '/assets/fonts/inter-var-latin.woff2',
  '/assets/fonts/saira-latin-400-900.woff2',
  '/assets/fonts/saira-stencil-one-latin-400.woff2',
  '/assets/fonts/ibm-plex-mono-latin-400.woff2',
  '/assets/fonts/ibm-plex-mono-latin-500.woff2',
  '/assets/fonts/ibm-plex-mono-latin-600.woff2',
  '/assets/img/icon.svg',
  '/assets/img/logo-fat.svg',
  '/assets/img/favicon.svg',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
  '/assets/img/icon-maskable.svg',
  '/assets/img/icon-maskable-512.png',
  '/assets/img/partage-fat.png',
  '/assets/img/quentin-guirois.jpg',
  '/app.js',
  '/advanced-3d-app.js',
  '/advanced-device.js',
  '/advanced-transition.js',
  '/calculation-loader.js',
  '/calculator-tutorial.js',
  '/chart-data.js',
  '/render-capabilities.js',
  '/site.js',
  '/theme.js',
  '/physics-core.js',
  '/trajectory.worker.js',
  '/convertisseur-joules-fps/',
  '/outils/',
  '/guides/',
  '/simulateur-3d-airsoft/',
  '/outils/choisir-gaz-airsoft-pression-temperature/',
  '/data/green-gas-pressure-curves.json',
  '/gas-pressure-tool.js',
  '/gas-pressure-app.js',
  '/modele-physique-atp/'
];

// Ces ressources restent hors du pré-cache pour préserver le lazy-load réseau.
// Elles rejoignent le même cache lors de la première activation de la vue 3D.
const LAZY_3D = [
  '/drone-3d.js',
  '/assets/vendor/three-r185/build/three.module.min.js',
  '/assets/vendor/three-r185/build/three.core.min.js',
  '/assets/vendor/three-r185/examples/jsm/controls/OrbitControls.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_3D') return;
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await Promise.all(LAZY_3D.map(async (url) => {
      if (!await cache.match(url)) await cache.add(url);
    }));
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((response) => response
          || caches.match(url.pathname)
          || caches.match('/offline.html'))),
    );
    return;
  }

  if (['script', 'style', 'worker'].includes(event.request.destination)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })),
  );
});
