import { describe, expect, it } from "vitest";
import { localeShortLabel } from "../liveContextLocale";

describe("localeShortLabel", () => {
  it("shows the language in capitals and the region in parentheses", () => {
    expect(localeShortLabel("en-US")).toBe("EN (US)");
    expect(localeShortLabel("zh-CN")).toBe("ZH (CN)");
    expect(localeShortLabel("zh-TW")).toBe("ZH (TW)");
    expect(localeShortLabel("ja-JP")).toBe("JA (JP)");
    expect(localeShortLabel("yue-CN")).toBe("YUE (CN)");
  });

  it("shows only the language when there is no region", () => {
    expect(localeShortLabel("en")).toBe("EN");
    expect(localeShortLabel("zh-Hans")).toBe("ZH");
  });

  it("finds the region after a script and accepts underscores", () => {
    expect(localeShortLabel("zh-Hant-TW")).toBe("ZH (TW)");
    expect(localeShortLabel("es_419")).toBe("ES (419)");
  });
});
