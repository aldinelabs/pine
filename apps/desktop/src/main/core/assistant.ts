import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  APPROVAL_MODE_ORDER,
  approvalModeWithin,
  type PineApprovalMode,
  type PromptSessionRequest,
  type PromptSessionResult,
} from "../../shared/agent";
import type {
  AutomationSummary,
  AutomationTriggerFact,
} from "../../shared/automation";
import { readPineAgentSettings } from "../../agent/pineSettings";
import { resolvePineToolGroups } from "../../shared/toolGroups";
import {
  ASSISTANT_APPROVAL_MODE,
  ASSISTANT_CLIENT_ID,
  ASSISTANT_DISPATCH_ATTACHMENTS_MAX,
  ASSISTANT_DISPLAY_NAME,
  type AssistantAutomationDetail,
  type AssistantAutomationFact,
  type AssistantDigest,
  type AssistantSessionFact,
  type AssistantSettingFact,
  type AssistantHostOperation,
  type AssistantHostResult,
  type AssistantOverviewSession,
  type AssistantState,
  type AssistantTurnSource,
  assistantAttachmentId,
  markWeChatMessage,
} from "../../shared/assistant";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
  type PineAttachment,
} from "../../shared/attachments";
import type { PineModelSelection } from "../../shared/models";
import {
  isTemporaryWorkspace,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "../../shared/projects";
import {
  withoutRelayPrefix,
  type PineSessionNotice,
  type PineSessionSummary,
  type PineTextMessage,
} from "../../shared/sessions";
import { isVirtualClient } from "../../shared/webControl";
import {
  listOrchestratorSessions,
  listProjectSessions,
} from "../recentSessions";
import type { PineCore } from "./pineCore";
import {
  answerSessionOperation,
  sessionLibrary,
  startBackgroundSession,
} from "./requests/sessions";
import {
  childrenOf,
  messageText,
  parentOf,
  parentProjectOf,
} from "./subSessions";

/**
 * The main-process side of Pine's Assistant (shared/assistant.ts): finds its
 * conversation among No Project's sessions, answers its tools, and relays the
 * results of the sessions it dispatched, its sub-sessions in any project.
 */

const TEMP = TEMPORARY_WORKSPACE_PROJECT_ID;
/** Dispatched sessions the overview lists. */
const OVERVIEW_DISPATCHED_MAX = 10;
const REPLY_MAX = 2_000;
const REQUEST_MAX = 800;

/** What the desktop sends the Assistant; its target is always its thread. */
export interface AssistantPromptRequest {
  locale: "en-US" | "zh-CN";
  message: string;
  streamingBehavior?: "follow-up" | "steer";
  rewrite?: PromptSessionRequest["rewrite"];
  /** The composer's mode; the Assistant never runs in YOLO. */
  approvalMode?: PineApprovalMode;
}

const OperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("overview") }),
  z.object({
    op: z.literal("dispatch"),
    projectId: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    message: z.string().trim().min(1).max(100_000),
    approvalMode: z.enum([
      "let-me-review",
      "auto-approve",
      "autonomous",
      "YOLO",
    ]),
    locale: z.enum(["en-US", "zh-CN"]),
    attachmentIds: z
      .array(z.string().trim().min(1).max(100))
      .max(ASSISTANT_DISPATCH_ATTACHMENTS_MAX)
      .optional(),
  }),
  z.object({
    op: z.literal("digest"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({ op: z.literal("settings") }),
  z.object({ op: z.literal("projects") }),
  z.object({ op: z.literal("automations"), projectId: z.uuid().optional() }),
  z.object({
    op: z.enum(["automation", "automation-disable", "automation-run"]),
    projectId: z.uuid(),
    automationId: z.string().min(1).max(200),
  }),
  z.object({
    op: z.literal("session"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({
    op: z.literal("session-send"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
    message: z.string().trim().min(1).max(100_000),
    locale: z.enum(["en-US", "zh-CN"]),
    confirmed: z.boolean(),
  }),
  z.object({
    op: z.literal("session-stop"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
    confirmed: z.boolean(),
  }),
  z.object({
    op: z.literal("session-rename"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    confirmed: z.boolean(),
  }),
]);

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function lastOf(
  messages: readonly PineTextMessage[],
  role: "user" | "assistant",
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== role) continue;
    const text = messageText(
      message.blocks.filter((block) => block.type === "text"),
    );
    if (text) return text;
  }
  return undefined;
}

function triggerWords(trigger: AutomationTriggerFact): string {
  switch (trigger.kind) {
    case "schedule":
      return "schedule";
    case "folder":
      return `folder ${trigger.folder.folderName}`;
    case "system":
      return `system event ${trigger.event}`;
    case "script":
      return `script every ${trigger.every}`;
    case "manual":
      return "manual";
  }
}

function automationFact(
  automation: AutomationSummary,
): AssistantAutomationFact {
  return {
    id: automation.id,
    projectId: automation.projectId,
    projectName: automation.projectName,
    name: automation.name,
    ...(automation.description ? { description: automation.description } : {}),
    status:
      automation.status === "active"
        ? "active"
        : automation.status === "paused"
          ? "paused"
          : "off",
    triggers: [...automation.triggers],
    ...(automation.nextRunAt ? { nextRunAt: automation.nextRunAt } : {}),
    ...(automation.lastRun
      ? {
          lastRun: {
            status: automation.lastRun.status,
            at: automation.lastRun.at,
          },
        }
      : {}),
    running: automation.running,
  };
}

/** A wake-up of the Assistant whose reply still has to reach the user. */
interface PendingWake {
  thread: string;
  label: string;
  /** Shown as a desktop notification once the reply is written. */
  desktop: boolean;
}

/** Where the latest message to the Assistant came from, and its limit. */
interface AssistantTurn {
  source: AssistantTurnSource;
  /** Dispatches of this turn run at most this unsupervised (WeChat's ceiling). */
  ceiling?: PineApprovalMode;
}

export interface AssistantSendOptions {
  locale: "en-US" | "zh-CN";
  source: AssistantTurnSource;
  ceiling?: PineApprovalMode;
  /** The Assistant is mid-turn: the message steers it. */
  steer?: boolean;
  /** Files sent with the message, already in the Assistant's storage. */
  attachments?: readonly PineAttachment[];
}

/** The more supervised of two modes. */
function lowerMode(a: PineApprovalMode, b: PineApprovalMode): PineApprovalMode {
  return APPROVAL_MODE_ORDER.indexOf(a) <= APPROVAL_MODE_ORDER.indexOf(b)
    ? a
    : b;
}

export class AssistantService {
  /** The latest message's source; a dispatch reads it, never the model. */
  private turn: AssistantTurn = { source: "desktop" };
  /**
   * Each session the Assistant dispatches in a WeChat turn. PineCore hands
   * it to the WeChat bridge, which sends its approval cards there.
   */
  onDispatched?: (dispatch: {
    parentSessionId: string;
    sessionId: string;
    projectId: string;
  }) => void;
  /**
   * A session dispatched from WeChat woke the Assistant with its result: the
   * bridge pushes its reply, and `.u 9` reaches the reported session.
   * Resolves false when WeChat cannot take it now (paused, or too little of
   * the reply budget left), and the reply becomes a desktop notification
   * instead.
   */
  onWakeForWeChat?: (
    thread: string,
    reported: { sessionId: string; projectId: string },
  ) => Promise<boolean>;
  /** Shows an Assistant reply at the OS level. */
  notify?: (notification: { title: string; body: string }) => void;
  /** The interface language, for notifications. */
  locale: () => "en-US" | "zh-CN" = () => "en-US";
  /** Wake-ups whose reply has yet to reach the user. */
  private wakes: PendingWake[] = [];

  constructor(private readonly core: PineCore) {}

  /**
   * The Assistant's conversations, newest first: the No Project sessions
   * flagged as its own, live or stored. Clearing deletes one, so normally
   * there is at most one.
   */
  private async conversations(): Promise<PineSessionSummary[]> {
    const { runtimes } = this.core;
    const live = new Map<string, PineSessionSummary>();
    for (const id of runtimes.liveSessionIdsOf(TEMP)) {
      const summary = runtimes.summaryOfLiveSession(id);
      if (summary?.orchestrator) live.set(id, summary);
    }
    const stored = await listOrchestratorSessions(sessionLibrary(this.core));
    return [
      ...live.values(),
      ...stored.filter((session) => !live.has(session.id)),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Every conversation of the Assistant, for "From Orchestrator". */
  async conversationIds(): Promise<ReadonlySet<string>> {
    return new Set((await this.conversations()).map((session) => session.id));
  }

  /** Whether the session, in that project, is a conversation of the Assistant. */
  async isConversation(sessionId: string, projectId: string): Promise<boolean> {
    if (!isTemporaryWorkspace(projectId)) return false;
    const live = this.core.runtimes.summaryOfLiveSession(sessionId);
    if (live) return live.orchestrator === true;
    return (await this.conversationIds()).has(sessionId);
  }

  /** Whether a window's message is for the Assistant. */
  async isPromptFor(target: PromptSessionRequest["target"]): Promise<boolean> {
    return target.kind === "new"
      ? target.orchestrator === true
      : this.isConversation(target.sessionId, target.projectId);
  }

  /** The Assistant's conversation, if it has one: the most recent. */
  async thread(): Promise<string | undefined> {
    return (await this.threadSummary())?.id;
  }

  private async threadSummary(): Promise<PineSessionSummary | undefined> {
    return (await this.conversations())[0];
  }

  /** What a window needs to show the Assistant. */
  async describeState(): Promise<AssistantState> {
    const session = await this.threadSummary();
    return session ? { session } : {};
  }

  /**
   * The mode the Assistant's conversation runs in: what the user picked in
   * its composer, as for any session, never YOLO. Its dispatches may use no
   * looser mode.
   */
  private async threadMode(
    thread: string | undefined,
    requested: PineApprovalMode | undefined,
  ): Promise<PineApprovalMode> {
    const mode =
      requested ??
      (thread
        ? (this.core.runtimes.approvalModeOfLiveSession(thread) ??
          (await this.threadSummary())?.approvalMode)
        : undefined) ??
      ASSISTANT_APPROVAL_MODE;
    return mode === "YOLO" ? "autonomous" : mode;
  }

  /**
   * The client to reach the conversation through: one holding the runtime
   * it is live in, the requester first; else the requester if it holds No
   * Project; else the Assistant's virtual client, which holds No Project
   * while no window does.
   */
  private async clientFor(
    clientId: number,
    thread: string | undefined,
  ): Promise<number> {
    const { repository, runtimes } = this.core;
    const holders = thread ? runtimes.clientsOfSession(thread) : [];
    if (holders.length > 0)
      return holders.includes(clientId) ? clientId : (holders[0] ?? clientId);
    if (runtimes.isOpen(clientId, TEMP)) return clientId;
    if (!runtimes.isOpen(ASSISTANT_CLIENT_ID, TEMP))
      await runtimes.share(
        ASSISTANT_CLIENT_ID,
        await repository.open(TEMP),
        repository.dataPaths(TEMP),
      );
    return ASSISTANT_CLIENT_ID;
  }

  /**
   * Sends the Assistant a message in its conversation, starting one on
   * first use, like any session: in the mode its composer shows and on its
   * own model, the default model for a new one.
   */
  async prompt(
    clientId: number,
    request: AssistantPromptRequest,
    options: { focus?: boolean } = {},
    turn: AssistantTurn = { source: "desktop" },
  ): Promise<PromptSessionResult> {
    const thread = await this.thread();
    const sender = await this.clientFor(clientId, thread);
    const approvalMode = await this.threadMode(thread, request.approvalMode);
    // A message into a running turn keeps that turn's limit: the desktop
    // cannot lift a WeChat ceiling mid-turn.
    const ceiling =
      request.streamingBehavior && this.turn.ceiling
        ? turn.ceiling
          ? lowerMode(turn.ceiling, this.turn.ceiling)
          : this.turn.ceiling
        : turn.ceiling;
    this.turn = { source: turn.source, ...(ceiling ? { ceiling } : {}) };
    return this.core.runtimes.prompt(
      sender,
      {
        locale: request.locale,
        message: request.message,
        target: thread
          ? { kind: "session", projectId: TEMP, sessionId: thread }
          : { kind: "new", projectId: TEMP, orchestrator: true },
        approvalMode,
        ...(request.streamingBehavior
          ? { streamingBehavior: request.streamingBehavior }
          : {}),
        ...(thread && request.rewrite ? { rewrite: request.rewrite } : {}),
      },
      sender === clientId ? options : { ...options, focus: false },
    );
  }

  /**
   * Sends the user's message from elsewhere than a window, such as WeChat,
   * into the same conversation as the desktop's, marked with its source.
   * Resolves once the message is accepted. `ceiling` bounds what this turn
   * dispatches, below the Assistant's own mode.
   */
  async send(
    message: string,
    options: AssistantSendOptions,
  ): Promise<{ sessionId: string; projectId: string }> {
    const result = await this.prompt(
      ASSISTANT_CLIENT_ID,
      {
        locale: options.locale,
        // The prompt picks its WeChat style by this mark; displays strip
        // it with readAssistantMessage.
        // Attachments go first, as from any composer; the mark then heads
        // the text, where displays and the model's view look for it.
        message: serializeAttachmentMessage(
          options.attachments ?? [],
          options.source === "wechat" ? markWeChatMessage(message) : message,
        ),
        ...(options.steer ? { streamingBehavior: "steer" as const } : {}),
      },
      { focus: false },
      {
        source: options.source,
        ...(options.ceiling ? { ceiling: options.ceiling } : {}),
      },
    );
    return { sessionId: result.session.id, projectId: TEMP };
  }

  /**
   * Sessions were deleted. A deleted conversation's pending replies go with
   * it; the next message starts a new one.
   */
  sessionsDeleted(sessionIds: readonly string[]): void {
    this.wakes = this.wakes.filter((wake) => !sessionIds.includes(wake.thread));
  }

  /**
   * The attachments the user sent in the Assistant's conversation, by the
   * ids its model sees. Only the user's own messages count, so the model
   * cannot name a file the user did not attach.
   */
  private async conversationAttachments(
    requester: { sessionId: string; ownerId: number },
    ids: readonly string[],
  ): Promise<PineAttachment[]> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return [];
    const page = await this.core.runtimes.loadMessages(
      await this.clientFor(requester.ownerId, requester.sessionId),
      TEMP,
      requester.sessionId,
      undefined,
      1,
      true,
    );
    const known = new Map<string, PineAttachment>();
    for (const message of page.outline ?? [])
      for (const block of message.blocks)
        if (block.type === "text")
          for (const attachment of parseAttachmentMessage(block.text)
            .attachments)
            known.set(assistantAttachmentId(attachment), attachment);
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0)
      throw new Error(
        `No attachment ${unknown.join(", ")} in this conversation. Use the ids of an <attachments> list the user sent here.`,
      );
    return wanted.flatMap((id) => {
      const attachment = known.get(id);
      return attachment ? [attachment] : [];
    });
  }

  /**
   * The attachments as the dispatched session gets them, the way its own
   * would be stored: a file Pine keeps for the Assistant (pasted, or from
   * WeChat) is copied into the project's attachment storage; the user's own
   * files, folders and sessions go by reference, granting it read access.
   */
  private async forwardAttachments(
    attachments: readonly PineAttachment[],
    project: PineProject,
  ): Promise<PineAttachment[]> {
    if (attachments.length === 0) return [];
    const { repository } = this.core;
    const ownRoot = path.resolve(repository.dataPaths(TEMP).attachmentsRoot);
    const targetRoot = path.resolve(
      repository.dataPaths(project.id).attachmentsRoot,
    );
    const forwarded: PineAttachment[] = [];
    for (const attachment of attachments) {
      const relative = path.relative(ownRoot, path.resolve(attachment.path));
      const stored =
        attachment.kind !== "session" &&
        attachment.kind !== "directory" &&
        relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative);
      if (!stored) {
        forwarded.push(attachment);
        continue;
      }
      await mkdir(targetRoot, { recursive: true });
      const extension = path.extname(attachment.path);
      const target = path.join(targetRoot, `${randomUUID()}${extension}`);
      try {
        await copyFile(attachment.path, target);
      } catch (error) {
        throw new Error(
          `${attachment.name} could not be handed on: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const copied = await stat(target);
      forwarded.push({
        ...attachment,
        path: target,
        size: copied.size,
        modifiedAt: copied.mtime.toISOString(),
      });
    }
    return forwarded;
  }

  /** The client to read a project's sessions as, sharing it if no one does. */
  private async holdProject(project: PineProject): Promise<number> {
    const { repository, runtimes } = this.core;
    const owner = runtimes.ownerOfProject(project.id) ?? ASSISTANT_CLIENT_ID;
    if (!runtimes.isOpen(owner, project.id))
      await runtimes.share(
        owner,
        await repository.open(project.id),
        repository.dataPaths(project.id),
      );
    return owner;
  }

  private projectName(project: PineProject): string {
    return isTemporaryWorkspace(project.id) ? "No Project" : project.name;
  }

  private describe(
    project: PineProject,
    id: string,
    dispatched: boolean,
    title?: string,
    updatedAt?: string,
  ): AssistantOverviewSession {
    const name = this.core.runtimes.summaryOfLiveSession(id)?.name ?? title;
    return {
      id,
      projectId: project.id,
      projectName: this.projectName(project),
      ...(name ? { title: name } : {}),
      state: this.core.sessionActivity(id),
      ...(updatedAt ? { updatedAt } : {}),
      ...(dispatched ? { dispatched: true as const } : {}),
    };
  }

  /** Answers a tool of the Assistant's conversation, and only of it. */
  async answer(
    requester: { sessionId: string; ownerId: number },
    operation: AssistantHostOperation,
  ): Promise<AssistantHostResult> {
    const { repository, runtimes } = this.core;
    if (!runtimes.summaryOfLiveSession(requester.sessionId)?.orchestrator)
      throw new Error("Only Pine's Orchestrator can use this tool.");
    const parsed = OperationSchema.parse(operation);
    this.ownMode = runtimes.approvalModeOfLiveSession(requester.sessionId);
    const projects = await repository.list();
    const byId = new Map(projects.map((project) => [project.id, project]));
    const isOwn = (project: PineProject, id: string) =>
      parentOf(project, id) === requester.sessionId &&
      parentProjectOf(project, id) === TEMP;

    if (parsed.op === "overview") {
      const active: AssistantOverviewSession[] = [];
      let pendingApprovals = 0;
      for (const project of projects)
        for (const id of runtimes.liveSessionIdsOf(project.id)) {
          if (id === requester.sessionId) continue;
          const session = this.describe(project, id, isOwn(project, id));
          if (session.state === "awaiting-approval") pendingApprovals += 1;
          if (session.state !== "idle") active.push(session);
        }
      const dispatched: AssistantOverviewSession[] = [];
      for (const project of projects) {
        const children = new Set(
          childrenOf(project, requester.sessionId).filter((id) =>
            isOwn(project, id),
          ),
        );
        if (children.size === 0) continue;
        for (const session of await listProjectSessions(
          project,
          sessionLibrary(this.core),
        ))
          if (children.has(session.id))
            dispatched.push(
              this.describe(
                project,
                session.id,
                true,
                session.name,
                session.updatedAt,
              ),
            );
      }
      dispatched.sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
      );
      dispatched.splice(OVERVIEW_DISPATCHED_MAX);
      return {
        op: "overview",
        overview: {
          projects: projects.map((project) => ({
            id: project.id,
            name: this.projectName(project),
            ...(isTemporaryWorkspace(project.id)
              ? { temporaryWorkspace: true as const }
              : {}),
          })),
          active,
          dispatched,
          pendingApprovals,
        },
      };
    }

    switch (parsed.op) {
      case "settings":
        return { op: "settings", settings: await this.settingFacts() };
      case "projects":
        return {
          op: "projects",
          projects: projects.map((project) => ({
            id: project.id,
            name: this.projectName(project),
            folders: project.folders.map((folder) => ({
              path: folder.path,
              readOnly: folder.access === "read-only",
            })),
            ...(isTemporaryWorkspace(project.id)
              ? { temporaryWorkspace: true as const }
              : {}),
          })),
        };
      case "automations": {
        if (parsed.projectId && !byId.has(parsed.projectId))
          throw new Error("That project does not exist.");
        const automations = await this.core.automations.list(parsed.projectId);
        return {
          op: "automations",
          automations: automations
            .filter((automation) => byId.has(automation.projectId))
            .map(automationFact),
        };
      }
      case "automation":
      case "automation-disable":
      case "automation-run":
        return this.answerAutomation(parsed, byId);
      default:
        break;
    }

    if (
      parsed.op === "session" ||
      parsed.op === "session-send" ||
      parsed.op === "session-stop" ||
      parsed.op === "session-rename"
    )
      return this.answerSession(requester, parsed, byId);

    const project = byId.get(parsed.projectId);
    if (!project) throw new Error("That project does not exist.");

    if (parsed.op === "dispatch") {
      const callerMode = runtimes.approvalModeOfLiveSession(
        requester.sessionId,
      );
      if (!callerMode) throw new Error("The Assistant is no longer open.");
      if (!approvalModeWithin(parsed.approvalMode, callerMode))
        throw new Error(
          `The Orchestrator runs in ${callerMode}; it cannot dispatch a session in ${parsed.approvalMode}.`,
        );
      // A turn from WeChat dispatches within WeChat's ceiling, like `.new`:
      // the mode is lowered to it rather than refused, since the model
      // asks for its own mode by default.
      const turn = this.turn;
      // Before anything starts: an unknown id refuses the whole dispatch.
      const attachments = await this.conversationAttachments(
        requester,
        parsed.attachmentIds ?? [],
      );
      const approvalMode = turn.ceiling
        ? lowerMode(parsed.approvalMode, turn.ceiling)
        : parsed.approvalMode;
      // Like WeChat: a window that shows the project owns the new session,
      // so its approvals appear there; otherwise the Assistant holds it.
      if (!runtimes.isOpen(requester.ownerId, project.id))
        await runtimes.share(
          requester.ownerId,
          await repository.open(project.id),
          repository.dataPaths(project.id),
        );
      const ownerId =
        runtimes
          .clientsSharingRuntime(requester.ownerId, project.id)
          .find((id) => !isVirtualClient(id)) ?? requester.ownerId;
      const forwarded = await this.forwardAttachments(attachments, project);
      // A sub-session of the Assistant's conversation, in another project.
      const result = await startBackgroundSession(this.core, {
        ownerId,
        project,
        message: serializeAttachmentMessage(
          forwarded,
          `[Dispatched by Pine's Orchestrator. Pine reports your reply to the Orchestrator each time you finish a turn, so end with what the user needs to know.]\n\n${parsed.message}`,
        ),
        approvalMode,
        locale: parsed.locale,
        ...(parsed.title ? { title: parsed.title } : {}),
        parentSessionId: requester.sessionId,
        parentProjectId: TEMP,
      });
      if (turn.source === "wechat")
        try {
          this.onDispatched?.({
            parentSessionId: requester.sessionId,
            sessionId: result.session.id,
            projectId: project.id,
          });
        } catch (error) {
          console.error("Failed to report a dispatch.", error);
        }
      return {
        op: "dispatch",
        sessionId: result.session.id,
        projectId: project.id,
        projectName: this.projectName(project),
        approvalMode,
        ...(forwarded.length > 0 ? { attachments: forwarded.length } : {}),
      };
    }

    const known = (
      await listProjectSessions(project, sessionLibrary(this.core))
    ).find((session) => session.id === parsed.sessionId);
    if (!known)
      throw new Error(
        `No session ${parsed.sessionId} in ${this.projectName(project)}.`,
      );
    const owner = await this.holdProject(project);
    const page = await runtimes.loadMessages(
      owner,
      project.id,
      known.id,
      undefined,
      10,
    );
    const lastReply = lastOf(page.messages, "assistant");
    const lastRequest = lastOf(page.messages, "user");
    const digest: AssistantDigest = {
      session: this.describe(
        project,
        known.id,
        isOwn(project, known.id),
        known.name,
        known.updatedAt,
      ),
      messageCount: known.messageCount,
      ...(lastReply ? { lastReply: truncate(lastReply, REPLY_MAX) } : {}),
      ...(lastRequest
        ? {
            lastRequest: truncate(withoutRelayPrefix(lastRequest), REQUEST_MAX),
          }
        : {}),
    };
    return { op: "digest", digest };
  }

  /**
   * Adds a notice to the Assistant's conversation when a session it
   * dispatched ends a turn or waits for approval. A turn that ends wakes
   * it to relay the result where the work was asked for: WeChat, for a
   * session dispatched from there, while WeChat can take it; otherwise its
   * conversation and a desktop notification. An approval waits on its own
   * card instead.
   */
  async relay(
    thread: string,
    notice: PineSessionNotice,
    content: string,
  ): Promise<void> {
    await this.liveThread(thread);
    const relays = notice.state !== "awaiting-approval";
    const label =
      notice.title ??
      (isTemporaryWorkspace(notice.projectId)
        ? "No Project"
        : ((
            await this.core.repository
              .get(notice.projectId)
              .catch(() => undefined)
          )?.name ?? ""));
    if (relays) {
      const source: AssistantTurnSource =
        this.core.wechat.originOf(notice.sessionId) === "wechat"
          ? "wechat"
          : "desktop";
      // Like a reminder: what the relay starts stays fully supervised.
      if (this.core.sessionActivity(thread) === "idle")
        this.turn = { source, ceiling: "let-me-review" };
      const toWeChat =
        source === "wechat" &&
        ((await this.onWakeForWeChat?.(thread, {
          sessionId: notice.sessionId,
          projectId: notice.projectId,
        }).catch(() => false)) ??
          false);
      this.wakes.push({ thread, label, desktop: !toWeChat });
    }
    const delivered = await this.core.agentHost.notifySession(
      thread,
      notice,
      content,
      { triggerTurn: relays },
    );
    if (relays && !delivered.delivered) {
      this.wakes = this.wakes.filter((wake) => wake.thread !== thread);
      this.notifyDesktop(label);
    }
  }

  /**
   * Whether the Orchestrator relays this live session's results, so the
   * session itself raises no completion signal.
   */
  async relaysResultsOf(sessionId: string): Promise<boolean> {
    const projectId = this.core.runtimes.projectOfLiveSession(sessionId)?.id;
    if (!projectId) return false;
    const project = await this.core.repository
      .get(projectId)
      .catch(() => undefined);
    const parent = project && parentOf(project, sessionId);
    return project !== undefined && parent !== undefined
      ? this.isConversation(parent, parentProjectOf(project, sessionId))
      : false;
  }

  /** Opens the Assistant's conversation if it is not live. */
  private async liveThread(thread: string): Promise<void> {
    const { runtimes } = this.core;
    if (runtimes.clientsOfSession(thread).length > 0) return;
    await runtimes.resume(
      await this.clientFor(ASSISTANT_CLIENT_ID, thread),
      TEMP,
      thread,
      { focus: false },
    );
  }

  private notifyDesktop(body: string): void {
    try {
      this.notify?.({
        title: ASSISTANT_DISPLAY_NAME[this.locale()],
        body: truncate(body.replace(/\s+/g, " ").trim(), 200),
      });
    } catch (error) {
      console.error("Failed to show an Assistant notification.", error);
    }
  }

  /**
   * A turn of some session ended. When it was the Assistant answering a
   * wake-up that WeChat will not carry, its reply becomes a desktop
   * notification.
   */
  async turnEnded(sessionId: string, state: "idle" | "failed"): Promise<void> {
    const pending = this.wakes.filter((wake) => wake.thread === sessionId);
    if (!pending.length) return;
    this.wakes = this.wakes.filter((wake) => wake.thread !== sessionId);
    const desktop = pending.filter((wake) => wake.desktop);
    if (!desktop.length) return;
    let reply: string | undefined;
    if (state === "idle") {
      try {
        const page = await this.core.runtimes.loadMessages(
          await this.clientFor(ASSISTANT_CLIENT_ID, sessionId),
          TEMP,
          sessionId,
          undefined,
          4,
        );
        reply = lastOf(page.messages, "assistant");
      } catch {
        // Fall back to the reminder's own words.
      }
    }
    this.notifyDesktop(reply ?? desktop.map((wake) => wake.label).join(" · "));
  }

  /** The settings the Assistant may read; it can change none of them. */
  private async settingFacts(): Promise<AssistantSettingFact[]> {
    const { runtimes, wechat } = this.core;
    const [catalog, agent, own] = await Promise.all([
      runtimes.getModelCatalog().catch(() => undefined),
      readPineAgentSettings(this.core.agentDirectory).catch(() => undefined),
      this.threadSummary(),
    ]);
    const model = (selection: PineModelSelection | undefined) =>
      selection
        ? `${selection.providerId}/${selection.modelId} (reasoning ${selection.thinkingLevel})`
        : "none";
    const groups = resolvePineToolGroups(agent?.toolGroups);
    const off = Object.entries(groups)
      .filter(([, on]) => !on)
      .map(([id]) => id);
    const status = wechat.status();
    const currency = this.core.displayCurrency().currency;
    return [
      {
        where: "Default model (the composer's model menu)",
        value: model(catalog?.selection),
      },
      {
        where: "Your own model (your conversation's model menu)",
        value: own?.modelSelection
          ? model(own.modelSelection)
          : model(catalog?.selection),
      },
      {
        where:
          "Your own permission mode (your conversation's permission mode menu; the most a dispatched session may use)",
        value: await this.threadMode(own?.id, undefined),
      },
      {
        where: "Settings › Agent › Remember across sessions",
        value: agent?.memoryEnabled === false ? "off" : "on",
      },
      {
        where: "Settings › Agent › Tools",
        value: off.length ? `off: ${off.join(", ")}` : "all on",
      },
      {
        where: "Settings › Agent › Share approximate location with AI",
        value: agent?.approximateLocationEnabled === false ? "off" : "on",
      },
      { where: "Settings › General › Language", value: this.locale() },
      { where: "Settings › General › Currency", value: currency },
      {
        where: "Settings › Remote control › WeChat",
        value: status.bound
          ? status.paused
            ? "connected, paused"
            : "connected"
          : "not connected",
      },
      ...(status.bound
        ? [
            {
              where:
                "Settings › Remote control › WeChat › Highest approval mode",
              value: status.settings.ceilingMode,
            },
            {
              where:
                "Settings › Remote control › WeChat › Plain messages go to",
              value:
                status.settings.plainTarget === "assistant"
                  ? "Orchestrator"
                  : "Current session",
            },
            {
              where:
                "Settings › Remote control › WeChat › Allow approving high-risk actions from WeChat",
              value: status.settings.allowHighRiskApprovals ? "on" : "off",
            },
            {
              where:
                "Settings › Remote control › WeChat › Allow sending files to WeChat",
              value: status.settings.allowFileSending ? "on" : "off",
            },
          ]
        : []),
    ];
  }

  private async answerAutomation(
    parsed: {
      op: "automation" | "automation-disable" | "automation-run";
      projectId: string;
      automationId: string;
    },
    byId: ReadonlyMap<string, PineProject>,
  ): Promise<AssistantHostResult> {
    if (!byId.has(parsed.projectId))
      throw new Error("That project does not exist.");
    const { automations } = this.core;
    const summary = (await automations.list(parsed.projectId)).find(
      (candidate) => candidate.id === parsed.automationId,
    );
    if (!summary)
      throw new Error(
        "No such automation. Call automation_list for the current list.",
      );
    if (parsed.op === "automation-disable") {
      const changed = summary.status === "active";
      if (changed)
        await automations.setEnabled(
          { projectId: summary.projectId, source: "web" },
          summary.id,
          false,
        );
      return { op: "automation-disable", name: summary.name, changed };
    }
    const refusal = this.runRefusal(summary);
    if (parsed.op === "automation-run") {
      if (refusal) throw new Error(refusal);
      try {
        automations.runNow(summary.projectId, summary.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/already running|about to run/i.test(message))
          throw new Error(`“${summary.name}” is already running.`);
        throw error;
      }
      return { op: "automation-run", name: summary.name };
    }
    const { facts } = await automations.get(summary.projectId, summary.id);
    const detail: AssistantAutomationDetail = {
      ...automationFact(summary),
      triggers: facts.triggers.map(triggerWords),
      reads: facts.read.map((folder) => folder.folderName),
      writes: facts.write.map((folder) => folder.folderName),
      network: [...facts.network],
      ...(refusal ? { runRefusal: refusal } : {}),
    };
    return { op: "automation", automation: detail };
  }

  /**
   * Why an automation cannot run now, the way WeChat's `.auto N run` says:
   * it runs as Autonomous Work, so the Assistant's mode, and a WeChat turn's
   * ceiling, must allow that; and it must be on and not already running.
   */
  private runRefusal(automation: AutomationSummary): string | undefined {
    const thread = this.turn;
    const ceilings: PineApprovalMode[] = [
      this.ownMode ?? "auto-approve",
      ...(thread.ceiling ? [thread.ceiling] : []),
    ];
    const ceiling = ceilings.reduce(lowerMode);
    if (!approvalModeWithin("autonomous", ceiling))
      return `Automations run as Autonomous Work, above your current limit (${ceiling}). The user can run it in Pine on the computer, or raise the limit there.`;
    if (automation.status !== "active")
      return `“${automation.name}” is not on, so it cannot run. Only the user can turn it on, on the computer.`;
    if (automation.running) return `“${automation.name}” is already running.`;
    return undefined;
  }

  /** The Assistant's own mode as last answered, for automation checks. */
  private ownMode: PineApprovalMode | undefined;

  private async sessionFact(
    requester: string,
    byId: ReadonlyMap<string, PineProject>,
    projectId: string,
    sessionId: string,
  ): Promise<AssistantSessionFactWithProject> {
    const project = byId.get(projectId);
    if (!project) throw new Error("That project does not exist.");
    const known = (
      await listProjectSessions(project, sessionLibrary(this.core))
    ).find((session) => session.id === sessionId);
    if (!known)
      throw new Error(
        `No session ${sessionId} in ${this.projectName(project)}.`,
      );
    const title =
      this.core.runtimes.summaryOfLiveSession(sessionId)?.name ?? known.name;
    return {
      sessionId,
      projectId,
      projectName: this.projectName(project),
      ...(title ? { title } : {}),
      state: this.core.sessionActivity(sessionId),
      dispatched:
        parentOf(project, sessionId) === requester &&
        parentProjectOf(project, sessionId) === TEMP,
      project,
    };
  }

  private async answerSession(
    requester: { sessionId: string; ownerId: number },
    parsed:
      | { op: "session"; projectId: string; sessionId: string }
      | {
          op: "session-send";
          projectId: string;
          sessionId: string;
          message: string;
          locale: "en-US" | "zh-CN";
          confirmed: boolean;
        }
      | {
          op: "session-stop";
          projectId: string;
          sessionId: string;
          confirmed: boolean;
        }
      | {
          op: "session-rename";
          projectId: string;
          sessionId: string;
          title: string;
          confirmed: boolean;
        },
    byId: ReadonlyMap<string, PineProject>,
  ): Promise<AssistantHostResult> {
    const { project, ...session } = await this.sessionFact(
      requester.sessionId,
      byId,
      parsed.projectId,
      parsed.sessionId,
    );
    if (parsed.op === "session") return { op: "session", session };
    // Only sessions it dispatched, or ones the user confirmed on a card.
    if (!session.dispatched && !parsed.confirmed)
      throw new Error(
        "That session was not dispatched by you; the user has to confirm acting on it.",
      );
    if (parsed.op === "session-rename") {
      const owner = await this.holdProject(project);
      await this.core.runtimes.renameSession(
        owner,
        project.id,
        parsed.sessionId,
        parsed.title,
        "agent",
      );
      this.core.notifyLibraryChanged("sessions");
      return { op: "session-rename", title: parsed.title };
    }
    if (parsed.op === "session-stop") {
      const result = await answerSessionOperation(this.core, requester, {
        op: "stop",
        projectId: project.id,
        sessionId: parsed.sessionId,
      });
      if (result.op !== "stop") throw new Error("Pine could not stop it.");
      return { op: "session-stop", stopped: result.stopped };
    }
    const result = await answerSessionOperation(this.core, requester, {
      op: "send",
      projectId: project.id,
      sessionId: parsed.sessionId,
      message: parsed.message,
      locale: parsed.locale,
    });
    if (result.op !== "send") throw new Error("Pine could not send it.");
    return { op: "session-send", delivered: result.delivered };
  }
}

type AssistantSessionFactWithProject = AssistantSessionFact & {
  project: PineProject;
};
