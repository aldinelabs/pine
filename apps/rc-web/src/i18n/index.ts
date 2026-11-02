import { createI18n } from "vue-i18n";
import enUS from "./locales/en-US";
import deDE from "./locales/de-DE";
import frFR from "./locales/fr-FR";
import esES from "./locales/es-ES";
import jaJP from "./locales/ja-JP";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";

export const LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "es-ES",
  "fr-FR",
  "de-DE",
] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof zhCN;

/**
 * The embedded Pine shares this origin, so its language choice, saved under
 * the desktop app's key, applies here too.
 */
const PINE_LOCALE_KEY = "pine.locale";

function storedLocale(): string | null {
  try {
    return localStorage.getItem(PINE_LOCALE_KEY);
  } catch {
    return null;
  }
}

export function resolveLocale(
  languages: readonly string[],
  stored: string | null,
): Locale {
  if (LOCALES.some((locale) => locale === stored)) return stored as Locale;
  for (const language of languages) {
    const tag = language.toLowerCase();
    if (/^zh-(tw|hk|mo|hant)\b/.test(tag)) return "zh-TW";
    if (/^zh\b/.test(tag)) return "zh-CN";
    const match = LOCALES.find(
      (locale) => locale.toLowerCase().split("-")[0] === tag.split("-")[0],
    );
    if (match) return match;
  }
  return "en-US";
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale(navigator.languages, storedLocale()),
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": zhCN,
    "zh-TW": zhTW,
    "en-US": enUS,
    "ja-JP": jaJP,
    "es-ES": esES,
    "fr-FR": frFR,
    "de-DE": deDE,
  },
});

function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  document.title = i18n.global.t("title");
}

applyLocale(i18n.global.locale.value as Locale);
window.addEventListener("storage", (event) => {
  if (event.key === PINE_LOCALE_KEY || event.key === null)
    applyLocale(resolveLocale(navigator.languages, storedLocale()));
});

export function t(key: MessageKey, values: Record<string, string> = {}) {
  return i18n.global.t(key, values);
}
