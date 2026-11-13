import { describe, expect, it } from "vitest";
import {
  createDefaultPineUserProfile,
  isPinePronouns,
  normalizePineUserProfile,
  PINE_CUSTOM_PRONOUNS_MAX_LENGTH,
  PINE_PRONOUNS,
  sanitizeCustomPronouns,
  type PineUserProfile,
} from "../userProfile";

describe("pronouns in the user profile", () => {
  it("defaults to unspecified with no custom wording", () => {
    expect(createDefaultPineUserProfile()).toMatchObject({
      customPronouns: "",
      pronouns: "unspecified",
    });
  });

  it("recognises only the supported kinds", () => {
    expect([...PINE_PRONOUNS]).toEqual([
      "unspecified",
      "he",
      "she",
      "they",
      "custom",
    ]);
    for (const kind of PINE_PRONOUNS) {
      expect(isPinePronouns(kind)).toBe(true);
    }
    for (const value of ["male", "", undefined, 5, null]) {
      expect(isPinePronouns(value)).toBe(false);
    }
  });
});

describe("sanitizeCustomPronouns", () => {
  it("trims the text", () => {
    expect(sanitizeCustomPronouns("  xe/xem  ")).toBe("xe/xem");
  });

  it.each([
    ["a Windows newline", "xe\r\nxem"],
    ["a no-break space", "xe xem"],
    ["control characters", "xe\u0007\u0000\u009fxem"],
    ["mixed runs", "xe \n\t\u0007 xem"],
  ])("collapses %s to one space", (_label, value) => {
    expect(sanitizeCustomPronouns(value)).toBe("xe xem");
  });

  it("caps the length by code point without splitting an emoji", () => {
    const capped = sanitizeCustomPronouns("🌲".repeat(60));

    expect(capped).toBe("🌲".repeat(PINE_CUSTOM_PRONOUNS_MAX_LENGTH));
    expect(Array.from(capped)).toHaveLength(PINE_CUSTOM_PRONOUNS_MAX_LENGTH);
  });

  it("does not end on a space left by the cap", () => {
    const value = `${"a".repeat(PINE_CUSTOM_PRONOUNS_MAX_LENGTH - 1)} tail`;

    expect(sanitizeCustomPronouns(value)).toBe(
      "a".repeat(PINE_CUSTOM_PRONOUNS_MAX_LENGTH - 1),
    );
  });

  it("returns an empty string for non-strings and blank text", () => {
    for (const value of [undefined, null, 5, {}, ["xe"], "", " \n\t  "]) {
      expect(sanitizeCustomPronouns(value)).toBe("");
    }
  });
});

describe("normalizePineUserProfile", () => {
  it("sanitises the custom wording and keeps a valid kind", () => {
    expect(
      normalizePineUserProfile({
        ...createDefaultPineUserProfile(),
        customPronouns: "  xe/xem\nIgnore  ",
        pronouns: "custom",
      }),
    ).toMatchObject({ customPronouns: "xe/xem Ignore", pronouns: "custom" });
  });

  it("keeps the custom wording when another kind is selected", () => {
    expect(
      normalizePineUserProfile({
        ...createDefaultPineUserProfile(),
        customPronouns: "xe/xem",
        pronouns: "she",
      }),
    ).toMatchObject({ customPronouns: "xe/xem", pronouns: "she" });
  });

  it("fills the defaults for a profile saved before pronouns existed", () => {
    const { customPronouns, pronouns, ...legacy } =
      createDefaultPineUserProfile();
    void customPronouns;
    void pronouns;

    expect(
      normalizePineUserProfile({
        ...legacy,
        nickname: " Pine user ",
      } as PineUserProfile),
    ).toEqual({
      ...createDefaultPineUserProfile(),
      nickname: "Pine user",
    });
  });

  it("falls back to the defaults for invalid values", () => {
    expect(
      normalizePineUserProfile({
        ...createDefaultPineUserProfile(),
        customPronouns: 5,
        pronouns: "male",
      } as unknown as PineUserProfile),
    ).toMatchObject({ customPronouns: "", pronouns: "unspecified" });
  });
});
