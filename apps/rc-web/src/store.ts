import { generateIdentity, type Identity } from "@pine/rc-protocol";

/** A computer this phone has paired with. */
export interface StoredHost {
  /** The computer's public key, base64url. */
  id: string;
  name: string;
  signaling: string;
  /** Names this pair's own signaling room, base64url. */
  roomSecret: string;
  pairedAt: number;
  lastConnectedAt?: number;
}

const DB_NAME = "pine-rc";
const IDENTITY = "identity";
const HOSTS = "hosts";

let database: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDENTITY);
      request.result.createObjectStore(HOSTS, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
  return database;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = (await db()).transaction(store, mode);
  const request = action(transaction.objectStore(store));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB"));
  });
}

/**
 * This phone's key. The private half is non-extractable and stays in this
 * browser's storage, so even the pages served here cannot copy it.
 */
export async function phoneIdentity(): Promise<Identity> {
  const stored = await run<Identity | undefined>(IDENTITY, "readonly", (s) =>
    s.get("phone"),
  );
  if (stored) return stored;
  const identity = await generateIdentity(false);
  await run(IDENTITY, "readwrite", (s) => s.put(identity, "phone"));
  return identity;
}

export async function listHosts(): Promise<StoredHost[]> {
  const hosts = await run<StoredHost[]>(HOSTS, "readonly", (s) => s.getAll());
  return hosts.sort(
    (a, b) =>
      (b.lastConnectedAt ?? b.pairedAt) - (a.lastConnectedAt ?? a.pairedAt),
  );
}

export async function saveHost(host: StoredHost): Promise<void> {
  await run(HOSTS, "readwrite", (s) => s.put(host));
}

export async function forgetHost(id: string): Promise<void> {
  await run(HOSTS, "readwrite", (s) => s.delete(id));
}

/** Asks the browser not to clear this storage when space runs low. */
export async function keepStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not every browser lets a page ask.
  }
}
