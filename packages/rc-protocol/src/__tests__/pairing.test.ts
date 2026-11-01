import { describe, expect, it } from "vitest";
import { generateIdentity } from "../identity";
import {
  PAIRING_TTL_MS,
  createPairing,
  decodePairing,
  encodePairing,
  normalizeSignaling,
  pairingUrl,
  readPairingUrl,
} from "../pairing";

const NOW = 1_000_000;

describe("pairing", () => {
  it("round-trips through the code and the link", async () => {
    const host = await generateIdentity();
    const pairing = createPairing(host.publicKey, "https://api.aldine.cn", NOW);
    expect(decodePairing(encodePairing(pairing), NOW)).toEqual(pairing);
    const url = pairingUrl("https://rc.aldine.cn/app", pairing);
    expect(url.startsWith("https://rc.aldine.cn/#pair=")).toBe(true);
    expect(readPairingUrl(url, NOW)).toEqual(pairing);
  });

  it("uses a fresh secret each time", async () => {
    const host = await generateIdentity();
    const a = createPairing(host.publicKey, "https://api.aldine.cn", NOW);
    const b = createPairing(host.publicKey, "https://api.aldine.cn", NOW);
    expect(a.secret).not.toBe(b.secret);
  });

  it("rejects an expired code", async () => {
    const host = await generateIdentity();
    const code = encodePairing(
      createPairing(host.publicKey, "https://api.aldine.cn", NOW),
    );
    expect(() => decodePairing(code, NOW + PAIRING_TTL_MS + 1)).toThrow(
      /expired/,
    );
  });

  it("rejects codes that are not pairing codes", () => {
    expect(() => decodePairing("not a code", NOW)).toThrow();
    expect(() => decodePairing("e30", NOW)).toThrow();
    expect(() =>
      readPairingUrl("https://rc.aldine.cn/#other=1", NOW),
    ).toThrow();
  });

  it("only accepts https signaling, or a local one for development", () => {
    expect(normalizeSignaling("https://api.aldine.cn/")).toBe(
      "https://api.aldine.cn",
    );
    expect(normalizeSignaling("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(() => normalizeSignaling("http://api.aldine.cn")).toThrow();
    expect(() => normalizeSignaling("https://u:p@api.aldine.cn")).toThrow();
    expect(() => normalizeSignaling("https://api.aldine.cn/path")).toThrow();
  });
});
