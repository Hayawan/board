// Story 13.3 — minimal, additive service worker for the Board PWA.
//
// Its ONLY jobs: (1) make the app installable (a registered SW is an install
// criterion), and (2) serve the app shell offline. It is deliberately conservative:
// it NEVER calls respondWith() for the API, the SSE stream, screenshots, or the share
// target, so it cannot buffer text/event-stream (which would break the Story 5.3
// live-fill, sse.ts) or interpose on any mutation/capture path. Everything it does
// not explicitly shell-cache is left to the network, untouched.

const CACHE = 'board-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Pass through (do NOT intercept): non-GET, the API, the SSE stream, screenshot
  // assets, and the share-target POST. These must reach the network untouched — a
  // cached/buffered text/event-stream would break the live status fill.
  if (
    req.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/events') ||
    url.pathname.startsWith('/screenshots/') ||
    url.pathname.startsWith('/share')
  ) {
    return; // no respondWith → default network handling
  }

  // App-shell navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Other same-origin GETs (static assets): cache-first, fall back to the network.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
