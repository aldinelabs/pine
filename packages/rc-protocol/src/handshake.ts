import {
  type Bytes,
  bytesEqual,
  framedFields,
  fromBase64Url,
  randomBytes,
  toBase64Url,
} from "./encoding";
import { type Identity, PUBLIC_KEY_BYTES, sign, verify } from "./identity";

/**
 * WebRTC already encrypts the connection with DTLS, and the SDP carries the
 * fingerprint of each side's DTLS certificate. What WebRTC cannot say is who
 * the other side is, because the signaling service relays the SDP. So each
 * side signs its whole SDP with its long-term key: the signature covers the
 * certificate fingerprint, and a signaling service that swaps the SDP cannot
 * make the DTLS connection end at itself. ICE candidates travel unsigned;
 * the DTLS handshake still has to match the signed fingerprint.
 */
export const HANDSHAKE_VERSION = 1;
export const MAX_HANDSHAKE_SKEW_MS = 2 * 60_000;
const MAX_SDP_LENGTH = 64 * 1024;
const SESSION_BYTES = 16;

export interface OfferEnvelope {
  v: typeof HANDSHAKE_VERSION;
  /** Random per connection attempt, base64url. */
  session: string;
  timestamp: number;
  /** The desktop the phone means to reach, so an offer cannot be redirected. */
  hostKey: string;
  clientKey: string;
  sdp: string;
  /** Present on a first pairing: HMAC of the offer under the QR secret. */
  proof?: string;
  sig: string;
}

export interface AnswerEnvelope {
  v: typeof HANDSHAKE_VERSION;
  session: string;
  timestamp: number;
  hostKey: string;
  /** Digest of the offer this answers, so it cannot answer another one. */
  offer: string;
  sdp: string;
  sig: string;
}

type OfferFields = Omit<OfferEnvelope, "sig" | "proof">;
type AnswerFields = Omit<AnswerEnvelope, "sig">;

function offerBytes(offer: OfferFields): Bytes {
  return framedFields("pine-rc/1/offer", [
    String(offer.v),
    offer.session,
    String(offer.timestamp),
    offer.hostKey,
    offer.clientKey,
    offer.sdp,
  ]);
}

function answerBytes(answer: AnswerFields): Bytes {
  return framedFields("pine-rc/1/answer", [
    String(answer.v),
    answer.session,
    String(answer.timestamp),
    answer.hostKey,
    answer.offer,
    answer.sdp,
  ]);
}

async function digest(data: Bytes): Promise<string> {
  return toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  );
}

async function hmacKey(secret: Uint8Array, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    secret as Bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function createOffer(options: {
  identity: Identity;
  hostKey: Uint8Array;
  sdp: string;
  now: number;
  /** Only on the first connection, from the scanned QR code. */
  pairingSecret?: Uint8Array;
}): Promise<OfferEnvelope> {
  const fields: OfferFields = {
    v: HANDSHAKE_VERSION,
    session: toBase64Url(randomBytes(SESSION_BYTES)),
    timestamp: options.now,
    hostKey: toBase64Url(options.hostKey),
    clientKey: toBase64Url(options.identity.publicKey),
    sdp: options.sdp,
  };
  const body = offerBytes(fields);
  const offer: OfferEnvelope = {
    ...fields,
    sig: toBase64Url(await sign(options.identity, body)),
  };
  if (options.pairingSecret)
    offer.proof = toBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await hmacKey(options.pairingSecret, "sign"),
          body,
        ),
      ),
    );
  return offer;
}

export type OfferResult =
  | {
      ok: true;
      /** A device the desktop already trusts. */
      kind: "known";
      clientKey: Uint8Array;
    }
  | {
      ok: true;
      /**
       * A new device that proved it saw the QR code. The desktop still asks
       * its user, then spends the one-time secret and remembers the key.
       */
      kind: "pairing";
      clientKey: Uint8Array;
    }
  | {
      ok: false;
      reason:
        | "malformed"
        | "stale"
        | "wrong-host"
        | "bad-signature"
        | "unknown-device"
        | "bad-proof";
    };

function isEnvelope(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === HANDSHAKE_VERSION &&
    typeof record.timestamp === "number" &&
    Number.isFinite(record.timestamp) &&
    typeof record.sdp === "string" &&
    record.sdp.length <= MAX_SDP_LENGTH &&
    keys.every((key) => typeof record[key] === "string")
  );
}

function decodeKey(value: string): Uint8Array | undefined {
  try {
    const key = fromBase64Url(value);
    return key.length === PUBLIC_KEY_BYTES ? key : undefined;
  } catch {
    return undefined;
  }
}

function fresh(timestamp: number, now: number): boolean {
  return Math.abs(now - timestamp) <= MAX_HANDSHAKE_SKEW_MS;
}

export async function verifyOffer(
  value: unknown,
  options: {
    hostKey: Uint8Array;
    now: number;
    isKnownClient(clientKey: Uint8Array): boolean;
    /** The unspent secret of the QR code currently on screen, if any. */
    pairingSecret?: Uint8Array;
  },
): Promise<OfferResult> {
  if (!isEnvelope(value, ["session", "hostKey", "clientKey", "sig"]))
    return { ok: false, reason: "malformed" };
  const offer = value as OfferEnvelope;
  const clientKey = decodeKey(offer.clientKey);
  const hostKey = decodeKey(offer.hostKey);
  let signature: Bytes;
  try {
    if (fromBase64Url(offer.session).length !== SESSION_BYTES)
      return { ok: false, reason: "malformed" };
    signature = fromBase64Url(offer.sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!clientKey || !hostKey) return { ok: false, reason: "malformed" };
  if (!fresh(offer.timestamp, options.now))
    return { ok: false, reason: "stale" };
  if (!bytesEqual(hostKey, options.hostKey))
    return { ok: false, reason: "wrong-host" };
  const body = offerBytes(offer);
  if (!(await verify(clientKey, body, signature)))
    return { ok: false, reason: "bad-signature" };
  if (options.isKnownClient(clientKey))
    return { ok: true, kind: "known", clientKey };
  if (!options.pairingSecret || typeof offer.proof !== "string")
    return { ok: false, reason: "unknown-device" };
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(options.pairingSecret, "verify"),
      fromBase64Url(offer.proof),
      body,
    );
    return valid
      ? { ok: true, kind: "pairing", clientKey }
      : { ok: false, reason: "bad-proof" };
  } catch {
    return { ok: false, reason: "bad-proof" };
  }
}

export async function createAnswer(options: {
  identity: Identity;
  offer: OfferEnvelope;
  sdp: string;
  now: number;
}): Promise<AnswerEnvelope> {
  const fields: AnswerFields = {
    v: HANDSHAKE_VERSION,
    session: options.offer.session,
    timestamp: options.now,
    hostKey: toBase64Url(options.identity.publicKey),
    offer: await digest(offerBytes(options.offer)),
    sdp: options.sdp,
  };
  return {
    ...fields,
    sig: toBase64Url(await sign(options.identity, answerBytes(fields))),
  };
}

export type AnswerResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        "malformed" | "stale" | "wrong-host" | "wrong-offer" | "bad-signature";
    };

/** The phone checks the answer against the offer it sent and the key it trusts. */
export async function verifyAnswer(
  value: unknown,
  options: { offer: OfferEnvelope; now: number },
): Promise<AnswerResult> {
  if (!isEnvelope(value, ["session", "hostKey", "offer", "sig"]))
    return { ok: false, reason: "malformed" };
  const answer = value as AnswerEnvelope;
  const hostKey = decodeKey(answer.hostKey);
  let signature: Bytes;
  try {
    signature = fromBase64Url(answer.sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!hostKey) return { ok: false, reason: "malformed" };
  if (!fresh(answer.timestamp, options.now))
    return { ok: false, reason: "stale" };
  const expectedHost = decodeKey(options.offer.hostKey);
  if (!expectedHost || !bytesEqual(hostKey, expectedHost))
    return { ok: false, reason: "wrong-host" };
  if (
    answer.session !== options.offer.session ||
    answer.offer !== (await digest(offerBytes(options.offer)))
  )
    return { ok: false, reason: "wrong-offer" };
  return (await verify(hostKey, answerBytes(answer), signature))
    ? { ok: true }
    : { ok: false, reason: "bad-signature" };
}

/** Remembers recent sessions, so a captured offer cannot be played again. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  /** True the first time a session shows up inside the freshness window. */
  accept(session: string, now: number): boolean {
    for (const [id, expires] of this.seen)
      if (expires < now) this.seen.delete(id);
    if (this.seen.has(session)) return false;
    this.seen.set(session, now + 2 * MAX_HANDSHAKE_SKEW_MS);
    return true;
  }
}
