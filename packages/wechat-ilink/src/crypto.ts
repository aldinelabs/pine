// Ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.

import { createCipheriv, createDecipheriv } from "node:crypto";

// Files on the WeChat CDN are AES-128-ECB with PKCS#7 padding and no IV.
// The cipher is the protocol's choice; a fresh random key is used per file.

const KEY_BYTES = 16;
const BLOCK_BYTES = 16;
const HEX_KEY = /^[0-9a-fA-F]{32}$/;

function checkedKey(key: Uint8Array): Uint8Array {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(`An AES-128 key is ${KEY_BYTES} bytes long.`);
  }
  return key;
}

export function encryptAesEcb(plain: Uint8Array, key: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-128-ecb", checkedKey(key), null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/** Throws when the key is wrong or the ciphertext is cut short. */
export function decryptAesEcb(cipher: Uint8Array, key: Uint8Array): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", checkedKey(key), null);
  return Buffer.concat([decipher.update(cipher), decipher.final()]);
}

/** Size of the ciphertext of a plain file of that many bytes. */
export function paddedSize(plainBytes: number): number {
  return Math.ceil((plainBytes + 1) / BLOCK_BYTES) * BLOCK_BYTES;
}

/**
 * Reads the `aes_key` of a media reference. The server sends it either as
 * base64 of the 16 key bytes (seen on images) or as base64 of their 32 hex
 * characters (seen on files, voice and video).
 */
export function parseAesKey(base64: string): Buffer {
  const decoded = Buffer.from(base64, "base64");
  if (decoded.length === KEY_BYTES) return decoded;
  if (decoded.length === KEY_BYTES * 2) {
    const hex = decoded.toString("ascii");
    if (HEX_KEY.test(hex)) return Buffer.from(hex, "hex");
  }
  // The value is a secret, so the message says only what was expected.
  throw new Error("aes_key has to decode to 16 bytes or to 32 hex characters.");
}

/** The `aes_key` of a file the bot sends: base64 of the key's hex characters. */
export function outboundAesKey(key: Uint8Array): string {
  const hex = Buffer.from(checkedKey(key)).toString("hex");
  return Buffer.from(hex, "utf8").toString("base64");
}
