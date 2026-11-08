export const GET_USER_PROFILE_CHANNEL = "user-profile:get" as const;
export const SET_USER_PROFILE_CHANNEL = "user-profile:set" as const;

export type PineCommunicationStyle =
  "calm-professional" | "neutral" | "warm-friendly";
export type PineTechnicalBackground = "general-user" | "professional-user";

export interface PineUserProfile {
  communicationStyle: PineCommunicationStyle;
  customInstructions: string;
  interactiveAnswersEnabled: boolean;
  /**
   * Monet mode: Sóber's voice and the reading font. While on, it replaces the
   * communication style.
   */
  monetMode: boolean;
  nickname: string;
  personalDetails: string;
  technicalBackground: PineTechnicalBackground;
}

export interface SetUserProfileResult {
  updated: boolean;
}

export function createDefaultPineUserProfile(): PineUserProfile {
  return {
    communicationStyle: "neutral",
    customInstructions: "",
    interactiveAnswersEnabled: true,
    monetMode: false,
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
    interactiveAnswersEnabled: profile.interactiveAnswersEnabled ?? true,
    monetMode: profile.monetMode,
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
    value === "neutral" ||
    value === "warm-friendly"
  );
}

export function isPineTechnicalBackground(
  value: string,
): value is PineTechnicalBackground {
  return value === "general-user" || value === "professional-user";
}
