import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import type {
  AgentSession,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  VCC_RECALL_TOOL_NAME,
  type PineAgentEvent,
  type PineApprovalMode,
  type PineMessageRewriteTarget,
} from "../../shared/agent";
import type { McpStatusSnapshot } from "pi-mcp-adapter";
import type { PineProviderAuthEvent } from "../../shared/models";
import type {
  PineContextCompactionRoute,
  PineContextCompactionStrategy,
} from "../../shared/preferences";
import type { PineSessionSummary } from "../../shared/sessions";
import {
  PINE_AUTHORIZATION_GRANT_ENTRY,
  PINE_COMPUTER_USE_ACTIVE_ENTRY,
  PINE_MEDIA_GENERATION_ACTIVE_ENTRY,
  PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
} from "../../shared/sessions";
import type {
  AuthorizationGrant,
  GateTurnContext,
  ToolGate,
  UserApprovalRequest,
} from "../gate";
import type { PineAttachedPathAccess } from "../tools";
import type { ComputerUseController } from "../computer-use/tools";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type { GateDecision } from "../protocol";
import {
  attachmentMessagePreview,
  parseAttachmentMessage,
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
  /** Fallback while a newly submitted prompt has not reached session entries. */
  latestUserPrompt?: string;
  authorizationGrants: AuthorizationGrant[];
  /** Paths directly attached by the user; read-only for file tools. */
  attachedPaths: PineAttachedPathAccess;
  availableToolNames: string[];
  computerUseActive: boolean;
  computerUseController?: ComputerUseController;
  mediaGenerationActive: boolean;
  skillAuthoringActive: boolean;
  tinyFishApiKey?: string;
  locale: "en-US" | "zh-CN";
  contextCompactionStrategy: PineContextCompactionStrategy;
  contextCompactionRoute: PineContextCompactionRoute;
  /** The session's `bg_run` tasks; they stop when the session is disposed. */
  backgroundTasks?: BackgroundTaskRegistry;
  /** Coalesces task changes, including streamed output, into one event. */
  backgroundTaskEmitTimer?: ReturnType<typeof setTimeout>;
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

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function projectSessionDirectory(
  sessionsRoot: string,
  cwd: string,
): string {
  return path.join(sessionsRoot, encodeCwd(cwd));
}

export function sessionSummary(session: AgentSession): PineSessionSummary {
  const header = session.sessionManager.getHeader();
  const entries = session.sessionManager.getEntries();
  const messages = entries.filter((entry) => entry.type === "message");
  const lastEntry = entries.at(-1);
  const createdAt = header?.timestamp ?? new Date().toISOString();

  return {
    id: session.sessionId,
    createdAt,
    updatedAt: lastEntry?.timestamp ?? createdAt,
    messageCount: messages.length,
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

export function toolNamesForApprovalMode(
  activeToolNames: readonly string[],
  approvalMode: PineApprovalMode,
  tinyFishEnabled = true,
): string[] {
  const networkTools = activeToolNames.filter((name) =>
    TINYFISH_TOOL_NAMES.includes(name as (typeof TINYFISH_TOOL_NAMES)[number]),
  );
  const withoutNetwork = activeToolNames.filter(
    (name) =>
      !TINYFISH_TOOL_NAMES.includes(
        name as (typeof TINYFISH_TOOL_NAMES)[number],
      ),
  );
  const withoutBash = withoutNetwork.filter(
    (name) => name !== "bash" && name !== "powershell",
  );
  if (approvalMode === "YOLO") {
    return tinyFishEnabled ? [...withoutBash, ...networkTools] : withoutBash;
  }
  const readIndex = withoutBash.indexOf("read");
  const privilegedIndex = withoutBash.findIndex(
    (name) => name === "privileged_bash" || name === "privileged_powershell",
  );
  const insertionIndex =
    readIndex !== -1
      ? readIndex + 1
      : privilegedIndex === -1
        ? withoutBash.length
        : privilegedIndex;
  const result = [
    ...withoutBash.slice(0, insertionIndex),
    activeToolNames.includes("powershell") ||
    withoutBash[privilegedIndex] === "privileged_powershell"
      ? "powershell"
      : "bash",
    ...withoutBash.slice(insertionIndex),
  ];
  return tinyFishEnabled ? [...result, ...networkTools] : result;
}

/** `vcc_recall` searches pi-vcc summaries' history, so it follows the route. */
export function toolNamesForCompactionRoute(
  toolNames: readonly string[],
  route: PineContextCompactionRoute,
): string[] {
  if (route === "semantic") return [...toolNames];
  return toolNames.filter((name) => name !== VCC_RECALL_TOOL_NAME);
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

/** Recover direct user attachment grants when reopening a persisted session. */
export function attachedPathsFromSessionEntries(
  entries: readonly unknown[],
): string[] {
  const paths = new Set<string>();
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
    for (const attachment of parseAttachmentMessage(content).attachments) {
      if (attachment.path.length <= 4_096) paths.add(attachment.path);
    }
  }
  return [...paths];
}
