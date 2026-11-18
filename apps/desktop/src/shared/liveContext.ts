/**
 * Live Context: a meeting or class transcribed on device, bound to one
 * session, so the conversation can draw on what is being said. Desktop only
 * (macOS 26+), and while experimental only with PINE_EXPERIMENTAL_LIVE_CONTEXT=1.
 * See docs/live-context.md.
 */

export const LIVE_CONTEXT_STATUS_CHANNEL = "live-context:status" as const;
export const LIVE_CONTEXT_START_CHANNEL = "live-context:start" as const;
export const LIVE_CONTEXT_PAUSE_CHANNEL = "live-context:pause" as const;
export const LIVE_CONTEXT_RESUME_CHANNEL = "live-context:resume" as const;
export const LIVE_CONTEXT_STOP_CHANNEL = "live-context:stop" as const;
export const LIVE_CONTEXT_TRANSCRIPT_CHANNEL =
  "live-context:transcript" as const;
export const LIVE_CONTEXT_EVENT_CHANNEL = "live-context:event" as const;

/** Desktop IPC only; never on the shared router, so browsers and phones cannot listen. */
export const LIVE_CONTEXT_REQUEST_CHANNELS = [
  LIVE_CONTEXT_STATUS_CHANNEL,
  LIVE_CONTEXT_START_CHANNEL,
  LIVE_CONTEXT_PAUSE_CHANNEL,
  LIVE_CONTEXT_RESUME_CHANNEL,
  LIVE_CONTEXT_STOP_CHANNEL,
  LIVE_CONTEXT_TRANSCRIPT_CHANNEL,
] as const;

/** Where speech comes from; the channel stands in for the speaker in v1. */
export const LIVE_CONTEXT_SOURCES = ["mic", "system"] as const;
export type LiveContextSource = (typeof LIVE_CONTEXT_SOURCES)[number];

/** Locales offered first; the helper accepts any it supports. */
export const LIVE_CONTEXT_LOCALES = [
  "zh-CN",
  "en-US",
  "zh-TW",
  "yue-CN",
  "ja-JP",
  "ko-KR",
  "fr-FR",
  "de-DE",
  "es-ES",
] as const;

export type LiveContextUnavailableReason =
  /** Not macOS 26 or later. */
  | "platform"
  /** This build has no helper (built without the macOS 26 SDK). */
  | "helper-missing"
  /** The experimental flag is off. */
  | "disabled";

export type LiveContextState =
  | "idle"
  | "preparing"
  /** Fetching the on-device speech model for the locale. */
  | "downloading"
  | "listening"
  | "paused"
  | "stopping";

export interface LiveContextError {
  code: string;
  message: string;
  source?: LiveContextSource;
}

export interface LiveContextStatus {
  available: boolean;
  unavailableReason?: LiveContextUnavailableReason;
  state: LiveContextState;
  /** The one capture app-wide, when there is one. */
  projectId?: string;
  sessionId?: string;
  sources: LiveContextSource[];
  locale?: string;
  /** Unix ms when listening began. */
  startedAt?: number;
  /** 0–1 while downloading. */
  downloadProgress?: number;
  /** The system source has heard nothing for a while: access may be off. */
  systemSilent?: boolean;
  lastError?: LiveContextError;
}

/** A stretch of speech. Volatile ones (`final: false`) may still change. */
export interface LiveContextSegment {
  /** Stable across a segment's volatile updates and its final version. */
  id: string;
  source: LiveContextSource;
  /** Unix ms. */
  start: number;
  end: number;
  text: string;
  final: boolean;
}

export interface LiveContextTarget {
  projectId: string;
  sessionId: string;
}

export interface LiveContextStartRequest extends LiveContextTarget {
  sources: LiveContextSource[];
  locale: string;
}

export type LiveContextEvent =
  | { kind: "status"; status: LiveContextStatus }
  | { kind: "segment"; sessionId: string; segment: LiveContextSegment };

export interface PineLiveContextApi {
  status(): Promise<LiveContextStatus>;
  start(request: LiveContextStartRequest): Promise<LiveContextStatus>;
  pause(): Promise<LiveContextStatus>;
  resume(): Promise<LiveContextStatus>;
  stop(): Promise<LiveContextStatus>;
  /** The session's final segments, oldest first. */
  transcript(target: LiveContextTarget): Promise<LiveContextSegment[]>;
  subscribe(listener: (event: LiveContextEvent) => void): () => void;
}

export const IDLE_LIVE_CONTEXT_STATUS: LiveContextStatus = {
  available: false,
  unavailableReason: "platform",
  state: "idle",
  sources: [],
};
