import { afterEach, describe, expect, it, vi } from "vitest";
import { WebRequestCache } from "../webRequestCache";

afterEach(() => vi.useRealTimers());

describe("HTTP command receipts", () => {
  it("does not expire a pending command and bounds receipts after completion", async () => {
    vi.useFakeTimers();
    const cache = new WebRequestCache(1, 1000);
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const original = cache.execute("one", "prompt", {}, invoke);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(cache.execute("one", "prompt", {}, invoke)).toBe(original);
    expect(() => cache.execute("two", "prompt", {}, invoke)).toThrow(
      "Too many",
    );
    resolve({ accepted: true });
    await original;
    await vi.advanceTimersByTimeAsync(1001);
    await cache.execute("two", "prompt", {}, () =>
      Promise.resolve({ accepted: true }),
    );
    expect(invoke).toHaveBeenCalledOnce();
  });
});
