const CACHE_NAME = 'lumi-v18';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './player.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cacheando assets estáticos');
      return cache.addAll(STATIC_ASSETS);
    }).catch((err) => {
      console.warn('[SW] Error al cachear:', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No interceptar: API, manifest, screenshots, iconos
  if (
    url.pathname.includes('/api/') ||
    url.pathname.endsWith('manifest.json') ||
    url.pathname.includes('screenshot-') ||
    url.pathname.includes('icon-') ||
    url.pathname.includes('apple-touch-icon')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const url2 = new URL(event.request.url);
        const pathname = url2.pathname;
        const isStatic = STATIC_ASSETS.some(a => pathname.endsWith(a.replace('./', '')));
        if (response.ok && isStatic) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});