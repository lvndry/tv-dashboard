// IndexedDB for caches too large for localStorage's ~5 MB budget, such as the art collection.

const databaseName = 'bonsoir-cache';
const storeName = 'entries';

let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(storeName);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('Could not open the cache database'));
  });
  return databasePromise;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('Cache request failed'));
  });
}

export async function readBig<T>(key: string): Promise<T | null> {
  const db = await database();
  return (await request<T | undefined>(db.transaction(storeName, 'readonly').objectStore(storeName).get(key))) ?? null;
}

export async function writeBig<T>(key: string, value: T): Promise<void> {
  const db = await database();
  await request(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key));
}
