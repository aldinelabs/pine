import {
  PINE_SESSION_NOTICE_TYPE,
  PINE_SUB_SESSION_ENTRY,
  PINE_USER_TITLE_ENTRY,
  approvalModeFromEntries,
  isUserChosenTitle,
  subSessionParentOf,
  type PineSessionNotice,
  type SessionRenamer,
} from "../shared/sessions";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  loadSkills,
  type AgentSession,
  type AgentSessionEvent,
  type InlineExtension,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createMcpAdapter,
  MCP_STATUS_EVENT,
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  type McpStatusSnapshot,
  type McpToolApprovalRequest,
} from "pi-mcp-adapter";
import { McpScriptApprovalCache } from "./mcp-approval";
import { automationMcpConfig, isGrantedMcpTool } from "./automation/mcp";
import { loadMcpConfig } from "pi-mcp-adapter/config";
import {
  RECALL_TOOL_NAME,
  type PineApprovalMode,
  type PineJsonValue,
  type PineMessageRewriteTarget,
} from "../shared/agent";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  PineAuthType,
  PineImageModelSelection,
  PineVideoModelSelection,
  PineModelCatalog,
  PineModelSelection,
  PineThinkingLevel,
  PineApprovalModelSelection,
  PineUtilityModelSelection,
  ProviderLoginResult,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";
import {
  PINE_AUTHORIZATION_GRANT_ENTRY,
  PINE_APPROVAL_DECISION_ENTRY,
  PINE_APPROVAL_MODE_ENTRY,
  PINE_COMPUTER_USE_ACTIVE_ENTRY,
  PINE_MEDIA_GENERATION_ACTIVE_ENTRY,
  PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
  PINE_AUTOMATION_AUTHORING_ACTIVE_ENTRY,
  PINE_MCP_AUTHORING_ACTIVE_ENTRY,
  type PineApprovalDecision,
  type PineApprovalExplanation,
  type PineApprovalReview,
  type PineContextUsage,
  withoutRelayPrefix,
} from "../shared/sessions";
import type { RenameCurrentSessionResult } from "./sessionTools";
import { attachmentMessagePreview } from "../shared/attachments";
import { REVIEW_FAILURE_MESSAGES } from "../shared/approvalReasons";
import {
  type AgentHostReply,
  type AgentHostRequest,
  type AgentHostResponse,
  type AgentSessionLocation,
  type AgentWorkerPromptResult,
  type AgentWorkerMutateResult,
  type AgentWorkerSessionResult,
  type AgentSideChatOpenRequest,
  type AgentWorkerSideChatResult,
  GateDecision,
  toErrorMessage,
  toPineJsonValue,
} from "./protocol";
import {
  PINE_SYSTEM_PROMPT,
  systemPromptForPlatform,
  systemPromptWithUserProfile,
  approvalModeNotice,
  approvalModeSystemPrompt,
} from "./system-prompt";
import {
  AutoReviewGate,
  RULING_TOOL,
  AUTONOMOUS_RULING_TOOL,
  EXPLANATION_TOOL,
  JudgeUnavailableError,
  UserApprovalGate,
  type AuthorizationGrant,
  type GateHost,
  type JudgeRequest,
  type JudgeRuling,
  type ToolGate,
  type UserApprovalRequest,
} from "./gate";
import { createPineToolDefinitions, PineAttachedPathAccess } from "./tools";
import {
  createSideChatExtension,
  forkEntries,
  isSideChatEntry,
  PINE_SIDE_CHAT_ENTRY,
  PINE_SIDE_CHAT_NOTICE,
  SIDE_CHAT_APPROVAL_REASON,
  resolveAnchorMessage,
  sideChatEntry,
  sideChatMessages,
  sideChatPassage,
  writeForkFile,
} from "./sideChat";
import { ForegroundPromoter } from "./foreground-promotion";
import { createModelToolDefinitions } from "./modelTools";
import { createActivatePineOpsToolDefinition } from "./pine-ops/tools";
import type {
  FilePresentationDisplay,
  FileReveal,
} from "../shared/projectFiles";
import type { BackgroundTaskNotificationMessage } from "@pine/pi-background-tasks";
import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import {
  BACKGROUND_TASK_OUTPUT_TAIL_BYTES,
  type BackgroundTaskResult,
  type ListBackgroundTasksResult,
  type ReadBackgroundTaskOutputResult,
} from "../shared/backgroundTasks";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";
import {
  ACTIVATE_COMPUTER_USE_TOOL_NAME,
  COMPUTER_USE_DYNAMIC_TOOL_NAMES,
  createComputerUseExtension,
} from "./computer-use/tools";
import {
  ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
  INVOKE_SKILL_TOOL_NAME,
  LIST_SKILL_RESOURCES_TOOL_NAME,
  READ_SKILL_RESOURCE_TOOL_NAME,
  SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
  createSkillToolsExtension,
  skillAuthoringInstructions,
} from "./skills/tools";
import {
  ACTIVATE_MCP_AUTHORING_TOOL_NAME,
  MCP_AUTHORING_DYNAMIC_TOOL_NAMES,
  createMcpAuthoringExtension,
  mcpAuthoringInstructions,
} from "./mcp/tools";
import type { McpHostOperation } from "../shared/mcp";
import {
  AUTHORING_ACTIVATION_TOOL_NAME,
  PINE_SESSION_MUTATION_MESSAGE,
  uniqueSessionMutators,
  type PineAuthoringTarget,
  type PineSessionMutationDetails,
  type PineSessionMutator,
} from "../shared/sessionMutators";
import { createProgressRemindersExtension } from "./runtime/progress-reminders";
import {
  AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
  automationAuthoringInstructions,
  createAutomationAuthoringExtension,
  createAutomationReportTool,
} from "./automation/tools";
import {
  createAutomationRunExtension,
  PINE_AUTOMATION_PAYLOAD,
} from "./automation/run";
import {
  ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
  type AutomationHostOperation,
} from "../shared/automation";
import { imageModel, IMAGE_MODEL_PROVIDER_ID } from "./media/models";
import { PineSkillRepository } from "./skills/repository";
import {
  filterPineManagedSkills,
  piProjectSkillPaths,
} from "./skills/piDiscovery";
import { readPineAgentSettings } from "./pineSettings";
import {
  createDefaultPineUserProfile,
  type PineUserProfile,
} from "../shared/userProfile";
import { intelligentUiSystemPrompt } from "../shared/intelligentUi";
import {
  approximateLocationNotice,
  localNetworkRegionSignals,
  networkRegionSystemPrompt,
} from "./network-region";
import {
  announcedContextNotices,
  contextNoticeMessage,
  type PineContextNoticeState,
} from "./runtime/context-notices";
import {
  DEFAULT_APPROXIMATE_LOCATION_ENABLED,
  type ApproximateLocation,
} from "../shared/approximateLocation";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  DEFAULT_CONTEXT_COMPACTION_ROUTE,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
} from "../shared/preferences";
import { runApprovalReview } from "./runtime/decisions-review";
import { PineModelService } from "./runtime/model-service";
import { PineAgentEventForwarder } from "./runtime/event-forwarder";
import type {
  LiveAgentSession,
  PendingQuestionnaire,
  PendingUserApproval,
  PineAgentRuntimeOptions,
} from "./runtime/session-state";

import {
  approvalActionDigest,
  attachedPathsFromSessionEntries,
  authorizationGrantsFromSessionEntries,
  automationAuthoringActiveFromSessionEntries,
  buildGateTurnContext,
  computerUseActiveFromSessionEntries,
  mcpAuthoringActiveFromSessionEntries,
  mediaGenerationActiveFromSessionEntries,
  projectSessionDirectory,
  rewriteTargetEntryId,
  sessionSummary,
  skillAuthoringActiveFromSessionEntries,
  textFromMessageContent,
  announcedApprovalMode,
  PINE_APPROVAL_MODE_NOTICE,
  toolNamesForTinyFishCredential,
  toolNamesForCompactionRoute,
  toolNamesForComputerUseState,
  toolNamesForMediaGenerationState,
  toolNamesForSkillAuthoringState,
  toolNamesForInterimAnswers,
  toolNamesForSubSession,
  toolNamesForAutomationAuthoringState,
  toolNamesForAutomationRun,
  toolNamesForMcpAuthoringState,
} from "./runtime/session-state";
import { getLatestCacheHitRate } from "./runtime/context-metrics";
import {
  createSessionSummaryCompactionExtension,
  createSubmitSessionSummaryToolDefinition,
} from "./runtime/session-summary";
import {
  describeContextTokens,
  isActivationToolName,
  PINE_ACTIVATION_RESUME_MESSAGE,
  shouldConfirmLongContextActivation,
} from "./runtime/activation-guard";
import { configureContextCompactionSettings } from "./runtime/compaction-settings";
import { createSemanticCompactionExtension } from "./runtime/semantic-compaction";
import {
  AUTONOMOUS_JUDGE_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  approvalExplanationAudience,
  approvalExplanationSystemPrompt,
  awaitApprovalExplanation,
  buildApprovalExplanationContent,
  buildJudgeEvidence,
  buildJudgeSharedContext,
  judgeStreamOptions,
  parseApprovalExplanations,
  parseJudgeRulings,
  truncateText,
} from "./runtime/review";
import {
  MAX_GENERATED_TITLE_LENGTH,
  TITLE_TOOL,
  normalizeGeneratedTitle,
  titleFromAssistantMessage,
} from "./runtime/title";
export {
  attachedPathsFromSessionEntries,
  authorizationGrantsFromSessionEntries,
  buildGateTurnContext,
  computerUseActiveFromSessionEntries,
  mediaGenerationActiveFromSessionEntries,
  projectSessionDirectory,
  skillAuthoringActiveFromSessionEntries,
  announcedApprovalMode,
  toolNamesForTinyFishCredential,
  toolNamesForComputerUseState,
  toolNamesForMediaGenerationState,
  toolNamesForSkillAuthoringState,
} from "./runtime/session-state";
export {
  getLatestCacheHitRate,
  recommendedCompactionReserveTokens,
  RECOMMENDED_COMPACTION_CONTEXT_RATIO,
  RECOMMENDED_COMPACTION_HARD_LIMIT,
} from "./runtime/context-metrics";
export {
  AUTONOMOUS_JUDGE_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  judgeStreamOptions,
  parseJudgeRulings,
} from "./runtime/review";
export {
  normalizeGeneratedTitle,
  titleFromAssistantMessage,
} from "./runtime/title";
export type { PineAgentRuntimeOptions } from "./runtime/session-state";

/** Where each authoring target keeps its activation, flag and record. */
const AUTHORING_STATE = {
  skill: {
    flag: "skillAuthoringActive",
    entry: PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
  },
  automation: {
    flag: "automationAuthoringActive",
    entry: PINE_AUTOMATION_AUTHORING_ACTIVE_ENTRY,
  },
  mcp: { flag: "mcpAuthoringActive", entry: PINE_MCP_AUTHORING_ACTIVE_ENTRY },
} as const satisfies Record<
  PineAuthoringTarget,
  {
    flag:
      | "skillAuthoringActive"
      | "automationAuthoringActive"
      | "mcpAuthoringActive";
    entry: string;
  }
>;

const AUTHORING_INSTRUCTIONS: Record<PineAuthoringTarget, () => string> = {
  skill: skillAuthoringInstructions,
  automation: automationAuthoringInstructions,
  mcp: mcpAuthoringInstructions,
};

const AUTHORING_TARGET_LABEL: Record<PineAuthoringTarget, string> = {
  skill: "Skills",
  automation: "Automations",
  mcp: "MCP servers",
};

const JUDGE_TIMEOUT_MS = 60_000;
/**
 * Explanation-only requests for Decisions needs_user cards. The card waits up
 * to APPROVAL_EXPLANATION_WAIT_MS; an account landing later still fills it.
 */
const APPROVAL_EXPLANATION_TIMEOUT_MS = 20_000;
export const APPROVAL_EXPLANATION_WAIT_MS = 10_000;
const BACKGROUND_TASKS_EVENT_MS = 200;
const TITLE_TIMEOUT_MS = 30_000;
const TITLE_MAX_TOKENS = 4_096;
const MAX_TITLE_ATTEMPTS = 3;
function userMessageText(message: unknown): string | undefined {
  const { role, content } = message as { role?: string; content?: unknown };
  if (role !== "user") return undefined;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part: { type?: string; text?: string }) =>
      part.type === "text" ? (part.text ?? "") : "",
    )
    .join("");
}

/** Shell tools whose running command can move to the background. */
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "privileged_bash",
  "powershell",
  "privileged_powershell",
]);
/** Main answers from its cache; this only guards against a stuck reply. */
const APPROXIMATE_LOCATION_TIMEOUT_MS = 1_000;
export class PineAgentRuntime {
  private readonly liveSessions = new Map<string, LiveAgentSession>();
  private readonly pendingApprovals = new Map<string, PendingUserApproval>();
  private readonly pendingQuestionnaires = new Map<
    string,
    PendingQuestionnaire
  >();
  /** Replies main owes to tool calls waiting on a host request. */
  private readonly pendingHostRequests = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: AgentHostResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly titleGenerationAttempts = new Set<string>();
  private readonly titleGenerationInFlight = new Set<string>();
  private readonly titleGenerationFailures = new Map<string, number>();

  private readonly modelService: PineModelService;
  private readonly eventForwarder: PineAgentEventForwarder;

  constructor(private readonly options: PineAgentRuntimeOptions) {
    this.modelService = new PineModelService({
      emit: options.emit,
      getLiveSession: (sessionId) => this.liveSessions.get(sessionId),
      getLiveSessions: () => this.liveSessions.values(),
      applyContextCompactionStrategy: (live, strategy) =>
        this.applyContextCompactionStrategy(live, strategy),
    });
    this.eventForwarder = new PineAgentEventForwarder({
      emit: options.emit,
      getLiveSession: (sessionId) => this.liveSessions.get(sessionId),
      getSession: (sessionId) => this.getSession(sessionId),
      emitSteeringQueue: (live) => this.emitSteeringQueue(live),
      recordApprovalDecision: (live, decision) =>
        this.recordApprovalDecision(live, decision),
      generateInitialTitle: (live) => this.generateInitialTitle(live),
      getContextUsage: (session, message) =>
        this.getContextUsage(session, message),
      emitContextUsage: (session, usage) =>
        this.emitContextUsage(session, usage),
    });
  }

  async createSession(
    location: AgentSessionLocation,
  ): Promise<AgentWorkerSessionResult> {
    const manager = SessionManager.create(
      location.cwd,
      projectSessionDirectory(location.sessionsRoot, location.cwd),
    );
    if (location.parentSessionId)
      manager.appendCustomEntry(PINE_SUB_SESSION_ENTRY, {
        parentSessionId: location.parentSessionId,
      });
    return this.registerSession(location, manager);
  }

  async openSession(
    location: AgentSessionLocation,
    sessionFile: string,
  ): Promise<AgentWorkerSessionResult> {
    const manager = SessionManager.open(
      sessionFile,
      projectSessionDirectory(location.sessionsRoot, location.cwd),
      location.cwd,
    );
    return this.registerSession(location, manager);
  }

  /**
   * Opens a side chat. A new one forks the parent's current branch, keeping
   * its entries as they are so the model sees the same prefix; a follow-up
   * is saved beside the parent's other side chats, a plain one stays in
   * memory and is gone once disposed.
   */
  async openSideChat(
    request: AgentSideChatOpenRequest,
  ): Promise<AgentWorkerSideChatResult> {
    const { location, parentSessionId } = request;
    const parentLive = this.liveSessions.get(parentSessionId);
    let manager: SessionManager;
    let anchor: unknown = request.anchor;
    if (request.sideChatFile) {
      manager = SessionManager.open(
        request.sideChatFile,
        request.sideChatsDirectory,
        location.cwd,
      );
      const marker = sideChatEntry(manager.getEntries());
      if (marker?.data.parentSessionId !== parentSessionId)
        throw new Error("This side chat belongs to another conversation.");
      anchor = marker.data.anchor;
    } else {
      const parent =
        parentLive?.session.sessionManager ??
        (request.parentSessionFile
          ? SessionManager.open(
              request.parentSessionFile,
              undefined,
              location.cwd,
            )
          : undefined);
      if (!parent) throw new Error("The conversation is not available.");
      const fork = forkEntries(parent, location.cwd);
      anchor = resolveAnchorMessage(anchor, fork.entries, (messageId) =>
        this.eventForwarder.streamedMessage(parentSessionId, messageId),
      );
      manager =
        anchor === undefined
          ? SessionManager.inMemory(location.cwd, undefined, [
              fork.header,
              ...fork.entries,
            ])
          : SessionManager.open(
              writeForkFile(request.sideChatsDirectory, fork),
              request.sideChatsDirectory,
              location.cwd,
            );
      // Not a context entry: the model's prefix stays the parent's.
      manager.appendCustomEntry(PINE_SIDE_CHAT_ENTRY, {
        parentSessionId,
        ...(anchor !== undefined ? { anchor } : {}),
      });
    }
    const result = await this.registerSession(
      {
        ...location,
        // The approval mode is part of the conversation; keep the parent's.
        approvalMode: parentLive?.approvalMode ?? location.approvalMode,
      },
      manager,
      { parentSessionId, persistent: anchor !== undefined },
    );
    return {
      ...result,
      parentSessionId,
      ...(anchor !== undefined ? { anchor: toPineJsonValue(anchor) } : {}),
      messages: sideChatMessages(manager.getBranch()).map(
        ({ id, message }) => ({
          id,
          message: toPineJsonValue(message),
        }),
      ),
    };
  }

  async prompt(
    sessionId: string,
    message: string,
    streamingBehavior?: "followUp" | "steer",
    attachedPaths: readonly string[] = [],
    approvalMode?: PineApprovalMode,
    locale: "en-US" | "zh-CN" = "en-US",
    rewrite?: PineMessageRewriteTarget,
  ): Promise<AgentWorkerPromptResult> {
    const live = this.getSession(sessionId);
    approvalMode ??= live.approvalMode;
    if (rewrite) await this.rewindToUserMessage(live, rewrite);
    live.locale = locale;
    this.setApprovalMode(live, live.automation ? "autonomous" : approvalMode);
    await live.attachedPaths.grant(attachedPaths);
    live.latestUserPrompt = message;
    if (live.session.isIdle)
      live.computerUseController?.resetTaskAuthorization();
    live.gate?.resetTurn();
    live.mcpScriptApprovals.clear();
    this.options.emit({ type: "run-state", sessionId, state: "running" });
    return new Promise<AgentWorkerPromptResult>((resolve, reject) => {
      let responseSettled = false;
      const result = (accepted: boolean): AgentWorkerPromptResult => ({
        accepted,
        session: sessionSummary(live.session),
        ...(live.session.sessionFile
          ? { sessionFile: live.session.sessionFile }
          : {}),
      });
      const settleAccepted = (): void => {
        if (responseSettled) return;
        responseSettled = true;
        resolve(result(true));
      };

      // AgentSession.prompt rejects during compaction, so stage steering
      // messages in the runtime and submit them after compaction completes.
      const queueDuringCompaction =
        streamingBehavior === "steer" || streamingBehavior === undefined;
      const prompt =
        queueDuringCompaction &&
        (live.session.isCompacting || live.resumingCompactionPrompts)
          ? Promise.resolve().then(() => {
              this.queueCompactionPrompt(live, message, approvalMode, locale);
            })
          : live.session.prompt(message, {
              ...(streamingBehavior ? { streamingBehavior } : {}),
              // Pi only reports a disposition for accepted prompts.
              preflightResult: () => {
                settleAccepted();
              },
              source: "interactive",
            });
      void prompt
        .then(settleAccepted)
        .catch((error: unknown) => {
          // Compaction can begin inside Pi's asynchronous prompt preflight,
          // after the isCompacting check above.
          if (
            queueDuringCompaction &&
            !responseSettled &&
            error instanceof Error &&
            error.message ===
              "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry."
          ) {
            this.queueCompactionPrompt(live, message, approvalMode, locale);
            settleAccepted();
            return;
          }
          const errorMessage = toErrorMessage(error);
          this.options.emit({
            type: "session-error",
            sessionId,
            errorId: randomUUID(),
            message: errorMessage,
          });
          this.options.emit({
            type: "run-state",
            sessionId,
            state: "failed",
            error: errorMessage,
          });
          if (!responseSettled) {
            responseSettled = true;
            reject(error instanceof Error ? error : new Error(errorMessage));
          }
        })
        .finally(() => {
          if (live.session.isIdle && !live.resumingCompactionPrompts) {
            this.options.emit({ type: "run-state", sessionId, state: "idle" });
          }
        });
    });
  }

  /**
   * Move the session leaf to just before the edited user message. The
   * abandoned tail stays in the append-only file as an inactive branch.
   */
  private async rewindToUserMessage(
    live: LiveAgentSession,
    rewrite: PineMessageRewriteTarget,
  ): Promise<void> {
    if (
      !live.session.isIdle ||
      live.session.isCompacting ||
      live.resumingCompactionPrompts
    ) {
      throw new Error(
        "Wait for the current response to finish before editing.",
      );
    }
    const manager = live.session.sessionManager;
    let targetId = rewriteTargetEntryId(manager.getBranch(), rewrite);
    // A side chat edits only its own questions, never the conversation it
    // forked from.
    if (live.sideChat && !isSideChatEntry(manager.getBranch(), targetId))
      throw new Error("This message cannot be edited here.");
    // Pi treats navigating to the current leaf as a no-op, so a trailing user
    // message rewinds through its parent instead.
    if (targetId === manager.getLeafId()) {
      const parent = manager.getEntry(targetId)?.parentId;
      const parentEntry = parent ? manager.getEntry(parent) : undefined;
      if (
        !parentEntry ||
        (parentEntry.type === "message" && parentEntry.message.role === "user")
      ) {
        throw new Error("This message cannot be edited yet.");
      }
      targetId = parentEntry.id;
    }
    const result = await live.session.navigateTree(targetId);
    if (result.cancelled) throw new Error("Editing the message was cancelled.");
    live.authorizationGrants = authorizationGrantsFromSessionEntries(
      manager.getBranch(),
    );
    // Navigating the tree refreshes Pi's tool registry, which turns every
    // tool active by default back on; keep the set the model saw before, so
    // the request still shares its cached prefix.
    this.syncActiveTools(live);
  }

  private emitSteeringQueue(live: LiveAgentSession): void {
    this.options.emit({
      type: "steering-queue",
      sessionId: live.session.sessionId,
      messages: [
        ...live.session.getSteeringMessages(),
        ...(live.sendNow?.held ?? []),
        ...live.queuedCompactionPrompts.map(({ message }) => message),
      ],
    });
  }

  private queueCompactionPrompt(
    live: LiveAgentSession,
    message: string,
    approvalMode: PineApprovalMode,
    locale: "en-US" | "zh-CN",
  ): void {
    live.queuedCompactionPrompts.push({ message, approvalMode, locale });
    this.emitSteeringQueue(live);
    this.resumeQueuedMessagesWhenIdle(live);
  }

  private resumeQueuedMessagesWhenIdle(live: LiveAgentSession): void {
    if (live.resumingCompactionPrompts) return;
    live.resumingCompactionPrompts = true;
    void (async () => {
      const sessionId = live.session.sessionId;
      try {
        await live.session.waitForIdle();
        while (live.queuedCompactionPrompts.length > 0) {
          const queued = live.queuedCompactionPrompts.shift();
          if (!queued) continue;
          this.emitSteeringQueue(live);

          live.locale = queued.locale;
          live.latestUserPrompt = queued.message;
          live.computerUseController?.resetTaskAuthorization();
          this.setApprovalMode(live, queued.approvalMode);
          live.gate?.resetTurn();
          live.mcpScriptApprovals.clear();
          this.options.emit({ type: "run-state", sessionId, state: "running" });
          try {
            await live.session.prompt(queued.message, {
              source: "interactive",
            });
          } catch (error) {
            const errorMessage = toErrorMessage(error);
            this.options.emit({
              type: "session-error",
              sessionId,
              errorId: randomUUID(),
              message: errorMessage,
            });
            this.options.emit({
              type: "run-state",
              sessionId,
              state: "failed",
              error: errorMessage,
            });
          }
        }
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        this.options.emit({
          type: "session-error",
          sessionId,
          errorId: randomUUID(),
          message: errorMessage,
        });
        this.options.emit({
          type: "run-state",
          sessionId,
          state: "failed",
          error: errorMessage,
        });
      } finally {
        live.resumingCompactionPrompts = false;
        if (live.session.isIdle) {
          this.options.emit({ type: "run-state", sessionId, state: "idle" });
        }
        if (live.queuedCompactionPrompts.length > 0) {
          this.resumeQueuedMessagesWhenIdle(live);
        }
      }
    })();
  }

  /** Remove one still-queued steering message without disturbing its siblings. */
  async dequeueSteering(
    sessionId: string,
    message: string,
  ): Promise<{ message?: string; removed: boolean }> {
    const live = this.getSession(sessionId);
    const steering = [...live.session.getSteeringMessages()];
    const index = steering.indexOf(message);
    if (index < 0) {
      const heldIndex = live.sendNow?.held.indexOf(message) ?? -1;
      if (live.sendNow && heldIndex >= 0) {
        live.sendNow.held.splice(heldIndex, 1);
        this.emitSteeringQueue(live);
        return { message, removed: true };
      }
      const stagedIndex = live.queuedCompactionPrompts.findIndex(
        (queued) => queued.message === message,
      );
      if (stagedIndex < 0) return { removed: false };
      live.queuedCompactionPrompts.splice(stagedIndex, 1);
      this.emitSteeringQueue(live);
      return { message, removed: true };
    }

    const followUp = [...live.session.getFollowUpMessages()];
    const [removed] = steering.splice(index, 1);
    live.session.clearQueue();
    for (const queued of steering) await live.session.steer(queued);
    for (const queued of followUp) await live.session.followUp(queued);
    this.emitSteeringQueue(live);
    return { message: removed, removed: true };
  }

  /**
   * Deliver one queued steering message without waiting for its boundary.
   * Shell commands holding the turn move to the background so their tool
   * calls return now and the message follows; any other work (streaming
   * text, other tools, pending approvals) is interrupted and the message is
   * sent as a new prompt. The other staged messages stay staged: they leave
   * the agent's queue, which it would deliver whole, and return once the sent
   * message has been taken.
   */
  async sendSteeringNow(
    sessionId: string,
    message: string,
  ): Promise<{ sent: boolean }> {
    const live = this.getSession(sessionId);
    // A previous send-now still holding messages lets them go back first.
    await this.releaseHeldSteering(live);
    const queued = live.session.getSteeringMessages();
    if (!queued.includes(message)) return { sent: false };

    const { steering, followUp } = live.session.clearQueue();
    const held = [...steering];
    held.splice(held.indexOf(message), 1);
    live.sendNow = { target: message, held, armed: false, consumed: false };
    const restoreFollowUp = async () => {
      for (const queuedFollowUp of followUp)
        await live.session.followUp(queuedFollowUp);
    };
    await restoreFollowUp();
    this.emitSteeringQueue(live);

    const activeCalls = [...live.activeToolCalls];
    if (
      activeCalls.length > 0 &&
      activeCalls.every(([, toolName]) => SHELL_TOOL_NAMES.has(toolName))
    ) {
      // The message must be queued before the calls return.
      await live.session.steer(message);
      live.sendNow.armed = true;
      const promoted = activeCalls.filter(([toolCallId]) =>
        live.foregroundPromoter.promote(toolCallId),
      );
      if (promoted.length === activeCalls.length) return { sent: true };
      // Commands already moved stay in the background; interrupt the rest.
      live.sendNow.armed = false;
      live.session.clearQueue();
      await restoreFollowUp();
    }

    await this.abort(sessionId);
    live.sendNow.armed = true;
    try {
      await this.prompt(
        sessionId,
        message,
        undefined,
        [],
        live.approvalMode,
        live.locale,
      );
    } catch (error) {
      await this.releaseHeldSteering(live);
      throw error;
    }
    return { sent: true };
  }

  /** Track the sent message; once it is taken, the held ones queue again. */
  private trackSendNow(live: LiveAgentSession, event: AgentSessionEvent): void {
    const sendNow = live.sendNow;
    if (!sendNow?.armed) return;
    if (event.type === "message_start") {
      const role = (event.message as { role?: string }).role;
      if (role === "user" && userMessageText(event.message) === sendNow.target)
        sendNow.consumed = true;
      // The response is under way, well before the next steering boundary.
      else if (role === "assistant" && sendNow.consumed)
        void this.releaseHeldSteering(live);
    } else if (event.type === "agent_end") {
      void this.releaseHeldSteering(live, true);
    }
  }

  private async releaseHeldSteering(
    live: LiveAgentSession,
    runEnded = false,
  ): Promise<void> {
    const sendNow = live.sendNow;
    if (!sendNow) return;
    live.sendNow = undefined;
    for (const message of sendNow.held) {
      // A finished run cannot take steering; submit what is left in turn.
      if (runEnded || live.session.isIdle) {
        live.queuedCompactionPrompts.push({
          message,
          approvalMode: live.approvalMode,
          locale: live.locale,
        });
        continue;
      }
      try {
        await live.session.steer(message);
      } catch {
        live.queuedCompactionPrompts.push({
          message,
          approvalMode: live.approvalMode,
          locale: live.locale,
        });
      }
    }
    this.emitSteeringQueue(live);
    if (live.queuedCompactionPrompts.length > 0)
      this.resumeQueuedMessagesWhenIdle(live);
  }

  async abort(sessionId: string): Promise<{ aborted: boolean }> {
    const live = this.getSession(sessionId);
    live.computerUseController?.resetTaskAuthorization();
    const aborted = !live.session.isIdle;
    if (aborted) {
      this.options.emit({ type: "run-state", sessionId, state: "aborting" });
      await live.session.abort();
      this.options.emit({ type: "run-state", sessionId, state: "idle" });
    }
    return { aborted };
  }

  async compact(sessionId: string): Promise<{ compacted: boolean }> {
    const live = this.getSession(sessionId);
    await live.session.compact();
    return { compacted: true };
  }

  setSessionApprovalMode(
    sessionId: string,
    approvalMode: PineApprovalMode,
  ): { updated: boolean } {
    this.setApprovalMode(this.getSession(sessionId), approvalMode);
    return { updated: true };
  }

  /**
   * Apply session mutators before the next prompt. Each activates state the
   * conversation could also reach through a tool call, so one already in
   * effect is skipped and applying the same list twice changes nothing.
   */
  async mutateSession(
    sessionId: string,
    mutators: readonly PineSessionMutator[],
  ): Promise<AgentWorkerMutateResult> {
    const live = this.getSession(sessionId);
    if (live.automation)
      throw new Error("An automation run's session cannot be changed.");
    if (!live.session.isIdle)
      throw new Error("Finish the current response before changing it.");
    const applied: PineSessionMutator[] = [];
    for (const mutator of uniqueSessionMutators(mutators)) {
      if (this.authoringActive(live, mutator.target)) continue;
      this.activateAuthoring(live, mutator.target);
      const details: PineSessionMutationDetails = { mutator };
      await live.session.sendCustomMessage({
        customType: PINE_SESSION_MUTATION_MESSAGE,
        content: `<pine_session_setup>\nThe user opened this conversation from Pine's ${AUTHORING_TARGET_LABEL[mutator.target]} settings to create one together with you. Its authoring tools are already active; the instructions follow. Start from what the user asks; do not call ${AUTHORING_ACTIVATION_TOOL_NAME[mutator.target]}.\n</pine_session_setup>\n\n${AUTHORING_INSTRUCTIONS[mutator.target]()}`,
        display: true,
        details,
      });
      applied.push(mutator);
    }
    return { applied };
  }

  private authoringActive(
    live: LiveAgentSession,
    target: PineAuthoringTarget,
  ): boolean {
    return live[AUTHORING_STATE[target].flag];
  }

  /** Turn on one authoring tool set and remember it across resumes. */
  private activateAuthoring(
    live: LiveAgentSession,
    target: PineAuthoringTarget,
  ): void {
    const { flag, entry } = AUTHORING_STATE[target];
    if (live[flag]) return;
    live[flag] = true;
    live.session.sessionManager.appendCustomEntry(entry, { active: true });
    this.syncActiveTools(live);
  }

  /**
   * After the run that paused an activation ends, compress the conversation
   * and hand control back to the model so it repeats the activation it asked
   * for. The call goes through without a second question.
   */
  private compactThenResume(live: LiveAgentSession, toolName: string): void {
    void (async () => {
      try {
        await live.session.waitForIdle();
        try {
          await live.session.compact();
        } catch (error) {
          // The activation was already agreed to, so it still goes ahead.
          this.options.emit({
            type: "session-error",
            sessionId: live.session.sessionId,
            errorId: randomUUID(),
            message: toErrorMessage(error),
          });
        }
        const resumeNotice =
          live.locale === "zh-CN"
            ? `已按用户要求压缩对话。请继续之前的请求，并重新调用 ${toolName} 完成激活。`
            : `The conversation was compressed at the user's request. Continue the previous request and call ${toolName} again to finish the activation.`;
        await live.session.sendCustomMessage(
          {
            customType: PINE_ACTIVATION_RESUME_MESSAGE,
            content: resumeNotice,
            display: false,
          },
          { triggerTurn: true },
        );
      } catch (error) {
        live.preapprovedActivations.delete(toolName);
        this.options.emit({
          type: "session-error",
          sessionId: live.session.sessionId,
          errorId: randomUUID(),
          message: toErrorMessage(error),
        });
      }
    })();
  }

  renameSession(
    sessionId: string,
    name: string,
    by: SessionRenamer = "user",
  ): AgentWorkerSessionResult {
    const session = this.getSession(sessionId).session;
    if (by === "user")
      session.sessionManager.appendCustomEntry(PINE_USER_TITLE_ENTRY, { name });
    session.setSessionName(name);
    return { session: sessionSummary(session) };
  }

  async disposeSession(sessionId: string): Promise<{ disposed: boolean }> {
    const live = this.liveSessions.get(sessionId);
    if (!live) return { disposed: false };

    this.liveSessions.delete(sessionId);
    this.eventForwarder.clearSession(sessionId);
    this.rejectHostRequests(sessionId, "The session was closed.");
    for (const [requestId, pending] of this.pendingApprovals) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingApprovals.delete(requestId);
      pending.resolve({ kind: "deny", reason: "The session was closed." });
    }
    for (const [requestId, pending] of this.pendingQuestionnaires) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingQuestionnaires.delete(requestId);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      pending.resolve({ answers: [], cancelled: true });
      this.options.emit({
        type: "questionnaire-decided",
        sessionId,
        requestId,
        toolCallId: pending.toolCallId,
        cancelled: true,
      });
    }
    if (!live.session.isIdle) await live.session.abort();
    // Tasks stopped by the session closing do not notify the model.
    await live.backgroundTasks?.dispose();
    clearTimeout(live.backgroundTaskEmitTimer);
    await live.computerUseController?.dispose();
    live.unsubscribe();
    await live.session.settingsManager.flush();
    live.session.dispose();
    return { disposed: true };
  }

  async dispose(): Promise<{ disposed: boolean }> {
    this.modelService.dispose();
    // Send what is still batched and stop the throttle timers before the
    // sessions go, so no timer fires into a torn-down runtime.
    this.eventForwarder.dispose();
    this.rejectHostRequests(null, "The agent runtime was disposed.");
    for (const [requestId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(requestId);
      pending.resolve({
        kind: "deny",
        reason: "The agent runtime was disposed.",
      });
    }
    for (const [requestId, pending] of this.pendingQuestionnaires) {
      this.pendingQuestionnaires.delete(requestId);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      pending.resolve({ answers: [], cancelled: true });
      this.options.emit({
        type: "questionnaire-decided",
        sessionId: pending.sessionId,
        requestId,
        toolCallId: pending.toolCallId,
        cancelled: true,
      });
    }
    await Promise.all(
      [...this.liveSessions.keys()].map((sessionId) =>
        this.disposeSession(sessionId),
      ),
    );
    return { disposed: true };
  }

  getModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    return this.modelService.getModelCatalog(agentDir);
  }

  refreshModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    return this.modelService.refreshModelCatalog(agentDir);
  }

  addCustomModel(
    agentDir: string,
    input: AddCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.modelService.addCustomModel(agentDir, input);
  }

  updateCustomModel(
    agentDir: string,
    input: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.modelService.updateCustomModel(agentDir, input);
  }

  deleteCustomModel(
    agentDir: string,
    input: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.modelService.deleteCustomModel(agentDir, input);
  }

  updateCustomProvider(
    agentDir: string,
    input: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.modelService.updateCustomProvider(agentDir, input);
  }

  deleteCustomProvider(
    agentDir: string,
    input: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.modelService.deleteCustomProvider(agentDir, input);
  }

  loginProvider(
    agentDir: string,
    loginId: string,
    providerId: string,
    authType: PineAuthType,
  ): Promise<ProviderLoginResult> {
    return this.modelService.loginProvider(
      agentDir,
      loginId,
      providerId,
      authType,
    );
  }

  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): { accepted: boolean } {
    return this.modelService.respondToProviderAuth(loginId, promptId, value);
  }

  cancelProviderAuth(loginId: string): { cancelled: boolean } {
    return this.modelService.cancelProviderAuth(loginId);
  }

  logoutProvider(
    agentDir: string,
    providerId: string,
  ): Promise<{ disposed: boolean }> {
    return this.modelService.logoutProvider(agentDir, providerId);
  }

  selectModel(
    agentDir: string,
    providerId: string,
    modelId: string,
    thinkingLevel: PineThinkingLevel,
    sessionId?: string,
  ): Promise<{ disposed: boolean }> {
    return this.modelService.selectModel(
      agentDir,
      providerId,
      modelId,
      thinkingLevel,
      sessionId,
    );
  }

  selectUtilityModel(
    agentDir: string,
    selection: PineUtilityModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.modelService.selectUtilityModel(agentDir, selection);
  }

  selectApprovalModel(
    agentDir: string,
    selection: PineApprovalModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.modelService.selectApprovalModel(agentDir, selection);
  }

  selectImageModel(
    agentDir: string,
    selection: PineImageModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.modelService.selectImageModel(agentDir, selection);
  }
  selectVideoModel(
    agentDir: string,
    selection: PineVideoModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.modelService.selectVideoModel(agentDir, selection);
  }

  setContextCompactionStrategy(strategy: PineContextCompactionStrategy): {
    updated: boolean;
  } {
    return this.modelService.setContextCompactionStrategy(strategy);
  }

  setContextCompactionRoute(route: PineContextCompactionRoute): {
    updated: boolean;
  } {
    for (const live of this.liveSessions.values()) {
      live.contextCompactionRoute = route;
      this.syncActiveTools(live);
    }
    return { updated: true };
  }

  private async registerSession(
    location: AgentSessionLocation,
    sessionManager: SessionManager,
    sideChat?: LiveAgentSession["sideChat"],
  ): Promise<AgentWorkerSessionResult> {
    const existing = this.liveSessions.get(sessionManager.getSessionId());
    if (existing) {
      const contextUsage = this.getContextUsage(existing.session);
      return {
        session: sessionSummary(existing.session),
        ...(existing.session.sessionFile
          ? { sessionFile: existing.session.sessionFile }
          : {}),
        ...(contextUsage ? { contextUsage } : {}),
      };
    }

    const settingsManager = SettingsManager.create(
      location.cwd,
      location.agentDir,
      { projectTrusted: false },
    );
    const pineSettings = await readPineAgentSettings(location.agentDir);
    const contextCompactionStrategy =
      pineSettings.contextCompactionStrategy ??
      DEFAULT_CONTEXT_COMPACTION_STRATEGY;
    const contextCompactionRoute =
      pineSettings.contextCompactionRoute ?? DEFAULT_CONTEXT_COMPACTION_ROUTE;
    const attachedPaths = new PineAttachedPathAccess();
    await attachedPaths.grant(
      attachedPathsFromSessionEntries(sessionManager.getEntries()),
    );
    const live: LiveAgentSession = {
      session: undefined as never,
      queuedCompactionPrompts: [],
      resumingCompactionPrompts: false,
      unsubscribe: () => undefined,
      agentDir: location.agentDir,
      cwd: location.cwd,
      approvalMode: location.automation
        ? "autonomous"
        : approvalModeFromEntries(
            sessionManager.getEntries(),
            location.approvalMode,
          ),
      gate: undefined as never,
      mcpScriptApprovals: new McpScriptApprovalCache(),
      preapprovedActivations: new Set<string>(),
      authorizationGrants: authorizationGrantsFromSessionEntries(
        sessionManager.getBranch(),
      ),
      attachedPaths,
      availableToolNames: [],
      subSession: subSessionParentOf(sessionManager.getEntries()) !== undefined,
      interimAnswersEnabled:
        pineSettings.userProfile?.interimAnswersEnabled ?? true,
      computerUseActive: computerUseActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      mediaGenerationActive: mediaGenerationActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      skillAuthoringActive: skillAuthoringActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      automationAuthoringActive: automationAuthoringActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      mcpAuthoringActive: mcpAuthoringActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      ...(location.automation ? { automation: location.automation } : {}),
      ...(sideChat ? { sideChat } : {}),
      ...(location.tinyFishApiKey
        ? { tinyFishApiKey: location.tinyFishApiKey }
        : {}),
      locale: "en-US",
      contextCompactionStrategy,
      contextCompactionRoute,
      foregroundPromoter: new ForegroundPromoter(),
      activeToolCalls: new Map(),
    };
    configureContextCompactionSettings(
      settingsManager,
      () => live.contextCompactionStrategy,
    );
    const computerUse = createComputerUseExtension({
      getApprovalMode: () => live.approvalMode,
      getGate: () => live.gate,
      activated: () => {
        if (live.computerUseActive) return;
        live.computerUseActive = true;
        live.session.sessionManager.appendCustomEntry(
          PINE_COMPUTER_USE_ACTIVE_ENTRY,
          { active: true },
        );
      },
    });
    live.computerUseController = computerUse.controller;
    const skillRepository = new PineSkillRepository({
      disabledGlobalSkillsPath:
        location.skillsSettingsPath ??
        path.join(path.dirname(location.sessionsRoot), "skills.json"),
      global: path.join(location.agentDir, "skills"),
      project:
        location.skillsRoot ??
        path.join(path.dirname(location.sessionsRoot), "skills"),
    });
    const skillTools = createSkillToolsExtension({
      repository: skillRepository,
      getApprovalMode: () => live.approvalMode,
      getGate: () => live.gate,
      activated: () => this.activateAuthoring(live, "skill"),
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: location.cwd,
      agentDir: location.agentDir,
      settingsManager,
      noExtensions: true,
      additionalSkillPaths: piProjectSkillPaths(location.cwd),
      extensionFactories: [
        {
          name: "pine-approval-mode",
          factory: (pi) => {
            pi.on("before_agent_start", (event) => {
              event.systemPromptOptions.sections.pine_approval_mode =
                approvalModeSystemPrompt();
              // The mode lives in the conversation, not the system prompt or
              // tool list, so a mid-session switch keeps the cached prefix.
              if (
                announcedApprovalMode(live.session.messages) ===
                live.approvalMode
              )
                return undefined;
              return {
                message: {
                  customType: PINE_APPROVAL_MODE_NOTICE,
                  content: approvalModeNotice(live.approvalMode),
                  display: false,
                  details: { approvalMode: live.approvalMode },
                },
              };
            });
          },
        },
        {
          name: "pine-activation-guard",
          factory: (pi) => {
            pi.on("tool_call", async (event, ctx) => {
              if (!isActivationToolName(event.toolName)) return undefined;
              if (live.preapprovedActivations.delete(event.toolName)) {
                return undefined;
              }
              const tokens = live.session.getContextUsage()?.tokens;
              if (
                !shouldConfirmLongContextActivation({
                  toolName: event.toolName,
                  activeToolNames: live.session.getActiveToolNames(),
                  model: live.session.model,
                  contextTokens: tokens,
                  attended:
                    !live.automation &&
                    live.approvalMode !== "autonomous" &&
                    live.approvalMode !== "YOLO",
                })
              ) {
                return undefined;
              }
              const decision = await this.requestUserApproval(live, {
                trigger: "long-context-activation",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                subject: describeContextTokens(tokens ?? 0),
                signal: ctx.signal,
              });
              // Allowing activates as requested. The card's other two answers
              // carry a choice; any other denial is an abort or a closed
              // session, and the call must not run.
              if (decision.kind === "allow") return undefined;
              if (decision.choice === "compact") {
                live.preapprovedActivations.add(event.toolName);
                this.compactThenResume(live, event.toolName);
                return {
                  block: true,
                  terminate: true,
                  reason:
                    "The user chose to compress the conversation before this activation. Pine compresses it now and resumes automatically with the activation applied; end this turn without further tool calls.",
                };
              }
              if (decision.choice === "abort") ctx.abort();
              return {
                block: true,
                terminate: true,
                reason:
                  decision.reason ?? "The user cancelled this activation.",
              };
            });
          },
        },
        {
          name: "pine-context-notices",
          factory: (pi) => {
            pi.on("before_agent_start", async () => {
              const settings = await readPineAgentSettings(live.agentDir);
              const userProfile =
                settings.userProfile ?? createDefaultPineUserProfile();
              // Applied for this run: pi keeps a tool list set here.
              this.applyInterimAnswersSetting(
                live,
                userProfile.interimAnswersEnabled,
              );
              const notices: PineContextNoticeState = {
                user_profile: systemPromptWithUserProfile(
                  "",
                  userProfile,
                ).trim(),
              };
              if (userProfile.interactiveAnswersEnabled)
                notices.interface_elements = intelligentUiSystemPrompt();
              const skillList = skillRepository.promptList();
              if (skillList) notices.skills = skillList;
              const networkRegion = networkRegionSystemPrompt(
                localNetworkRegionSignals(),
              );
              if (networkRegion) notices.network_region = networkRegion;
              if (
                settings.approximateLocationEnabled ??
                DEFAULT_APPROXIMATE_LOCATION_ENABLED
              ) {
                const location = await this.approximateLocation(live);
                // A failed lookup keeps the last estimate rather than
                // withdrawing and re-announcing it.
                notices.approximate_location = location
                  ? approximateLocationNotice(location)
                  : announcedContextNotices(live.session.messages)
                      .approximate_location;
              }
              const message = contextNoticeMessage(
                live.session.messages,
                notices,
              );
              return message ? { message } : undefined;
            });
          },
        },
        computerUse.extension,
        skillTools.extension,
        ...(location.automation
          ? [
              createAutomationRunExtension(location.automation, () =>
                live.session.messages.some(
                  (message) =>
                    message.role === "custom" &&
                    message.customType === PINE_AUTOMATION_PAYLOAD,
                ),
              ),
            ]
          : [
              createAutomationAuthoringExtension({
                call: (operation) => this.automationHostCall(live, operation),
                getApprovalMode: () => live.approvalMode,
                getGate: () => live.gate,
                explain: (spec, previous) =>
                  this.explainAutomation(live, spec, previous),
                afterExternalContent: () => this.turnReadExternalContent(live),
                currentModel: () => this.currentModelSelection(live),
                activated: () => this.activateAuthoring(live, "automation"),
              }),
              createMcpAuthoringExtension({
                call: (operation) => this.mcpHostCall(live, operation),
                requestApproval: (input) =>
                  this.requestUserApproval(live, {
                    trigger: "privileged-execution",
                    ...input,
                  }),
                reloadWhenIdle: () => this.reloadMcpWhenIdle(live),
                activated: () => this.activateAuthoring(live, "mcp"),
              }),
            ]),
        ...(location.automation
          ? location.automation.mcp
            ? ([
                this.mcpApprovalExtension(live, (request) =>
                  isGrantedMcpTool(
                    location.automation?.mcp?.grants ?? [],
                    request.serverName,
                    request.originalToolName,
                  ),
                ),
                {
                  name: "pi-mcp-adapter",
                  factory: createMcpAdapter({
                    config: automationMcpConfig(
                      path.join(location.agentDir, "mcp.json"),
                      location.automation.mcp.cwd,
                      location.automation.mcp.grants,
                    ),
                  }),
                },
              ] satisfies InlineExtension[])
            : []
          : ([
              this.mcpApprovalExtension(live),
              createSemanticCompactionExtension({
                agentDir: location.agentDir,
                isEnabled: () => live.contextCompactionRoute === "semantic",
              }),
              createSessionSummaryCompactionExtension({
                getSession: () => live.session,
                isEnabled: () => live.contextCompactionRoute === "model",
              }),
              {
                name: "pi-mcp-adapter",
                factory: createMcpAdapter({
                  configPath: path.join(location.agentDir, "mcp.json"),
                }),
              },
            ] satisfies InlineExtension[])),
        createProgressRemindersExtension(),
        ...(sideChat
          ? [
              createSideChatExtension({
                hasNotice: () =>
                  live.session.messages.some(
                    (message) =>
                      message.role === "custom" &&
                      message.customType === PINE_SIDE_CHAT_NOTICE,
                  ),
                passage: () =>
                  sideChatPassage(live.session.sessionManager.getEntries()),
              }),
            ]
          : []),
      ],
      noThemes: true,
      skillsOverride: filterPineManagedSkills(
        skillRepository,
        location.cwd,
        location.agentDir,
        loadSkills,
      ),
      systemPromptOverride: () => systemPromptForPlatform(PINE_SYSTEM_PROMPT),
    });
    await resourceLoader.reload();
    live.gate = this.createGate(
      live,
      live.approvalMode === "let-me-review" ? "user" : "auto",
    );
    const modelRuntime = await this.getModelRuntime(location.agentDir);
    const pineTools = await createPineToolDefinitions(
      location,
      live.gate,
      attachedPaths,
      {
        getApprovalMode: () => live.approvalMode,
        getGate: () => live.gate,
        getSkillAuthoringFolders: () =>
          live.skillAuthoringActive
            ? skillRepository.authoringDirectories().map((skillDirectory) => ({
                access: "read-write" as const,
                path: skillDirectory,
              }))
            : [],
        getTinyFishApiKey: () => live.tinyFishApiKey,
        mediaGeneration: {
          activate: () => {
            if (live.mediaGenerationActive) return;
            live.mediaGenerationActive = true;
            live.session.sessionManager.appendCustomEntry(
              PINE_MEDIA_GENERATION_ACTIVE_ENTRY,
              { active: true },
            );
            this.syncActiveTools(live);
          },
          videoModelId: async () =>
            (await readPineAgentSettings(live.agentDir)).videoModel?.modelId,
          imageModelId: async () => {
            const selected = (await readPineAgentSettings(live.agentDir))
              .imageModel;
            return selected && imageModel(selected.modelId)
              ? selected.modelId
              : undefined;
          },
          resolveOpenRouterApiKey: async () =>
            (await modelRuntime.getAuth(IMAGE_MODEL_PROVIDER_ID))?.auth.apiKey,
        },
        requestQuestionnaire: (toolCallId, params, signal) =>
          this.requestQuestionnaire(live, toolCallId, params, signal),
        presentFile: (toolCallId, filePath, reveal, display) =>
          this.presentFile(live, toolCallId, filePath, reveal, display),
        workbench: {
          readState: async () => {
            const response = await this.requestHost(live, {
              kind: "workbench-state",
            });
            if (response.kind !== "workbench-state")
              throw new Error("Pine returned an unexpected workbench state.");
            return response.state;
          },
          sendCommand: (toolCallId, command) =>
            this.options.emit({
              type: "workbench-command",
              sessionId: live.session.sessionId,
              toolCallId,
              command,
            }),
        },
        workspace: {
          requestHost: (request) => this.requestHost(live, request),
          getLocale: () => live.locale,
        },
        sessions: {
          requestHost: (request) => this.requestHost(live, request),
          getLocale: () => live.locale,
          renameCurrentSession: (title) => this.retitleByAgent(live, title),
          getParentSessionId: () =>
            subSessionParentOf(live.session.sessionManager.getEntries()),
          requestApproval: (input) =>
            this.requestUserApproval(live, {
              trigger: "pre-execution",
              ...input,
            }),
        },
        backgroundTasks: {
          onChange: () => this.scheduleBackgroundTasksEvent(live),
          sendCompletionNotification: (message, options) =>
            this.deliverBackgroundTaskNotification(live, message, options),
          attach: (registry) => {
            live.backgroundTasks = registry;
          },
          promoter: live.foregroundPromoter,
        },
      },
    );
    const customTools = [
      ...pineTools,
      createActivatePineOpsToolDefinition(),
      ...(location.automation
        ? [
            createAutomationReportTool(location.automation.runId, (operation) =>
              this.automationHostCall(live, operation),
            ),
          ]
        : [
            ...createModelToolDefinitions({
              current: () => this.currentModelSelection(live),
              catalog: () => this.modelService.getModelCatalog(live.agentDir),
            }),
            // Always listed so a compaction request never changes the tools.
            createSubmitSessionSummaryToolDefinition(),
          ]),
    ];
    live.availableToolNames = [
      ...customTools.map((tool) => tool.name),
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
      INVOKE_SKILL_TOOL_NAME,
      LIST_SKILL_RESOURCES_TOOL_NAME,
      READ_SKILL_RESOURCE_TOOL_NAME,
      ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
      ...SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
      ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
      ...AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
      ACTIVATE_MCP_AUTHORING_TOOL_NAME,
      ...MCP_AUTHORING_DYNAMIC_TOOL_NAMES,
      RECALL_TOOL_NAME,
    ];

    const { session } = await createAgentSession({
      cwd: location.cwd,
      agentDir: location.agentDir,
      modelRuntime,
      resourceLoader,
      sessionManager,
      settingsManager,
      customTools,
    });
    live.session = session;
    await session.bindExtensions({ mode: "rpc" });
    this.persistApprovalMode(live);
    this.applyContextCompactionStrategy(live, contextCompactionStrategy);
    // Pine presents every staged steering message together, so inject the
    // whole batch at the next steering boundary instead of serializing turns.
    session.setSteeringMode("all");
    // Do not pass this list as createAgentSession({ tools }): the SDK treats
    // that option as a permanent registry allowlist, which would make lazily
    // activated tools impossible to add later. All definitions are registered
    // above, then the initial model-visible set is narrowed before any prompt.
    this.syncActiveTools(live);
    live.unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start")
        live.activeToolCalls.set(event.toolCallId, event.toolName);
      else if (event.type === "tool_execution_end")
        live.activeToolCalls.delete(event.toolCallId);
      else if (event.type === "agent_end") live.activeToolCalls.clear();
      this.trackSendNow(live, event);
      this.forwardEvent(session, event);
    });
    this.liveSessions.set(session.sessionId, live);
    // A resumed session already carries usage history; surface it before the
    // next turn completes.
    const contextUsage = this.getContextUsage(session);
    if (contextUsage) this.emitContextUsage(session, contextUsage);

    return {
      session: sessionSummary(session),
      ...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
      ...(contextUsage ? { contextUsage } : {}),
    };
  }

  private createGate(live: LiveAgentSession, mode: "user" | "auto"): ToolGate {
    const host: GateHost = {
      get sessionId() {
        return live.session.sessionId;
      },
      emit: (event) => this.options.emit(event),
      authorizationGrants: () => live.authorizationGrants,
      turnContext: (subjects) =>
        buildGateTurnContext(
          live.session.sessionManager.getBranch(),
          live.authorizationGrants,
          live.latestUserPrompt,
          subjects,
        ),
      recordGrant: (grant) => this.recordAuthorizationGrant(live, grant),
      recordApprovalDecision: (decision) =>
        this.recordApprovalDecision(live, decision),
      judge: (request) => this.runJudge(live, request),
      requestUserApproval: (request) => this.requestUserApproval(live, request),
    };
    return mode === "user"
      ? new UserApprovalGate(host)
      : new AutoReviewGate(host, live.approvalMode === "autonomous");
  }

  private applyContextCompactionStrategy(
    live: LiveAgentSession,
    strategy: PineContextCompactionStrategy,
  ): void {
    live.contextCompactionStrategy = strategy;
  }

  private setApprovalMode(
    live: LiveAgentSession,
    approvalMode: PineApprovalMode,
  ): void {
    // Automation runs are unattended and always autonomous, even under YOLO.
    if (live.automation) approvalMode = "autonomous";
    if (live.approvalMode !== approvalMode) {
      live.computerUseController?.resetTaskAuthorization();
      live.approvalMode = approvalMode;
      live.gate = this.createGate(
        live,
        approvalMode === "let-me-review" ? "user" : "auto",
      );
    }
    this.persistApprovalMode(live);
  }

  private persistApprovalMode(live: LiveAgentSession): void {
    const entries = live.session.sessionManager.getEntries();
    const previous = [...entries]
      .reverse()
      .find(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === PINE_APPROVAL_MODE_ENTRY,
      );
    const previousMode =
      previous?.type === "custom" &&
      typeof previous.data === "object" &&
      previous.data !== null &&
      !Array.isArray(previous.data)
        ? (previous.data as { approvalMode?: unknown }).approvalMode
        : undefined;
    if (previousMode === live.approvalMode) return;
    live.session.sessionManager.appendCustomEntry(PINE_APPROVAL_MODE_ENTRY, {
      approvalMode: live.approvalMode,
    });
  }

  /**
   * Preferences › Agent › Interim answers, read at each run start. A running
   * turn keeps its tools; the next message picks up the new value.
   */
  private applyInterimAnswersSetting(
    live: LiveAgentSession,
    enabled: boolean,
  ): void {
    if (live.interimAnswersEnabled === enabled) return;
    live.interimAnswersEnabled = enabled;
    this.syncActiveTools(live);
  }

  private syncActiveTools(live: LiveAgentSession): void {
    const activeToolNames = live.session.getActiveToolNames();
    const mcpToolNames = live.session
      .getAllTools()
      .filter((tool) => tool.sourceInfo.path === "<inline:pi-mcp-adapter>")
      .map((tool) => tool.name);
    const nextToolNames = live.automation
      ? toolNamesForTinyFishCredential(
          toolNamesForAutomationRun(
            live.availableToolNames,
            live.automation,
            mcpToolNames,
          ),
          live.tinyFishApiKey !== undefined,
        )
      : toolNamesForTinyFishCredential(
          toolNamesForMediaGenerationState(
            toolNamesForComputerUseState(
              toolNamesForMcpAuthoringState(
                toolNamesForAutomationAuthoringState(
                  toolNamesForSkillAuthoringState(
                    toolNamesForCompactionRoute(
                      toolNamesForInterimAnswers(
                        toolNamesForSubSession(
                          [...live.availableToolNames, ...mcpToolNames],
                          live.subSession,
                        ),
                        live.interimAnswersEnabled,
                      ),
                      live.contextCompactionRoute,
                    ),
                    live.skillAuthoringActive,
                  ),
                  live.automationAuthoringActive,
                ),
                live.mcpAuthoringActive,
              ),
              live.computerUseActive,
            ),
            live.mediaGenerationActive,
          ),
          live.tinyFishApiKey !== undefined,
        );
    if (
      nextToolNames.length === activeToolNames.length &&
      nextToolNames.every((name, index) => name === activeToolNames[index])
    ) {
      return;
    }
    live.session.setActiveToolsByName(nextToolNames);
  }

  async reloadMcp(sessionId: string): Promise<{ updated: boolean }> {
    const live = this.liveSessions.get(sessionId);
    if (!live) return { updated: false };
    // A running session picks the change up when its run ends.
    if (!live.session.isIdle) {
      this.reloadMcpWhenIdle(live);
      return { updated: false };
    }
    await live.session.reload();
    this.syncActiveTools(live);
    return { updated: true };
  }

  listBackgroundTasks(sessionId: string): ListBackgroundTasksResult {
    return { tasks: this.backgroundTasksFor(sessionId).snapshots() };
  }

  async stopBackgroundTask(
    sessionId: string,
    taskId: string,
  ): Promise<BackgroundTaskResult> {
    return {
      task: await this.backgroundTasksFor(sessionId).stop(taskId, "user"),
    };
  }

  readBackgroundTaskOutput(
    sessionId: string,
    taskId: string,
    maxBytes: number,
  ): Promise<ReadBackgroundTaskOutputResult> {
    return this.backgroundTasksFor(sessionId).readOutput(
      taskId,
      Math.max(0, Math.min(maxBytes, BACKGROUND_TASK_OUTPUT_TAIL_BYTES)),
    );
  }

  private backgroundTasksFor(sessionId: string): BackgroundTaskRegistry {
    const registry = this.getSession(sessionId).backgroundTasks;
    if (!registry) throw new Error("This session has no background tasks.");
    return registry;
  }

  private scheduleBackgroundTasksEvent(live: LiveAgentSession): void {
    if (live.backgroundTaskEmitTimer) return;
    live.backgroundTaskEmitTimer = setTimeout(() => {
      live.backgroundTaskEmitTimer = undefined;
      const registry = live.backgroundTasks;
      const sessionId = live.session?.sessionId;
      if (!registry || !sessionId || !this.liveSessions.has(sessionId)) return;
      this.options.emit({
        type: "background-tasks",
        sessionId,
        tasks: registry.snapshots(),
      });
    }, BACKGROUND_TASKS_EVENT_MS);
  }

  /**
   * Hand a finished task's notification to the session. A running turn takes
   * it as steering before its next model call; a wake-up on an idle session
   * starts a turn outside `prompt`, so this reports its run state.
   */
  /**
   * Tells a session about one of its sub-sessions the way a finished
   * background task does: steering while it runs, a new turn when idle.
   */
  async notifySession(
    sessionId: string,
    notice: PineSessionNotice,
    content: string,
    triggerTurn = true,
  ): Promise<{ delivered: boolean }> {
    const live = this.liveSessions.get(sessionId);
    if (!live) return { delivered: false };
    await this.deliverBackgroundTaskNotification(
      live,
      {
        customType: PINE_SESSION_NOTICE_TYPE,
        content,
        display: true,
        details: notice,
      },
      { triggerTurn },
    );
    return { delivered: true };
  }

  private async deliverBackgroundTaskNotification(
    live: LiveAgentSession,
    message:
      | BackgroundTaskNotificationMessage
      | {
          customType: typeof PINE_SESSION_NOTICE_TYPE;
          content: string;
          display: true;
          details: PineSessionNotice;
        },
    options: { triggerTurn: boolean },
  ): Promise<void> {
    const session = live.session;
    const sessionId = session.sessionId;
    if (!this.liveSessions.has(sessionId)) return;
    if (session.isCompacting || live.resumingCompactionPrompts) {
      await session.waitForIdle();
    }
    if (!this.liveSessions.has(sessionId)) return;
    const startsTurn = options.triggerTurn && session.isIdle;
    if (!startsTurn) {
      await session.sendCustomMessage<unknown>(message, {
        deliverAs: "steer",
        triggerTurn: options.triggerTurn,
      });
      return;
    }
    live.computerUseController?.resetTaskAuthorization();
    live.gate?.resetTurn();
    live.mcpScriptApprovals.clear();
    this.options.emit({ type: "run-state", sessionId, state: "running" });
    void session
      .sendCustomMessage<unknown>(message, {
        deliverAs: "steer",
        triggerTurn: true,
      })
      .catch((error: unknown) => {
        const errorMessage = toErrorMessage(error);
        this.options.emit({
          type: "session-error",
          sessionId,
          errorId: randomUUID(),
          message: errorMessage,
        });
        this.options.emit({
          type: "run-state",
          sessionId,
          state: "failed",
          error: errorMessage,
        });
      })
      .finally(() => {
        if (session.isIdle) {
          this.options.emit({ type: "run-state", sessionId, state: "idle" });
        }
      });
  }

  getMcpStatus(sessionId: string): McpStatusSnapshot {
    const live = this.liveSessions.get(sessionId);
    const reported = live?.mcpStatus;
    const configured = live
      ? Object.entries(
          loadMcpConfig(path.join(live.agentDir, "mcp.json"), live.cwd)
            .mcpServers,
        ).map(([name, definition]) => ({
          name,
          status:
            definition.disabled === true
              ? ("disabled" as const)
              : ("not-connected" as const),
          listenState: "disconnected" as const,
          toolCount: 0,
          directToolCount: 0,
          disabled: definition.disabled === true,
        }))
      : [];
    const servers = [
      ...(reported?.servers ?? []),
      ...configured.filter(
        (server) =>
          !reported?.servers.some((entry) => entry.name === server.name),
      ),
    ];
    return {
      version: reported?.version ?? 1,
      servers,
      totalTools: reported?.totalTools ?? 0,
      totalResources: reported?.totalResources ?? 0,
      connectedCount: reported?.connectedCount ?? 0,
      disabledCount: servers.filter((server) => server.disabled).length,
    };
  }

  setTinyFishApiKey(apiKey: string | undefined): { updated: boolean } {
    const normalized = apiKey?.trim() || undefined;
    for (const live of this.liveSessions.values()) {
      if (normalized) live.tinyFishApiKey = normalized;
      else delete live.tinyFishApiKey;
      this.syncActiveTools(live);
    }
    return { updated: true };
  }

  /** Cross-process round trip: renderer answers, worker resumes. */
  private requestUserApproval(
    live: LiveAgentSession,
    request: UserApprovalRequest,
  ): Promise<GateDecision> {
    // A side chat shows no approval cards; what needs one is not read-only.
    if (live.sideChat)
      return Promise.resolve({
        kind: "deny",
        reason: SIDE_CHAT_APPROVAL_REASON,
      });
    const sessionId = live.session.sessionId;
    const requestId = randomUUID();
    return new Promise<GateDecision>((resolve) => {
      const pending: PendingUserApproval = {
        resolve,
        sessionId,
        toolCallId: request.toolCallId,
        live,
        request,
        actionDigest: approvalActionDigest(request),
      };
      this.pendingApprovals.set(requestId, pending);
      const onAbort = () => {
        if (this.pendingApprovals.get(requestId) !== pending) return;
        this.pendingApprovals.delete(requestId);
        resolve({ kind: "deny", reason: "aborted" });
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      const reviewInput: Record<string, string> = {};
      if (request.subject !== undefined) reviewInput.subject = request.subject;
      if (request.description !== undefined) {
        reviewInput.description = request.description;
      }
      const emitRequest = (
        explanation: PineApprovalExplanation | undefined,
        explanationPending: boolean,
      ) =>
        this.options.emit({
          type: "approval-request",
          sessionId,
          requestId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          trigger: request.trigger,
          input: Object.keys(reviewInput).length > 0 ? reviewInput : undefined,
          evidence: request.evidence,
          autoApprovalFailure: request.autoApprovalFailure,
          ...(request.reasonCode ? { reasonCode: request.reasonCode } : {}),
          ...(request.reasonDetail
            ? { reasonDetail: request.reasonDetail }
            : {}),
          ...(request.reviews?.length ? { reviews: request.reviews } : {}),
          ...(explanation
            ? { explanation }
            : explanationPending
              ? { explanationPending: true }
              : {}),
          actionDigest: pending.actionDigest,
        });
      const pendingExplanation = request.pendingExplanation;
      if (request.explanation || !pendingExplanation) {
        emitRequest(request.explanation, false);
        return;
      }
      // Show the card once its account is ready, or after the wait window.
      void awaitApprovalExplanation(
        pendingExplanation,
        request.signal,
        APPROVAL_EXPLANATION_WAIT_MS,
      ).then(({ explanation, timedOut }) => {
        // Aborted, decided elsewhere, or the session closed meanwhile.
        if (this.pendingApprovals.get(requestId) !== pending) return;
        if (!timedOut) {
          emitRequest(explanation, false);
          return;
        }
        emitRequest(undefined, true);
        void pendingExplanation
          .catch(() => undefined)
          .then((late) => {
            // A decided or aborted card no longer shows anything.
            if (this.pendingApprovals.get(requestId) !== pending) return;
            this.options.emit({
              type: "approval-explanation",
              sessionId,
              requestId,
              toolCallId: request.toolCallId,
              ...(late ? { explanation: late } : {}),
            });
          });
      });
    });
  }

  /** Entry point for the worker's inbound `approval:response` messages. */
  resolveApproval(
    requestId: string,
    decision: GateDecision,
  ): { accepted: boolean } {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return { accepted: false };
    this.pendingApprovals.delete(requestId);
    if (
      decision.kind === "allow" &&
      pending.request.trigger !== "long-context-activation"
    ) {
      this.recordAuthorizationGrant(pending.live, {
        source: "user",
        scope: "once",
        toolName: pending.request.toolName,
        subject: pending.request.subject ?? "",
        description: pending.request.description,
        actionDigest: pending.actionDigest,
      });
    }
    pending.resolve(decision);
    const persistedDecision: PineApprovalDecision = {
      requestId,
      toolCallId: pending.toolCallId,
      verdict: decision.kind === "allow" ? "approved" : "denied",
      decidedBy: "user",
      ...(pending.request.reviews?.length
        ? { reviews: pending.request.reviews }
        : {}),
      ...(decision.kind === "deny" && decision.reason
        ? { reason: decision.reason }
        : {}),
    };
    this.recordApprovalDecision(pending.live, persistedDecision);
    this.options.emit({
      type: "approval-decided",
      sessionId: pending.sessionId,
      requestId,
      toolCallId: pending.toolCallId,
      verdict: decision.kind === "allow" ? "approved" : "denied",
      decidedBy: "user",
      reason: decision.kind === "deny" ? decision.reason : undefined,
      ...(pending.request.reviews?.length
        ? { reviews: pending.request.reviews }
        : {}),
    });
    return { accepted: true };
  }

  private recordApprovalDecision(
    live: LiveAgentSession,
    decision: PineApprovalDecision,
  ): void {
    live.session.sessionManager.appendCustomEntry(
      PINE_APPROVAL_DECISION_ENTRY,
      decision,
    );
  }

  /**
   * Ask the renderer to show a file the user should look at. Main resolves the
   * absolute path into a preview target, so this stays fire-and-forget: the
   * tool already proved the path readable, and no part of showing it can fail
   * in a way the agent needs to act on.
   */
  private presentFile(
    live: LiveAgentSession,
    toolCallId: string,
    filePath: string,
    reveal?: FileReveal,
    display: FilePresentationDisplay = "sidebar",
  ): void {
    this.options.emit({
      type: "present-file",
      sessionId: live.session.sessionId,
      toolCallId,
      path: filePath,
      display,
      ...(reveal ? { reveal } : {}),
    });
  }

  /** Null when main has no estimate in time; it never delays a turn long. */
  private async approximateLocation(
    live: LiveAgentSession,
  ): Promise<ApproximateLocation | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), APPROXIMATE_LOCATION_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([
        this.requestHost(live, { kind: "approximate-location" }),
        timeout,
      ]);
      return response?.kind === "approximate-location"
        ? response.location
        : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Answers the MCP adapter's approval requests. Outside YOLO the approval
   * model reviews each call; a run additionally refuses every server tool its
   * definition does not list.
   */
  private mcpApprovalExtension(
    live: LiveAgentSession,
    granted?: (request: McpToolApprovalRequest) => boolean,
  ): InlineExtension {
    return {
      name: "pine-mcp-approval",
      factory: (pi) => {
        pi.events.on(MCP_STATUS_EVENT, (snapshot) => {
          live.mcpStatus = snapshot as McpStatusSnapshot;
          if (live.session) this.syncActiveTools(live);
        });
        pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value) => {
          const request = value as McpToolApprovalRequest;
          request.claim(async () => {
            if (granted && !granted(request)) return "deny";
            if (live.approvalMode === "YOLO") return "allow_once";
            return live.mcpScriptApprovals.decide(request, live.gate);
          });
        });
      },
    };
  }

  private async mcpHostCall(
    live: LiveAgentSession,
    operation: McpHostOperation,
  ): Promise<PineJsonValue> {
    const response = await this.requestHost(live, { kind: "mcp", operation });
    if (response.kind !== "mcp")
      throw new Error("Pine returned an unexpected MCP response.");
    return response.result;
  }

  /**
   * Reloading replaces the session's extensions, which cannot happen mid-run;
   * a config change made by a tool waits for the run to end.
   */
  private reloadMcpWhenIdle(live: LiveAgentSession): void {
    if (live.mcpReloadPending) return;
    live.mcpReloadPending = true;
    void (async () => {
      try {
        while (!live.session.isIdle) await live.session.waitForIdle();
        if (this.liveSessions.get(live.session.sessionId) !== live) return;
        live.mcpReloadPending = false;
        await live.session.reload();
        this.syncActiveTools(live);
      } catch {
        live.mcpReloadPending = false;
      }
    })();
  }

  private async automationHostCall(
    live: LiveAgentSession,
    operation: AutomationHostOperation,
  ): Promise<PineJsonValue> {
    const response = await this.requestHost(live, {
      kind: "automation",
      operation,
    });
    if (response.kind !== "automation")
      throw new Error("Pine returned an unexpected automation response.");
    return response.result;
  }

  private currentModelSelection(
    live: LiveAgentSession,
  ): PineModelSelection | undefined {
    const model = live.session?.model;
    if (!model) return undefined;
    return {
      providerId: model.provider,
      modelId: model.id,
      thinkingLevel: live.session.thinkingLevel,
    };
  }

  /** Whether this turn has read web or MCP content, for the approval card. */
  private turnReadExternalContent(live: LiveAgentSession): boolean {
    const mcpToolNames = new Set(
      live.session
        .getAllTools()
        .filter((tool) => tool.sourceInfo.path === "<inline:pi-mcp-adapter>")
        .map((tool) => tool.name),
    );
    const messages = live.session.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user") return false;
      if (
        message.role === "toolResult" &&
        (message.toolName === "web_fetch" ||
          message.toolName === "web_search" ||
          mcpToolNames.has(message.toolName))
      )
        return true;
    }
    return false;
  }

  /**
   * A plain account of an automation for its approval card, written by the
   * approval model. The card shows the hard facts beside it regardless.
   */
  private async explainAutomation(
    live: LiveAgentSession,
    spec: PineJsonValue,
    previous?: PineJsonValue,
  ): Promise<string | undefined> {
    const modelRuntime = await this.getModelRuntime(live.agentDir);
    const model = await this.modelService.approvalModel(
      live.agentDir,
      modelRuntime,
    );
    if (!model) return undefined;
    const language = live.locale === "zh-CN" ? "Simplified Chinese" : "English";
    const signal = AbortSignal.timeout(JUDGE_TIMEOUT_MS);
    const context: Context = {
      systemPrompt: `You explain a Pine automation to the person who must approve it. Write in ${language}, at most 120 words, plain prose without headings. Say when it runs, what it reads, what it changes or creates, which websites it contacts and which saved secrets it uses. ${previous ? "Start with what changes compared with the previous version. " : ""}Point out anything that could surprise the user: deleting or overwriting files, sending data to websites, privileged shell access, running very often. Describe only what the definition allows; do not reassure or recommend.`,
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: `${previous ? `Previous definition:\n${truncateText(JSON.stringify(previous, null, 2), 12_000)}\n\n` : ""}Definition to approve:\n${truncateText(JSON.stringify(spec, null, 2), 24_000)}`,
        },
      ],
    };
    let final: AssistantMessage | undefined;
    for await (const event of modelRuntime.stream(model, context, {
      ...judgeStreamOptions(model, signal),
      maxTokens: 800,
    })) {
      if (event.type === "done") final = event.message;
      else if (event.type === "error") return undefined;
    }
    const text = final?.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    return text || undefined;
  }

  private requestHost(
    live: LiveAgentSession,
    request: AgentHostRequest,
  ): Promise<AgentHostResponse> {
    const sessionId = live.session.sessionId;
    const requestId = randomUUID();
    return new Promise<AgentHostResponse>((resolve, reject) => {
      this.pendingHostRequests.set(requestId, { sessionId, resolve, reject });
      this.options.emit({
        type: "host-request",
        sessionId,
        requestId,
        request,
      });
    });
  }

  resolveHostRequest(requestId: string, reply: AgentHostReply): void {
    const pending = this.pendingHostRequests.get(requestId);
    if (!pending) return;
    this.pendingHostRequests.delete(requestId);
    if (reply.ok) pending.resolve(reply.response);
    else pending.reject(new Error(reply.error));
  }

  private rejectHostRequests(sessionId: string | null, reason: string): void {
    for (const [requestId, pending] of this.pendingHostRequests) {
      if (sessionId !== null && pending.sessionId !== sessionId) continue;
      this.pendingHostRequests.delete(requestId);
      pending.reject(new Error(reason));
    }
  }

  private requestQuestionnaire(
    live: LiveAgentSession,
    toolCallId: string,
    questionnaire: AskUserQuestionParams,
    signal?: AbortSignal,
  ): Promise<AskUserQuestionSubmission> {
    const sessionId = live.session.sessionId;
    const requestId = randomUUID();
    return new Promise<AskUserQuestionSubmission>((resolve) => {
      const pending: PendingQuestionnaire = {
        resolve,
        sessionId,
        toolCallId,
        signal,
      };
      this.pendingQuestionnaires.set(requestId, pending);
      const onAbort = () => {
        if (this.pendingQuestionnaires.get(requestId) !== pending) return;
        this.pendingQuestionnaires.delete(requestId);
        resolve({ answers: [], cancelled: true });
        this.options.emit({
          type: "questionnaire-decided",
          sessionId,
          requestId,
          toolCallId,
          cancelled: true,
        });
      };
      pending.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.options.emit({
        type: "questionnaire-request",
        sessionId,
        requestId,
        toolCallId,
        questionnaire,
      });
    });
  }

  resolveQuestionnaire(
    requestId: string,
    submission: AskUserQuestionSubmission,
  ): { accepted: boolean } {
    const pending = this.pendingQuestionnaires.get(requestId);
    if (!pending) return { accepted: false };
    this.pendingQuestionnaires.delete(requestId);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    pending.resolve(structuredClone(submission));
    this.options.emit({
      type: "questionnaire-decided",
      sessionId: pending.sessionId,
      requestId,
      toolCallId: pending.toolCallId,
      cancelled: submission.cancelled,
    });
    return { accepted: true };
  }

  private recordAuthorizationGrant(
    live: LiveAgentSession,
    input: Omit<AuthorizationGrant, "id" | "createdAt">,
  ): AuthorizationGrant {
    const duplicate =
      input.scope === "session"
        ? live.authorizationGrants.find(
            (grant) =>
              grant.scope === input.scope &&
              grant.source === input.source &&
              grant.actionDigest === input.actionDigest,
          )
        : undefined;
    if (duplicate) return duplicate;
    const grant: AuthorizationGrant = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    live.authorizationGrants.push(grant);
    live.session.sessionManager.appendCustomEntry(
      PINE_AUTHORIZATION_GRANT_ENTRY,
      grant,
    );
    return grant;
  }

  /**
   * Review each batch through the configured path, using Decisions screening
   * when enabled and the approval model for any calls requiring further review.
   * Never goes through session.prompt (no recursion into the tool pipeline).
   */
  private async runJudge(
    live: LiveAgentSession,
    requests: JudgeRequest[],
  ): Promise<JudgeRuling[]> {
    if (requests.length === 0) return [];
    const timeout = AbortSignal.timeout(JUDGE_TIMEOUT_MS);
    const requestSignals = requests.flatMap((request) =>
      request.signal ? [request.signal] : [],
    );
    const signal = AbortSignal.any([...requestSignals, timeout]);
    const pineSettings = await readPineAgentSettings(live.agentDir);
    const settings =
      pineSettings.autoApproval ?? DEFAULT_AUTO_APPROVAL_SETTINGS;
    const profile = pineSettings.userProfile ?? createDefaultPineUserProfile();
    return runApprovalReview({
      requests,
      settings,
      autonomous: live.approvalMode === "autonomous",
      locale: live.locale,
      sessionId: live.session.sessionId,
      signal,
      resolveApiKey: async () =>
        (
          await (
            await this.getModelRuntime(live.agentDir)
          ).getAuth("openrouter")
        )?.auth.apiKey,
      reviewWithModel: (pending) =>
        this.runModelJudge(live, pending, signal, profile),
      ...(live.approvalMode !== "autonomous"
        ? {
            explainWithModel: (pending: JudgeRequest[]) =>
              this.runModelExplanation(live, pending, profile),
          }
        : {}),
    });
  }

  /**
   * Plain-language account of calls Decisions screening sent to the user,
   * written by the approval model. It fills text only and cannot re-decide.
   */
  private async runModelExplanation(
    live: LiveAgentSession,
    requests: JudgeRequest[],
    profile: PineUserProfile = createDefaultPineUserProfile(),
  ): Promise<Map<string, PineApprovalExplanation>> {
    const none = new Map<string, PineApprovalExplanation>();
    if (requests.length === 0) return none;
    try {
      const modelRuntime = await this.getModelRuntime(live.agentDir);
      const model = await this.modelService.approvalModel(
        live.agentDir,
        modelRuntime,
      );
      if (!model) return none;
      const signal = AbortSignal.any([
        ...requests.flatMap((request) =>
          request.signal ? [request.signal] : [],
        ),
        AbortSignal.timeout(APPROVAL_EXPLANATION_TIMEOUT_MS),
      ]);
      const context: Context = {
        systemPrompt: approvalExplanationSystemPrompt(
          live.locale,
          approvalExplanationAudience(profile, { includeNotes: true }),
        ),
        messages: [
          {
            role: "user",
            timestamp: Date.now(),
            content: `Explain all ${requests.length} tool call${requests.length === 1 ? "" : "s"} below, one entry per exact toolCallId.\n\n${buildApprovalExplanationContent(requests)}`,
          },
        ],
        tools: [EXPLANATION_TOOL],
      };
      let final: AssistantMessage | undefined;
      for await (const event of modelRuntime.stream(model, context, {
        ...judgeStreamOptions(model, signal),
        maxTokens: Math.min(1_500, 250 + 250 * requests.length),
      })) {
        if (event.type === "done") final = event.message;
        else if (event.type === "error") return none;
      }
      const call = final?.content.find(
        (block) =>
          block.type === "toolCall" && block.name === EXPLANATION_TOOL.name,
      );
      if (!call || call.type !== "toolCall") return none;
      return parseApprovalExplanations(
        call.arguments,
        requests.map((request) => request.toolCallId),
      );
    } catch {
      return none;
    }
  }

  private async runModelJudge(
    live: LiveAgentSession,
    requests: JudgeRequest[],
    signal: AbortSignal,
    profile: PineUserProfile = createDefaultPineUserProfile(),
  ): Promise<JudgeRuling[]> {
    let reviewer: Pick<
      PineApprovalReview,
      "kind" | "providerId" | "modelId" | "modelName"
    > = { kind: "model" };
    try {
      signal.throwIfAborted();
      const modelRuntime = await this.getModelRuntime(live.agentDir);
      const model = await this.modelService.approvalModel(
        live.agentDir,
        modelRuntime,
      );
      if (!model)
        throw new JudgeUnavailableError(
          REVIEW_FAILURE_MESSAGES.noApprovalModel,
        );
      reviewer = {
        kind: "model",
        providerId: model.provider,
        modelId: model.id,
        modelName: model.name,
      };
      signal.throwIfAborted();
      const autonomous = live.approvalMode === "autonomous";
      const context: Context = {
        systemPrompt: `${autonomous ? AUTONOMOUS_JUDGE_SYSTEM_PROMPT : JUDGE_SYSTEM_PROMPT}${
          requests.every((request) => request.allowSessionScope === false)
            ? '\n\nThese privileged calls must each receive an independent verdict. Set every scope to "once"; session scope is not available.'
            : ""
        }${
          autonomous
            ? ""
            : `\n\nReader of summary and risks (affects only their wording, never the verdict): ${approvalExplanationAudience(profile, { includeNotes: false })}`
        }`,
        messages: [
          {
            role: "user",
            timestamp: Date.now(),
            content: `Review all ${requests.length} tool call${requests.length === 1 ? "" : "s"} below and return one ruling for every exact toolCallId.\n\n## Shared authorization and causal context\n${buildJudgeSharedContext(requests[0].turn) || "No conversation authority was available."}\n\n${requests
              .map(
                (request, index) =>
                  `## Tool call ${index + 1}\n${buildJudgeEvidence(request)}`,
              )
              .join("\n\n")}`,
          },
        ],
        tools: [autonomous ? AUTONOMOUS_RULING_TOOL : RULING_TOOL],
      };
      const stream = modelRuntime.stream(
        model,
        context,
        judgeStreamOptions(model, signal),
      );
      let final: AssistantMessage | undefined;
      for await (const event of stream) {
        if (event.type === "done") final = event.message;
        else if (event.type === "error") {
          if (event.reason === "aborted") throw new Error("aborted");
          throw new Error(
            event.error.errorMessage ?? REVIEW_FAILURE_MESSAGES.streamFailed,
          );
        }
      }
      if (!final) throw new Error(REVIEW_FAILURE_MESSAGES.noResponse);
      const call = final.content.find(
        (block) => block.type === "toolCall" && block.name === RULING_TOOL.name,
      );
      if (!call || call.type !== "toolCall") {
        throw new Error(REVIEW_FAILURE_MESSAGES.noRuling);
      }
      const rulings = parseJudgeRulings(
        call.arguments,
        requests.map((request) => request.toolCallId),
      );
      for (const request of requests) {
        const ruling = rulings.find(
          (entry) => entry.toolCallId === request.toolCallId,
        )!;
        request.onReview?.({
          ...reviewer,
          outcome: ruling.verdict,
          reason: ruling.reason,
        });
      }
      return rulings;
    } catch (error) {
      for (const request of requests)
        request.onReview?.({
          ...reviewer,
          outcome: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      throw error;
    }
  }

  /** The agent's own retitle; a title the user chose is never replaced. */
  private retitleByAgent(
    live: LiveAgentSession,
    title: string,
  ): RenameCurrentSessionResult {
    const session = live.session;
    const normalized = normalizeGeneratedTitle(title);
    if (!normalized) return { renamed: false, reason: "invalid" };
    if (
      isUserChosenTitle(
        session.sessionManager.getEntries(),
        session.sessionName,
      )
    )
      return { renamed: false, reason: "user-title" };
    if (normalized === session.sessionName)
      return { renamed: false, reason: "unchanged" };
    session.setSessionName(normalized);
    return { renamed: true, title: normalized };
  }

  private async generateInitialTitle(live: LiveAgentSession): Promise<void> {
    const session = live.session;
    if (
      live.sideChat ||
      session.sessionName ||
      this.titleGenerationAttempts.has(session.sessionId) ||
      (this.titleGenerationFailures.get(session.sessionId) ?? 0) >=
        MAX_TITLE_ATTEMPTS ||
      this.titleGenerationInFlight.has(session.sessionId)
    ) {
      return;
    }

    const messages = session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .filter(
        (entry) =>
          entry.message.role === "user" || entry.message.role === "assistant",
      );
    if (!messages.some((entry) => entry.message.role === "user")) return;
    const transcript = truncateText(
      messages
        .map((entry) => {
          const role = entry.message.role === "user" ? "User" : "Assistant";
          // Pine's routing line on a sub-session's or relayed message is
          // not what the conversation is about.
          const text = withoutRelayPrefix(
            attachmentMessagePreview(
              textFromMessageContent(
                "content" in entry.message ? entry.message.content : "",
              ),
            ),
          );
          return `${role}: ${truncateText(text, 4_000)}`;
        })
        .filter((line) => !line.endsWith(": "))
        .join("\n\n"),
      6_000,
    );
    if (!transcript) return;

    this.titleGenerationInFlight.add(session.sessionId);
    try {
      const modelRuntime = await this.getModelRuntime(live.agentDir);
      const model = await this.modelService.utilityModel(
        live.agentDir,
        modelRuntime,
      );
      if (!model) return;
      const language =
        live.locale === "zh-CN" ? "Simplified Chinese" : "English";
      const signal = AbortSignal.timeout(TITLE_TIMEOUT_MS);
      const context: Context = {
        systemPrompt: `Generate a concise, informative conversation title in ${language}. Capture the primary user goal or topic so the conversation is easy to recognize later. Prefer a short, natural phrase that preserves the complete meaning; do not sacrifice clarity or truncate key terms for brevity. Use at most ${MAX_GENERATED_TITLE_LENGTH} characters. Keep model names, product names, filenames, and technical terms when they are central to the topic. Omit incidental details and unnecessary URLs. Do not invent outcomes or use promotional wording. Call submit_title exactly once with { "title": string }; do not answer in plain text.`,
        messages: [
          {
            role: "user",
            timestamp: Date.now(),
            content: transcript,
          },
        ],
        tools: [TITLE_TOOL],
      };
      const options = {
        ...judgeStreamOptions(model, signal),
        maxTokens: TITLE_MAX_TOKENS,
      };
      let final: AssistantMessage | undefined;
      for await (const event of modelRuntime.stream(model, context, options)) {
        if (event.type === "done") final = event.message;
        else if (event.type === "error") {
          this.recordTitleFailure(session.sessionId);
          return;
        }
      }
      const title = titleFromAssistantMessage(final);
      if (title) {
        this.titleGenerationAttempts.add(session.sessionId);
        if (!session.sessionName) session.setSessionName(title);
      } else {
        this.recordTitleFailure(session.sessionId);
      }
    } catch {
      // Title generation is best-effort and must never fail the user's turn.
      // A failed attempt is retried on a later turn, a few times at most.
      this.recordTitleFailure(session.sessionId);
    } finally {
      this.titleGenerationInFlight.delete(session.sessionId);
    }
  }

  private recordTitleFailure(sessionId: string): void {
    this.titleGenerationFailures.set(
      sessionId,
      (this.titleGenerationFailures.get(sessionId) ?? 0) + 1,
    );
  }

  private getSession(sessionId: string): LiveAgentSession {
    const live = this.liveSessions.get(sessionId);
    if (!live) throw new Error(`Agent session not found: ${sessionId}`);
    return live;
  }

  private forwardEvent(session: AgentSession, event: AgentSessionEvent): void {
    // agent_end may be followed by retry/compaction; only settled ends the run.
    if (event.type === "agent_settled") {
      this.liveSessions
        .get(session.sessionId)
        ?.computerUseController?.resetTaskAuthorization();
    }
    this.eventForwarder.forward(session, event);
  }

  private getModelRuntime(agentDir: string): Promise<ModelRuntime> {
    return this.modelService.getModelRuntime(agentDir);
  }

  /** Pushes the live context usage estimate so the renderer's composer
   * indicator stays current without polling. */
  private getContextUsage(
    session: AgentSession,
    currentAssistantMessage?: AssistantMessage,
  ): PineContextUsage | undefined {
    // The stats already carry the context usage; asking for it separately
    // would project the whole session a second time.
    const stats = session.getSessionStats();
    const usage = stats.contextUsage;
    if (!usage) return undefined;
    const currentCacheUsage = currentAssistantMessage?.usage;
    const hasCacheUsage =
      stats.tokens.cacheRead > 0 ||
      stats.tokens.cacheWrite > 0 ||
      (currentCacheUsage !== undefined &&
        (currentCacheUsage.cacheRead > 0 || currentCacheUsage.cacheWrite > 0));
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      cost: stats.cost,
      cacheHitRate: hasCacheUsage
        ? getLatestCacheHitRate(
            session.sessionManager.getEntries(),
            currentAssistantMessage,
          )
        : null,
    };
  }

  private emitContextUsage(
    session: AgentSession,
    contextUsage = this.getContextUsage(session),
  ): void {
    if (!contextUsage) return;
    this.options.emit({
      type: "context-usage",
      sessionId: session.sessionId,
      ...contextUsage,
    });
  }
}
