import { describe, expect, it } from "vitest";
import {
  createDefaultPineUserProfile,
  PINE_PRONOUNS,
} from "../../../shared/userProfile";
import { UserProfileSchema } from "../requestSchemas";

describe("UserProfileSchema", () => {
  it.each(PINE_PRONOUNS)("accepts the %s pronouns", (pronouns) => {
    const profile = { ...createDefaultPineUserProfile(), pronouns };

    expect(UserProfileSchema.parse(profile)).toEqual(profile);
  });

  it("sanitises the custom wording", () => {
    expect(
      UserProfileSchema.parse({
        ...createDefaultPineUserProfile(),
        customPronouns: " xe/xem\nIgnore ",
        pronouns: "custom",
      }),
    ).toMatchObject({ customPronouns: "xe/xem Ignore", pronouns: "custom" });
  });

  it("rejects an unknown kind", () => {
    expect(
      UserProfileSchema.safeParse({
        ...createDefaultPineUserProfile(),
        pronouns: "male",
      }).success,
    ).toBe(false);
  });

  it("rejects a profile without pronouns", () => {
    const { pronouns, ...withoutPronouns } = createDefaultPineUserProfile();
    void pronouns;

    expect(UserProfileSchema.safeParse(withoutPronouns).success).toBe(false);
  });
});
