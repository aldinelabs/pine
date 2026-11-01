import {
  type Bytes,
  concatBytes,
  fromBase64Url,
  toBase64Url,
} from "./encoding";

const KEY = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;
/** An uncompressed P-256 point: 0x04 followed by X and Y. */
export const PUBLIC_KEY_BYTES = 65;

/** A device's long-term key. The public half is what other devices remember. */
export interface Identity {
  publicKey: Bytes;
  privateKey: CryptoKey;
}

export interface StoredIdentity {
  publicKey: string;
  privateKey: string;
}

/**
 * Browsers should keep the private key non-extractable in IndexedDB. The
 * desktop needs to persist it, so it asks for an extractable one and seals
 * the export with the operating system's secret storage.
 */
export async function generateIdentity(extractable = false): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(KEY, extractable, [
    "sign",
    "verify",
  ]);
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return { publicKey, privateKey: pair.privateKey };
}

export async function exportIdentity(
  identity: Identity,
): Promise<StoredIdentity> {
  return {
    publicKey: toBase64Url(identity.publicKey),
    privateKey: toBase64Url(
      new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", identity.privateKey),
      ),
    ),
  };
}

export async function importIdentity(
  stored: StoredIdentity,
  extractable = false,
): Promise<Identity> {
  const publicKey = fromBase64Url(stored.publicKey);
  await importPublicKey(publicKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(stored.privateKey),
    KEY,
    extractable,
    ["sign"],
  );
  return { publicKey, privateKey };
}

async function importPublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 4)
    throw new Error("Invalid public key.");
  return crypto.subtle.importKey("raw", publicKey as Bytes, KEY, false, [
    "verify",
  ]);
}

export async function sign(identity: Identity, data: Bytes): Promise<Bytes> {
  return new Uint8Array(
    await crypto.subtle.sign(SIGNATURE, identity.privateKey, data),
  );
}

/** False for a bad signature and for a key that is not a valid P-256 point. */
export async function verify(
  publicKey: Uint8Array,
  data: Bytes,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      SIGNATURE,
      await importPublicKey(publicKey),
      signature as Bytes,
      data,
    );
  } catch {
    return false;
  }
}

/**
 * Short text for people to compare on both screens when pairing, such as
 * "a1b2 c3d4 e5f6 0718 293a". Eighty bits is enough because it only guards
 * against someone swapping the key during that one pairing.
 */
export async function fingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", concatBytes(publicKey)),
  );
  const hex = Array.from(digest.subarray(0, 10), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hex.match(/.{4}/g)!.join(" ");
}
