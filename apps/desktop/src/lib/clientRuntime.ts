/**
 * The renderer runs either inside the Electron window or as the local web
 * interface. Components ask this module instead of inspecting `window.pine`.
 */
export function isWebClient(): boolean {
  return typeof window !== "undefined" && window.pine?.runtime === "web";
}

export function isDesktopClient(): boolean {
  return !isWebClient();
}
