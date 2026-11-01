import { describe, expect, it } from "vitest";
import { decodeWebJson, encodeWebJson } from "../webControl";

describe("web JSON codec", () => {
  it("round-trips bytes anywhere in a request and leaves other objects alone", () => {
    const value = {
      bytes: new Uint8Array([0, 1, 254, 255]),
      nested: [{ data: new Uint8Array(20_000).fill(7) }],
      plain: { $pineBytes: 1, other: true },
    };
    const decoded = decodeWebJson(encodeWebJson(value)) as typeof value;
    expect(decoded.bytes).toEqual(value.bytes);
    expect(decoded.nested[0].data).toEqual(value.nested[0].data);
    expect(decoded.plain).toEqual(value.plain);
  });
});
