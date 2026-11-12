import type { PineSessionEvent } from "./agent";

export const GET_WEB_SERVER_CHANNEL = "web-control:get";
export const SET_WEB_SERVER_CHANNEL = "web-control:set";
export const SET_WEB_PASSWORD_CHANNEL = "web-control:set-password";
export const SIGN_OUT_WEB_BROWSERS_CHANNEL = "web-control:sign-out";
export const DEFAULT_WEB_PORT = 9415;
export const MIN_WEB_PASSWORD_LENGTH = 8;
/** One persistent subscriber for the local browser interface. */
export const WEB_CLIENT_ID = -1;

/**
 * Whether a client id names an interface that is not a desktop window, such
 * as the browser interface or WeChat. Desktop windows use positive ids.
 */
export function isVirtualClient(clientId: number): boolean {
  return clientId < 0;
}
export const WEB_SNAPSHOT_CHANNEL = "web-control:snapshot";

/** How long a signed-in browser stays signed in. */
export const WEB_REMEMBER_FOR = ["session", "1d", "7d", "30d"] as const;
export type WebRememberFor = (typeof WEB_REMEMBER_FOR)[number];
export const DEFAULT_WEB_REMEMBER_FOR: WebRememberFor = "7d";

export interface WebServerSettings {
  enabled: boolean;
  port: number;
  /** Listens on every network interface instead of only this computer. */
  lan: boolean;
  rememberFor: WebRememberFor;
  /**
   * Off only when something in front of Pine, such as Cloudflare Access,
   * signs people in instead. It cannot be off while LAN access is on.
   */
  requirePassword: boolean;
  /** The origin a reverse proxy serves Pine at, such as https://pine.example.com. */
  publicOrigin?: string;
}

export interface WebServerStatus extends WebServerSettings {
  hasPassword: boolean;
  /** Where browsers reach the service while it runs, this computer first. */
  addresses?: string[];
  error?: string;
}

export const DEFAULT_WEB_SERVER_SETTINGS: WebServerSettings = {
  enabled: false,
  port: DEFAULT_WEB_PORT,
  lan: false,
  rememberFor: DEFAULT_WEB_REMEMBER_FOR,
  requirePassword: true,
};

/** The bare origin of an http(s) URL, or undefined for anything else. */
export function normalizeWebOrigin(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export interface WebSessionSnapshot {
  sessionId: string;
  projectId: string;
  events: PineSessionEvent[];
}

export interface WebEvent {
  channel: string;
  value: unknown;
}

export function isWebServerSettings(
  value: unknown,
): value is WebServerSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.enabled === "boolean" &&
    typeof settings.port === "number" &&
    Number.isInteger(settings.port) &&
    settings.port >= 1024 &&
    settings.port <= 65535 &&
    typeof settings.lan === "boolean" &&
    WEB_REMEMBER_FOR.includes(settings.rememberFor as WebRememberFor) &&
    typeof settings.requirePassword === "boolean" &&
    (settings.publicOrigin === undefined ||
      (typeof settings.publicOrigin === "string" &&
        normalizeWebOrigin(settings.publicOrigin) === settings.publicOrigin))
  );
}

/**
 * Reads stored settings, filling what earlier versions did not save. Those
 * signed in with a link instead of a password, so they start without LAN
 * access and with the default sign-in length.
 */
export function readWebServerSettings(
  value: unknown,
): WebServerSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const settings = { ...DEFAULT_WEB_SERVER_SETTINGS, ...value };
  return isWebServerSettings(settings)
    ? {
        enabled: settings.enabled,
        port: settings.port,
        lan: settings.lan,
        rememberFor: settings.rememberFor,
        requirePassword: settings.requirePassword,
        ...(settings.publicOrigin
          ? { publicOrigin: settings.publicOrigin }
          : {}),
      }
    : undefined;
}

/**
 * JSON cannot carry bytes, so the HTTP transport tags each Uint8Array
 * explicitly. Both directions use this codec; no channel decodes by hand.
 */
const BYTES_TAG = "$pineBytes";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeWebJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array ? { [BYTES_TAG]: bytesToBase64(item) } : item,
  );
}

export function decodeWebJson(text: string): unknown {
  return JSON.parse(text, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    return keys.length === 1 &&
      keys[0] === BYTES_TAG &&
      typeof record[BYTES_TAG] === "string"
      ? base64ToBytes(record[BYTES_TAG])
      : item;
  });
}
