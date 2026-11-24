// Service worker: app-schil offline beschikbaar. Reisgegevens staan in IndexedDB, niet in deze cache.
const CACHE = 'vademecum-v0.4.1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/graph.js', 'js/text.js', 'js/validate.js', 'js/migrate.js',
  'vendor/qrcode.js', 'schema/schema.json', 'voorbeeld/voorbeeldreis.reis.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
self.addEventListener('install', (e) => { // cache: 'reload' omzeilt de HTTP-cache van de browser, zodat een nieuwe versie echt nieuwe bestanden binnenhaalt.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'vademecum-share').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eerst de cache (snel en offline), op de achtergrond bijwerken.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // "Delen › Vade Mecum" vanuit Drive, WhatsApp, Bestanden…: het bestand even bewaren en de app openen, die het dan importeert.
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/gedeeld')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const f = form.getAll('reis').find(x => x && typeof x === 'object');
        const c = await caches.open('vademecum-share');
        await c.delete('gedeeld-bestand');
        if (f) await c.put('gedeeld-bestand', new Response(f, { headers: { 'content-type': f.type || 'application/json', 'x-name': encodeURIComponent(f.name || 'gedeeld.reis.json') } }));
      } catch (err) {}
      return Response.redirect(new URL('./?gedeeld=1#/start', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache' }) : new Request(e.request, { cache: 'no-cache' });
    const net = fetch(fresh).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || c.match('index.html');
  }));
});
