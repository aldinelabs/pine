export const GET_USER_PROFILE_CHANNEL = "user-profile:get" as const;
export const SET_USER_PROFILE_CHANNEL = "user-profile:set" as const;

export type PineCommunicationStyle =
  "calm-professional" | "warm-friendly" | "monet";
export type PineTechnicalBackground =
  "general-user" | "enthusiast" | "professional-user";

export interface PineUserProfile {
  communicationStyle: PineCommunicationStyle;
  customInstructions: string;
  nickname: string;
  personalDetails: string;
  technicalBackground: PineTechnicalBackground;
}

export interface SetUserProfileResult {
  updated: boolean;
}

export function createDefaultPineUserProfile(): PineUserProfile {
  return {
    communicationStyle: "calm-professional",
    customInstructions: "",
    nickname: "",
    personalDetails: "",
    technicalBackground: "enthusiast",
  };
}

export function normalizePineUserProfile(
  profile: PineUserProfile,
): PineUserProfile {
  return {
    communicationStyle: profile.communicationStyle,
    customInstructions: profile.customInstructions.trim(),
    nickname: profile.nickname.trim(),
    personalDetails: profile.personalDetails.trim(),
    technicalBackground: profile.technicalBackground,
  };
}

export function isPineCommunicationStyle(
  value: string,
): value is PineCommunicationStyle {
  return (
    value === "calm-professional" ||
    value === "warm-friendly" ||
    value === "monet"
  );
}

export function isPineTechnicalBackground(
  value: string,
): value is PineTechnicalBackground {
  return (
    value === "general-user" ||
    value === "enthusiast" ||
    value === "professional-user"
  );
}
