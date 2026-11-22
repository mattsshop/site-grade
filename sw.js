// Site Grade service worker – lets the app open with no cell signal.
// Bump CACHE when releasing a new version so phones pick up the update.
const CACHE = 'site-grade-v1.6.0';
const SHELL = [
  './',
  './index.html',
  './cloud.js',
  './projects.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './plans/home2-douglasville-grading.jpg',
  './plans/woodspring-douglasville-grading.jpg',
  './surfaces/home2-fg.json',
  './surfaces/woodspring-fg.json',
  './plans/home-test.jpg',
  './surfaces/home-lidar.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the app + project list (so updates show up when there is signal),
// cache first for plan images (big, rarely change).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // v1.6: keep a copy of the Firebase SDK so the app (and cloud sync's offline queue) start with no signal
  if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  const isPlan = url.pathname.includes('/plans/') || url.pathname.includes('/surfaces/');
  if (isPlan) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  } else {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
    );
  }
});
