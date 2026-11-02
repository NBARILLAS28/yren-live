// Persistencia local (IndexedDB): canciones, archivos de audio, setlists y ajustes.

const DB_NAME = 'yren-live';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        const r = fn(s);
        if (r && 'onsuccess' in r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const store = {
  get: (s, key) => tx(s, 'readonly', (o) => o.get(key)),
  getAll: (s) => tx(s, 'readonly', (o) => o.getAll()),
  put: (s, value, key) => tx(s, 'readwrite', (o) => (key === undefined ? o.put(value) : o.put(value, key))),
  del: (s, key) => tx(s, 'readwrite', (o) => o.delete(key)),
  async delFilesOfSong(songId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', 'readwrite');
      const o = t.objectStore('files');
      const range = IDBKeyRange.bound(songId + ':', songId + ':￿');
      o.delete(range);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  /** [[clave, registro], …] de un almacén sin claves internas (por ejemplo, "files"). */
  async getAllEntries(s) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = [];
      const t = db.transaction(s, 'readonly');
      const req = t.objectStore(s).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  },
  fileKey: (songId, trackId) => `${songId}:${trackId}`,
  getSetting: (key) => tx('kv', 'readonly', (o) => o.get(key)),
  setSetting: (key, value) => tx('kv', 'readwrite', (o) => o.put(value, key)),
};

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* noop */ }
  return false;
}
