// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ERROR_REPEAT_MS } from "../constants";
import { RateLimits } from "../rateLimit";

describe("RateLimits", () => {
  it("does not repeat the same error reply within the window", () => {
    let now = 0;
    const limits = new RateLimits({ now: () => now });
    expect(limits.repeatAllowed("E-CODE:42")).toBe(true);
    expect(limits.repeatAllowed("E-CODE:42")).toBe(false);
    expect(limits.repeatAllowed("E-CODE:43")).toBe(true);
    now += ERROR_REPEAT_MS - 1;
    expect(limits.repeatAllowed("E-CODE:42")).toBe(false);
    now += 1;
    expect(limits.repeatAllowed("E-CODE:42")).toBe(true);
  });

  it("starts over on reset", () => {
    const limits = new RateLimits({ now: () => 0 });
    expect(limits.repeatAllowed("E-FAIL")).toBe(true);
    limits.reset();
    expect(limits.repeatAllowed("E-FAIL")).toBe(true);
  });
});
