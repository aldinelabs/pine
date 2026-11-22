import type { AppLocale } from "@/app/i18n";
import enUS from "./content/en-US";
import zhCN from "./content/zh-CN";
import {
  HELP_TOPIC_STEPS,
  type HelpContent,
  type HelpIllustrationId,
  type HelpStepText,
  type HelpTopicId,
  type HelpTopicText,
} from "./topics";

export * from "./topics";

/** Locales whose guides are written; the others fall back below. */
const HELP_CONTENT: Partial<Record<AppLocale, HelpContent>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

/**
 * Traditional Chinese readers get the Simplified guides rather than English
 * until their own are written; every other language falls back to English.
 */
const HELP_FALLBACK: Partial<Record<AppLocale, AppLocale>> = {
  "zh-TW": "zh-CN",
};

export interface ResolvedHelpStep extends HelpStepText {
  illustration: HelpIllustrationId;
}

export interface ResolvedHelpTopic extends Omit<HelpTopicText, "steps"> {
  id: HelpTopicId;
  /** The language the text is actually in, for the dialog's `lang`. */
  locale: AppLocale;
  steps: ResolvedHelpStep[];
}

export function helpContentLocale(locale: AppLocale): AppLocale {
  if (HELP_CONTENT[locale]) return locale;
  const fallback = HELP_FALLBACK[locale];
  return fallback && HELP_CONTENT[fallback] ? fallback : "en-US";
}

export function resolveHelpTopic(
  id: HelpTopicId,
  locale: AppLocale,
): ResolvedHelpTopic {
  const contentLocale = helpContentLocale(locale);
  const text = (HELP_CONTENT[contentLocale] ?? enUS)[id];
  return {
    id,
    locale: contentLocale,
    title: text.title,
    summary: text.summary,
    steps: HELP_TOPIC_STEPS[id].map((illustration, index) => ({
      ...text.steps[index],
      illustration,
    })),
  };
}
