/* Cache application assets only. Identity, API replies and music stay private. */
const VERSION = 'tingjian-flutter-c8670dbc273d';
const ROOT = new URL('./', self.location.href);
const shell = ['index.html', 'manifest.json', 'audio_bridge.js', 'flutter_bootstrap.js', 'favicon.png', 'icons/Icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(shell.map(path => new URL(path, ROOT).href))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tingjian-flutter-') && key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const path = url.pathname.slice(ROOT.pathname.length);
  if (url.search || path.startsWith('api/') || path.startsWith('legacy/')) return;
  const navigates = request.mode === 'navigate';
  const asset = /\.(?:js|wasm|json|png|woff2?|otf|ttf)$/.test(path) || path === 'index.html';
  if (!navigates && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await fetch(request, {cache: 'no-cache'});
      if (response.ok && response.type !== 'opaque') {
        await cache.put(navigates ? new URL('index.html', ROOT).href : request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(navigates ? new URL('index.html', ROOT).href : request);
      if (cached) return cached;
      throw error;
    }
  })());
});
