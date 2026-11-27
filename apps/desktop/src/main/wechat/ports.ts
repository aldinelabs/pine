// What the WeChat bridge needs from Pine's core and from the host it runs
// in (desktop app or headless server). Kept free of Electron so the server
// build can include the bridge.
import type { DisplayCurrency } from "../../shared/currency";
import type {
  PineApprovalMode,
  PineAgentEvent,
  PromptSessionResult,
} from "../../shared/agent";
import type { PineAttachment } from "../../shared/attachments";
import type { PineMcpCatalog } from "../../shared/mcp";
import type { PineLibraryChange, PineProject } from "../../shared/projects";
import type { ListSkillsResult } from "../../shared/skills";
import type {
  WeChatNotification,
  WeChatSettingsPatch,
  WeChatStatus,
} from "../../shared/wechatRemote";
import type { AutomationService } from "../automation/service";
import type { ProjectRuntimeRegistry } from "../projectRuntime";
import type {
  ProjectDataPaths,
  ProjectRepository,
} from "../projects/projectRepository";
import type { ProjectSessionService } from "../sessions";
import type { TinyFishSafeStorage } from "../tinyfishCredentials";
import type { ChannelFactory } from "./channel";
import type { PendingAttachment, StoredMedia, WeChatStateStore } from "./types";

export interface StartBackgroundSessionInput {
  ownerId: number;
  project: PineProject;
  message: string;
  approvalMode: PineApprovalMode;
  locale: "en-US" | "zh-CN";
}

/**
 * Pine's Assistant, as the bridge reaches it (main/core/assistant.ts). The
 * bridge only hands it the user's text; it never reads the model's output
 * as anything but text to send back.
 */
export interface WeChatAssistantPort {
  /**
   * Sends plain text to the Assistant's one conversation as the user, from
   * WeChat. Sessions it dispatches in this turn run within `ceiling`. Resolves
   * once the message is accepted, not when the turn ends.
   */
  send(input: {
    message: string;
    locale: "en-US" | "zh-CN";
    ceiling: PineApprovalMode;
    /** It is mid-turn: the text steers the running turn. */
    steer: boolean;
    /** Files the user sent from WeChat, already in the Assistant's storage. */
    attachments?: PineAttachment[];
  }): Promise<{ sessionId: string; projectId: string }>;
  /** Its conversation, once it has one. */
  sessionId(): Promise<string | undefined>;
}

/** The parts of the core the bridge calls directly, bypassing the request router. */
export interface WeChatCorePorts {
  runtimes: ProjectRuntimeRegistry;
  repository: ProjectRepository;
  automations: AutomationService;
  notifyLibraryChanged(
    change: PineLibraryChange,
    sourceClientId?: number,
  ): void;
  rememberAttachments(clientId: number, paths: readonly string[]): void;
  startBackgroundSession(
    input: StartBackgroundSessionInput,
  ): Promise<PromptSessionResult>;
  sessionLibrary(): {
    dataPaths(projectId: string): ProjectDataPaths;
    openSessionService(projectId: string): ProjectSessionService | undefined;
  };
  listSkills(projectId: string): Promise<ListSkillsResult>;
  listMcpServers(projectId: string): Promise<PineMcpCatalog>;
  /** Absent where Pine has no Assistant: plain text then always goes to the current session. */
  assistant?: WeChatAssistantPort;
}

/** A voice message's recording, for transcription on this computer. */
export interface WeChatVoiceClip {
  data: Buffer;
  /** 1 pcm, 2 adpcm, 3 feature, 4 speex, 5 amr, 6 silk, 7 mp3, 8 ogg-speex. */
  encodeType?: number;
  sampleRate?: number;
  playtimeMs?: number;
}

export interface WeChatHostPorts {
  version: string;
  computerName: string;
  locale?: () => "en-US" | "zh-CN";
  /** The currency costs are shown in, per Pine's preferences; USD without it. */
  currency?: () => DisplayCurrency;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Encrypts the sealed blob: the system keychain on the desktop, a 0600 file on the server. */
  credentialStorage: TinyFishSafeStorage;
  dataDirectory: string;
  agentDirectory: string;
  /** A local user can see and answer automation approvals on this host (false on the headless server). */
  localAutomationApprovals: boolean;
  changed(status: WeChatStatus): void;
  notify(notification: WeChatNotification): void;
  /**
   * Transcribes a voice message that came without the server's transcript,
   * on this computer; undefined when nothing was said. Missing where it
   * cannot run (not macOS 26+, the headless server): such messages get
   * `E-VOICE`.
   */
  transcribeVoice?: (
    clip: WeChatVoiceClip,
    signal?: AbortSignal,
  ) => Promise<{ text: string } | undefined>;
}

/** Media received from WeChat, staged until a prompt uses it. Implemented by attachments.ts. */
export interface InboundAttachmentsApi {
  stage(
    media: StoredMedia,
    download: (
      ref: string,
      maxBytes: number,
      signal?: AbortSignal,
    ) => Promise<Buffer>,
  ): Promise<PendingAttachment>;
  list(): readonly PendingAttachment[];
  /** Moves the staged files into the project's attachments root and empties the list. */
  take(attachmentsRoot: string): Promise<PineAttachment[]>;
  drop(): Promise<number>;
  sweep(nowMs: number): Promise<void>;
}

export interface WeChatBridgeOptions {
  core: WeChatCorePorts;
  host: WeChatHostPorts;
  /** Default: the ClawBot factory. */
  channels?: ChannelFactory;
  /** Default: WeChatStore on host paths. */
  store?: WeChatStateStore;
  now?: () => number;
  /** 6 digits; default from node:crypto randomInt. */
  randomCode?: () => string;
}

export interface WeChatBridgeApi {
  /** Loads the store and connects when bound; never throws for "not bound". */
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
  status(): WeChatStatus;
  /** Bound and not paused. */
  isListening(): boolean;
  setPaused(paused: boolean): Promise<WeChatStatus>;
  setSettings(patch: WeChatSettingsPatch): Promise<WeChatStatus>;
  startBinding(): Promise<WeChatStatus>;
  cancelBinding(): WeChatStatus;
  submitVerifyCode(code: string): WeChatStatus;
  submitPairingCode(code: string): Promise<WeChatStatus>;
  unbind(): Promise<WeChatStatus>;
  /** Re-reads paused and settings from disk and re-clamps (headless SIGHUP). */
  reloadLocalConfig(): Promise<WeChatStatus>;
  /** Wake after system resume. */
  wake(): void;
  /** Synchronous; never throws. */
  observeAgentEvent(event: PineAgentEvent, ownerId: number | undefined): void;
  sessionSpawned(
    parentSessionId: string,
    childSessionId: string,
    projectId: string,
  ): void;
  sessionMoved(
    sessionId: string,
    fromProjectId: string,
    projectId: string,
  ): void;
  /** A WeChat-driven session handed work to a relative. Never throws. */
  sessionRelayed(
    fromSessionId: string,
    toSessionId: string,
    projectId: string,
  ): Promise<void>;
  automationsChanged(): void;
  /** Sidebar marker. */
  originOf(sessionId: string): "wechat" | "wechat-used" | undefined;
  /**
   * A message for the agent when a WeChat-driven session may not start this
   * automation; undefined = allowed or not WeChat-driven. Notifies locally
   * when it allows a WeChat-driven one.
   */
  automationRunRefusal(
    sessionId: string | undefined,
    automation: { id: string; name: string; enabled: boolean },
  ): string | undefined;
}
