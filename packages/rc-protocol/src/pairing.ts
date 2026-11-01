import { fromBase64Url, randomBytes, toBase64Url, utf8 } from "./encoding";
import { PUBLIC_KEY_BYTES } from "./identity";

export const PAIRING_VERSION = 1;
export const PAIRING_TTL_MS = 5 * 60_000;
const SECRET_BYTES = 32;

/** What the desktop shows as a QR code and a phone scans. */
export interface PairingOffer {
  /** The desktop's public key, base64url. The phone trusts it from here on. */
  hostKey: string;
  /** One-time secret proving the phone saw the QR code, base64url. */
  secret: string;
  /** Origin of the signaling service both sides connect to. */
  signaling: string;
  expiresAt: number;
}

export function createPairing(
  hostPublicKey: Uint8Array,
  signaling: string,
  now: number,
  ttl = PAIRING_TTL_MS,
): PairingOffer {
  return {
    hostKey: toBase64Url(hostPublicKey),
    secret: toBase64Url(randomBytes(SECRET_BYTES)),
    signaling: normalizeSignaling(signaling),
    expiresAt: now + ttl,
  };
}

/** Signaling is https, except a local one for development. */
export function normalizeSignaling(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error("Signaling must use https.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Invalid signaling origin.");
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("Invalid signaling origin.");
  return url.origin;
}

export function encodePairing(pairing: PairingOffer): string {
  return toBase64Url(
    utf8(
      JSON.stringify([
        PAIRING_VERSION,
        pairing.hostKey,
        pairing.secret,
        pairing.signaling,
        pairing.expiresAt,
      ]),
    ),
  );
}

export function decodePairing(text: string, now: number): PairingOffer {
  let fields: unknown;
  try {
    fields = JSON.parse(new TextDecoder().decode(fromBase64Url(text)));
  } catch {
    throw new Error("This is not a Pine pairing code.");
  }
  if (
    !Array.isArray(fields) ||
    fields.length !== 5 ||
    fields[0] !== PAIRING_VERSION ||
    typeof fields[1] !== "string" ||
    typeof fields[2] !== "string" ||
    typeof fields[3] !== "string" ||
    typeof fields[4] !== "number"
  )
    throw new Error("This is not a Pine pairing code.");
  const [, hostKey, secret, signaling, expiresAt] = fields as [
    number,
    string,
    string,
    string,
    number,
  ];
  try {
    if (fromBase64Url(hostKey).length !== PUBLIC_KEY_BYTES)
      throw new Error("key");
    if (fromBase64Url(secret).length !== SECRET_BYTES)
      throw new Error("secret");
    normalizeSignaling(signaling);
  } catch {
    throw new Error("This is not a Pine pairing code.");
  }
  if (now > expiresAt) throw new Error("This pairing code has expired.");
  return {
    hostKey,
    secret,
    signaling: normalizeSignaling(signaling),
    expiresAt,
  };
}

/** The link the QR code holds. The code sits after "#", so servers never see it. */
export function pairingUrl(pageOrigin: string, pairing: PairingOffer): string {
  return `${new URL(pageOrigin).origin}/#pair=${encodePairing(pairing)}`;
}

export function readPairingUrl(url: string, now: number): PairingOffer {
  const hash = new URL(url).hash;
  const match = /^#pair=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new Error("This is not a Pine pairing code.");
  return decodePairing(match[1]!, now);
}
