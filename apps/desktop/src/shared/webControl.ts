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
