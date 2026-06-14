// Self-destructing and bypass Service Worker to clear aggressive browser cache in preview environment
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          console.log('Destroying cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      // Refresh all running clients so they load the new code instantly
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          try {
            client.navigate(client.url);
          } catch (e) {
            console.error('Client navigation failed:', e);
          }
        });
      });
    })
  );
});

// Pure network pass-through to ensure absolutely no caching issues
self.addEventListener('fetch', (event) => {
  // Always fetch directly from network
  event.respondWith(fetch(event.request));
});

