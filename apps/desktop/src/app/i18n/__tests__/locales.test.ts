import { describe, expect, it } from "vitest";
import {
  agentLocale,
  APP_LOCALES,
  APP_LOCALE_NAMES,
  localeMessages,
  resolveAppLocale,
} from "..";

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") entries.set(path, value);
    else for (const [k, v] of flatten(value, path)) entries.set(k, v);
  }
  return entries;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]).sort();

const reference = flatten(localeMessages["en-US"]);

describe("locale catalogs", () => {
  it.each(APP_LOCALES)("%s has the same keys as en-US", (locale) => {
    const messages = flatten(localeMessages[locale]);
    expect([...messages.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(APP_LOCALES)("%s keeps every placeholder", (locale) => {
    const messages = flatten(localeMessages[locale]);
    const mismatched = [...reference].filter(
      ([key, text]) =>
        placeholders(messages.get(key) ?? "").join() !==
        placeholders(text).join(),
    );
    expect(mismatched.map(([key]) => key)).toEqual([]);
  });

  it("ja-JP waiting marker uses the catalog's プロバイダ and says still", () => {
    const text = flatten(localeMessages["ja-JP"]).get(
      "project.transcript.awaitingResponse",
    );
    expect(text).toContain("まだ");
    expect(text).toContain("モデルプロバイダ");
    expect(text).not.toContain("プロバイダー");
  });

  it("names every locale in its own language", () => {
    expect(Object.keys(APP_LOCALE_NAMES).sort()).toEqual(
      [...APP_LOCALES].sort(),
    );
  });
});

describe("resolveAppLocale", () => {
  it("prefers a stored locale", () => {
    expect(resolveAppLocale(["en-US"], "ja-JP")).toBe("ja-JP");
  });

  it("maps Traditional Chinese regions to zh-TW and the rest to zh-CN", () => {
    expect(resolveAppLocale(["zh-TW"])).toBe("zh-TW");
    expect(resolveAppLocale(["zh-Hant-HK"])).toBe("zh-TW");
    expect(resolveAppLocale(["zh-CN"])).toBe("zh-CN");
    expect(resolveAppLocale(["zh"])).toBe("zh-CN");
  });

  it("matches other languages by primary subtag in preference order", () => {
    expect(resolveAppLocale(["ja"])).toBe("ja-JP");
    expect(resolveAppLocale(["xx", "ja-JP", "en-GB"])).toBe("ja-JP");
    expect(resolveAppLocale(["xx"])).toBe("en-US");
    expect(resolveAppLocale([])).toBe("en-US");
  });
});

describe("agentLocale", () => {
  it("keeps agent prompts to Chinese and English", () => {
    expect(agentLocale("zh-TW")).toBe("zh-CN");
    expect(agentLocale("ja-JP")).toBe("en-US");
  });
});
