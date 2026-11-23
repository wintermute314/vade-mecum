// Lokale opslag in IndexedDB. Store "trips": de reisgegevens zonder bijlagen. Store "files": bijlagen als Blob.
// Store "notes": eigen notities per fiche, los van het reisbestand, zodat ze een nieuwe import overleven.
// Als IndexedDB niet beschikbaar is (bv. privévenster), valt de app terug op geheugen voor deze sessie.
const DB_NAME = 'reisapp', DB_VERSION = 2;
let dbp = null;
const mem = { trips: new Map(), files: new Map(), notes: new Map() };
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
// Reis volledig van het toestel verwijderen, ook de notities.
export async function deleteTrip(id) {
  await removeTripData(id);
  const db = await open();
  if (!db) { for (const k of [...mem.notes.keys()]) if (k.startsWith(id + '/')) mem.notes.delete(k); return; }
  await tx('notes', 'readwrite', s => { s.delete(prefixRange(id)); });
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
