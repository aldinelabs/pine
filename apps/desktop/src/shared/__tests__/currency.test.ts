import { describe, expect, it } from "vitest";
import {
  currencyForLocales,
  currencyForRegion,
  currencySymbol,
  displayCurrency,
  formatCurrency,
  isPineCurrency,
  preferredCurrency,
} from "../currency";

describe("currencyForRegion", () => {
  it("maps an ISO region regardless of the interface language", () => {
    expect(currencyForRegion("CA")).toBe("CAD");
    expect(currencyForRegion("ca")).toBe("CAD");
    expect(currencyForRegion("ZZ")).toBeUndefined();
    expect(currencyForRegion(null)).toBeUndefined();
  });
});

describe("currencyForLocales", () => {
  it("maps the system region to its currency", () => {
    expect(currencyForLocales(["zh-CN"])).toBe("CNY");
    expect(currencyForLocales(["en-GB", "en-US"])).toBe("GBP");
    expect(currencyForLocales(["de-DE"])).toBe("EUR");
    expect(currencyForLocales(["ja"])).toBe("JPY");
  });

  it("skips malformed tags and falls back to USD", () => {
    expect(currencyForLocales(["!!", "fr-FR"])).toBe("EUR");
    expect(currencyForLocales([])).toBe("USD");
    expect(currencyForLocales(undefined)).toBe("USD");
  });

  it("recognises supported currency codes", () => {
    expect(isPineCurrency("CNY")).toBe(true);
    expect(isPineCurrency("XYZ")).toBe(false);
  });
});

describe("preferredCurrency", () => {
  it("uses the stored preference over the system", () => {
    expect(preferredCurrency("EUR", "CN", ["zh-CN"])).toBe("EUR");
  });

  it("follows the system region, then the languages, without one", () => {
    expect(preferredCurrency(undefined, "CN", ["en-US"])).toBe("CNY");
    expect(preferredCurrency(null, null, ["ja-JP"])).toBe("JPY");
    expect(preferredCurrency("XYZ", undefined, [])).toBe("USD");
  });
});

describe("displayCurrency", () => {
  const rates = {
    base: "USD" as const,
    date: "2026-11-18",
    rates: { CNY: 7.2 },
  };

  it("uses the latest rate for the wanted currency", () => {
    expect(displayCurrency("CNY", rates)).toEqual({
      currency: "CNY",
      rate: 7.2,
    });
  });

  it("falls back to USD while there is no rate", () => {
    expect(displayCurrency("CNY", null)).toEqual({ currency: "USD", rate: 1 });
    expect(displayCurrency("EUR", rates)).toEqual({ currency: "USD", rate: 1 });
  });
});

describe("formatCurrency", () => {
  it("formats an amount with the currency's symbol", () => {
    expect(
      formatCurrency(3.6, "CNY", {
        fractionDigits: 2,
        narrow: true,
        locale: "en-US",
      }),
    ).toBe("¥3.60");
    expect(formatCurrency(0.1234, "USD", { locale: "en-US" })).toBe("$0.1234");
    expect(formatCurrency(1234.5, "EUR", { locale: "en-US" })).toBe(
      "€1,234.50",
    );
  });

  it("gives the bare symbol", () => {
    expect(currencySymbol("CNY", "en-US")).toBe("¥");
    expect(currencySymbol("USD", "zh-CN")).toBe("$");
  });
});
