const CACHE_NAME = 'cekpinjol-static-v3';
const STATIC_ASSETS = ['./', './index.html', './script.js', './style.css'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data dinamis, sesi, dan halaman admin tidak boleh masuk Cache Storage.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Aset lokal tampil dari cache terlebih dahulu, lalu diperbarui di belakang layar.
  event.respondWith(
    caches.match(request).then(cached => {
      const networkUpdate = fetch(request)
        .then(response => {
          if (response.ok && response.type === 'basic') {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkUpdate);
        return cached;
      }

      return networkUpdate.then(response => response || caches.match('./index.html'));
    })
  );
});
