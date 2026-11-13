// What the WeChat bridge knows about Pine's sessions, and the only two ways a
// prompt leaves the bridge.
//
// `observe` sees the events of every session that passes the core hook. It
// caches run state, open asks and a few per-session facts for all of them,
// but pushes cards and results only for tracked sessions. Results are pushed
// only for a run whose latest prompt this bridge sent.

import { realpath } from "node:fs/promises";
import path from "node:path";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import {
  APPROVAL_MODE_ORDER,
  approvalModeWithin,
  type PineAgentEvent,
  type PineApprovalMode,
  type PineJsonValue,
  type PromptSessionResult,
} from "../../shared/agent";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
} from "../../shared/attachments";
import { MCP_AUTHORING_DYNAMIC_TOOL_NAMES } from "../../shared/mcp";
import { isTemporaryWorkspace, type PineProject } from "../../shared/projects";
import type { PineContextUsage } from "../../shared/sessions";
import { isVirtualClient } from "../../shared/webControl";
import {
  WECHAT_CLIENT_ID,
  type WeChatNotificationKind,
  type WeChatSettings,
} from "../../shared/wechatRemote";
import { CompletionSignalTracker } from "../completionSignal";
import type { AskBook } from "./asks";
import {
  approvalCardPolicy,
  approvalCardText,
  EXTERNAL_CONTENT_TOOLS,
  type CardVerdict,
} from "./cardPolicy";
import {
  CURRENT_IDLE_ACK_MS,
  HOLD_IDLE_MS,
  OBSERVED_SESSIONS_MAX,
  ORIGINS_MAX,
  PROGRESS_AFTER_MS,
  TRACK_IDLE_MS,
  TRACKED_MAX,
} from "./constants";
import { notice, type NoticeData } from "./notices";
import type { Outbound } from "./outbound";
import type {
  InboundAttachmentsApi,
  WeChatCorePorts,
  WeChatHostPorts,
} from "./ports";
import {
  questionCardAnswerable,
  render,
  type ReplyData,
  type SessionRef,
} from "./replies";
import { quoteBlock } from "./text";
import type {
  ApprovalAsk,
  Ask,
  QuestionAsk,
  ReplyLanguage,
  SessionOrigin,
  TrackedSession,
  WeChatStateStore,
} from "./types";

const W = WECHAT_CLIENT_ID;

/** `shared/attachments.ts` keeps its marker private; any version counts. */
const ATTACHMENT_BLOCK_MARKER = /^\s*<pine_attachments\b/;

/** Automation approvals expire after this (`APPROVAL_TIMEOUT_MS` of the automation service). */
const AUTOMATION_APPROVAL_TIMEOUT_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Refusals

/** The errors the two prompt exits (and handlers) raise for the user to read. */
export type WeChatRefusalId =
  "E-TEXT" | "E-VIEW" | "E-VIEWRUN" | "E-BUSY" | "E-GONE" | "E-QUOTE";

type RefusalArgs<K extends WeChatRefusalId> = ReplyData[K] extends undefined
  ? []
  : [data: ReplyData[K]];

/** A refusal with its reply template; the pipeline renders it in the reply language. */
export class WeChatRefusal extends Error {
  readonly id: WeChatRefusalId;
  readonly data: Record<string, unknown>;

  constructor(id: WeChatRefusalId, data: Record<string, unknown> = {}) {
    super(`WeChat refusal ${id}`);
    this.name = "WeChatRefusal";
    this.id = id;
    this.data = data;
  }

  /** The reply text of this refusal. */
  render(lang: ReplyLanguage): string {
    return (
      render as (
        id: WeChatRefusalId,
        lang: ReplyLanguage,
        data: unknown,
      ) => string
    )(this.id, lang, this.data);
  }
}

/** Builds a refusal whose data matches its template. */
export function refuse<K extends WeChatRefusalId>(
  id: K,
  ...data: RefusalArgs<K>
): WeChatRefusal {
  return new WeChatRefusal(id, data[0] ?? {});
}

// ---------------------------------------------------------------------------
// Public shapes

export type RunState = "running" | "waiting" | "idle" | "failed";

/** A file the agent presented in a session; the only files `.file` may send. */
export interface PresentedFile {
  toolCallId: string;
  /** Canonical absolute path recorded when it was presented. Never rendered. */
  path: string;
  /** Base name, for display. */
  name: string;
}

/** What `.status`, `.use` and friends show about one session. */
export interface SessionView {
  sessionId: string;
  projectId: string;
  /** Display name of the project ("No Project" for the temporary workspace). */
  project: string;
  title: string;
  state: RunState;
  live: boolean;
  runStartedAtMs?: number;
  contextUsage?: PineContextUsage;
  todos?: { done: number; total: number };
  queue: string[];
  tasks: BackgroundTaskSnapshot[];
  /** The session read external content (`T-EXTERNAL`). */
  external: boolean;
  /** Open asks of this session, oldest first. */
  asks: Ask[];
  mode: PineApprovalMode | "view-only";
  viewOnly?: "ceiling" | "automation-run";
}

/** Plan ground rule 14: a plain message is never held for routing. */
export type RouteDecision = { kind: "silent" } | { kind: "ack" };

export interface SessionDirectoryDeps {
  core: WeChatCorePorts;
  host: Pick<
    WeChatHostPorts,
    "notify" | "locale" | "dataDirectory" | "agentDirectory"
  >;
  store: WeChatStateStore;
  asks: AskBook;
  outbound: Pick<Outbound, "push" | "retract" | "setTyping">;
  attachments: InboundAttachmentsApi;
  settings: () => WeChatSettings;
  lang: () => ReplyLanguage;
  now: () => number;
}

/** "No Project" for the temporary workspace, else the project's name. */
export function projectLabel(
  project: Pick<PineProject, "id" | "name"> | undefined,
  lang: ReplyLanguage,
): string {
  if (!project || isTemporaryWorkspace(project.id)) {
    return lang === "zh" ? "无项目" : "No Project";
  }
  return project.name;
}

/**
 * `approvalModeWithin`, except that a mode Pine does not know (a hand-edited
 * state file) is never within the ceiling: its index would be -1.
 */
function withinCeiling(
  mode: PineApprovalMode,
  ceiling: PineApprovalMode,
): boolean {
  return (
    APPROVAL_MODE_ORDER.includes(mode) &&
    APPROVAL_MODE_ORDER.includes(ceiling) &&
    approvalModeWithin(mode, ceiling)
  );
}

/** `current` clamped to `ceiling`. */
export function clampMode(
  mode: PineApprovalMode,
  ceiling: PineApprovalMode,
): PineApprovalMode {
  return withinCeiling(mode, ceiling) ? mode : ceiling;
}

/** Whether text would carry Pine's attachment block into a prompt. */
export function carriesAttachmentBlock(text: string): boolean {
  return (
    ATTACHMENT_BLOCK_MARKER.test(text) ||
    parseAttachmentMessage(text).attachments.length > 0 ||
    parseAttachmentMessage(text.trimStart()).attachments.length > 0
  );
}

// ---------------------------------------------------------------------------
// Internal state

interface Observed {
  projectId?: string;
  state?: "running" | "idle" | "failed";
  runStartedAtMs?: number;
  aborted: boolean;
  /** The latest prompt of the current run came from this bridge. */
  bridgeRun: boolean;
  /** A bridge prompt is on its way; the next run start is the bridge's. */
  pendingPrompt: boolean;
  progressSent: boolean;
  external: boolean;
  queue: string[];
  tasks: BackgroundTaskSnapshot[];
  title?: string;
  contextUsage?: PineContextUsage;
  todos?: { done: number; total: number };
  presented: PresentedFile[];
  /** Files presented during the current run. */
  runFiles: number;
  lastError?: string;
}

interface Hold {
  lastUsedAtMs: number;
}

interface RunWatch {
  projectId: string;
  automationId: string;
  name: string;
  sinceMs: number;
}

const MCP_AUTHORING: ReadonlySet<string> = new Set(
  MCP_AUTHORING_DYNAMIC_TOOL_NAMES as readonly string[],
);

/**
 * MCP tool names are not fixed (the adapter's prefix can be "none"); these
 * are the shapes it uses by default. Pine's own MCP authoring tools are not
 * external content.
 */
function isMcpToolName(name: string): boolean {
  if (MCP_AUTHORING.has(name) || name.startsWith("mcp_config_")) return false;
  return name === "mcp" || /^mcp[_-]/.test(name) || name.includes("__");
}

function objectOf(
  value: PineJsonValue | undefined,
): Record<string, PineJsonValue | undefined> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

/** Counts of a `todo` tool result's task snapshot, if the payload carries one. */
function todoCounts(
  payload: PineJsonValue | undefined,
): { done: number; total: number } | undefined {
  const root = objectOf(payload);
  const candidates = [
    objectOf(root?.details),
    objectOf(objectOf(root?.result)?.details),
    root,
  ];
  for (const candidate of candidates) {
    const tasks = candidate?.tasks;
    if (!Array.isArray(tasks)) continue;
    const live = tasks
      .map((task) => objectOf(task))
      .filter((task) => task !== undefined && task.status !== "deleted");
    return {
      done: live.filter((task) => task?.status === "completed").length,
      total: live.length,
    };
  }
  return undefined;
}

function windowsFirst(ids: readonly number[]): number[] {
  return [
    ...ids.filter((id) => !isVirtualClient(id)),
    ...ids.filter((id) => isVirtualClient(id)),
  ];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rank(mode: PineApprovalMode): number {
  return APPROVAL_MODE_ORDER.indexOf(mode);
}

// ---------------------------------------------------------------------------

export class SessionDirectory {
  private readonly observed = new Map<string, Observed>();
  private readonly completions = new CompletionSignalTracker();
  private readonly holds = new Map<string, Hold>();
  private readonly projectNames = new Map<string, string>();
  private readonly usedNotified = new Set<string>();
  private readonly runWatches = new Map<string, RunWatch>();
  private readonly enableWatches = new Set<string>();

  constructor(private readonly deps: SessionDirectoryDeps) {}

  // -------------------------------------------------------------------------
  // Observation

  /** Every session's events; synchronous and never throws. */
  observe(event: PineAgentEvent, ownerId: number | undefined): void {
    // Sessions no interface holds (owner undefined) are observed too.
    void ownerId;
    try {
      this.observeEvent(event);
    } catch (error) {
      console.error(
        "WeChat remote could not observe an agent event:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  private observeEvent(event: PineAgentEvent): void {
    if (event.type === "host-request") return;
    const sessionId = event.sessionId;
    if (event.type === "message-update") {
      // Hot path: nothing to cache, only a due progress push.
      const known = this.observed.get(sessionId);
      if (known) this.checkProgress(sessionId, known);
      return;
    }
    const completion =
      event.type === "run-state" || event.type === "message-end"
        ? this.completions.observe(event)
        : undefined;
    const obs = this.touch(sessionId);
    obs.projectId =
      this.deps.core.runtimes.projectOfLiveSession(sessionId)?.id ??
      obs.projectId;
    switch (event.type) {
      case "run-state":
        this.observeRunState(
          sessionId,
          obs,
          event.state,
          event.error,
          completion,
        );
        break;
      case "session-error":
        obs.lastError = event.message;
        break;
      case "session-updated":
        obs.title = event.summary.name ?? event.summary.preview ?? obs.title;
        break;
      case "context-usage":
        obs.contextUsage = {
          tokens: event.tokens,
          contextWindow: event.contextWindow,
          percent: event.percent,
          cost: event.cost,
          cacheHitRate: event.cacheHitRate,
        };
        break;
      case "steering-queue":
        obs.queue = [...event.messages];
        break;
      case "background-tasks":
        obs.tasks = [...event.tasks];
        break;
      case "tool-start":
        if (
          EXTERNAL_CONTENT_TOOLS.has(event.toolName) ||
          isMcpToolName(event.toolName)
        )
          obs.external = true;
        break;
      case "tool-end":
        if (event.toolName === "todo" && !event.isError) {
          obs.todos = todoCounts(event.payload) ?? obs.todos;
        }
        break;
      case "approval-request":
        this.openApproval(sessionId, obs, event);
        break;
      case "approval-explanation":
        this.applyExplanation(event);
        break;
      case "questionnaire-request":
        this.openQuestion(sessionId, obs, event);
        break;
      case "approval-decided":
      case "questionnaire-decided":
        this.closeRequest(event.requestId, "decided");
        break;
      case "present-file":
        void this.recordPresented(sessionId, event.toolCallId, event.path);
        break;
      default:
        break;
    }
    this.checkProgress(sessionId, obs);
  }

  private touch(sessionId: string): Observed {
    let obs = this.observed.get(sessionId);
    if (obs) {
      this.observed.delete(sessionId);
      this.observed.set(sessionId, obs);
      return obs;
    }
    obs = {
      aborted: false,
      bridgeRun: false,
      pendingPrompt: false,
      progressSent: false,
      external: false,
      queue: [],
      tasks: [],
      presented: [],
      runFiles: 0,
    };
    this.observed.set(sessionId, obs);
    while (this.observed.size > OBSERVED_SESSIONS_MAX) {
      const evictable =
        [...this.observed].find(
          ([id, candidate]) =>
            candidate.state !== "running" &&
            !this.deps.asks.list().some((ask) => askSession(ask) === id),
        ) ?? [...this.observed][0];
      if (!evictable) break;
      this.observed.delete(evictable[0]);
      this.completions.forget(evictable[0]);
    }
    return obs;
  }

  private observeRunState(
    sessionId: string,
    obs: Observed,
    state: "idle" | "running" | "aborting" | "failed",
    error: string | undefined,
    completion: { text: string } | undefined,
  ): void {
    if (state === "running") {
      if (obs.state === "running") return;
      obs.state = "running";
      obs.runStartedAtMs = this.deps.now();
      obs.aborted = false;
      obs.progressSent = false;
      obs.runFiles = 0;
      obs.bridgeRun = obs.pendingPrompt;
      obs.pendingPrompt = false;
      if (!obs.bridgeRun) this.foreignRun(sessionId);
      return;
    }
    if (state === "aborting") {
      obs.aborted = true;
      return;
    }
    const wasRunning = obs.state === "running";
    obs.state = state;
    if (state === "failed" && error) obs.lastError = error;
    this.endRun(sessionId, obs, wasRunning, state, completion);
  }

  /** A run started that the bridge did not prompt. */
  private foreignRun(sessionId: string): void {
    const state = this.deps.store.get();
    const tracked = state.tracked.find(
      (entry) => entry.sessionId === sessionId,
    );
    const origin = state.origins.find((entry) => entry.sessionId === sessionId);
    const untrack = tracked?.origin === "adopted";
    const touch = origin?.kind === "started" && !origin.touchedLocally;
    if (!untrack && !touch) return;
    this.deps.store.updateSoon((draft) => {
      if (untrack)
        draft.tracked = draft.tracked.filter(
          (entry) => entry.sessionId !== sessionId,
        );
      if (touch) {
        const entry = draft.origins.find(
          (candidate) => candidate.sessionId === sessionId,
        );
        if (entry) entry.touchedLocally = true;
      }
    });
  }

  private endRun(
    sessionId: string,
    obs: Observed,
    wasRunning: boolean,
    state: "idle" | "failed",
    completion: { text: string } | undefined,
  ): void {
    // The "typing…" a silently forwarded message turned on ends with its run.
    if (wasRunning && obs.bridgeRun) this.deps.outbound.setTyping(false);
    const closed = this.deps.asks.closeWhere(
      (ask) => askSession(ask) === sessionId,
      "invalidated",
    );
    for (const ask of closed) this.deps.outbound.retract(`ask:${ask.number}`);
    this.deps.outbound.retract(`progress:${sessionId}`);
    const report =
      wasRunning &&
      obs.bridgeRun &&
      !obs.aborted &&
      this.pushesResults(sessionId);
    const startedAt = obs.runStartedAtMs;
    const files = obs.runFiles;
    obs.bridgeRun = false;
    obs.runStartedAtMs = undefined;
    if (report) {
      void this.pushResult(sessionId, {
        state,
        text: completion?.text ?? "",
        error: obs.lastError,
        durationMs:
          startedAt === undefined ? undefined : this.deps.now() - startedAt,
        cost: obs.contextUsage?.cost,
        files,
      }).catch(() => undefined);
    }
    void this.releaseIdle().catch(() => undefined);
  }

  private trackedEntry(sessionId: string): TrackedSession | undefined {
    return this.deps.store
      .get()
      .tracked.find((entry) => entry.sessionId === sessionId);
  }

  /** Results and progress: tracked, not a spawned child. */
  private pushesResults(sessionId: string): boolean {
    const tracked = this.trackedEntry(sessionId);
    return tracked !== undefined && tracked.origin !== "spawned";
  }

  private checkProgress(sessionId: string, obs: Observed): void {
    if (
      obs.state !== "running" ||
      !obs.bridgeRun ||
      obs.progressSent ||
      obs.aborted ||
      obs.runStartedAtMs === undefined ||
      this.deps.now() - obs.runStartedAtMs < PROGRESS_AFTER_MS ||
      !this.pushesResults(sessionId)
    )
      return;
    obs.progressSent = true;
    void this.pushProgress(sessionId, obs).catch(() => undefined);
  }

  /** Progress pushes that fell due without an event; the bridge's sweep timer calls it. */
  tick(): void {
    for (const [sessionId, obs] of this.observed)
      this.checkProgress(sessionId, obs);
  }

  private projectOfSession(sessionId: string, obs?: Observed): string {
    const state = this.deps.store.get();
    return (
      this.deps.core.runtimes.projectOfLiveSession(sessionId)?.id ??
      obs?.projectId ??
      state.tracked.find((entry) => entry.sessionId === sessionId)?.projectId ??
      state.origins.find((entry) => entry.sessionId === sessionId)?.projectId ??
      ""
    );
  }

  private openApproval(
    sessionId: string,
    obs: Observed,
    event: Extract<PineAgentEvent, { type: "approval-request" }>,
  ): void {
    const card = approvalCardText(event);
    // A re-sent request whose action changed must not keep the old card's
    // number: `.y NN` would approve something the user never saw.
    const existing = this.deps.asks.byRequest(event.requestId);
    if (
      existing?.kind === "approval" &&
      existing.actionDigest !== event.actionDigest
    ) {
      this.deps.asks.close(existing.number, "invalidated");
      this.deps.outbound.retract(`ask:${existing.number}`);
    }
    const ask = this.deps.asks.open({
      kind: "approval",
      requestId: event.requestId,
      ...(event.actionDigest !== undefined
        ? { actionDigest: event.actionDigest }
        : {}),
      sessionId,
      projectId: this.projectOfSession(sessionId, obs),
      trigger: event.trigger,
      toolName: event.toolName,
      ...(event.input !== undefined ? { input: event.input } : {}),
      ...(event.evidence !== undefined ? { evidence: event.evidence } : {}),
      ...(event.explanation ? { explanation: event.explanation } : {}),
      subjectCut: card.subjectCut,
      external: obs.external,
    });
    if (ask) void this.pushCard(ask.number).catch(() => undefined);
  }

  /**
   * A late reviewer explanation. A card still waiting to go out is rebuilt
   * with it; a delivered one is not repeated (`.N` shows it).
   */
  private applyExplanation(
    event: Extract<PineAgentEvent, { type: "approval-explanation" }>,
  ): void {
    if (!event.explanation) return;
    const ask = this.deps.asks.setExplanation(
      event.requestId,
      event.explanation,
    );
    if (!ask || ask.deliveredAtMs !== undefined) return;
    this.deps.outbound.retract(`ask:${ask.number}`);
    void this.pushCard(ask.number).catch(() => undefined);
  }

  private openQuestion(
    sessionId: string,
    obs: Observed,
    event: Extract<PineAgentEvent, { type: "questionnaire-request" }>,
  ): void {
    const ask = this.deps.asks.open({
      kind: "question",
      requestId: event.requestId,
      sessionId,
      projectId: this.projectOfSession(sessionId, obs),
      questionnaire: event.questionnaire,
      answerable: true,
    });
    if (ask?.kind !== "question") return;
    ask.answerable = questionCardAnswerable(
      this.deps.lang(),
      { project: "", title: obs.title ?? "" },
      ask.number,
      ask.questionnaire,
    );
    void this.pushCard(ask.number).catch(() => undefined);
  }

  private closeRequest(requestId: string, reason: "decided"): void {
    const ask = this.deps.asks.byRequest(requestId);
    if (!ask) return;
    this.deps.asks.close(ask.number, reason);
    this.deps.outbound.retract(`ask:${ask.number}`);
  }

  private async recordPresented(
    sessionId: string,
    toolCallId: string,
    filePath: string,
  ): Promise<void> {
    try {
      const target = await this.deps.core.runtimes.resolvePresentTarget(
        sessionId,
        filePath,
      );
      if (!target) return;
      const canonical = await realpath(filePath);
      const obs = this.touch(sessionId);
      if (obs.presented.some((file) => file.toolCallId === toolCallId)) return;
      obs.presented.push({
        toolCallId,
        path: canonical,
        name: path.basename(canonical),
      });
      obs.runFiles += 1;
    } catch {
      // A file that cannot be resolved is not offered.
    }
  }

  // -------------------------------------------------------------------------
  // Pushes (tracked sessions only; never touch the handle tables)

  private recordPush(sessionId: string, projectId: string): void {
    const atMs = this.deps.now();
    this.deps.store.updateSoon((draft) => {
      draft.lastPush = { sessionId, projectId, atMs };
    });
  }

  private async sessionRef(
    sessionId: string,
    projectId: string,
  ): Promise<SessionRef> {
    return {
      project: await this.projectName(projectId),
      title: await this.titleOf(sessionId, projectId),
    };
  }

  private async projectName(projectId: string): Promise<string> {
    const lang = this.deps.lang();
    if (isTemporaryWorkspace(projectId) || projectId === "")
      return projectLabel(undefined, lang);
    const cached = this.projectNames.get(projectId);
    if (cached !== undefined) return cached;
    try {
      const project = await this.deps.core.repository.get(projectId);
      this.projectNames.set(projectId, project.name);
      return project.name;
    } catch {
      return "";
    }
  }

  private async titleOf(sessionId: string, projectId: string): Promise<string> {
    const live = this.deps.core.runtimes.summaryOfLiveSession(sessionId);
    const title =
      live?.name ?? this.observed.get(sessionId)?.title ?? live?.preview;
    if (title) return title;
    const stored = await this.storedSummary(sessionId, projectId);
    return stored?.name ?? stored?.preview ?? "";
  }

  private async storedSummary(sessionId: string, projectId: string) {
    try {
      const service = this.deps.core
        .sessionLibrary()
        .openSessionService(projectId);
      return service
        ? (await service.describeSession(sessionId)).summary
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async pushCard(number: number): Promise<void> {
    const ask = this.deps.asks.get(number);
    if (ask?.kind !== "approval" && ask?.kind !== "question") return;
    if (!this.trackedEntry(ask.sessionId)) return;
    const text = await this.cardText(ask);
    // The ask may have been answered while the card was being built.
    if (this.deps.asks.get(number) !== ask) return;
    this.deps.outbound.push({
      key: `ask:${number}`,
      priority: 1,
      text,
      digest: { kind: "ask", number },
    });
    this.recordPush(ask.sessionId, ask.projectId);
  }

  /** The text of an ask's card, as pushed or as `.use` / `.pending` show it. */
  async cardText(ask: ApprovalAsk | QuestionAsk): Promise<string> {
    const lang = this.deps.lang();
    const at = await this.sessionRef(ask.sessionId, ask.projectId);
    if (ask.kind === "question") {
      const viewOnly =
        (await this.modeFor(ask.sessionId, ask.projectId)) === "view-only";
      const data = { at, ask: ask.number, questionnaire: ask.questionnaire };
      return !viewOnly && ask.answerable
        ? render("T-QCARD", lang, data)
        : render("T-QCARD-LOCAL", lang, data);
    }
    const verdict = await this.verdict(ask);
    if (verdict.kind === "long-context")
      return render("T-LONGCTX", lang, { at, ask: ask.number });
    const card = approvalCardText(ask);
    const data = {
      at,
      ask: ask.number,
      tool: ask.toolName,
      trigger: ask.trigger,
      ...(card.subject !== undefined ? { subject: card.subject } : {}),
      ...(card.description !== undefined
        ? { description: card.description }
        : {}),
      ...(card.summary !== undefined ? { summary: card.summary } : {}),
      external: ask.external,
      cut: card.subjectCut,
    };
    if (verdict.kind === "approvable") return render("T-APPROVAL", lang, data);
    const viewOnly =
      verdict.reason === "view-only"
        ? await this.viewOnlyReason(ask.sessionId, ask.projectId)
        : undefined;
    return render("T-APPROVAL-LOCAL", lang, {
      ...data,
      reason: verdict.reason,
      ...(viewOnly ? { viewOnly } : {}),
    });
  }

  private async pushResult(
    sessionId: string,
    result: {
      state: "idle" | "failed";
      text: string;
      error?: string;
      durationMs?: number;
      cost?: number;
      files: number;
    },
  ): Promise<void> {
    const projectId = this.projectOfSession(sessionId);
    const at = await this.sessionRef(sessionId, projectId);
    const lang = this.deps.lang();
    const title = at.title;
    this.deps.outbound.retract(`progress:${sessionId}`);
    if (result.state === "failed") {
      this.deps.outbound.push({
        key: `result:${sessionId}`,
        priority: 2,
        text: render("T-FAILED", lang, {
          at,
          error: result.error ?? (lang === "zh" ? "未知错误" : "unknown error"),
        }),
        digest: { kind: "failed", title },
      });
    } else {
      this.deps.outbound.push({
        key: `result:${sessionId}`,
        priority: 2,
        text: render("T-DONE", lang, {
          at,
          ...(result.durationMs !== undefined
            ? { durationMs: result.durationMs }
            : {}),
          ...(result.cost !== undefined && result.cost > 0
            ? { costUsd: result.cost }
            : {}),
          text: result.text,
          files: result.files,
          current: this.deps.store.get().current?.sessionId === sessionId,
        }),
        digest: { kind: "done", title },
      });
    }
    this.recordPush(sessionId, projectId);
  }

  private async pushProgress(sessionId: string, obs: Observed): Promise<void> {
    const projectId = this.projectOfSession(sessionId, obs);
    const at = await this.sessionRef(sessionId, projectId);
    this.deps.outbound.push({
      key: `progress:${sessionId}`,
      priority: 3,
      text: render("T-PROGRESS", this.deps.lang(), {
        at,
        ...(obs.todos ? { todos: obs.todos } : {}),
      }),
      digest: { kind: "done", title: at.title },
    });
    this.recordPush(sessionId, projectId);
  }

  // -------------------------------------------------------------------------
  // Core hooks

  sessionSpawned(
    parentSessionId: string,
    childSessionId: string,
    projectId: string,
  ): void {
    const state = this.deps.store.get();
    const parentTracked = state.tracked.some(
      (entry) => entry.sessionId === parentSessionId,
    );
    const parentOrigin = state.origins.some(
      (entry) => entry.sessionId === parentSessionId,
    );
    if (!parentTracked && !parentOrigin) return;
    const now = this.deps.now();
    const obs = this.touch(childSessionId);
    obs.projectId = projectId;
    void this.deps.store
      .update((draft) => {
        if (!draft.origins.some((entry) => entry.sessionId === childSessionId))
          addOrigin(draft.origins, {
            sessionId: childSessionId,
            projectId,
            kind: "spawned",
            atMs: now,
          });
        if (parentTracked)
          addTracked(
            draft.tracked,
            childSessionId,
            projectId,
            "spawned",
            now,
            this.isBusy,
          );
      })
      .catch(() => undefined);
  }

  /**
   * A WeChat-driven session handed work to a relative (`ui_session_send`, or
   * a finished turn that woke its parent). The relative now carries content
   * from WeChat, so it is held to the same limits as one WeChat used.
   */
  async sessionRelayed(
    fromSessionId: string,
    toSessionId: string,
    projectId: string,
  ): Promise<void> {
    const state = this.deps.store.get();
    if (!state.origins.some((entry) => entry.sessionId === fromSessionId))
      return;
    if (state.origins.some((entry) => entry.sessionId === toSessionId)) return;
    const now = this.deps.now();
    await this.deps.store.update((draft) => {
      if (!draft.origins.some((entry) => entry.sessionId === toSessionId))
        addOrigin(draft.origins, {
          sessionId: toSessionId,
          projectId,
          kind: "used",
          atMs: now,
        });
    });
    this.deps.core.notifyLibraryChanged("sessions");
  }

  sessionMoved(
    sessionId: string,
    fromProjectId: string,
    projectId: string,
  ): void {
    const obs = this.observed.get(sessionId);
    if (obs) obs.projectId = projectId;
    for (const ask of this.deps.asks.list()) {
      if (
        (ask.kind === "approval" || ask.kind === "question") &&
        ask.sessionId === sessionId
      )
        ask.projectId = projectId;
    }
    const state = this.deps.store.get();
    const known =
      state.tracked.some((entry) => entry.sessionId === sessionId) ||
      state.current?.sessionId === sessionId ||
      state.origins.some((entry) => entry.sessionId === sessionId) ||
      state.lastPush?.sessionId === sessionId;
    if (!known) return;
    void this.deps.store
      .update((draft) => {
        for (const entry of draft.tracked)
          if (entry.sessionId === sessionId) entry.projectId = projectId;
        for (const entry of draft.origins)
          if (entry.sessionId === sessionId) entry.projectId = projectId;
        if (draft.current?.sessionId === sessionId) {
          draft.current.projectId = projectId;
          if (draft.currentProjectId === fromProjectId)
            draft.currentProjectId = projectId;
        }
        if (draft.lastPush?.sessionId === sessionId)
          draft.lastPush.projectId = projectId;
      })
      .then(() => this.hold(projectId))
      .catch(() => undefined);
  }

  /** The automation service changed: report the runs WeChat started. */
  automationsChanged(): void {
    for (const [key, watch] of this.runWatches) {
      void this.checkRunWatch(key, watch).catch(() => undefined);
    }
  }

  private async checkRunWatch(key: string, watch: RunWatch): Promise<void> {
    const runs = await this.deps.core.automations.listRuns({
      projectId: watch.projectId,
      automationId: watch.automationId,
      filter: "all",
      limit: 5,
    });
    const run = runs.find(
      (candidate) => Date.parse(candidate.startedAt) >= watch.sinceMs - 60_000,
    );
    if (!run || run.status === "running") return;
    if (this.runWatches.get(key) !== watch) return;
    this.runWatches.delete(key);
    const lang = this.deps.lang();
    const result =
      run.summary ??
      run.error ??
      (lang === "zh" ? statusZh(run.status) : run.status);
    this.deps.outbound.push({
      key: `autorun:${watch.automationId}`,
      priority: 4,
      text: render("T-AUTORUN", lang, { name: watch.name, result }),
      digest: { kind: "autorun", name: watch.name, result },
    });
  }

  /** A local settings change: overrides above the new ceiling are deleted. */
  async settingsChanged(): Promise<void> {
    const ceiling = this.deps.settings().ceilingMode;
    const overrides = this.deps.store.get().modeOverride;
    const above = Object.keys(overrides).filter(
      (id) => !withinCeiling(overrides[id], ceiling),
    );
    if (above.length === 0) return;
    await this.deps.store.update((draft) => {
      for (const id of above) delete draft.modeOverride[id];
    });
  }

  // -------------------------------------------------------------------------
  // Holding projects

  /** Shares the project as the bridge; before every per-project call. */
  async hold(projectId: string): Promise<PineProject> {
    const { repository, runtimes } = this.deps.core;
    const project = await repository.open(projectId);
    await runtimes.share(W, project, repository.dataPaths(projectId));
    this.holds.set(projectId, { lastUsedAtMs: this.deps.now() });
    this.projectNames.set(projectId, project.name);
    return project;
  }

  private isBusy = (sessionId: string): boolean => {
    const state = this.runState(sessionId);
    return state === "running" || state === "waiting";
  };

  /**
   * Lets go of projects with no running or waiting session, that are not the
   * current project and were not used for HOLD_IDLE_MS. Also drops tracked
   * sessions idle for TRACK_IDLE_MS.
   */
  async releaseIdle(): Promise<void> {
    await this.sweepTracked();
    const now = this.deps.now();
    const state = this.deps.store.get();
    const keep = new Set<string>();
    if (state.current) keep.add(state.current.projectId);
    if (state.currentProjectId) keep.add(state.currentProjectId);
    for (const [sessionId, obs] of this.observed) {
      if (obs.projectId && this.isBusy(sessionId)) keep.add(obs.projectId);
    }
    for (const entry of state.tracked) {
      if (this.isBusy(entry.sessionId)) keep.add(entry.projectId);
    }
    const { runtimes } = this.deps.core;
    for (const projectId of runtimes.projectIdsOf(W)) {
      if (keep.has(projectId)) continue;
      const hold = this.holds.get(projectId);
      if (hold && now - hold.lastUsedAtMs < HOLD_IDLE_MS) continue;
      await runtimes.close(W, projectId);
      this.holds.delete(projectId);
    }
  }

  /** Drops tracked sessions idle for TRACK_IDLE_MS (never a running one). */
  async sweepTracked(): Promise<void> {
    const now = this.deps.now();
    const stale = this.deps.store
      .get()
      .tracked.filter(
        (entry) =>
          now - entry.lastUsedAtMs >= TRACK_IDLE_MS &&
          !this.isBusy(entry.sessionId),
      )
      .map((entry) => entry.sessionId);
    if (stale.length === 0) return;
    await this.deps.store.update((draft) => {
      draft.tracked = draft.tracked.filter(
        (entry) => !stale.includes(entry.sessionId),
      );
    });
  }

  /** On stop and unbind. With `abortOwnSessions`, first aborts running sessions only the bridge holds. */
  async releaseAll(options: { abortOwnSessions: boolean }): Promise<void> {
    const { runtimes } = this.deps.core;
    if (options.abortOwnSessions) {
      for (const projectId of runtimes.projectIdsOf(W)) {
        for (const sessionId of runtimes.liveSessionIdsOf(projectId)) {
          const clients = runtimes.clientsOfSession(sessionId);
          if (clients.length !== 1 || clients[0] !== W) continue;
          if (!this.isBusy(sessionId)) continue;
          await runtimes.abort(W, sessionId).catch(() => undefined);
        }
      }
    }
    await runtimes.dispose(W);
    this.holds.clear();
  }

  // -------------------------------------------------------------------------
  // Identity

  /** The client id that acts on a session (prompt, abort, mode, compact). */
  actor(sessionId: string | undefined, projectId: string): number {
    const { runtimes } = this.deps.core;
    if (sessionId !== undefined) {
      const controller = runtimes.controllerOfSession(sessionId);
      if (controller !== undefined && controller !== W) return controller;
      if (this.isLive(sessionId)) {
        const other = windowsFirst(
          runtimes.clientsOfSession(sessionId).filter((id) => id !== W),
        )[0];
        if (other !== undefined) return other;
        return W;
      }
    }
    const sharing = windowsFirst(
      runtimes.clientsSharingRuntime(W, projectId).filter((id) => id !== W),
    )[0];
    return sharing ?? W;
  }

  /** The client id that answers a session's approvals and questions. */
  responder(sessionId: string, projectId: string): number {
    return this.deps.core.runtimes.clientsOfSession(sessionId).includes(W)
      ? W
      : this.actor(sessionId, projectId);
  }

  isLive(sessionId: string): boolean {
    return (
      this.deps.core.runtimes.approvalModeOfLiveSession(sessionId) !== undefined
    );
  }

  // -------------------------------------------------------------------------
  // Modes

  private async currentMode(
    sessionId: string,
    projectId: string,
  ): Promise<PineApprovalMode> {
    const settings = this.deps.settings();
    const live = this.deps.core.runtimes.approvalModeOfLiveSession(sessionId);
    if (live !== undefined) return live;
    // The stored mode is only readable while some runtime holds the project
    // open; without the hold a YOLO session would read as the default mode.
    try {
      await this.hold(projectId);
    } catch {
      // An unknown project has no stored mode; fall through to the default.
    }
    return (
      (await this.storedSummary(sessionId, projectId))?.approvalMode ??
      clampMode(settings.defaultMode, settings.ceilingMode)
    );
  }

  private async isAutomationRun(
    sessionId: string,
    projectId: string,
  ): Promise<boolean> {
    const { automations } = this.deps.core;
    if (automations.isAutomationSession(sessionId)) return true;
    try {
      return (await automations.runSessions(projectId)).has(sessionId);
    } catch {
      return false;
    }
  }

  async viewOnlyReason(
    sessionId: string,
    projectId: string,
  ): Promise<"ceiling" | "automation-run" | undefined> {
    if (await this.isAutomationRun(sessionId, projectId))
      return "automation-run";
    const current = await this.currentMode(sessionId, projectId);
    return withinCeiling(current, this.deps.settings().ceilingMode)
      ? undefined
      : "ceiling";
  }

  /** The mode to pass to the next prompt, or "view-only". */
  async modeFor(
    sessionId: string,
    projectId: string,
  ): Promise<PineApprovalMode | "view-only"> {
    if (await this.isAutomationRun(sessionId, projectId)) return "view-only";
    const ceiling = this.deps.settings().ceilingMode;
    const current = await this.currentMode(sessionId, projectId);
    if (!withinCeiling(current, ceiling)) return "view-only";
    const override = this.deps.store.get().modeOverride[sessionId];
    if (override === undefined) return current;
    if (withinCeiling(override, ceiling)) return override;
    await this.deps.store.update((draft) => {
      delete draft.modeOverride[sessionId];
    });
    return current;
  }

  /** The current (live or stored) mode, for `E-VIEW` and `.mode`. */
  sessionMode(sessionId: string, projectId: string): Promise<PineApprovalMode> {
    return this.currentMode(sessionId, projectId);
  }

  async verdict(ask: ApprovalAsk): Promise<CardVerdict> {
    return approvalCardPolicy(ask, {
      settings: this.deps.settings(),
      mode: await this.modeFor(ask.sessionId, ask.projectId),
    });
  }

  // -------------------------------------------------------------------------
  // Tracking, origins, current

  async track(
    sessionId: string,
    projectId: string,
    origin: TrackedSession["origin"],
  ): Promise<void> {
    const now = this.deps.now();
    await this.deps.store.update((draft) => {
      addTracked(draft.tracked, sessionId, projectId, origin, now, this.isBusy);
    });
  }

  async setCurrent(
    target: { projectId: string; sessionId: string } | undefined,
  ): Promise<void> {
    const now = this.deps.now();
    await this.deps.store.update((draft) => {
      if (!target) {
        delete draft.current;
        return;
      }
      draft.current = { ...target, usedAtMs: now };
      draft.currentProjectId = target.projectId;
    });
  }

  /** Sidebar marker: started (or spawned) from WeChat, or used from WeChat. */
  originOf(sessionId: string): "wechat" | "wechat-used" | undefined {
    const origin = this.origin(sessionId);
    if (!origin) return undefined;
    return origin.kind === "used" ? "wechat-used" : "wechat";
  }

  origin(sessionId: string): SessionOrigin | undefined {
    return this.deps.store
      .get()
      .origins.find((entry) => entry.sessionId === sessionId);
  }

  runState(sessionId: string): RunState | undefined {
    const obs = this.observed.get(sessionId);
    const waiting = this.deps.asks
      .list()
      .some(
        (ask) =>
          (ask.kind === "approval" || ask.kind === "question") &&
          ask.sessionId === sessionId,
      );
    if (obs?.state === "running") return waiting ? "waiting" : "running";
    if (waiting) return "waiting";
    return obs?.state;
  }

  /** Open approval and question asks of a session, oldest first. */
  asksOf(sessionId: string): (ApprovalAsk | QuestionAsk)[] {
    return this.deps.asks
      .list()
      .filter(
        (ask): ask is ApprovalAsk | QuestionAsk =>
          (ask.kind === "approval" || ask.kind === "question") &&
          ask.sessionId === sessionId,
      );
  }

  async view(sessionId: string, projectId: string): Promise<SessionView> {
    const project = await this.hold(projectId);
    const obs = this.observed.get(sessionId);
    const { runtimes } = this.deps.core;
    let todos = obs?.todos;
    if (!todos) {
      try {
        const page = await runtimes.loadMessages(
          W,
          projectId,
          sessionId,
          undefined,
          1,
        );
        const tasks = page.todos?.tasks.filter(
          (task) => task.status !== "deleted",
        );
        if (tasks && tasks.length > 0)
          todos = {
            done: tasks.filter((task) => task.status === "completed").length,
            total: tasks.length,
          };
      } catch {
        // A session without a stored transcript has no todos.
      }
    }
    const mode = await this.modeFor(sessionId, projectId);
    const viewOnly =
      mode === "view-only"
        ? await this.viewOnlyReason(sessionId, projectId)
        : undefined;
    const contextUsage =
      runtimes.contextUsageOf(sessionId) ?? obs?.contextUsage;
    return {
      sessionId,
      projectId,
      project: projectLabel(project, this.deps.lang()),
      title: await this.titleOf(sessionId, projectId),
      state: this.runState(sessionId) ?? "idle",
      live: this.isLive(sessionId),
      ...(obs?.state === "running" && obs.runStartedAtMs !== undefined
        ? { runStartedAtMs: obs.runStartedAtMs }
        : {}),
      ...(contextUsage ? { contextUsage } : {}),
      ...(todos ? { todos } : {}),
      queue: [...(obs?.queue ?? [])],
      tasks: [...(obs?.tasks ?? [])],
      external: obs?.external ?? false,
      asks: this.asksOf(sessionId),
      mode,
      ...(viewOnly ? { viewOnly } : {}),
    };
  }

  /** Observed presentations, completed from the stored transcript. */
  async files(sessionId: string, projectId: string): Promise<PresentedFile[]> {
    await this.hold(projectId);
    let stored: { toolCallId: string; path: string }[] = [];
    try {
      stored = await this.deps.core.runtimes.listPresentedFiles(
        W,
        projectId,
        sessionId,
      );
    } catch {
      stored = [];
    }
    const files: PresentedFile[] = stored.map((file) => ({
      toolCallId: file.toolCallId,
      path: file.path,
      name: path.basename(file.path),
    }));
    for (const file of this.observed.get(sessionId)?.presented ?? []) {
      if (!files.some((known) => known.toolCallId === file.toolCallId))
        files.push({ ...file });
    }
    return files;
  }

  /** Tracked sessions that are running or waiting on an ask. */
  runningWeChatSessions(): string[] {
    return this.deps.store
      .get()
      .tracked.filter((entry) => this.isBusy(entry.sessionId))
      .map((entry) => entry.sessionId);
  }

  // -------------------------------------------------------------------------
  // Routing

  routeFor(nowMs: number): RouteDecision {
    const state = this.deps.store.get();
    const current = state.current;
    if (!current) return { kind: "silent" };
    const push = state.lastPush;
    if (
      push &&
      push.sessionId !== current.sessionId &&
      push.atMs > (state.lastAcceptedAtMs ?? 0)
    )
      return { kind: "ack" };
    if (nowMs - current.usedAtMs > CURRENT_IDLE_ACK_MS) return { kind: "ack" };
    if (this.runningWeChatSessions().length > 1) return { kind: "ack" };
    return { kind: "silent" };
  }

  /** An inbound message was accepted: clears the "latest push" cue. */
  async noteAccepted(nowMs: number): Promise<void> {
    await this.deps.store.update((draft) => {
      draft.lastAcceptedAtMs = nowMs;
    });
  }

  // -------------------------------------------------------------------------
  // Automations

  watchAutomationRun(
    projectId: string,
    automationId: string,
    name: string,
  ): void {
    this.runWatches.set(`${projectId}:${automationId}`, {
      projectId,
      automationId,
      name,
      sinceMs: this.deps.now(),
    });
  }

  /** One pending enable request per automation; pushes `T-AUTO-ON` when it settles. */
  watchAutomationEnable(
    projectId: string,
    automationId: string,
    name: string,
    outcome: Promise<void>,
  ): void {
    const key = `${projectId}:${automationId}`;
    if (this.enableWatches.has(key)) {
      outcome.catch(() => undefined);
      return;
    }
    this.enableWatches.add(key);
    const startedAt = this.deps.now();
    const settle = (result: "approved" | "denied" | "timeout") => {
      this.enableWatches.delete(key);
      this.deps.outbound.push({
        key: `auto-on:${automationId}`,
        priority: 4,
        text: render("T-AUTO-ON", this.deps.lang(), { name, result }),
        digest: { kind: "auto-on", name, result },
      });
    };
    outcome.then(
      () => settle("approved"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        const timedOut =
          /timed? ?out|expired/i.test(message) ||
          this.deps.now() - startedAt >= AUTOMATION_APPROVAL_TIMEOUT_MS;
        settle(timedOut ? "timeout" : "denied");
      },
    );
  }

  /** Whether an enable request started from WeChat is still waiting. */
  enablePending(projectId: string, automationId: string): boolean {
    return this.enableWatches.has(`${projectId}:${automationId}`);
  }

  automationRunRefusal(
    sessionId: string | undefined,
    automation: { id: string; name: string; enabled: boolean },
  ): string | undefined {
    if (sessionId === undefined) return undefined;
    const origin = this.origin(sessionId);
    if (!origin) return undefined;
    const ceiling = this.deps.settings().ceilingMode;
    if (rank(ceiling) < rank("autonomous"))
      return "This session is driven from WeChat, and WeChat remote's highest approval mode is below Autonomous Work, so it cannot start automations. Ask the user to run the automation in Pine on this computer.";
    if (!automation.enabled)
      return "This session is driven from WeChat, and the automation is turned off. Ask the user to turn it on in Pine on this computer first.";
    this.notifyLocal(
      "automation-run",
      { name: automation.name },
      {
        projectId: origin.projectId,
        sessionId,
      },
    );
    this.watchAutomationRun(origin.projectId, automation.id, automation.name);
    return undefined;
  }

  // -------------------------------------------------------------------------
  // The two prompt exits (invariant 3)

  private guardText(text: string, quotedText: string | undefined): void {
    if (carriesAttachmentBlock(text)) throw refuse("E-TEXT");
    if (text.trim() === "" && quotedText?.trim()) throw refuse("E-QUOTE");
  }

  /** Throws unless `mode` is within the current ceiling; right before a prompt. */
  private assertWithinCeiling(mode: PineApprovalMode): void {
    const ceiling = this.deps.settings().ceilingMode;
    if (!withinCeiling(mode, ceiling))
      throw new Error("The approval mode is above the WeChat ceiling.");
  }

  private locale(): "en-US" | "zh-CN" {
    return this.deps.lang() === "zh" ? "zh-CN" : "en-US";
  }

  private async buildMessage(
    projectId: string,
    actorId: number,
    input: { text: string; quotedText?: string; attachments: boolean },
  ): Promise<string> {
    const lang = this.deps.lang();
    const quote = input.quotedText?.trim();
    const body = quote
      ? `${input.text.trim()}\n\n${quoteBlock(lang, input.quotedText ?? "")}`
      : input.text.trim();
    const attachments = input.attachments
      ? await this.deps.attachments.take(
          this.deps.core.repository.dataPaths(projectId).attachmentsRoot,
        )
      : [];
    const message = serializeAttachmentMessage(attachments, body);
    const staged = attachments.map((attachment) => attachment.path);
    const parsed = parseAttachmentMessage(message).attachments.map(
      (attachment) => attachment.path,
    );
    if (!sameList(parsed, staged))
      throw new Error("The message does not carry exactly the staged files.");
    if (message.trim() === "") throw new Error("There is nothing to send.");
    if (staged.length > 0) this.deps.core.rememberAttachments(actorId, staged);
    return message;
  }

  async startSession(input: {
    projectId: string;
    text: string;
    quotedText?: string;
    attachments: boolean;
  }): Promise<PromptSessionResult> {
    this.guardText(input.text, input.quotedText);
    const settings = this.deps.settings();
    const mode = clampMode(settings.defaultMode, settings.ceilingMode);
    const project = await this.hold(input.projectId);
    const ownerId = this.actor(undefined, input.projectId);
    const message = await this.buildMessage(input.projectId, ownerId, input);
    this.assertWithinCeiling(mode);
    const result = await this.deps.core.startBackgroundSession({
      ownerId,
      project,
      message,
      approvalMode: mode,
      locale: this.locale(),
    });
    const sessionId = result.session.id;
    const obs = this.touch(sessionId);
    obs.projectId = input.projectId;
    obs.title = result.session.name ?? result.session.preview ?? obs.title;
    if (input.attachments || input.quotedText?.trim()) obs.external = true;
    if (obs.state === "running") obs.bridgeRun = true;
    else obs.pendingPrompt = true;
    const now = this.deps.now();
    await this.deps.store.update((draft) => {
      if (!draft.origins.some((entry) => entry.sessionId === sessionId))
        addOrigin(draft.origins, {
          sessionId,
          projectId: input.projectId,
          kind: "started",
          atMs: now,
        });
      addTracked(
        draft.tracked,
        sessionId,
        input.projectId,
        "wechat",
        now,
        this.isBusy,
      );
      draft.current = { projectId: input.projectId, sessionId, usedAtMs: now };
      draft.currentProjectId = input.projectId;
    });
    this.deps.core.notifyLibraryChanged("sessions");
    this.notifyLocal(
      "session-started",
      {
        project: projectLabel(project, this.deps.lang()),
        title: result.session.name ?? result.session.preview ?? "",
        text: input.text,
      },
      { projectId: input.projectId, sessionId },
    );
    return result;
  }

  async send(input: {
    sessionId: string;
    projectId: string;
    text: string;
    quotedText?: string;
    behavior?: "steer" | "follow-up";
    attachments: boolean;
  }): Promise<PromptSessionResult> {
    const { sessionId, projectId } = input;
    this.guardText(input.text, input.quotedText);
    const reason = await this.viewOnlyReason(sessionId, projectId);
    if (reason === "automation-run") {
      throw refuse("E-VIEWRUN", {
        title: await this.titleOf(sessionId, projectId),
      });
    }
    if (reason === "ceiling") {
      throw refuse("E-VIEW", {
        title: await this.titleOf(sessionId, projectId),
        mode: await this.currentMode(sessionId, projectId),
        ceiling: this.deps.settings().ceilingMode,
      });
    }
    const mode = await this.modeFor(sessionId, projectId);
    if (mode === "view-only") {
      throw refuse("E-VIEW", {
        title: await this.titleOf(sessionId, projectId),
        mode: await this.currentMode(sessionId, projectId),
        ceiling: this.deps.settings().ceilingMode,
      });
    }
    const project = await this.hold(projectId);
    const actorId = this.actor(sessionId, projectId);
    const message = await this.buildMessage(projectId, actorId, input);
    const obs = this.touch(sessionId);
    obs.projectId = projectId;
    if (input.attachments || input.quotedText?.trim()) obs.external = true;
    obs.pendingPrompt = true;
    this.assertWithinCeiling(mode);
    let result: PromptSessionResult;
    try {
      result = await this.deps.core.runtimes.prompt(
        actorId,
        {
          target: { kind: "session", projectId, sessionId },
          message,
          approvalMode: mode,
          locale: this.locale(),
          ...(input.behavior ? { streamingBehavior: input.behavior } : {}),
        },
        { focus: false },
      );
    } catch (error) {
      obs.pendingPrompt = false;
      throw error;
    }
    if (obs.state === "running") {
      obs.bridgeRun = true;
      obs.pendingPrompt = false;
    }
    const now = this.deps.now();
    const before = this.deps.store.get();
    const hadOrigin = before.origins.some(
      (entry) => entry.sessionId === sessionId,
    );
    const existing = before.tracked.find(
      (entry) => entry.sessionId === sessionId,
    );
    const trackAs: TrackedSession["origin"] =
      existing?.origin ??
      (before.origins.find((entry) => entry.sessionId === sessionId)?.kind ===
      "started"
        ? "wechat"
        : "adopted");
    await this.deps.store.update((draft) => {
      delete draft.modeOverride[sessionId];
      addTracked(
        draft.tracked,
        sessionId,
        projectId,
        trackAs,
        now,
        this.isBusy,
      );
      if (!hadOrigin)
        addOrigin(draft.origins, {
          sessionId,
          projectId,
          kind: "used",
          atMs: now,
        });
      if (draft.current?.sessionId === sessionId) draft.current.usedAtMs = now;
    });
    if (!hadOrigin && !this.usedNotified.has(sessionId)) {
      this.usedNotified.add(sessionId);
      this.deps.core.notifyLibraryChanged("sessions");
      this.notifyLocal(
        "session-used",
        {
          project: projectLabel(project, this.deps.lang()),
          title: await this.titleOf(sessionId, projectId),
        },
        { projectId, sessionId },
      );
    }
    return result;
  }

  // -------------------------------------------------------------------------

  private notifyLocal<K extends WeChatNotificationKind>(
    kind: K,
    data: NoticeData[K],
    ids: { projectId?: string; sessionId?: string },
  ): void {
    const lang: ReplyLanguage =
      this.deps.host.locale?.() === "zh-CN" ? "zh" : this.deps.lang();
    const texts = (
      notice as (
        kind: K,
        lang: ReplyLanguage,
        data: NoticeData[K],
      ) => {
        title: string;
        body: string;
      }
    )(kind, lang, data);
    try {
      this.deps.host.notify({ kind, ...texts, ...ids });
    } catch {
      // A failed notification never blocks the bridge.
    }
  }
}

function askSession(ask: Ask): string | undefined {
  return ask.kind === "approval" || ask.kind === "question"
    ? ask.sessionId
    : undefined;
}

function addOrigin(origins: SessionOrigin[], origin: SessionOrigin): void {
  origins.push(origin);
  while (origins.length > ORIGINS_MAX) origins.shift();
}

/** Adds or refreshes a tracked session; drops the oldest idle one beyond TRACKED_MAX. */
function addTracked(
  tracked: TrackedSession[],
  sessionId: string,
  projectId: string,
  origin: TrackedSession["origin"],
  now: number,
  isBusy: (sessionId: string) => boolean,
): void {
  const existing = tracked.find((entry) => entry.sessionId === sessionId);
  if (existing) {
    existing.projectId = projectId;
    existing.lastUsedAtMs = now;
    if (origin === "wechat") existing.origin = "wechat";
    return;
  }
  tracked.push({
    sessionId,
    projectId,
    origin,
    trackedAtMs: now,
    lastUsedAtMs: now,
  });
  while (tracked.length > TRACKED_MAX) {
    const candidates = tracked
      .filter((entry) => entry.sessionId !== sessionId)
      .sort((a, b) => a.lastUsedAtMs - b.lastUsedAtMs);
    const victim =
      candidates.find((entry) => !isBusy(entry.sessionId)) ?? candidates[0];
    if (!victim) break;
    tracked.splice(tracked.indexOf(victim), 1);
  }
}

function statusZh(status: string): string {
  return (
    {
      findings: "有发现",
      nothing: "无事发生",
      failed: "失败",
      interrupted: "中断",
      skipped: "跳过",
    }[status] ?? status
  );
}
