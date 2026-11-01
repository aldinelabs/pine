import { describe, expect, it } from "vitest";
import { utf8 } from "../encoding";
import {
  PUBLIC_KEY_BYTES,
  exportIdentity,
  fingerprint,
  generateIdentity,
  importIdentity,
  sign,
  verify,
} from "../identity";

describe("identity", () => {
  it("signs and verifies, and rejects other data and other keys", async () => {
    const identity = await generateIdentity();
    const other = await generateIdentity();
    const data = utf8("hello");
    const signature = await sign(identity, data);
    expect(identity.publicKey.length).toBe(PUBLIC_KEY_BYTES);
    expect(await verify(identity.publicKey, data, signature)).toBe(true);
    expect(await verify(identity.publicKey, utf8("hellp"), signature)).toBe(
      false,
    );
    expect(await verify(other.publicKey, data, signature)).toBe(false);
  });

  it("treats a malformed public key as a failed verification", async () => {
    const identity = await generateIdentity();
    const signature = await sign(identity, utf8("x"));
    expect(await verify(new Uint8Array(65), utf8("x"), signature)).toBe(false);
    expect(await verify(new Uint8Array(3), utf8("x"), signature)).toBe(false);
  });

  it("restores an exported identity", async () => {
    const identity = await generateIdentity(true);
    const restored = await importIdentity(await exportIdentity(identity));
    const signature = await sign(restored, utf8("again"));
    expect(await verify(identity.publicKey, utf8("again"), signature)).toBe(
      true,
    );
  });

  it("cannot export a non-extractable identity", async () => {
    await expect(exportIdentity(await generateIdentity())).rejects.toThrow();
  });

  it("prints a short fingerprint that differs between keys", async () => {
    const a = await fingerprint((await generateIdentity()).publicKey);
    const b = await fingerprint((await generateIdentity()).publicKey);
    expect(a).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/);
    expect(a).not.toBe(b);
  });
});
