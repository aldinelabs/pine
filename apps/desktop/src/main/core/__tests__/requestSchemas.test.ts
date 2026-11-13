import { describe, expect, it } from "vitest";
import {
  createDefaultPineUserProfile,
  PINE_PRONOUNS,
} from "../../../shared/userProfile";
import {
  ReopenPresentedToolFileRequestSchema,
  UserProfileSchema,
} from "../requestSchemas";

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

  it("keeps interim answers on when an older client omits the switch", () => {
    const { interimAnswersEnabled, ...withoutSwitch } =
      createDefaultPineUserProfile();
    void interimAnswersEnabled;

    expect(UserProfileSchema.parse(withoutSwitch)).toMatchObject({
      interimAnswersEnabled: true,
    });
  });
});

describe("ReopenPresentedToolFileRequestSchema", () => {
  const request = {
    projectId: "7f48c81c-f1dc-4be6-a8ee-55729ef647ba",
    sessionId: "0198e338-fb55-7e18-a23e-a7028500f999",
    toolCallId: "submit-1",
  };

  it("takes an optional artifact path", () => {
    expect(ReopenPresentedToolFileRequestSchema.parse(request)).toEqual(
      request,
    );
    expect(
      ReopenPresentedToolFileRequestSchema.parse({
        ...request,
        path: "/work/report.md",
      }),
    ).toEqual({ ...request, path: "/work/report.md" });
    expect(
      ReopenPresentedToolFileRequestSchema.safeParse({ ...request, path: "" })
        .success,
    ).toBe(false);
  });
});
