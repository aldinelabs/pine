import { describe, expect, it } from "vitest";
import {
  MAINLAND_CHINA_NETWORK_PROMPT,
  approximateLocationNotice,
  SYSTEM_LANGUAGES_ENV,
  localNetworkRegionSignals,
  mayBeInMainlandChina,
  networkRegionSystemPrompt,
} from "../network-region";

describe("mayBeInMainlandChina", () => {
  it("matches a mainland China time zone", () => {
    expect(mayBeInMainlandChina("Asia/Shanghai", [])).toBe(true);
    expect(mayBeInMainlandChina("Asia/Urumqi", ["en-US"])).toBe(true);
  });

  it("matches a system language whose region is mainland China", () => {
    expect(mayBeInMainlandChina("UTC", ["zh-Hans-CN"])).toBe(true);
    expect(mayBeInMainlandChina("UTC", ["en-CN"])).toBe(true);
    expect(mayBeInMainlandChina(undefined, ["zh-Hans"])).toBe(true);
  });

  it("does not match Hong Kong, Macau, Taiwan or elsewhere", () => {
    expect(mayBeInMainlandChina("Asia/Hong_Kong", ["zh-Hant-HK"])).toBe(false);
    expect(mayBeInMainlandChina("Asia/Macau", ["zh-MO"])).toBe(false);
    expect(mayBeInMainlandChina("Asia/Taipei", ["zh-TW", "zh-Hant"])).toBe(
      false,
    );
    expect(mayBeInMainlandChina("America/New_York", ["en-US"])).toBe(false);
  });

  it("ignores malformed language tags", () => {
    expect(mayBeInMainlandChina("UTC", ["not a tag!"])).toBe(false);
  });
});

describe("localNetworkRegionSignals", () => {
  it("reads the system languages passed down from main", () => {
    const signals = localNetworkRegionSignals({
      [SYSTEM_LANGUAGES_ENV]: "zh-Hans-CN, en-CN,",
    });
    expect(signals.languageTags).toEqual(["zh-Hans-CN", "en-CN"]);
    expect(typeof signals.timeZone).toBe("string");
  });

  it("has no languages when main passed none", () => {
    expect(localNetworkRegionSignals({}).languageTags).toEqual([]);
  });
});

describe("networkRegionSystemPrompt", () => {
  it("asks the model to confirm with the user before switching mirrors", () => {
    expect(
      networkRegionSystemPrompt({
        timeZone: "Asia/Shanghai",
        languageTags: [],
      }),
    ).toBe(MAINLAND_CHINA_NETWORK_PROMPT);
    expect(MAINLAND_CHINA_NETWORK_PROMPT).toContain("ask the user once");
    expect(MAINLAND_CHINA_NETWORK_PROMPT).toContain(
      "Do not switch sources before they confirm",
    );
  });

  it("adds nothing elsewhere", () => {
    expect(
      networkRegionSystemPrompt({
        timeZone: "Europe/Berlin",
        languageTags: ["de-DE"],
      }),
    ).toBeUndefined();
  });
});

describe("approximateLocationNotice", () => {
  it("names the place and calls it an estimate", () => {
    const notice = approximateLocationNotice({
      city: "Hangzhou",
      region: "Zhejiang",
      country: "China",
      countryCode: "CN",
    });

    expect(notice).toContain("in or near Hangzhou, Zhejiang, China (CN)");
    expect(notice).toContain("This is an estimate.");
  });

  it("leaves out parts the database does not know", () => {
    expect(approximateLocationNotice({ country: "Japan" })).toContain(
      "in or near Japan.",
    );
  });
});
