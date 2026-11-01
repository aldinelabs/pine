import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "../encoding";
import {
  MAX_HANDSHAKE_SKEW_MS,
  ReplayGuard,
  createAnswer,
  createOffer,
  verifyAnswer,
  verifyOffer,
} from "../handshake";
import { type Identity, generateIdentity } from "../identity";

const NOW = 5_000_000;
const SDP = "v=0\r\na=fingerprint:sha-256 AA:BB\r\n";

let host: Identity;
let phone: Identity;
let secret: Uint8Array;

beforeEach(async () => {
  host = await generateIdentity();
  phone = await generateIdentity();
  secret = randomBytes(32);
});

const nobody = () => false;

describe("pairing a new phone", () => {
  it("accepts an offer that proves the QR secret and signs the answer", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
      pairingSecret: secret,
    });
    const result = await verifyOffer(offer, {
      hostKey: host.publicKey,
      now: NOW,
      isKnownClient: nobody,
      pairingSecret: secret,
    });
    expect(result).toMatchObject({ ok: true, kind: "pairing" });
    const answer = await createAnswer({
      identity: host,
      offer,
      sdp: "answer-sdp",
      now: NOW,
    });
    expect(await verifyAnswer(answer, { offer, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("refuses a new phone that does not know the QR secret", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
      pairingSecret: randomBytes(32),
    });
    expect(
      await verifyOffer(offer, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: nobody,
        pairingSecret: secret,
      }),
    ).toEqual({ ok: false, reason: "bad-proof" });
  });

  it("refuses an unknown phone without a proof, or with no QR code on screen", async () => {
    const bare = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    expect(
      await verifyOffer(bare, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: nobody,
        pairingSecret: secret,
      }),
    ).toEqual({ ok: false, reason: "unknown-device" });
    const proven = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
      pairingSecret: secret,
    });
    expect(
      await verifyOffer(proven, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: nobody,
      }),
    ).toEqual({ ok: false, reason: "unknown-device" });
  });
});

describe("reconnecting a paired phone", () => {
  it("accepts a known device with no QR secret", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const result = await verifyOffer(offer, {
      hostKey: host.publicKey,
      now: NOW,
      isKnownClient: (key) =>
        Buffer.from(key).equals(Buffer.from(phone.publicKey)),
    });
    expect(result).toMatchObject({ ok: true, kind: "known" });
  });

  it("refuses a device that was removed", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    expect(
      await verifyOffer(offer, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: nobody,
      }),
    ).toEqual({ ok: false, reason: "unknown-device" });
  });
});

describe("a hostile signaling service", () => {
  const known = (identity: Identity) => (key: Uint8Array) =>
    Buffer.from(key).equals(Buffer.from(identity.publicKey));

  it("cannot change the offer's SDP", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const tampered = { ...offer, sdp: SDP.replace("AA:BB", "EV:IL") };
    expect(
      await verifyOffer(tampered, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: known(phone),
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("cannot swap in its own key for the phone's", async () => {
    const attacker = await generateIdentity();
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const forged = await createOffer({
      identity: attacker,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const mixed = { ...forged, clientKey: offer.clientKey };
    expect(
      await verifyOffer(mixed, {
        hostKey: host.publicKey,
        now: NOW,
        isKnownClient: known(phone),
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("cannot forward an offer to a different desktop", async () => {
    const other = await generateIdentity();
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    expect(
      await verifyOffer(offer, {
        hostKey: other.publicKey,
        now: NOW,
        isKnownClient: known(phone),
      }),
    ).toEqual({ ok: false, reason: "wrong-host" });
  });

  it("cannot answer in the desktop's place", async () => {
    const attacker = await generateIdentity();
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const answer = await createAnswer({
      identity: attacker,
      offer,
      sdp: "evil",
      now: NOW,
    });
    expect(await verifyAnswer(answer, { offer, now: NOW })).toEqual({
      ok: false,
      reason: "wrong-host",
    });
  });

  it("cannot change the answer's SDP or reuse an answer for another offer", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const answer = await createAnswer({
      identity: host,
      offer,
      sdp: "good",
      now: NOW,
    });
    expect(
      await verifyAnswer({ ...answer, sdp: "evil" }, { offer, now: NOW }),
    ).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    const next = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    expect(await verifyAnswer(answer, { offer: next, now: NOW })).toEqual({
      ok: false,
      reason: "wrong-offer",
    });
  });

  it("cannot play a captured offer again", () => {
    const guard = new ReplayGuard();
    expect(guard.accept("session-a", NOW)).toBe(true);
    expect(guard.accept("session-a", NOW + 1)).toBe(false);
    expect(guard.accept("session-b", NOW + 1)).toBe(true);
    expect(guard.accept("session-a", NOW + 5 * MAX_HANDSHAKE_SKEW_MS)).toBe(
      true,
    );
  });

  it("is told apart by age: stale offers and answers fail", async () => {
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    const later = NOW + MAX_HANDSHAKE_SKEW_MS + 1;
    expect(
      await verifyOffer(offer, {
        hostKey: host.publicKey,
        now: later,
        isKnownClient: known(phone),
      }),
    ).toEqual({ ok: false, reason: "stale" });
    const answer = await createAnswer({
      identity: host,
      offer,
      sdp: "x",
      now: NOW,
    });
    expect(await verifyAnswer(answer, { offer, now: later })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects malformed envelopes without throwing", async () => {
    const options = {
      hostKey: host.publicKey,
      now: NOW,
      isKnownClient: nobody,
    };
    for (const value of [null, 1, "x", {}, { v: 1 }, { v: 2, session: "a" }])
      expect(await verifyOffer(value, options)).toEqual({
        ok: false,
        reason: "malformed",
      });
    const offer = await createOffer({
      identity: phone,
      hostKey: host.publicKey,
      sdp: SDP,
      now: NOW,
    });
    expect(await verifyOffer({ ...offer, session: "AA" }, options)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyOffer({ ...offer, clientKey: "AA" }, options)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyAnswer({ v: 1 }, { offer, now: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
