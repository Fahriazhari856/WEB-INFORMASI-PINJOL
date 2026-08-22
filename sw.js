const CACHE_NAME = 'cekpinjol-static-v2';
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

  // Network-first mencegah aset lama terus digunakan setelah aplikasi diperbarui.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
  );
});
