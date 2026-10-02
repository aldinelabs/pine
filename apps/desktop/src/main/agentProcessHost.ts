import { utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { McpStatusSnapshot } from "pi-mcp-adapter";
import type {
  PineApprovalMode,
  PineMessageRewriteTarget,
} from "../shared/agent";
import type { PineContextCompactionStrategy } from "../shared/preferences";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  LoginProviderRequest,
  PineImageModelSelection,
  PineModelCatalog,
  PineThinkingLevel,
  PineUtilityModelSelection,
  ProviderLoginResult,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";
import type {
  AgentSessionLocation,
  AgentWorkerInbound,
  AgentWorkerMessage,
  AgentWorkerPromptResult,
  AgentWorkerRequest,
  AgentWorkerRequestInput,
  AgentWorkerResult,
  AgentWorkerSessionResult,
  GateDecision,
  PineRuntimeEvent,
} from "../agent/protocol";

interface AgentProcess {
  readonly stdout?: Pick<NodeJS.ReadableStream, "resume"> | null;
  readonly stderr?: Pick<NodeJS.ReadableStream, "resume"> | null;
  kill(): boolean;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message", listener: (message: unknown) => void): this;
  postMessage(message: AgentWorkerInbound): void;
}

export interface AgentHost {
  reloadMcp?(sessionId: string): Promise<{ updated: boolean }>;
  getMcpStatus?(sessionId: string): Promise<McpStatusSnapshot>;
  abort(sessionId: string): Promise<{ aborted: boolean }>;
  compact(sessionId: string): Promise<{ compacted: boolean }>;
  dequeueSteering(
    sessionId: string,
    message: string,
  ): Promise<{ message?: string; removed: boolean }>;
  createSession(
    location: AgentSessionLocation,
  ): Promise<AgentWorkerSessionResult>;
  disposeSession(sessionId: string): Promise<{ disposed: boolean }>;
  openSession(
    location: AgentSessionLocation,
    sessionFile: string,
  ): Promise<AgentWorkerSessionResult>;
  prompt(
    sessionId: string,
    message: string,
    streamingBehavior?: "followUp" | "steer",
    attachedPaths?: readonly string[],
    approvalMode?: PineApprovalMode,
    locale?: "en-US" | "zh-CN",
    rewrite?: PineMessageRewriteTarget,
  ): Promise<AgentWorkerPromptResult>;
  renameSession(
    sessionId: string,
    name: string,
  ): Promise<AgentWorkerSessionResult>;
  getModelCatalog(agentDir: string): Promise<PineModelCatalog>;
  refreshModelCatalog(agentDir: string): Promise<PineModelCatalog>;
  addCustomModel(
    agentDir: string,
    request: AddCustomModelRequest,
  ): Promise<PineModelCatalog>;
  updateCustomModel(
    agentDir: string,
    request: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog>;
  deleteCustomModel(
    agentDir: string,
    request: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog>;
  updateCustomProvider(
    agentDir: string,
    request: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog>;
  deleteCustomProvider(
    agentDir: string,
    request: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog>;
  loginProvider(
    agentDir: string,
    request: LoginProviderRequest,
  ): Promise<ProviderLoginResult>;
  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): Promise<{ accepted: boolean }>;
  cancelProviderAuth(loginId: string): Promise<{ cancelled: boolean }>;
  logoutProvider(
    agentDir: string,
    providerId: string,
  ): Promise<{ disposed: boolean }>;
  selectModel(
    agentDir: string,
    providerId: string,
    modelId: string,
    thinkingLevel: PineThinkingLevel,
    sessionId?: string,
  ): Promise<{ disposed: boolean }>;
  selectUtilityModel(
    agentDir: string,
    selection: PineUtilityModelSelection,
  ): Promise<{ updated: boolean }>;
  selectImageModel(
    agentDir: string,
    selection: PineImageModelSelection,
  ): Promise<{ updated: boolean }>;
  setTinyFishApiKey(apiKey: string | undefined): Promise<{ updated: boolean }>;
  setContextCompactionStrategy(
    strategy: PineContextCompactionStrategy,
  ): Promise<{ updated: boolean }>;
  subscribe(listener: (event: PineRuntimeEvent) => void): () => void;
  /** Resolve a pending user-approval round trip inside the agent worker. */
  respondApproval(requestId: string, decision: GateDecision): void;
  /** Resolve a pending structured-question round trip inside the worker. */
  respondQuestionnaire(
    requestId: string,
    submission: AskUserQuestionSubmission,
  ): void;
  setApprovalMode(
    sessionId: string,
    approvalMode: PineApprovalMode,
  ): Promise<{ updated: boolean }>;
}

type AgentProcessFactory = () => AgentProcess;

interface PendingRequest {
  reject: (reason: Error) => void;
  resolve: (result: AgentWorkerResult) => void;
}

export class AgentProcessHost implements AgentHost {
  reloadMcp(sessionId: string): Promise<{ updated: boolean }> {
    return this.request({ type: "mcp:reload", sessionId });
  }

  getMcpStatus(sessionId: string): Promise<McpStatusSnapshot> {
    return this.request({ type: "mcp:status", sessionId });
  }
  private process: AgentProcess | null = null;
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((reason: Error) => void) | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: PineRuntimeEvent) => void>();

  constructor(private readonly createProcess: AgentProcessFactory) {}

  static createDefault(): AgentProcessHost {
    return new AgentProcessHost(() =>
      utilityProcess.fork(path.join(__dirname, "agent.mjs"), [], {
        serviceName: "Pine Agent",
        stdio: "pipe",
      }),
    );
  }

  createSession(
    location: AgentSessionLocation,
  ): Promise<AgentWorkerSessionResult> {
    return this.request({ type: "session:create", location });
  }

  openSession(
    location: AgentSessionLocation,
    sessionFile: string,
  ): Promise<AgentWorkerSessionResult> {
    return this.request({ type: "session:open", location, sessionFile });
  }

  prompt(
    sessionId: string,
    message: string,
    streamingBehavior?: "followUp" | "steer",
    attachedPaths?: readonly string[],
    approvalMode?: PineApprovalMode,
    locale: "en-US" | "zh-CN" = "en-US",
    rewrite?: PineMessageRewriteTarget,
  ): Promise<AgentWorkerPromptResult> {
    return this.request({
      type: "session:prompt",
      sessionId,
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(attachedPaths?.length ? { attachedPaths: [...attachedPaths] } : {}),
      ...(approvalMode ? { approvalMode } : {}),
      locale,
      ...(rewrite ? { rewrite } : {}),
    });
  }

  abort(sessionId: string): Promise<{ aborted: boolean }> {
    return this.request({ type: "session:abort", sessionId });
  }

  compact(sessionId: string): Promise<{ compacted: boolean }> {
    return this.request({ type: "session:compact", sessionId });
  }

  dequeueSteering(
    sessionId: string,
    message: string,
  ): Promise<{ message?: string; removed: boolean }> {
    return this.request({
      type: "session:dequeue-steering",
      sessionId,
      message,
    });
  }

  setApprovalMode(
    sessionId: string,
    approvalMode: PineApprovalMode,
  ): Promise<{ updated: boolean }> {
    return this.request({
      type: "session:set-approval-mode",
      sessionId,
      approvalMode,
    });
  }

  renameSession(
    sessionId: string,
    name: string,
  ): Promise<AgentWorkerSessionResult> {
    return this.request({ type: "session:rename", sessionId, name });
  }

  getModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    return this.request({ type: "models:catalog", agentDir });
  }

  refreshModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    return this.request({ type: "models:refresh-catalog", agentDir });
  }

  addCustomModel(
    agentDir: string,
    request: AddCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.request({ type: "models:add-custom", agentDir, ...request });
  }

  updateCustomModel(
    agentDir: string,
    request: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.request({ type: "models:update-custom", agentDir, ...request });
  }

  deleteCustomModel(
    agentDir: string,
    request: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.request({ type: "models:delete-custom", agentDir, ...request });
  }

  updateCustomProvider(
    agentDir: string,
    request: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.request({
      type: "providers:update-custom",
      agentDir,
      ...request,
    });
  }

  deleteCustomProvider(
    agentDir: string,
    request: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.request({
      type: "providers:delete-custom",
      agentDir,
      ...request,
    });
  }

  loginProvider(
    agentDir: string,
    request: LoginProviderRequest,
  ): Promise<ProviderLoginResult> {
    return this.request({ type: "provider:login", agentDir, ...request });
  }

  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): Promise<{ accepted: boolean }> {
    return this.request({
      type: "provider:auth-response",
      loginId,
      promptId,
      value,
    });
  }

  cancelProviderAuth(loginId: string): Promise<{ cancelled: boolean }> {
    return this.request({ type: "provider:auth-cancel", loginId });
  }

  logoutProvider(
    agentDir: string,
    providerId: string,
  ): Promise<{ disposed: boolean }> {
    return this.request({ type: "provider:logout", agentDir, providerId });
  }

  selectModel(
    agentDir: string,
    providerId: string,
    modelId: string,
    thinkingLevel: PineThinkingLevel,
    sessionId?: string,
  ): Promise<{ disposed: boolean }> {
    return this.request({
      type: "models:select",
      agentDir,
      providerId,
      modelId,
      thinkingLevel,
      ...(sessionId ? { sessionId } : {}),
    });
  }

  selectUtilityModel(
    agentDir: string,
    selection: PineUtilityModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.request({
      type: "models:select-utility",
      agentDir,
      selection,
    });
  }

  selectImageModel(
    agentDir: string,
    selection: PineImageModelSelection,
  ): Promise<{ updated: boolean }> {
    return this.request({
      type: "models:select-image",
      agentDir,
      selection,
    });
  }

  setTinyFishApiKey(apiKey: string | undefined): Promise<{ updated: boolean }> {
    return this.request({
      type: "runtime:set-tinyfish-api-key",
      ...(apiKey ? { tinyFishApiKey: apiKey } : {}),
    });
  }

  setContextCompactionStrategy(
    strategy: PineContextCompactionStrategy,
  ): Promise<{ updated: boolean }> {
    return this.request({
      type: "runtime:set-context-compaction-strategy",
      strategy,
    });
  }

  disposeSession(sessionId: string): Promise<{ disposed: boolean }> {
    return this.request({ type: "session:dispose", sessionId });
  }

  subscribe(listener: (event: PineRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  respondApproval(requestId: string, decision: GateDecision): void {
    this.process?.postMessage({
      type: "approval:response",
      requestId,
      decision,
    });
  }

  respondQuestionnaire(
    requestId: string,
    submission: AskUserQuestionSubmission,
  ): void {
    this.process?.postMessage({
      type: "questionnaire:response",
      requestId,
      submission,
    });
  }

  async dispose(): Promise<void> {
    const process = this.process;
    if (!process) return;

    try {
      await this.request({ type: "runtime:dispose" });
    } finally {
      process.kill();
      this.resetProcess(new Error("The Pine agent process was disposed."));
    }
  }

  private async request<TResult extends AgentWorkerResult>(
    request: AgentWorkerRequestInput,
  ): Promise<TResult> {
    await this.ensureReady();
    const id = randomUUID();
    const message = { ...request, id } as AgentWorkerRequest;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as TResult),
        reject,
      });
      this.process?.postMessage(message);
    });
  }

  private ensureReady(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const process = this.createProcess();
    this.process = process;
    // Drain piped output even when no console is attached to a packaged app.
    // Otherwise a full pipe can prevent the agent from making progress.
    process.stdout?.resume();
    process.stderr?.resume();
    process.on("message", (message) => this.handleMessage(message));
    process.on("exit", (code) => {
      if (this.process !== process) return;
      this.resetProcess(
        new Error(`The Pine agent process exited unexpectedly (${code}).`),
      );
    });
    return this.ready;
  }

  private handleMessage(message: unknown): void {
    const workerMessage = message as AgentWorkerMessage;
    if (workerMessage.type === "ready") {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (workerMessage.type === "event") {
      for (const listener of this.listeners) listener(workerMessage.event);
      return;
    }

    const pending = this.pending.get(workerMessage.id);
    if (!pending) return;
    this.pending.delete(workerMessage.id);
    if (workerMessage.ok) pending.resolve(workerMessage.result);
    else pending.reject(new Error(workerMessage.error.message));
  }

  private resetProcess(error: Error): void {
    this.rejectReady?.(error);
    this.process = null;
    this.ready = null;
    this.resolveReady = null;
    this.rejectReady = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
