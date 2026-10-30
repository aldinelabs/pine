export const GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:get-context-compaction-strategy" as const;
export const SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:set-context-compaction-strategy" as const;
export const GET_CONTEXT_COMPACTION_ROUTE_CHANNEL =
  "preferences:get-context-compaction-route" as const;
export const SET_CONTEXT_COMPACTION_ROUTE_CHANNEL =
  "preferences:set-context-compaction-route" as const;
export const GET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:get-diagnostic-logging" as const;
export const SET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:set-diagnostic-logging" as const;
export const GET_COMPLETION_SIGNAL_CHANNEL =
  "preferences:get-completion-signal" as const;
export const SET_COMPLETION_SIGNAL_CHANNEL =
  "preferences:set-completion-signal" as const;
/** Main → renderer: a run finished and the completion sound should play. */
export const COMPLETION_SOUND_EVENT_CHANNEL =
  "preferences:completion-sound" as const;
export const GET_AUTO_APPROVAL_SETTINGS_CHANNEL =
  "preferences:get-auto-approval-settings" as const;
export const SET_AUTO_APPROVAL_SETTINGS_CHANNEL =
  "preferences:set-auto-approval-settings" as const;

export interface PineAutoApprovalSettings {
  strategy: "model" | "decisions";
  decisionsModel: string;
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: PineAutoApprovalSettings = {
  strategy: "model",
  decisionsModel: "typesafe/jev-1.13",
};

export function isPineAutoApprovalSettings(
  value: unknown,
): value is PineAutoApprovalSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return (
    (settings.strategy === "model" || settings.strategy === "decisions") &&
    typeof settings.decisionsModel === "string" &&
    settings.decisionsModel.trim().length > 0 &&
    settings.decisionsModel.length <= 256
  );
}

export interface SetDiagnosticLoggingRequest {
  enabled: boolean;
}

export interface SetDiagnosticLoggingResult {
  enabled: boolean;
}

export interface SetCompletionSignalRequest {
  mode: PineCompletionSignalMode;
}

export interface SetCompletionSignalResult {
  mode: PineCompletionSignalMode;
}

/** How Pine signals finished work while the user is elsewhere. */
export const PINE_COMPLETION_SIGNAL_MODES = [
  "off",
  "notification",
  "notification-sound",
] as const;

export type PineCompletionSignalMode =
  (typeof PINE_COMPLETION_SIGNAL_MODES)[number];

export function isPineCompletionSignalMode(
  value: unknown,
): value is PineCompletionSignalMode {
  return (PINE_COMPLETION_SIGNAL_MODES as readonly unknown[]).includes(value);
}

/** Notify without a sound unless the user chose otherwise. */
export const DEFAULT_COMPLETION_SIGNAL_MODE: PineCompletionSignalMode =
  "notification";

export type PineContextCompactionStrategy = "passive" | "recommended";

export const DEFAULT_CONTEXT_COMPACTION_STRATEGY =
  "recommended" satisfies PineContextCompactionStrategy;

export function isPineContextCompactionStrategy(
  value: unknown,
): value is PineContextCompactionStrategy {
  return value === "passive" || value === "recommended";
}

export interface SetContextCompactionStrategyRequest {
  strategy: PineContextCompactionStrategy;
}

export interface SetContextCompactionStrategyResult {
  updated: boolean;
}

/** How compaction summaries are produced: an LLM call or pi-vcc's extraction. */
export type PineContextCompactionRoute = "model" | "semantic";

export const DEFAULT_CONTEXT_COMPACTION_ROUTE =
  "model" satisfies PineContextCompactionRoute;

export function isPineContextCompactionRoute(
  value: unknown,
): value is PineContextCompactionRoute {
  return value === "model" || value === "semantic";
}

export interface SetContextCompactionRouteRequest {
  route: PineContextCompactionRoute;
}

export interface SetContextCompactionRouteResult {
  updated: boolean;
}
