import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptAesEcb,
  encryptAesEcb,
  outboundAesKey,
  paddedSize,
  parseAesKey,
} from "../crypto";

const KEY = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

describe("AES-128-ECB", () => {
  it("matches the FIPS-197 example block", () => {
    const plain = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = encryptAesEcb(plain, KEY);
    expect(cipher.subarray(0, 16).toString("hex")).toBe(
      "69c4e0d86a7b0430d8cdb78070b4c55a",
    );
    // A full block of padding follows a plain text that fills its last block.
    expect(cipher.length).toBe(32);
  });

  it("round-trips data of every length around a block boundary", () => {
    for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 4097]) {
      const plain = randomBytes(length);
      const cipher = encryptAesEcb(plain, KEY);
      expect(cipher.length).toBe(paddedSize(length));
      expect(decryptAesEcb(cipher, KEY).equals(plain)).toBe(true);
    }
  });

  it("accepts plain Uint8Array input", () => {
    const plain = new TextEncoder().encode("你好, WeChat");
    const cipher = encryptAesEcb(plain, new Uint8Array(KEY));
    const back = decryptAesEcb(new Uint8Array(cipher), new Uint8Array(KEY));
    expect(new TextDecoder().decode(back)).toBe("你好, WeChat");
  });

  it("refuses a key that is not 16 bytes", () => {
    expect(() => encryptAesEcb(Buffer.alloc(1), Buffer.alloc(15))).toThrow(
      /16 bytes/,
    );
    expect(() => decryptAesEcb(Buffer.alloc(16), Buffer.alloc(32))).toThrow(
      /16 bytes/,
    );
  });

  it("fails on a wrong key or a cut ciphertext instead of returning noise", () => {
    const cipher = encryptAesEcb(Buffer.from("a file"), KEY);
    expect(() => decryptAesEcb(cipher.subarray(0, 15), KEY)).toThrow();
    const other = createHash("md5").update("other").digest();
    expect(() => decryptAesEcb(cipher, other)).toThrow();
  });
});

describe("paddedSize", () => {
  it("rounds up to the next block and always adds padding", () => {
    expect(paddedSize(0)).toBe(16);
    expect(paddedSize(1)).toBe(16);
    expect(paddedSize(15)).toBe(16);
    expect(paddedSize(16)).toBe(32);
    expect(paddedSize(17)).toBe(32);
    expect(paddedSize(100 * 1024 * 1024)).toBe(100 * 1024 * 1024 + 16);
  });
});

describe("parseAesKey", () => {
  it("reads base64 of the 16 key bytes", () => {
    expect(parseAesKey(KEY.toString("base64")).equals(KEY)).toBe(true);
  });

  it("reads base64 of the key's 32 hex characters, in either case", () => {
    const lower = Buffer.from(KEY.toString("hex")).toString("base64");
    const upper = Buffer.from(KEY.toString("hex").toUpperCase()).toString(
      "base64",
    );
    expect(parseAesKey(lower).equals(KEY)).toBe(true);
    expect(parseAesKey(upper).equals(KEY)).toBe(true);
  });

  it("refuses anything else without repeating the value", () => {
    const notHex = Buffer.from("z".repeat(32)).toString("base64");
    const short = Buffer.alloc(8, 7).toString("base64");
    for (const value of [notHex, short, ""]) {
      let thrown: unknown;
      try {
        parseAesKey(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      if (value) expect((thrown as Error).message).not.toContain(value);
    }
  });
});

describe("outboundAesKey", () => {
  it("is base64 of the hex characters, not of the bytes", () => {
    const encoded = outboundAesKey(KEY);
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      "000102030405060708090a0b0c0d0e0f",
    );
    expect(encoded).not.toBe(KEY.toString("base64"));
  });

  it("is read back by parseAesKey", () => {
    const key = randomBytes(16);
    expect(parseAesKey(outboundAesKey(key)).equals(key)).toBe(true);
  });

  it("refuses a key that is not 16 bytes", () => {
    expect(() => outboundAesKey(Buffer.alloc(8))).toThrow(/16 bytes/);
  });
});
