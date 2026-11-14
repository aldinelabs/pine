export const GET_PI_PROVIDERS_CHANNEL = "settings:pi-providers" as const;
export const SET_PI_PROVIDERS_CHANNEL = "settings:set-pi-providers" as const;
/** Desktop only: shows Pi's models.json (or its folder) in the file manager. */
export const REVEAL_PI_PROVIDERS_CHANNEL =
  "settings:reveal-pi-providers" as const;
/** Desktop only: lets the user pick a different Pi agent folder. */
export const PICK_PI_AGENT_DIR_CHANNEL = "settings:pick-pi-agent-dir" as const;

/** Pine registers each provider from Pi's models.json under this prefix. */
export const PI_PROVIDER_ID_PREFIX = "pi-";

/** Why a provider from Pi's models.json was left out. Never carries secrets. */
export type PiProviderSkipReason =
  | "command-value"
  | "no-models"
  | "missing-base-url"
  | "missing-api"
  | "conflict"
  | "invalid";

export interface PiProviderSkip {
  /** The provider key in Pi's models.json. */
  key: string;
  reason: PiProviderSkipReason;
}

export type PiProvidersFileError = "too-large" | "invalid-json" | "unreadable";

/** Where the agent folder came from: Pine's setting, the environment or Pi's default. */
export type PiAgentDirSource = "setting" | "environment" | "default";

export interface PiProvidersStatus {
  enabled: boolean;
  /** Pi's agent folder that Pine reads. */
  agentDir: string;
  agentDirSource: PiAgentDirSource;
  /** Full path of the models.json Pine reads. */
  path: string;
  /** Whether models.json exists. */
  found: boolean;
  /** Providers Pine registered from it. */
  count: number;
  skipped: readonly PiProviderSkip[];
  error?: PiProvidersFileError;
}

export interface SetPiProvidersRequest {
  enabled: boolean;
  /** An absolute folder, or null to go back to the environment or Pi's default. */
  agentDir?: string | null;
}

/** The saved Pine setting; absent means off. */
export interface PiProvidersSetting {
  enabled: boolean;
  agentDir?: string;
}

export interface PickPiAgentDirResult {
  status?: PiProvidersStatus;
}

/** Desktop only: the browser never reads or changes the host's Pi config. */
export interface PinePiProvidersApi {
  getPiProviders?: () => Promise<PiProvidersStatus>;
  setPiProviders?: (
    request: SetPiProvidersRequest,
  ) => Promise<PiProvidersStatus>;
  /** Shows models.json, or Pi's agent folder when the file is missing. */
  revealPiProviders?: () => Promise<{ revealed: boolean }>;
  pickPiAgentDir?: () => Promise<PickPiAgentDirResult>;
}

/** Every channel above; none of them is exposed to the browser. */
export const PI_PROVIDERS_REQUEST_CHANNELS = [
  GET_PI_PROVIDERS_CHANNEL,
  SET_PI_PROVIDERS_CHANNEL,
  REVEAL_PI_PROVIDERS_CHANNEL,
  PICK_PI_AGENT_DIR_CHANNEL,
] as const;
