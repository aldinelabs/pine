import { approvalModeFromEntries } from "../../shared/sessions";
import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import type {
  AgentSession,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  RECALL_TOOL_NAME,
  REPORT_PROGRESS_TOOL_NAME,
  type PineAgentEvent,
  type PineApprovalMode,
  type PineMessageRewriteTarget,
  type PinePromptChannel,
} from "../../shared/agent";
import type { McpStatusSnapshot } from "pi-mcp-adapter";
import type { McpScriptApprovalCache } from "../mcp-approval";
import type { PineProviderAuthEvent } from "../../shared/models";
import type {
  PineContextCompactionRoute,
  PineContextCompactionStrategy,
} from "../../shared/preferences";
import { sessionActivityAt } from "../../shared/sessionActivity";
import type { PineSessionSummary } from "../../shared/sessions";
import {
  PINE_AUTHORIZATION_GRANT_ENTRY,
  PINE_COMPUTER_USE_ACTIVE_ENTRY,
  PINE_MEDIA_GENERATION_ACTIVE_ENTRY,
  PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
  PINE_AUTOMATION_AUTHORING_ACTIVE_ENTRY,
  PINE_MCP_AUTHORING_ACTIVE_ENTRY,
} from "../../shared/sessions";
import { MCP_AUTHORING_DYNAMIC_TOOL_NAMES } from "../../shared/mcp";
import { AUTOMATION_REPORT_TOOL_NAME } from "../../shared/automation";
import { AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES } from "../automation/tools";
import type { AgentAutomationRun } from "../protocol";
import type {
  AuthorizationGrant,
  GateTurnContext,
  ToolGate,
  UserApprovalRequest,
} from "../gate";
import type { PineAttachedPathAccess } from "../tools";
import type { ForegroundPromoter } from "../foreground-promotion";
import type { ComputerUseController } from "../computer-use/tools";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type { GateDecision } from "../protocol";
import {
  attachmentMessagePreview,
  attachmentFilePaths,
  parseAttachmentMessage,
  type AttachedSession,
  type PineAttachment,
} from "../../shared/attachments";
import { TINYFISH_TOOL_NAMES } from "../tinyfishTools";
import { COMPUTER_USE_DYNAMIC_TOOL_NAMES } from "../computer-use/tools";
import { SKILL_AUTHORING_DYNAMIC_TOOL_NAMES } from "../skills/tools";
import { MEDIA_GENERATION_DYNAMIC_TOOL_NAMES } from "../media/tools";

export interface LiveAgentSession {
  session: AgentSession;
  queuedCompactionPrompts: Array<{
    message: string;
    approvalMode: PineApprovalMode;
    locale: "en-US" | "zh-CN";
  }>;
  resumingCompactionPrompts: boolean;
  cwd: string;
  mcpStatus?: McpStatusSnapshot;
  unsubscribe: () => void;
  agentDir: string;
  approvalMode: PineApprovalMode;
  gate: ToolGate;
  /** Reuses judge allows for repeated MCP script calls within one turn. */
  mcpScriptApprovals: McpScriptApprovalCache;
  /** Fallback while a newly submitted prompt has not reached session entries. */
  latestUserPrompt?: string;
  /**
   * Set once the session is used from WeChat (and on every message to a
   * WeChat session after a restart): it then never gets interactive answers.
   */
  promptChannel?: PinePromptChannel;
  authorizationGrants: AuthorizationGrant[];
  /** Paths directly attached by the user; read-only for file tools. */
  attachedPaths: PineAttachedPathAccess;
  availableToolNames: string[];
  computerUseActive: boolean;
  computerUseController?: ComputerUseController;
  mediaGenerationActive: boolean;
  /**
   * Activation tools the user already agreed to after choosing to compress
   * first; the next call to each one goes through without asking again.
   */
  preapprovedActivations: Set<string>;
  skillAuthoringActive: boolean;
  automationAuthoringActive: boolean;
  mcpAuthoringActive: boolean;
  /** An MCP config change waits for the run to end before reloading. */
  mcpReloadPending?: boolean;
  /** Whether the session file names a parent: this is a sub-session. */
  subSession: boolean;
  /** Preferences › Agent › Interim answers, read at each run start. */
  interimAnswersEnabled: boolean;
  /** Set for a read-only side chat forked from another conversation. */
  sideChat?: { parentSessionId: string; persistent: boolean };
  /** Set for an unattended automation run; its envelope replaces the tool list. */
  automation?: AgentAutomationRun;
  tinyFishApiKey?: string;
  locale: "en-US" | "zh-CN";
  contextCompactionStrategy: PineContextCompactionStrategy;
  contextCompactionRoute: PineContextCompactionRoute;
  /** The session's `bg_run` tasks; they stop when the session is disposed. */
  backgroundTasks?: BackgroundTaskRegistry;
  /** Coalesces task changes, including streamed output, into one event. */
  backgroundTaskEmitTimer?: ReturnType<typeof setTimeout>;
  /** Moves running shell calls to the background for "send now". */
  foregroundPromoter: ForegroundPromoter;
  /** Tool calls currently executing, by call ID, with their tool names. */
  activeToolCalls: Map<string, string>;
  /**
   * Steering messages held back while one message is sent now. The agent
   * delivers its whole steering queue at once, so the others wait outside it
   * until the sent message has been taken.
   */
  sendNow?: {
    target: string;
    held: string[];
    /** Set once events for the sent message are expected. */
    armed: boolean;
    consumed: boolean;
  };
}

export interface PineAgentRuntimeOptions {
  emit: (event: PineAgentEvent | PineProviderAuthEvent) => void;
}

export interface PendingUserApproval {
  resolve: (decision: GateDecision) => void;
  sessionId: string;
  toolCallId: string;
  live: LiveAgentSession;
  request: UserApprovalRequest;
  actionDigest: string;
}

export interface PendingQuestionnaire {
  resolve: (submission: AskUserQuestionSubmission) => void;
  sessionId: string;
  toolCallId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export { projectSessionDirectory } from "../../shared/sessionPaths";

export function sessionSummary(session: AgentSession): PineSessionSummary {
  const header = session.sessionManager.getHeader();
  const entries = session.sessionManager.getEntries();
  let messageCount = 0;
  for (const entry of entries) if (entry.type === "message") messageCount++;
  const createdAt = header?.timestamp ?? new Date().toISOString();

  return {
    approvalMode: approvalModeFromEntries(entries),
    id: session.sessionId,
    createdAt,
    // Same rule as the session list, so opening a session never moves it.
    updatedAt: sessionActivityAt(entries, Date.parse(createdAt), Date.now()),
    messageCount,
    ...(session.model
      ? {
          modelSelection: {
            providerId: session.model.provider,
            modelId: session.model.id,
            thinkingLevel: session.thinkingLevel,
          },
        }
      : {}),
    ...(session.sessionName ? { name: session.sessionName } : {}),
  };
}

/**
 * TinyFish tools need a credential. The approval mode never changes the tool
 * list, so switching modes keeps the provider's prompt cache intact.
 */
export function toolNamesForTinyFishCredential(
  toolNames: readonly string[],
  tinyFishEnabled: boolean,
): string[] {
  const isNetworkTool = (name: string) =>
    TINYFISH_TOOL_NAMES.includes(name as (typeof TINYFISH_TOOL_NAMES)[number]);
  const localTools = toolNames.filter((name) => !isNetworkTool(name));
  if (!tinyFishEnabled) return localTools;
  return [...localTools, ...toolNames.filter(isNetworkTool)];
}

/** Custom message type announcing the active permission mode to the model. */
export const PINE_APPROVAL_MODE_NOTICE = "pine.approval-mode-notice";

/**
 * The permission mode most recently announced in the model's context, or
 * undefined when none survives (a new session, or one compacted past it).
 */
export function announcedApprovalMode(
  messages: readonly unknown[],
): PineApprovalMode | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const message = value as Record<string, unknown>;
    if (
      message.role !== "custom" ||
      message.customType !== PINE_APPROVAL_MODE_NOTICE
    ) {
      continue;
    }
    const details = message.details;
    if (typeof details !== "object" || details === null) return undefined;
    const approvalMode = (details as { approvalMode?: unknown }).approvalMode;
    return typeof approvalMode === "string"
      ? (approvalMode as PineApprovalMode)
      : undefined;
  }
  return undefined;
}

/** `recall` searches pi-vcc summaries' history, so it follows the route. */
export function toolNamesForCompactionRoute(
  toolNames: readonly string[],
  route: PineContextCompactionRoute,
): string[] {
  if (route === "semantic") return [...toolNames];
  return toolNames.filter((name) => name !== RECALL_TOOL_NAME);
}

/**
 * The session that started a sub-session reads only the last reply of each
 * turn, so an interim answer would move findings out of the one message that
 * reaches it. Sub-sessions answer in their final reply alone.
 */
export function toolNamesForSubSession(
  toolNames: readonly string[],
  subSession: boolean,
): string[] {
  if (!subSession) return [...toolNames];
  return toolNames.filter((name) => name !== REPORT_PROGRESS_TOOL_NAME);
}

/** The Preferences switch for interim answers; off hides the tool from the model. */
export function toolNamesForInterimAnswers(
  toolNames: readonly string[],
  enabled: boolean,
): string[] {
  if (enabled) return [...toolNames];
  return toolNames.filter((name) => name !== REPORT_PROGRESS_TOOL_NAME);
}

export function toolNamesForComputerUseState(
  toolNames: readonly string[],
  active: boolean,
): string[] {
  if (active) return [...toolNames];
  return toolNames.filter(
    (name) => !COMPUTER_USE_DYNAMIC_TOOL_NAMES.includes(name),
  );
}

export function computerUseActiveFromSessionEntries(
  entries: readonly unknown[],
): boolean {
  return activeFlagFromSessionEntries(entries, PINE_COMPUTER_USE_ACTIVE_ENTRY);
}

export function skillAuthoringActiveFromSessionEntries(
  entries: readonly unknown[],
): boolean {
  return activeFlagFromSessionEntries(
    entries,
    PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
  );
}

export function automationAuthoringActiveFromSessionEntries(
  entries: readonly unknown[],
): boolean {
  return activeFlagFromSessionEntries(
    entries,
    PINE_AUTOMATION_AUTHORING_ACTIVE_ENTRY,
  );
}

export function mcpAuthoringActiveFromSessionEntries(
  entries: readonly unknown[],
): boolean {
  return activeFlagFromSessionEntries(entries, PINE_MCP_AUTHORING_ACTIVE_ENTRY);
}

export function mediaGenerationActiveFromSessionEntries(
  entries: readonly unknown[],
): boolean {
  return activeFlagFromSessionEntries(
    entries,
    PINE_MEDIA_GENERATION_ACTIVE_ENTRY,
  );
}

function activeFlagFromSessionEntries(
  entries: readonly unknown[],
  customType: string,
): boolean {
  return entries.some((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const entry = value as Record<string, unknown>;
    return (
      entry.type === "custom" &&
      entry.customType === customType &&
      typeof entry.data === "object" &&
      entry.data !== null &&
      !Array.isArray(entry.data) &&
      (entry.data as { active?: unknown }).active === true
    );
  });
}

export function toolNamesForAutomationAuthoringState(
  toolNames: readonly string[],
  active: boolean,
): string[] {
  return toolNames.filter(
    (name) =>
      name !== AUTOMATION_REPORT_TOOL_NAME &&
      (active ||
        !AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES.includes(
          name as (typeof AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES)[number],
        )),
  );
}

/**
 * An automation run sees exactly its approved tools and the report tool,
 * plus the MCP adapter's tools when it lists MCP grants. Which server tools
 * those may call is enforced call by call.
 */
export function toolNamesForAutomationRun(
  toolNames: readonly string[],
  run: AgentAutomationRun,
  mcpToolNames: readonly string[] = [],
): string[] {
  const allowed = new Set([...run.toolNames, AUTOMATION_REPORT_TOOL_NAME]);
  return [
    ...toolNames.filter((name) => allowed.has(name)),
    ...(run.mcp?.grants.length ? mcpToolNames : []),
  ];
}

export function toolNamesForSkillAuthoringState(
  toolNames: readonly string[],
  active: boolean,
): string[] {
  if (active) return [...toolNames];
  return toolNames.filter(
    (name) =>
      !SKILL_AUTHORING_DYNAMIC_TOOL_NAMES.includes(
        name as (typeof SKILL_AUTHORING_DYNAMIC_TOOL_NAMES)[number],
      ),
  );
}

export function toolNamesForMcpAuthoringState(
  toolNames: readonly string[],
  active: boolean,
): string[] {
  if (active) return [...toolNames];
  return toolNames.filter(
    (name) =>
      !MCP_AUTHORING_DYNAMIC_TOOL_NAMES.includes(
        name as (typeof MCP_AUTHORING_DYNAMIC_TOOL_NAMES)[number],
      ),
  );
}

export function toolNamesForMediaGenerationState(
  toolNames: readonly string[],
  active: boolean,
): string[] {
  if (active) return [...toolNames];
  return toolNames.filter(
    (name) =>
      !MEDIA_GENERATION_DYNAMIC_TOOL_NAMES.includes(
        name as (typeof MEDIA_GENERATION_DYNAMIC_TOOL_NAMES)[number],
      ),
  );
}

export function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        return [];
      }
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

export function approvalActionDigest(request: {
  trigger: string;
  toolName: string;
  subject?: string;
  description?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.trigger,
        request.toolName,
        request.subject ?? "",
        request.description ?? "",
      ]),
    )
    .digest("hex");
}

function isAuthorizationGrant(value: unknown): value is AuthorizationGrant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const grant = value as Partial<AuthorizationGrant>;
  return (
    typeof grant.id === "string" &&
    (grant.source === "judge" || grant.source === "user") &&
    (grant.scope === "once" || grant.scope === "session") &&
    typeof grant.toolName === "string" &&
    typeof grant.subject === "string" &&
    typeof grant.actionDigest === "string" &&
    typeof grant.createdAt === "string"
  );
}

/**
 * Resolve the user message entry a rewrite starts from. Messages loaded from
 * history carry their entry id; live messages only have renderer ids, so their
 * position from the end of the active branch identifies them instead.
 */
export function rewriteTargetEntryId(
  branch: readonly SessionEntry[],
  target: PineMessageRewriteTarget,
): string {
  const userEntries = branch.filter(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  const byId = userEntries.find((entry) => entry.id === target.messageId);
  if (byId) return byId.id;
  const byPosition = userEntries.at(-1 - target.userMessagesAfter);
  if (!byPosition)
    throw new Error("The message to edit is no longer in history.");
  return byPosition.id;
}

export function authorizationGrantsFromSessionEntries(
  entries: readonly unknown[],
): AuthorizationGrant[] {
  return entries.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const entry = value as Record<string, unknown>;
    if (
      entry.type !== "custom" ||
      entry.customType !== PINE_AUTHORIZATION_GRANT_ENTRY ||
      !isAuthorizationGrant(entry.data)
    ) {
      return [];
    }
    return [entry.data];
  });
}

function summarizeCausalEntry(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") return undefined;
  const { message } = entry;
  if (message.role === "assistant") {
    const parts = message.content.flatMap((block) => {
      if (block.type === "text") return [block.text];
      if (block.type === "toolCall") {
        return [`requested ${block.name}: ${JSON.stringify(block.arguments)}`];
      }
      // Raw model thinking is deliberately excluded from approval context.
      return [];
    });
    const summary = parts.join("\n").trim();
    return summary || undefined;
  }
  if (message.role === "toolResult") {
    const result = textFromMessageContent(message.content).trim();
    return `${message.toolName}${message.isError ? " failed" : " completed"}: ${result}`;
  }
  return undefined;
}

export function buildGateTurnContext(
  entries: readonly SessionEntry[],
  grants: readonly AuthorizationGrant[],
  latestUserPrompt?: string,
  subjects: readonly string[] = [],
): GateTurnContext {
  const userStatements = entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") return [];
    const text = attachmentMessagePreview(
      textFromMessageContent(entry.message.content),
    ).trim();
    return text ? [{ id: entry.id, text }] : [];
  });
  if (
    latestUserPrompt?.trim() &&
    userStatements.at(-1)?.text !== latestUserPrompt.trim()
  ) {
    userStatements.push({ id: "current-user-prompt", text: latestUserPrompt });
  }
  const rootGoal = userStatements[0];
  const relevanceTerms = [
    ...new Set(
      subjects.flatMap((subject) =>
        subject
          .toLocaleLowerCase()
          .split(/[^\p{L}\p{N}._/-]+/u)
          .filter((term) => term.length >= 4)
          .slice(0, 12),
      ),
    ),
  ];
  const matchesSubject = (text: string) => {
    const normalized = text.toLocaleLowerCase();
    return relevanceTerms.some((term) => normalized.includes(term));
  };
  const nonRootStatements = userStatements.filter(
    (statement) => statement.id !== rootGoal?.id,
  );
  const recentStatementIds = new Set(
    nonRootStatements.slice(-4).map((statement) => statement.id),
  );
  const recentUserStatements = nonRootStatements
    .filter(
      (statement) =>
        recentStatementIds.has(statement.id) || matchesSubject(statement.text),
    )
    .slice(-6);
  const causalEvents = entries.flatMap((entry) => {
    const summary = summarizeCausalEntry(entry);
    return summary
      ? [
          {
            id: entry.id,
            kind:
              entry.type === "message" && entry.message.role === "toolResult"
                ? ("tool-result" as const)
                : ("assistant" as const),
            summary,
          },
        ]
      : [];
  });
  const recentEventIds = new Set(
    causalEvents.slice(-8).map((event) => event.id),
  );
  const recentEvents = causalEvents
    .filter(
      (event) => recentEventIds.has(event.id) || matchesSubject(event.summary),
    )
    .slice(-12);
  return {
    ...(rootGoal ? { rootGoal } : {}),
    recentUserStatements,
    recentEvents,
    grants: grants.slice(-6),
  };
}

/** Attachments of the user's own messages in a session's entries. */
function userAttachmentsFromSessionEntries(
  entries: readonly unknown[],
): PineAttachment[] {
  const attachments: PineAttachment[] = [];
  for (const value of entries) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message) ||
      (message as Record<string, unknown>).role !== "user"
    ) {
      continue;
    }
    const content = textFromMessageContent(
      (message as Record<string, unknown>).content,
    );
    attachments.push(...parseAttachmentMessage(content).attachments);
  }
  return attachments;
}

/** Recover direct user attachment grants when reopening a persisted session. */
export function attachedPathsFromSessionEntries(
  entries: readonly unknown[],
): string[] {
  const paths = new Set<string>();
  for (const attachmentPath of attachmentFilePaths(
    userAttachmentsFromSessionEntries(entries),
  )) {
    if (attachmentPath.length <= 4_096) paths.add(attachmentPath);
  }
  return [...paths];
}

/** Sessions the user attached to their messages, which the agent may read. */
export function attachedSessionsFromSessionEntries(
  entries: readonly unknown[],
): AttachedSession[] {
  const sessions = new Map<string, AttachedSession>();
  for (const attachment of userAttachmentsFromSessionEntries(entries))
    if (attachment.session)
      sessions.set(attachment.session.sessionId, attachment.session);
  return [...sessions.values()];
}
