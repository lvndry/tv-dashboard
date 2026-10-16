// Secrets are sealed with an AES-GCM key generated on this TV as non-extractable:
// page code can ask the browser to encrypt and decrypt with it, but can never read
// the key itself. Key and ciphertext live in IndexedDB; nothing secret touches
// localStorage, the build, or the network except the provider it belongs to.

const databaseName = 'bonsoir-vault';
const keyStore = 'keys';
const secretStore = 'secrets';
const masterKeyId = 'master';

interface Sealed { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB request failed'));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(keyStore);
      opening.result.createObjectStore(secretStore);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('Could not open the vault'));
  });
  return databasePromise;
}

async function transaction<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return request(run(db.transaction(storeName, mode).objectStore(storeName)));
}

export function vaultSupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

async function masterKey(): Promise<CryptoKey> {
  if (!vaultSupported()) throw new Error('This TV has no WebCrypto, so secrets cannot be stored safely');
  const existing = await transaction<CryptoKey | undefined>(keyStore, 'readonly', store => store.get(masterKeyId));
  if (existing) return existing;
  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await transaction(keyStore, 'readwrite', store => store.put(created, masterKeyId));
  return created;
}

export async function sealSecret(name: string, value: string): Promise<void> {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) }, key, new TextEncoder().encode(value));
  await transaction(secretStore, 'readwrite', store => store.put({ iv, data } satisfies Sealed, name));
}

export async function openSecret(name: string): Promise<string | null> {
  if (!vaultSupported()) return null;
  const sealed = await transaction<Sealed | undefined>(secretStore, 'readonly', store => store.get(name));
  if (!sealed) return null;
  const key = await masterKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: new TextEncoder().encode(name) }, key, sealed.data);
  return new TextDecoder().decode(plain);
}

/** Drops every secret and the master key, so anything sealed before is unrecoverable. */
export async function wipeVault(): Promise<void> {
  if (!vaultSupported()) return;
  await transaction(secretStore, 'readwrite', store => store.clear());
  await transaction(keyStore, 'readwrite', store => store.clear());
}
