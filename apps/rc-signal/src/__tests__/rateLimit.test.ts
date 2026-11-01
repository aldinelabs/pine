import { describe, expect, it } from "vitest";
import { DailyBudget, RateLimiter } from "../rateLimit";

describe("RateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    const limiter = new RateLimiter(2, 1);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(false);
    expect(limiter.take("b", 0)).toBe(true);
    expect(limiter.take("a", 1000)).toBe(true);
    expect(limiter.take("a", 1000)).toBe(false);
  });

  it("never refills past its capacity", () => {
    const limiter = new RateLimiter(2, 1);
    limiter.take("a", 0);
    expect(limiter.take("a", 60_000)).toBe(true);
    expect(limiter.take("a", 60_000)).toBe(true);
    expect(limiter.take("a", 60_000)).toBe(false);
  });
});

describe("DailyBudget", () => {
  it("stops at the limit and starts over the next UTC day", () => {
    const budget = new DailyBudget(2);
    expect(budget.take(1000)).toBe(true);
    expect(budget.take(2000)).toBe(true);
    expect(budget.take(3000)).toBe(false);
    expect(budget.take(86_400_000 + 1)).toBe(true);
  });
});
