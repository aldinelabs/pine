/**
 * Live Context: a meeting or class transcribed on device, bound to one
 * session, so the conversation can draw on what is being said. Desktop only
 * (macOS 26+) with the helper built in. See docs/live-context.md.
 */

import type { PineApprovalMode } from "./agent";
import type { PineSessionSummary } from "./sessions";

export const LIVE_CONTEXT_STATUS_CHANNEL = "live-context:status" as const;
export const LIVE_CONTEXT_START_CHANNEL = "live-context:start" as const;
export const LIVE_CONTEXT_PAUSE_CHANNEL = "live-context:pause" as const;
export const LIVE_CONTEXT_RESUME_CHANNEL = "live-context:resume" as const;
export const LIVE_CONTEXT_STOP_CHANNEL = "live-context:stop" as const;
export const LIVE_CONTEXT_TRANSCRIPT_CHANNEL =
  "live-context:transcript" as const;
export const LIVE_CONTEXT_EVENT_CHANNEL = "live-context:event" as const;
export const LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL =
  "live-context:rename-speaker" as const;
export const LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL =
  "live-context:merge-speakers" as const;
export const LIVE_CONTEXT_CREATE_SESSION_CHANNEL =
  "live-context:create-session" as const;
export const LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL =
  "live-context:open-privacy-settings" as const;

/** Desktop IPC only; never on the shared router, so browsers and phones cannot listen. */
export const LIVE_CONTEXT_REQUEST_CHANNELS = [
  LIVE_CONTEXT_STATUS_CHANNEL,
  LIVE_CONTEXT_START_CHANNEL,
  LIVE_CONTEXT_PAUSE_CHANNEL,
  LIVE_CONTEXT_RESUME_CHANNEL,
  LIVE_CONTEXT_STOP_CHANNEL,
  LIVE_CONTEXT_TRANSCRIPT_CHANNEL,
  LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL,
  LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL,
  LIVE_CONTEXT_CREATE_SESSION_CHANNEL,
  LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL,
] as const;

/**
 * Where speech comes from. Without speaker labels the channel stands in for
 * the speaker (mic = me, system = others); with them, each source has its
 * own numbered speakers.
 */
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
  | "helper-missing";

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
  /** What is downloading: the speech model or the speaker models. */
  download?: "speech" | "speakers";
  /** This build can label speakers (the library ships with it). */
  speakersAvailable?: boolean;
  /** The current capture labels speakers. */
  speakers?: boolean;
  /**
   * Speaker labels are scaled back to keep the Mac cool or fast: "reduced"
   * labels less often, "paused" not at all (transcription goes on).
   */
  speakersDegraded?: "reduced" | "paused";
  /** The system source has heard nothing for a while: access may be off. */
  systemSilent?: boolean;
  lastError?: LiveContextError;
}

/**
 * A speaker within one source, `<source>-<n>` ("mic-1", "system-2"). Mic
 * and system speakers are separate unless the user merges them.
 */
export type LiveContextSpeakerKey = `${LiveContextSource}-${number}`;

/**
 * From `offset` (UTF-16, into the segment's text) on, this speaker talks.
 * Without `speaker` the voice is not known yet ("?").
 */
export interface LiveContextTurn {
  offset: number;
  speaker?: LiveContextSpeakerKey;
  /** A best guess that may still change. */
  provisional?: boolean;
  /** Someone else talks at the same time. */
  overlap?: LiveContextSpeakerKey;
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
  /**
   * Who said which part, when speakers are labeled; the first turn starts
   * at 0. Labels arrive a moment after the text and may still change.
   */
  turns?: LiveContextTurn[];
  /** Mic text that is mostly the loudspeaker (the other side, again). */
  echo?: boolean;
}

/** The user's names for speakers and the speakers they merged. */
export interface LiveContextSpeakers {
  names: Partial<Record<LiveContextSpeakerKey, string>>;
  /** Each merged speaker and the one it became. */
  merges: Partial<Record<LiveContextSpeakerKey, LiveContextSpeakerKey>>;
  /**
   * Speakers Pine found to be one voice after labeling them apart; old
   * labels resolve through this before the user's merges.
   */
  aliases?: Partial<Record<LiveContextSpeakerKey, LiveContextSpeakerKey>>;
}

export interface LiveContextTranscript {
  /** Final segments, oldest first, with their latest labels. */
  segments: LiveContextSegment[];
  speakers: LiveContextSpeakers;
}

export interface LiveContextTarget {
  projectId: string;
  sessionId: string;
}

export interface LiveContextStartRequest extends LiveContextTarget {
  sources: LiveContextSource[];
  locale: string;
  /** Label speakers within each source (downloads the models once). */
  speakers?: boolean;
  /** "About N people", if the user knows. */
  expectedSpeakers?: number;
}

export interface LiveContextRenameSpeakerRequest extends LiveContextTarget {
  speaker: LiveContextSpeakerKey;
  /** Empty restores the default name. */
  name: string;
}

export interface LiveContextMergeSpeakersRequest extends LiveContextTarget {
  /** This speaker's segments become `into`'s. */
  from: LiveContextSpeakerKey;
  into: LiveContextSpeakerKey;
}

/** One source's input level, 0…1, over the last ~40 ms. */
export interface LiveContextLevel {
  rms: number;
  peak: number;
}

export type LiveContextLevels = Partial<
  Record<LiveContextSource, LiveContextLevel>
>;

export type LiveContextEvent =
  | { kind: "status"; status: LiveContextStatus }
  /** Input levels while listening, about 25 a second; never saved. */
  | { kind: "levels"; levels: LiveContextLevels }
  | { kind: "segment"; sessionId: string; segment: LiveContextSegment }
  /** New or changed labels for a segment (volatile or final). */
  | {
      kind: "turns";
      sessionId: string;
      segmentId: string;
      turns: LiveContextTurn[];
      echo?: boolean;
    }
  | { kind: "speakers"; sessionId: string; speakers: LiveContextSpeakers };

export interface PineLiveContextApi {
  status(): Promise<LiveContextStatus>;
  start(request: LiveContextStartRequest): Promise<LiveContextStatus>;
  pause(): Promise<LiveContextStatus>;
  resume(): Promise<LiveContextStatus>;
  stop(): Promise<LiveContextStatus>;
  /** The session's final segments, oldest first, and its speakers. */
  transcript(target: LiveContextTarget): Promise<LiveContextTranscript>;
  renameSpeaker(
    request: LiveContextRenameSpeakerRequest,
  ): Promise<LiveContextSpeakers>;
  mergeSpeakers(
    request: LiveContextMergeSpeakersRequest,
  ): Promise<LiveContextSpeakers>;
  subscribe(listener: (event: LiveContextEvent) => void): () => void;
  /**
   * Opens the System Settings privacy pane that lets Pine hear this source:
   * Microphone, or Screen & System Audio Recording.
   */
  openPrivacySettings(source: LiveContextSource): Promise<void>;
  /**
   * Starts an empty session in the project to capture into, as a first
   * message would, saved and kept although no one has written in it. It
   * takes the approval mode the draft picked; the model is the default a
   * draft's model picker sets, as for a first message.
   */
  createSession(request: {
    projectId: string;
    approvalMode?: PineApprovalMode;
  }): Promise<PineSessionSummary>;
}

export const IDLE_LIVE_CONTEXT_STATUS: LiveContextStatus = {
  available: false,
  unavailableReason: "platform",
  state: "idle",
  sources: [],
};
