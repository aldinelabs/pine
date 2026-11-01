import { describe, expect, it } from "vitest";
import { randomId } from "../randomId";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  it("uses crypto.randomUUID when available", () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it("falls back to getRandomValues outside secure contexts", () => {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    try {
      const first = randomId();
      expect(first).toMatch(UUID_V4);
      expect(randomId()).not.toBe(first);
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });
});
