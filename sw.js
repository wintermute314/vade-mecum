// Service worker: app-schil offline beschikbaar. Reisgegevens staan in IndexedDB, niet in deze cache.
const CACHE = 'vademecum-v0.2.2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/graph.js', 'js/text.js', 'js/validate.js', 'js/migrate.js',
  'vendor/qrcode.js', 'schema/schema.json', 'voorbeeld/voorbeeldreis.reis.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
self.addEventListener('install', (e) => { // cache: 'reload' omzeilt de HTTP-cache van de browser, zodat een nieuwe versie echt nieuwe bestanden binnenhaalt.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eerst de cache (snel en offline), op de achtergrond bijwerken.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache' }) : new Request(e.request, { cache: 'no-cache' });
    const net = fetch(fresh).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || c.match('index.html');
  }));
});
