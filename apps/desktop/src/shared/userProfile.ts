export const GET_USER_PROFILE_CHANNEL = "user-profile:get" as const;
export const SET_USER_PROFILE_CHANNEL = "user-profile:set" as const;

export type PineCommunicationStyle =
  "calm-professional" | "warm-friendly" | "monet";
export type PineTechnicalBackground = "general-user" | "professional-user";
/** Whether replies may include interactive blocks ("rich") or stay text. */
export type PineInterfaceElements = "rich" | "simple";

export interface PineUserProfile {
  communicationStyle: PineCommunicationStyle;
  customInstructions: string;
  interfaceElements: PineInterfaceElements;
  nickname: string;
  personalDetails: string;
  technicalBackground: PineTechnicalBackground;
}

export interface SetUserProfileResult {
  updated: boolean;
}

export function createDefaultPineUserProfile(): PineUserProfile {
  return {
    communicationStyle: "monet",
    customInstructions: "",
    interfaceElements: "rich",
    nickname: "",
    personalDetails: "",
    technicalBackground: "general-user",
  };
}

export function normalizePineUserProfile(
  profile: PineUserProfile,
): PineUserProfile {
  return {
    communicationStyle: profile.communicationStyle,
    customInstructions: profile.customInstructions.trim(),
    interfaceElements: profile.interfaceElements,
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
  return value === "general-user" || value === "professional-user";
}

export function isPineInterfaceElements(
  value: string,
): value is PineInterfaceElements {
  return value === "rich" || value === "simple";
}
