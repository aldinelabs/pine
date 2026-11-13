import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import type {
  PineApprovalMode,
  PineApprovalTrigger,
  PineJsonValue,
} from "../../shared/agent";
import type {
  PineApprovalExplanation,
  PineApprovalReasonCode,
} from "../../shared/sessions";
import type { WeChatSettings } from "../../shared/wechatRemote";

export type ReplyLanguage = "zh" | "en";

/** Every dot command, in the order `.help` lists them. */
export const COMMAND_NAMES = [
  "help",
  "status",
  "info",
  "lang",
  "pause",
  "more",
  "drop",
  "new",
  "sessions",
  "search",
  "use",
  "last",
  "history",
  "stop",
  "queue",
  "unqueue",
  "rename",
  "delete",
  "model",
  "effort",
  "mode",
  "usage",
  "compact",
  "todo",
  "pending",
  "show",
  "approve",
  "reject",
  "guide",
  "answer",
  "files",
  "file",
  "tasks",
  "task",
  "kill",
  "projects",
  "autos",
  "auto",
  "runs",
  "skills",
  "mcp",
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

/** R read, R+ read with side effects on the bridge only, M- light change, M change, D destructive. */
export type CommandClass = "R" | "R+" | "M-" | "M" | "D";
/** What happens to the command when its message arrives too late. */
export type StaleClass = "run" | "guard" | "hold" | "drop";

export interface CommandSpec {
  name: CommandName;
  /** ASCII, first = recommended short form. */
  aliases: readonly string[];
  zhAliases: readonly string[];
  /** Names of positional parameters. */
  positional: readonly string[];
  tail: boolean;
  /** `.u3`: digits may be glued to the name. True only when the first parameter is a handle or an ask number. */
  glued: boolean;
  /** Accepts `@project` first. */
  project: boolean;
  cls: CommandClass;
  stale: StaleClass;
  needsCurrent: boolean;
  viewOnlyOk: boolean;
  /** Runs on the priority lane, ahead of the serial worker. */
  priority: boolean;
  /** Usage text, e.g. "[@project] [text]". */
  params: string;
  summary: { zh: string; en: string };
  example: string;
}

export interface ParsedCommand {
  kind: "command";
  name: CommandName;
  project?: string;
  args: string[];
  tail?: string;
}
export type Parsed =
  | { kind: "message"; text: string }
  | { kind: "unknown"; token: string; suggestion?: string }
  | { kind: "number"; numbers: number[] }
  | { kind: "invalid"; name: CommandName; reason: "args" }
  | ParsedCommand;

export type HandleKind =
  | "session"
  | "project"
  | "model"
  | "effort"
  | "mode"
  | "file"
  | "task"
  | "queue"
  | "automation"
  | "run";
export interface HandleRow {
  id: string;
  label: string;
  projectId?: string;
}
export interface HandleTable {
  rows: HandleRow[];
  sentAtMs: number;
  sessionId?: string;
}

export interface AskBase {
  number: number;
  createdAtMs: number;
  deliveredAtMs?: number;
}
export interface ApprovalAsk extends AskBase {
  kind: "approval";
  requestId: string;
  actionDigest?: string;
  sessionId: string;
  projectId: string;
  trigger: PineApprovalTrigger;
  toolName: string;
  input?: PineJsonValue;
  evidence?: string;
  /** Pine's fixed note on why the call reached the user; `.show` localizes it. */
  reasonCode?: PineApprovalReasonCode;
  reasonDetail?: string;
  /** Reviewer-written account; may arrive after the ask opened. */
  explanation?: PineApprovalExplanation;
  /** The card showed a cut subject; `.show` must be delivered before `.approve`. */
  subjectCut: boolean;
  shownAtMs?: number;
  /** The session had read external content when the request was raised. */
  external: boolean;
}
export interface QuestionAsk extends AskBase {
  kind: "question";
  requestId: string;
  sessionId: string;
  projectId: string;
  questionnaire: AskUserQuestionParams;
  answerable: boolean;
}
export interface ConfirmAsk extends AskBase {
  kind: "confirm";
  command: ParsedCommand;
  resolved: Record<string, string>;
  expiresAtMs: number;
}
/** Messages kept back because they arrived too late, until the user confirms them. */
export interface HeldAsk extends AskBase {
  kind: "held";
  reason: "stale";
  items: StoredInbound[];
  expiresAtMs: number;
}
export type Ask = ApprovalAsk | QuestionAsk | ConfirmAsk | HeldAsk;

export interface TrackedSession {
  sessionId: string;
  projectId: string;
  origin: "wechat" | "adopted" | "spawned";
  trackedAtMs: number;
  lastUsedAtMs: number;
}
export interface SessionOrigin {
  sessionId: string;
  projectId: string;
  kind: "started" | "used" | "spawned";
  atMs: number;
  touchedLocally?: boolean;
}
/** Serialisable reference to inbound media. Secret (CDN parameters, AES key): 0600 state file only, never logged. */
export interface StoredMedia {
  kind: "image" | "file" | "video";
  fileName?: string;
  sizeBytes?: number;
  ref: string;
}
export interface StoredInbound {
  id: string;
  createdAtMs: number;
  pollStartedAtMs: number;
  text?: string;
  voice?: boolean;
  quotedText?: string;
  media: StoredMedia[];
  /** Set in the same write that takes the entry off the queue. */
  startedAtMs?: number;
}
export interface PendingAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  kind: "image" | "file" | "video";
  stagedPath: string;
  receivedAtMs: number;
}
export type DigestItem =
  | { kind: "done"; title: string }
  | { kind: "failed"; title: string }
  | { kind: "ask"; number: number }
  | { kind: "autorun"; name: string; result: string }
  | {
      kind: "auto-on";
      name: string;
      result: "approved" | "denied" | "timeout";
    };
export interface QueuedOutbound {
  key: string;
  priority: 1 | 2 | 3 | 4;
  digest: DigestItem;
  queuedAtMs: number;
}

/** wechat-remote.json: nothing here widens what WeChat may do. */
export interface WeChatPersistedState {
  version: 1;
  language: ReplyLanguage | "auto";
  cursor: string;
  contextToken?: {
    value: string;
    receivedAtMs: number;
    sent: number;
    budgetNoticeSent: boolean;
  };
  /** At most SEEN_MAX, newest last. */
  seenMessageIds: string[];
  /** Accepted, not yet handled; at most INBOX_MAX. */
  inbox: StoredInbound[];
  /** At most PENDING_ATTACHMENTS_MAX. */
  pendingAttachments: PendingAttachment[];
  currentProjectId?: string;
  current?: { projectId: string; sessionId: string; usedAtMs: number };
  /** At most TRACKED_MAX. */
  tracked: TrackedSession[];
  /** At most ORIGINS_MAX. */
  origins: SessionOrigin[];
  lastPush?: { sessionId: string; projectId: string; atMs: number };
  lastAcceptedAtMs?: number;
  handles: Partial<Record<"session" | "project", HandleTable>>;
  nextAsk: number;
  /** Per-session mode chosen with `.mode`; clamped to the ceiling at every use. */
  modeOverride: Record<string, PineApprovalMode>;
  /** At most OUT_QUEUE_MAX. */
  outQueue: QueuedOutbound[];
  lastPausedNoticeAtMs?: number;
}

/** The sealed blob, written through the host's credential storage. */
export interface WeChatSecureState {
  version: 1;
  token?: string;
  owner?: { userId: string; botId: string; baseUrl: string; boundAt: number };
  settings: WeChatSettings;
  paused: boolean;
}

/** Implemented by store.ts; tests use the in-memory fake from __tests__/fakes.ts. */
export interface WeChatStateStore {
  /** Returns "reset" when the sealed blob could not be read and defaults (paused) were substituted. */
  load(): Promise<"ok" | "reset">;
  get(): Readonly<WeChatPersistedState>;
  /** Applies and writes before resolving; serialised. */
  update(mutate: (draft: WeChatPersistedState) => void): Promise<void>;
  /** Applies now, writes debounced (cursor, dedupe, counters). */
  updateSoon(mutate: (draft: WeChatPersistedState) => void): void;
  flush(): Promise<void>;
  canEncrypt(): boolean;
  secure(): Readonly<WeChatSecureState>;
  /** Re-reads the blob from disk, applies, writes. Serialised. */
  updateSecure(mutate: (draft: WeChatSecureState) => void): Promise<void>;
  /** Re-reads the blob from disk (SIGHUP on the headless server). */
  reloadSecure(): Promise<"ok" | "reset">;
  /** Re-reads only `language` from the plain file (`pine-server wechat config --language`, then SIGHUP). */
  reloadLanguage(): Promise<void>;
  /** Removes token and owner, resets the permission settings, and resets the plain state except language. */
  clearBinding(): Promise<void>;
}
