// Lokale opslag in IndexedDB. Store "trips": de reisgegevens zonder bijlagen. Store "files": bijlagen als Blob.
// Store "notes": eigen notities per fiche, los van het reisbestand, zodat ze een nieuwe import overleven.
// Store "photos": foto's van het web (Blob), sleutel = url, gedeeld door alle reizen; overleven een nieuwe import.
// Store "myphotos": eigen foto's per fiche (sleutel reis-id/fiche-id), zoals notities los van het reisbestand.
// Als IndexedDB niet beschikbaar is (bv. privévenster), valt de app terug op geheugen voor deze sessie.
const DB_NAME = 'reisapp', DB_VERSION = 3;
let dbp = null;
const mem = { trips: new Map(), files: new Map(), notes: new Map(), photos: new Map(), myphotos: new Map() };
let useMem = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { useMem = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'trip.id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      if (!db.objectStoreNames.contains('myphotos')) db.createObjectStore('myphotos', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMem = true; resolve(null); };
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => {
    if (!db || useMem) return fn(null);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listTrips() {
  const db = await open();
  if (!db) return [...mem.trips.values()].map(d => d.trip);
  const all = await tx('trips', 'readonly', s => req2p(s.getAll()));
  return all.map(d => d.trip).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}
export async function getTrip(id) {
  const db = await open();
  if (!db) return mem.trips.get(id) || null;
  return (await tx('trips', 'readonly', s => req2p(s.get(id)))) || null;
}
export async function saveTrip(data, files) {
  const db = await open();
  if (!db) { mem.trips.set(data.trip.id, data); for (const [k, b] of files) mem.files.set(data.trip.id + '/' + k, b); return; }
  await removeTripData(data.trip.id);   // notities blijven staan
  await tx('trips', 'readwrite', s => { s.put(data); });
  await tx('files', 'readwrite', s => { for (const [k, b] of files) s.put(b, data.trip.id + '/' + k); });
}
// Alleen de reisgegevens vervangen (bijlagen blijven), bv. na een migratie.
export async function updateTrip(data) {
  const db = await open();
  if (!db) { mem.trips.set(data.trip.id, data); return; }
  await tx('trips', 'readwrite', s => { s.put(data); });
}
async function removeTripData(id) {
  const db = await open();
  if (!db) { mem.trips.delete(id); for (const k of [...mem.files.keys()]) if (k.startsWith(id + '/')) mem.files.delete(k); return; }
  await tx('trips', 'readwrite', s => { s.delete(id); });
  await tx('files', 'readwrite', s => { s.delete(prefixRange(id)); });
}
const prefixRange = (id) => IDBKeyRange.bound(id + '/', id + '/\uffff');
// Reis volledig van het toestel verwijderen, ook de notities en eigen foto's.
export async function deleteTrip(id) {
  await removeTripData(id);
  const db = await open();
  if (!db) { for (const m of [mem.notes, mem.myphotos]) for (const k of [...m.keys()]) if (k.startsWith(id + '/')) m.delete(k); return; }
  await tx('notes', 'readwrite', s => { s.delete(prefixRange(id)); });
  await tx('myphotos', 'readwrite', s => { s.delete(prefixRange(id)); });
}

// ---- foto's van het web (sleutel = url) ----
export async function getPhoto(url) {
  const db = await open();
  if (!db) return mem.photos.get(url) || null;
  return (await tx('photos', 'readonly', s => req2p(s.get(url)))) || null;
}
export async function putPhoto(url, blob) {
  const db = await open();
  if (!db) { mem.photos.set(url, blob); return; }
  await tx('photos', 'readwrite', s => { s.put(blob, url); });
}
export async function photoKeys() {
  const db = await open();
  if (!db) return [...mem.photos.keys()];
  return await tx('photos', 'readonly', s => req2p(s.getAllKeys()));
}
export async function deletePhotos(urls) {
  const db = await open();
  if (!db) { for (const u of urls) mem.photos.delete(u); return; }
  await tx('photos', 'readwrite', s => { for (const u of urls) s.delete(u); });
}

// ---- eigen foto's: { key: tripId/entityId, tripId, entityId, blob, updated } ----
export async function getMyPhotos(tripId) {
  const db = await open();
  if (!db) return [...mem.myphotos.values()].filter(p => p.key.startsWith(tripId + '/'));
  return await tx('myphotos', 'readonly', s => req2p(s.getAll(prefixRange(tripId))));
}
export async function putMyPhoto(rec) {
  const db = await open();
  if (!db) { mem.myphotos.set(rec.key, rec); return; }
  await tx('myphotos', 'readwrite', s => { s.put(rec); });
}
export async function deleteMyPhoto(key) {
  const db = await open();
  if (!db) { mem.myphotos.delete(key); return; }
  await tx('myphotos', 'readwrite', s => { s.delete(key); });
}

// ---- notities (los van het reisbestand) ----
export async function getNotes(tripId) {
  const db = await open();
  if (!db) return [...mem.notes.values()].filter(n => n.key.startsWith(tripId + '/'));
  return await tx('notes', 'readonly', s => req2p(s.getAll(prefixRange(tripId))));
}
// note = { key: tripId/entityId, tripId, entityId, name, text, updated }. Lege tekst wist de notitie.
export async function putNote(note) {
  const db = await open();
  if (!db) { note.text ? mem.notes.set(note.key, note) : mem.notes.delete(note.key); return; }
  await tx('notes', 'readwrite', s => { note.text ? s.put(note) : s.delete(note.key); });
}
export async function getFile(tripId, attId) {
  const db = await open();
  if (!db) return mem.files.get(tripId + '/' + attId) || null;
  return (await tx('files', 'readonly', s => req2p(s.get(tripId + '/' + attId)))) || null;
}
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
export const isMemoryOnly = () => useMem;
