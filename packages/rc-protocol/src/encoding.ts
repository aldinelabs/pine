/** Web Crypto only accepts views over a plain ArrayBuffer. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function utf8(text: string): Bytes {
  return encoder.encode(text);
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Compares in time that does not depend on where the bytes differ. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(value: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    throw new Error("Invalid base64url.");
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Length-prefixes every part, so no two different field lists produce the
 * same bytes. Everything that is signed or authenticated goes through this.
 */
export function framedFields(label: string, fields: string[]): Bytes {
  const parts: Uint8Array[] = [];
  for (const field of [label, ...fields]) {
    const bytes = utf8(field);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length);
    parts.push(length, bytes);
  }
  return concatBytes(...parts);
}
