import { describe, expect, it } from "vitest";
import {
  bytesEqual,
  concatBytes,
  framedFields,
  fromBase64Url,
  toBase64Url,
} from "../encoding";

describe("encoding", () => {
  it("round-trips every length through base64url", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(fromBase64Url(text))).toEqual(Array.from(bytes));
    }
  });

  it("rejects text that is not base64url", () => {
    expect(() => fromBase64Url("a+b")).toThrow();
    expect(() => fromBase64Url("abcde")).toThrow();
    expect(() => fromBase64Url("ab=c")).toThrow();
  });

  it("compares bytes by value and length", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(
      true,
    );
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(
      false,
    );
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("frames fields so that moving a boundary changes the bytes", () => {
    const a = framedFields("x", ["ab", "c"]);
    const b = framedFields("x", ["a", "bc"]);
    expect(bytesEqual(a, b)).toBe(false);
    expect(concatBytes(new Uint8Array([1]), new Uint8Array([2])).length).toBe(
      2,
    );
  });
});
