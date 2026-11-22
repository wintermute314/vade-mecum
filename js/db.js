// Lokale opslag in IndexedDB. Store "trips": de reisgegevens zonder bijlagen. Store "files": bijlagen als Blob.
// Als IndexedDB niet beschikbaar is (bv. privévenster), valt de app terug op geheugen voor deze sessie.
const DB_NAME = 'reisapp', DB_VERSION = 1;
let dbp = null;
const mem = { trips: new Map(), files: new Map() };
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
  await deleteTrip(data.trip.id);
  await tx('trips', 'readwrite', s => { s.put(data); });
  await tx('files', 'readwrite', s => { for (const [k, b] of files) s.put(b, data.trip.id + '/' + k); });
}
export async function deleteTrip(id) {
  const db = await open();
  if (!db) { mem.trips.delete(id); for (const k of [...mem.files.keys()]) if (k.startsWith(id + '/')) mem.files.delete(k); return; }
  await tx('trips', 'readwrite', s => { s.delete(id); });
  await tx('files', 'readwrite', s => { s.delete(IDBKeyRange.bound(id + '/', id + '/￿')); });
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
