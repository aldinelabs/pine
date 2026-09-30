import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  loadSkills,
  type AgentSession,
  type AgentSessionEvent,
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
import { loadMcpConfig } from "pi-mcp-adapter/config";
import { type PineApprovalMode } from "../shared/agent";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  PineAuthType,
  PineImageModelSelection,
  PineModelCatalog,
  PineThinkingLevel,
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
  type PineApprovalDecision,
  type PineContextUsage,
} from "../shared/sessions";
import { attachmentMessagePreview } from "../shared/attachments";
import {
  type AgentSessionLocation,
  type AgentWorkerPromptResult,
  type AgentWorkerSessionResult,
  GateDecision,
  toErrorMessage,
} from "./protocol";
import {
  PINE_SYSTEM_PROMPT,
  systemPromptForPlatform,
  systemPromptWithUserProfile,
  systemPromptWithCurrentMonth,
  approvalModeSystemPrompt,
} from "./system-prompt";
import {
  AutoReviewGate,
  RULING_TOOL,
  AUTONOMOUS_RULING_TOOL,
  UserApprovalGate,
  type AuthorizationGrant,
  type GateHost,
  type JudgeRequest,
  type JudgeRuling,
  type ToolGate,
  type UserApprovalRequest,
} from "./gate";
import { createPineToolDefinitions, PineAttachedPathAccess } from "./tools";
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
} from "./skills/tools";
import { imageModel, IMAGE_MODEL_PROVIDER_ID } from "./media/models";
import { PineSkillRepository } from "./skills/repository";
import {
  filterPineManagedSkills,
  piProjectSkillPaths,
} from "./skills/piDiscovery";
import { readPineAgentSettings } from "./pineSettings";
import { createDefaultPineUserProfile } from "../shared/userProfile";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
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
  buildGateTurnContext,
  computerUseActiveFromSessionEntries,
  mediaGenerationActiveFromSessionEntries,
  projectSessionDirectory,
  sessionSummary,
  skillAuthoringActiveFromSessionEntries,
  textFromMessageContent,
  toolNamesForApprovalMode,
  toolNamesForComputerUseState,
  toolNamesForMediaGenerationState,
  toolNamesForSkillAuthoringState,
} from "./runtime/session-state";
import { getLatestCacheHitRate } from "./runtime/context-metrics";
import { configureContextCompactionSettings } from "./runtime/compaction-settings";
import {
  AUTONOMOUS_JUDGE_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeEvidence,
  buildJudgeSharedContext,
  judgeStreamOptions,
  parseJudgeRulings,
  truncateText,
} from "./runtime/review";
import {
  MAX_GENERATED_TITLE_LENGTH,
  TITLE_TOOL,
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
  toolNamesForApprovalMode,
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

const JUDGE_TIMEOUT_MS = 60_000;
const TITLE_TIMEOUT_MS = 30_000;
export class PineAgentRuntime {
  private readonly liveSessions = new Map<string, LiveAgentSession>();
  private readonly pendingApprovals = new Map<string, PendingUserApproval>();
  private readonly pendingQuestionnaires = new Map<
    string,
    PendingQuestionnaire
  >();
  private readonly titleGenerationAttempts = new Set<string>();
  private readonly titleGenerationInFlight = new Set<string>();

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

  async prompt(
    sessionId: string,
    message: string,
    streamingBehavior?: "followUp" | "steer",
    attachedPaths: readonly string[] = [],
    approvalMode: PineApprovalMode = "auto-approve",
    locale: "en-US" | "zh-CN" = "en-US",
  ): Promise<AgentWorkerPromptResult> {
    const live = this.getSession(sessionId);
    live.locale = locale;
    this.setApprovalMode(live, approvalMode);
    await live.attachedPaths.grant(attachedPaths);
    live.latestUserPrompt = message;
    live.gate?.resetTurn();
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
              preflightResult: (success) => {
                if (success) settleAccepted();
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

  private emitSteeringQueue(live: LiveAgentSession): void {
    this.options.emit({
      type: "steering-queue",
      sessionId: live.session.sessionId,
      messages: [
        ...live.session.getSteeringMessages(),
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
          this.setApprovalMode(live, queued.approvalMode);
          live.gate?.resetTurn();
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

  async abort(sessionId: string): Promise<{ aborted: boolean }> {
    const live = this.getSession(sessionId);
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

  renameSession(sessionId: string, name: string): AgentWorkerSessionResult {
    const session = this.getSession(sessionId).session;
    session.setSessionName(name);
    return { session: sessionSummary(session) };
  }

  async disposeSession(sessionId: string): Promise<{ disposed: boolean }> {
    const live = this.liveSessions.get(sessionId);
    if (!live) return { disposed: false };

    this.liveSessions.delete(sessionId);
    this.eventForwarder.clearSession(sessionId);
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
    await live.computerUseController?.dispose();
    live.unsubscribe();
    await live.session.settingsManager.flush();
    live.session.dispose();
    return { disposed: true };
  }

  async dispose(): Promise<{ disposed: boolean }> {
    this.modelService.dispose();
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

  selectImageModel(
    agentDir: string,
    selection: PineImageModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.modelService.selectImageModel(agentDir, selection);
  }

  setContextCompactionStrategy(strategy: PineContextCompactionStrategy): {
    updated: boolean;
  } {
    return this.modelService.setContextCompactionStrategy(strategy);
  }

  private async registerSession(
    location: AgentSessionLocation,
    sessionManager: SessionManager,
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
    const contextCompactionStrategy =
      (await readPineAgentSettings(location.agentDir))
        .contextCompactionStrategy ?? DEFAULT_CONTEXT_COMPACTION_STRATEGY;
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
      approvalMode: location.approvalMode ?? "auto-approve",
      gate: undefined as never,
      authorizationGrants: authorizationGrantsFromSessionEntries(
        sessionManager.getBranch(),
      ),
      attachedPaths,
      availableToolNames: [],
      computerUseActive: computerUseActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      mediaGenerationActive: mediaGenerationActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      skillAuthoringActive: skillAuthoringActiveFromSessionEntries(
        sessionManager.getEntries(),
      ),
      ...(location.tinyFishApiKey
        ? { tinyFishApiKey: location.tinyFishApiKey }
        : {}),
      locale: "en-US",
      contextCompactionStrategy,
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
      activated: () => {
        if (live.skillAuthoringActive) return;
        live.skillAuthoringActive = true;
        live.session.sessionManager.appendCustomEntry(
          PINE_SKILL_AUTHORING_ACTIVE_ENTRY,
          { active: true },
        );
        this.syncApprovalModeTools(live);
      },
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
            pi.on("before_agent_start", async (event) => {
              const userProfile =
                (await readPineAgentSettings(live.agentDir)).userProfile ??
                createDefaultPineUserProfile();
              event.systemPromptOptions.sections.pine_profile =
                systemPromptWithUserProfile("", userProfile).trim();
              event.systemPromptOptions.sections.pine_approval_mode =
                approvalModeSystemPrompt(live.approvalMode);
              event.systemPromptOptions.sections.pine_time =
                systemPromptWithCurrentMonth("").trim();
              const skillList = skillRepository.promptList();
              if (skillList)
                event.systemPromptOptions.sections.pine_skills = skillList;
              return undefined;
            });
          },
        },
        computerUse.extension,
        skillTools.extension,
        {
          name: "pine-mcp-approval",
          factory: (pi) => {
            pi.events.on(MCP_STATUS_EVENT, (snapshot) => {
              live.mcpStatus = snapshot as McpStatusSnapshot;
              if (live.session) this.syncApprovalModeTools(live);
            });
            pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value) => {
              const request = value as McpToolApprovalRequest;
              request.claim(async () => {
                if (live.approvalMode === "YOLO") return "allow_once";
                const decision = await live.gate.reviewPrivilegedCall({
                  toolCallId: request.requestId,
                  toolName: request.prefixedToolName,
                  subject: `${request.serverName}.${request.originalToolName} ${JSON.stringify(request.args)}`,
                  evidence:
                    "MCP tools execute in an external server outside Pine's project sandbox.",
                  signal: request.signal,
                });
                return decision.kind === "allow" ? "allow_once" : "deny";
              });
            });
          },
        },
        {
          name: "pi-mcp-adapter",
          factory: createMcpAdapter({
            configPath: path.join(location.agentDir, "mcp.json"),
          }),
        },
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
            this.syncApprovalModeTools(live);
          },
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
        presentFile: (toolCallId, filePath) =>
          this.presentFile(live, toolCallId, filePath),
      },
    );
    const customTools = [...pineTools];
    live.availableToolNames = [
      ...customTools.map((tool) => tool.name),
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
      INVOKE_SKILL_TOOL_NAME,
      LIST_SKILL_RESOURCES_TOOL_NAME,
      READ_SKILL_RESOURCE_TOOL_NAME,
      ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
      ...SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
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
    this.syncApprovalModeTools(live);
    live.unsubscribe = session.subscribe((event) =>
      this.forwardEvent(session, event),
    );
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
    if (live.approvalMode !== approvalMode) {
      live.approvalMode = approvalMode;
      live.gate = this.createGate(
        live,
        approvalMode === "let-me-review" ? "user" : "auto",
      );
    }
    this.syncApprovalModeTools(live);
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

  private syncApprovalModeTools(live: LiveAgentSession): void {
    const activeToolNames = live.session.getActiveToolNames();
    const mcpToolNames = live.session
      .getAllTools()
      .filter((tool) => tool.sourceInfo.path === "<inline:pi-mcp-adapter>")
      .map((tool) => tool.name);
    const nextToolNames = toolNamesForApprovalMode(
      toolNamesForMediaGenerationState(
        toolNamesForComputerUseState(
          toolNamesForSkillAuthoringState(
            [...live.availableToolNames, ...mcpToolNames],
            live.skillAuthoringActive,
          ),
          live.computerUseActive,
        ),
        live.mediaGenerationActive,
      ),
      live.approvalMode,
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
    if (!live.session.isIdle)
      throw new Error(
        "Finish the current response before reloading MCP servers.",
      );
    await live.session.reload();
    this.syncApprovalModeTools(live);
    return { updated: true };
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
      this.syncApprovalModeTools(live);
    }
    return { updated: true };
  }

  /** Cross-process round trip: renderer answers, worker resumes. */
  private requestUserApproval(
    live: LiveAgentSession,
    request: UserApprovalRequest,
  ): Promise<GateDecision> {
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
        actionDigest: pending.actionDigest,
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
    if (decision.kind === "allow") {
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
   * Ask the renderer to open a file the user should look at. Main resolves the
   * absolute path into a tab target, so this stays fire-and-forget: the tool
   * already proved the path readable, and no part of opening a tab can fail in
   * a way the agent needs to act on.
   */
  private presentFile(
    live: LiveAgentSession,
    toolCallId: string,
    filePath: string,
  ): void {
    this.options.emit({
      type: "present-file",
      sessionId: live.session.sessionId,
      toolCallId,
      path: filePath,
    });
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
   * when enabled and the utility model for any calls requiring further review.
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
    const settings =
      (await readPineAgentSettings(live.agentDir)).autoApproval ??
      DEFAULT_AUTO_APPROVAL_SETTINGS;
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
      reviewWithModel: (pending) => this.runModelJudge(live, pending, signal),
    });
  }

  private async runModelJudge(
    live: LiveAgentSession,
    requests: JudgeRequest[],
    signal: AbortSignal,
  ): Promise<JudgeRuling[]> {
    signal.throwIfAborted();
    const modelRuntime = await this.getModelRuntime(live.agentDir);
    const model = await this.modelService.utilityModel(
      live.agentDir,
      modelRuntime,
    );
    if (!model) throw new Error("No utility model is configured.");
    signal.throwIfAborted();
    const autonomous = live.approvalMode === "autonomous";
    const context: Context = {
      systemPrompt: `${autonomous ? AUTONOMOUS_JUDGE_SYSTEM_PROMPT : JUDGE_SYSTEM_PROMPT}${
        requests.every((request) => request.allowSessionScope === false)
          ? '\n\nThese privileged calls must each receive an independent verdict. Set every scope to "once"; session scope is not available.'
          : ""
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
          event.error.errorMessage ?? "The reviewer stream failed.",
        );
      }
    }
    if (!final) throw new Error("The reviewer returned no response.");
    const call = final.content.find(
      (block) => block.type === "toolCall" && block.name === RULING_TOOL.name,
    );
    if (!call || call.type !== "toolCall") {
      throw new Error("The reviewer did not submit a ruling.");
    }
    return parseJudgeRulings(
      call.arguments,
      requests.map((request) => request.toolCallId),
    );
  }

  private async generateInitialTitle(live: LiveAgentSession): Promise<void> {
    const session = live.session;
    if (
      session.sessionName ||
      this.titleGenerationAttempts.has(session.sessionId) ||
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
          const text = attachmentMessagePreview(
            textFromMessageContent(
              "content" in entry.message ? entry.message.content : "",
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
      this.titleGenerationAttempts.add(session.sessionId);
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
      const options = { ...judgeStreamOptions(model, signal), maxTokens: 80 };
      let final: AssistantMessage | undefined;
      for await (const event of modelRuntime.stream(model, context, options)) {
        if (event.type === "done") final = event.message;
        else if (event.type === "error") return;
      }
      const title = titleFromAssistantMessage(final);
      if (title && !session.sessionName) session.setSessionName(title);
    } catch {
      // Title generation is best-effort and must never fail the user's turn.
    } finally {
      this.titleGenerationInFlight.delete(session.sessionId);
    }
  }

  private getSession(sessionId: string): LiveAgentSession {
    const live = this.liveSessions.get(sessionId);
    if (!live) throw new Error(`Agent session not found: ${sessionId}`);
    return live;
  }

  private forwardEvent(session: AgentSession, event: AgentSessionEvent): void {
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
    const usage = session.getContextUsage();
    if (!usage) return undefined;
    const stats = session.getSessionStats();
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
