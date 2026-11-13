export const GET_USER_PROFILE_CHANNEL = "user-profile:get" as const;
export const SET_USER_PROFILE_CHANNEL = "user-profile:set" as const;

export type PineCommunicationStyle =
  "calm-professional" | "neutral" | "warm-friendly";
export type PineTechnicalBackground = "general-user" | "professional-user";

/**
 * How Pine refers to the user. The values are language independent; the
 * interface labels are not stored.
 */
export const PINE_PRONOUNS = [
  "unspecified",
  "he",
  "she",
  "they",
  "custom",
] as const;
export type PinePronouns = (typeof PINE_PRONOUNS)[number];
export const PINE_CUSTOM_PRONOUNS_MAX_LENGTH = 40;

export interface PineUserProfile {
  communicationStyle: PineCommunicationStyle;
  customInstructions: string;
  /** The user's own wording; only used while `pronouns` is "custom". */
  customPronouns: string;
  interactiveAnswersEnabled: boolean;
  /**
   * Lets the agent post interim answers while it keeps working; off removes
   * the tool from the model's tool list.
   */
  interimAnswersEnabled: boolean;
  /**
   * Monet mode: Sóber's voice and the reading font. While on, it replaces the
   * communication style.
   */
  monetMode: boolean;
  nickname: string;
  personalDetails: string;
  pronouns: PinePronouns;
  technicalBackground: PineTechnicalBackground;
}

export interface SetUserProfileResult {
  updated: boolean;
}

export function createDefaultPineUserProfile(): PineUserProfile {
  return {
    communicationStyle: "neutral",
    customInstructions: "",
    customPronouns: "",
    interactiveAnswersEnabled: true,
    interimAnswersEnabled: true,
    monetMode: false,
    nickname: "",
    personalDetails: "",
    pronouns: "unspecified",
    technicalBackground: "general-user",
  };
}

export function normalizePineUserProfile(
  profile: PineUserProfile,
): PineUserProfile {
  return {
    communicationStyle: profile.communicationStyle,
    customInstructions: profile.customInstructions.trim(),
    customPronouns: sanitizeCustomPronouns(profile.customPronouns),
    interactiveAnswersEnabled: profile.interactiveAnswersEnabled ?? true,
    interimAnswersEnabled: profile.interimAnswersEnabled ?? true,
    monetMode: profile.monetMode,
    nickname: profile.nickname.trim(),
    personalDetails: profile.personalDetails.trim(),
    pronouns: isPinePronouns(profile.pronouns)
      ? profile.pronouns
      : "unspecified",
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

export function isPinePronouns(value: unknown): value is PinePronouns {
  return (
    typeof value === "string" &&
    (PINE_PRONOUNS as readonly string[]).includes(value)
  );
}

/**
 * Keep custom pronouns to one short line: whitespace and control characters
 * collapse to a single space, and the result is capped by code point so a
 * surrogate pair is never split.
 */
export function sanitizeCustomPronouns(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const singleLine = value
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim();
  return Array.from(singleLine)
    .slice(0, PINE_CUSTOM_PRONOUNS_MAX_LENGTH)
    .join("")
    .trim();
}
