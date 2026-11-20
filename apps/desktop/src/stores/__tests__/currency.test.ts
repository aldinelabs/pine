import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PineCurrencyInfo } from "@/shared/currency";
import { CURRENCY_STORAGE_KEY, useCurrencyStore } from "../currency";

interface MutablePineWindow {
  pine?: { getExchangeRates: () => Promise<PineCurrencyInfo> };
}

function installRates(): void {
  (window as unknown as MutablePineWindow).pine = {
    getExchangeRates: () =>
      Promise.resolve({
        systemRegion: "US",
        rates: { base: "USD", date: "2026-11-18", rates: { CNY: 7.2 } },
      }),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (window as unknown as MutablePineWindow).pine;
});

describe("useCurrencyStore", () => {
  it("shows USD until the rates for the chosen currency load", async () => {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, "CNY");
    installRates();
    const store = useCurrencyStore();
    expect(store.currency).toBe("USD");
    expect(store.format(1, 2)).toContain("1.00");

    await store.load();
    expect(store.currency).toBe("CNY");
    expect(store.symbol).toBe("¥");
    expect(store.format(1, 2)).toContain("7.20");
    expect(store.toUsd(7.2)).toBeCloseTo(1);
  });

  it("follows the system region with no preference", async () => {
    installRates();
    const store = useCurrencyStore();
    await store.load();
    expect(store.preference).toBe("auto");
    expect(store.currency).toBe("USD");
    expect(store.format(0.1234)).toContain("0.1234");
  });
});
