import { describe, expect, it } from "vitest";
import {
  currencyForLocales,
  currencyForRegion,
  isPineCurrency,
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
