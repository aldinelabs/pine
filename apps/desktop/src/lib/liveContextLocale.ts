/**
 * A spoken-language code as a short label for tight controls: the language
 * in capitals with the region in parentheses ("zh-CN" → "ZH (CN)", "en" →
 * "EN"). Script subtags are left out; the full localized name belongs in
 * the menu and the control's accessible name.
 */
export function localeShortLabel(locale: string): string {
  const [language = locale, ...rest] = locale.split(/[-_]/);
  const region = rest.find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part));
  const code = language.toUpperCase();
  return region ? `${code} (${region.toUpperCase()})` : code;
}
