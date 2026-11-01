import type { PineSessionEvent } from "./agent";

export const GET_WEB_SERVER_CHANNEL = "web-control:get";
export const SET_WEB_SERVER_CHANNEL = "web-control:set";
export const DEFAULT_WEB_PORT = 9415;
/** One persistent subscriber for the local browser interface. */
export const WEB_CLIENT_ID = -1;
export const WEB_SNAPSHOT_CHANNEL = "web-control:snapshot";

export interface WebServerSettings {
  enabled: boolean;
  port: number;
}

export interface WebServerStatus extends WebServerSettings {
  url?: string;
  error?: string;
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
    settings.port <= 65535
  );
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
