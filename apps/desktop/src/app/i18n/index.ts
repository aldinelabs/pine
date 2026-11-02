import { createI18n } from "vue-i18n";
import enUS from "./locales/en-US";
import deDE from "./locales/de-DE";
import frFR from "./locales/fr-FR";
import esES from "./locales/es-ES";
import jaJP from "./locales/ja-JP";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";

export const APP_LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "es-ES",
  "fr-FR",
  "de-DE",
] as const;

/** Each language is named in itself so it stays findable from any interface language. */
export const APP_LOCALE_NAMES: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en-US": "English",
  "ja-JP": "日本語",
  "es-ES": "Español",
  "fr-FR": "Français",
  "de-DE": "Deutsch",
};
export const APP_LOCALE_STORAGE_KEY = "pine.locale";

export type AppLocale = (typeof APP_LOCALES)[number];

type MessageShape<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};

export const localeMessages = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  "ja-JP": jaJP,
  "es-ES": esES,
  "fr-FR": frFR,
  "de-DE": deDE,
} satisfies Record<AppLocale, MessageShape<typeof zhCN>>;

const TRADITIONAL_CHINESE = /^zh-(tw|hk|mo|hant)\b/;

function matchLanguage(language: string): AppLocale | null {
  const tag = language.toLowerCase();
  if (TRADITIONAL_CHINESE.test(tag)) return "zh-TW";
  if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
  const primary = tag.split("-")[0];
  return (
    APP_LOCALES.find(
      (locale) => locale.toLowerCase().split("-")[0] === primary,
    ) ?? null
  );
}

export function isAppLocale(value: string | null): value is AppLocale {
  return APP_LOCALES.some((locale) => locale === value);
}

export function resolveAppLocale(
  languages: readonly string[] = [],
  storedLocale: string | null = null,
): AppLocale {
  if (isAppLocale(storedLocale)) return storedLocale;

  for (const language of languages) {
    const matched = matchLanguage(language);
    if (matched) return matched;
  }
  return "en-US";
}

export function persistAppLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
    window.pine?.setAppLocale?.(locale);
  } catch {
    // The selected locale still applies for this session if storage is unavailable.
  }
}

export function createAppI18n(locale: AppLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: localeMessages,
  });
}

/** Agent prompts and native dialogs ship in Chinese and English only. */
export function agentLocale(locale: string): "en-US" | "zh-CN" {
  return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
