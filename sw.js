// Service Worker for Fleck - Complete offline capability
const CACHE_NAME = 'fleck-v9';
const APP_SHELL = './';
const ASSETS_TO_CACHE = [
  APP_SHELL,
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/utils.js',
  './js/history.js',
  './js/storage.js',
  './js/renderer.js',
  './js/tools.js',
  './js/app.js'
];

// Chrome refuses to use a redirected response for a navigation (ERR_FAILED).
// Vercel's cleanUrls redirects /index.html -> /, so strip the redirect flag.
async function cleanResponse(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function isCacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(ASSETS_TO_CACHE.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (isCacheable(response)) await cache.put(url, await cleanResponse(response));
        } catch (_) {
          // One missing asset must not block installation.
        }
      }));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads (/, /index.html, any path): network first so deploys show up,
  // falling back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await cleanResponse(await fetch(request));
        if (isCacheable(response)) cache.put(APP_SHELL, response.clone());
        if (response.ok) return response;
      } catch (_) {
        // offline
      }
      return (await cache.match(APP_SHELL)) || Response.error();
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then(async (response) => {
          if (isCacheable(response)) {
            const clean = await cleanResponse(response);
            cache.put(request, clean.clone());
            return clean;
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      return (await network) || Response.error();
    })
  );
});
