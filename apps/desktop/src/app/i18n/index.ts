import { createI18n } from "vue-i18n";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

export const APP_LOCALES = ["zh-CN", "en-US"] as const;
export const APP_LOCALE_STORAGE_KEY = "pine.locale";

export type AppLocale = (typeof APP_LOCALES)[number];

const messages = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function isAppLocale(value: string | null): value is AppLocale {
  return APP_LOCALES.some((locale) => locale === value);
}

export function resolveAppLocale(
  languages: readonly string[] = [],
  storedLocale: string | null = null,
): AppLocale {
  if (isAppLocale(storedLocale)) return storedLocale;

  const preferredLanguages = languages.map((language) =>
    language.toLowerCase(),
  );

  return preferredLanguages.some(
    (language) => language === "zh" || language.startsWith("zh-"),
  )
    ? "zh-CN"
    : "en-US";
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
    messages,
  });
}
