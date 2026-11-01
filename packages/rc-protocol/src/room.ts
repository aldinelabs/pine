import { type Bytes, toBase64Url, utf8 } from "./encoding";

/**
 * The signaling service puts two devices that name the same room in touch.
 * Rooms come from a secret, so the service cannot tell which device is behind
 * one, and nobody who only knows the public keys can guess it. "pairing" is
 * the one-time room of a QR code; "device" is the room of a paired phone,
 * whose secret the desktop hands over once pairing succeeds.
 */
export async function deriveRoomId(
  secret: Uint8Array,
  purpose: "pairing" | "device",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as Bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, utf8(`pine-rc/1/room/${purpose}`)),
    ),
  );
}
