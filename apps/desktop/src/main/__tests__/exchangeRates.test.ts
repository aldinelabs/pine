import { describe, expect, it, vi } from "vitest";
import { ExchangeRateService } from "../exchangeRates";

function rateResponse(): Response {
  return new Response(
    JSON.stringify({
      base: "USD",
      date: "2026-11-03",
      rates: { CNY: 7.1, EUR: 0.9, XYZ: 3 },
    }),
    { status: 200 },
  );
}

describe("ExchangeRateService", () => {
  it("keeps supported currencies, adds USD and caches the result", async () => {
    let now = 1_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(rateResponse()));
    const service = new ExchangeRateService({ fetch, now: () => now });

    const first = await service.get();
    expect(first).toEqual({
      base: "USD",
      date: "2026-11-03",
      rates: { USD: 1, CNY: 7.1, EUR: 0.9 },
    });

    now += 60_000;
    await service.get();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns null when the first fetch fails and keeps old rates later", async () => {
    let now = 1_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockImplementationOnce(() => Promise.resolve(rateResponse()))
      .mockRejectedValueOnce(new Error("offline"));
    const service = new ExchangeRateService({
      fetch,
      now: () => now,
      retryDelayMs: 10,
      ttlMs: 100,
    });

    expect(await service.get()).toBeNull();
    now += 20;
    expect((await service.get())?.rates.CNY).toBe(7.1);
    now += 200;
    expect((await service.get())?.rates.CNY).toBe(7.1);
  });
});
