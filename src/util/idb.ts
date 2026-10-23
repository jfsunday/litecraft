// Tiny promise wrapper around a single IndexedDB key/value store.
const DB = 'litecraft';
const STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try { return await tx('readonly', (s) => s.get(key) as IDBRequest<T | undefined>); } catch { return undefined; }
}
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try { await tx('readwrite', (s) => s.put(value, key)); return true; } catch { return false; }
}
export async function idbDel(key: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* storage unavailable */ }
}
