import type {
  ProjectEntryReference,
  ProjectFileOperation,
  ProjectEntry,
  FilePreviewTarget,
} from "../shared/projectFiles";
import type { PineProject, PineProjectFolder } from "../shared/projects";
import type {
  PineContextCompactionRoute,
  PineContextCompactionStrategy,
} from "../shared/preferences";
import type {
  PineApprovalMode,
  PromptSessionRequest,
  PromptSessionResult,
  RespondApprovalRequest,
  RespondQuestionnaireRequest,
} from "../shared/agent";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  LoginProviderRequest,
  PineModelCatalog,
  ProviderLoginResult,
  SelectModelRequest,
  SelectUtilityModelRequest,
  SelectImageModelRequest,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";
import type {
  LoadSessionMessagesResult,
  PineContextUsage,
  PineSessionSummary,
  ResumeSessionResult,
  SessionSearchResult,
} from "../shared/sessions";
import {
  operateProjectFile,
  resolveProjectEntry,
  resolveProjectEntryForNativeDrag,
  type ProjectFileNativeActions,
} from "./projectFileOperations";
import { listProjectDirectory, resolveProjectPath } from "./projectFiles";
import type { ProjectDataPaths } from "./projects/projectRepository";
import {
  ProjectSessionService,
  type PineSessionExportDocument,
} from "./sessions";
import type { AgentHost } from "./agentProcessHost";
import {
  BACKGROUND_TASK_OUTPUT_TAIL_BYTES,
  type BackgroundTaskRequest,
  type BackgroundTaskResult,
  type ListBackgroundTasksResult,
  type ReadBackgroundTaskOutputResult,
} from "../shared/backgroundTasks";
import type { GateDecision } from "../agent/protocol";
import {
  parseAttachmentMessage,
  type PineAttachment,
} from "../shared/attachments";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

function pathContains(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

/** Folder references are portable inside a project, so never leak `path.sep`. */
function toPortableRelativePath(parentPath: string, filePath: string): string {
  return path.relative(parentPath, filePath).split(path.sep).join("/");
}

/** Maps the renderer's approval action to the worker-side gate decision. */
function toGateDecision(request: RespondApprovalRequest): GateDecision {
  if (request.action === "approve") return { kind: "allow" };
  const guidance = request.guidance?.trim();
  if (request.action === "guide" && guidance) {
    return {
      kind: "deny",
      reason: `The user rejected this call with guidance: ${guidance}`,
    };
  }
  return { kind: "deny", reason: "The user rejected this tool call." };
}

interface RuntimeSession {
  summary: PineSessionSummary;
  approvalMode: PineApprovalMode;
  contextUsage?: PineContextUsage;
}

interface ProjectRuntime {
  approvalMode: PineApprovalMode;
  dataPaths: ProjectDataPaths;
  project: PineProject;
  focusedSessionId?: string;
  liveSessions: Map<string, RuntimeSession>;
  openingSessions: Map<string, Promise<ResumeSessionResult>>;
  pendingCreations: Set<Promise<PineSessionSummary>>;
  sessions: ProjectSessionService;
}

export class ProjectRuntimeRegistry {
  async reloadMcp(webContentsId: number): Promise<void> {
    const runtime = this.get(webContentsId);
    await Promise.all(
      [...runtime.liveSessions.keys()].map(async (sessionId) => {
        await this.agentHost.reloadMcp?.(sessionId);
      }),
    );
  }

  /** Background task requests act only on a session this window owns. */
  async listBackgroundTasks(
    webContentsId: number,
    sessionId: string,
  ): Promise<ListBackgroundTasksResult> {
    // A session that is not live yet has no tasks.
    const live = this.get(webContentsId).liveSessions.get(sessionId);
    if (!live || !this.agentHost.listBackgroundTasks) return { tasks: [] };
    return this.agentHost.listBackgroundTasks(live.summary.id);
  }

  async stopBackgroundTask(
    webContentsId: number,
    request: BackgroundTaskRequest,
  ): Promise<BackgroundTaskResult> {
    const live = this.requireBackgroundSession(
      webContentsId,
      request.sessionId,
    );
    return this.backgroundHost("stopBackgroundTask")(
      live.summary.id,
      request.taskId,
    );
  }

  async readBackgroundTaskOutput(
    webContentsId: number,
    request: BackgroundTaskRequest,
  ): Promise<ReadBackgroundTaskOutputResult> {
    const live = this.requireBackgroundSession(
      webContentsId,
      request.sessionId,
    );
    return this.backgroundHost("readBackgroundTaskOutput")(
      live.summary.id,
      request.taskId,
      BACKGROUND_TASK_OUTPUT_TAIL_BYTES,
    );
  }

  private requireBackgroundSession(
    webContentsId: number,
    sessionId: string,
  ): RuntimeSession {
    const live = this.targetSession(webContentsId, sessionId);
    if (!live) throw new Error("Session does not belong to this window.");
    return live;
  }

  private backgroundHost<
    K extends "stopBackgroundTask" | "readBackgroundTaskOutput",
  >(method: K): NonNullable<AgentHost[K]> {
    const fn = this.agentHost[method];
    if (!fn) throw new Error("Background tasks are unavailable.");
    return fn.bind(this.agentHost) as NonNullable<AgentHost[K]>;
  }

  async getMcpStatus(webContentsId: number) {
    const session = this.focusedSession(this.runtimes.get(webContentsId));
    return session
      ? this.agentHost.getMcpStatus?.(session.summary.id)
      : undefined;
  }
  private readonly runtimes = new Map<number, ProjectRuntime>();
  /** approval requestId → owning webContentsId, for response validation. */
  private readonly pendingApprovals = new Map<
    string,
    { webContentsId: number; sessionId?: string }
  >();
  /** questionnaire requestId → owning webContentsId, for response validation. */
  private readonly pendingQuestionnaires = new Map<
    string,
    { webContentsId: number; sessionId?: string }
  >();

  constructor(
    private readonly agentHost: AgentHost,
    private readonly agentDir: string,
    private readonly getTinyFishApiKey: () => string | undefined = () =>
      undefined,
  ) {}

  async open(
    webContentsId: number,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<void> {
    const defaultFolder = project.folders.find(
      (folder) => folder.id === project.defaultFolderId,
    );
    if (!defaultFolder?.isAvailable) {
      throw new Error("The project's default folder is unavailable.");
    }

    await this.dispose(webContentsId);

    const sessions = await ProjectSessionService.create({
      cacheRoot: dataPaths.cacheRoot,
      cwd: defaultFolder.path,
      sessionsRoot: dataPaths.sessionsRoot,
    });
    this.runtimes.set(webContentsId, {
      approvalMode: "auto-approve",
      dataPaths,
      project,
      liveSessions: new Map(),
      openingSessions: new Map(),
      pendingCreations: new Set(),
      sessions,
    });
  }

  isOpen(webContentsId: number, projectId: string): boolean {
    return this.runtimes.get(webContentsId)?.project.id === projectId;
  }

  ownerOfProject(projectId: string): number | undefined {
    for (const [webContentsId, runtime] of this.runtimes) {
      if (runtime.project.id === projectId) return webContentsId;
    }
    return undefined;
  }

  /** Attachment storage root for the project open in this window. */
  attachmentsRootFor(webContentsId: number): string | undefined {
    return this.runtimes.get(webContentsId)?.dataPaths.attachmentsRoot;
  }

  /**
   * Whether a filesystem path sits inside a folder the user granted to one
   * of the currently open projects. Used to scope which attachment images
   * the `pine-attachment://` protocol is allowed to serve.
   */
  isInsideGrantedFolder(candidatePath: string): boolean {
    const resolvedPath = path.resolve(candidatePath);
    for (const runtime of this.runtimes.values()) {
      for (const folder of runtime.project.folders) {
        if (pathContains(folder.path, resolvedPath)) return true;
      }
    }
    return false;
  }

  async search(
    webContentsId: number,
    query: string,
  ): Promise<SessionSearchResult[]> {
    return this.get(webContentsId).sessions.search(query);
  }

  async loadMessages(
    webContentsId: number,
    sessionId: string,
    before?: string,
    limit?: number,
    includeOutline?: boolean,
  ): Promise<LoadSessionMessagesResult> {
    return this.get(webContentsId).sessions.loadMessages(
      sessionId,
      before,
      limit,
      includeOutline,
    );
  }

  async attachmentForSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<PineAttachment> {
    return this.get(webContentsId).sessions.attachmentForSession(sessionId);
  }

  async exportSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<PineSessionExportDocument> {
    const runtime = this.get(webContentsId);
    const fallbackApprovalMode =
      runtime.liveSessions.get(sessionId)?.approvalMode ?? "auto-approve";
    return runtime.sessions.exportSession(sessionId, fallbackApprovalMode);
  }

  async deleteSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<boolean> {
    const runtime = this.get(webContentsId);
    await runtime.openingSessions.get(sessionId);
    if (runtime.liveSessions.has(sessionId)) {
      await this.agentHost.disposeSession(sessionId);
      runtime.liveSessions.delete(sessionId);
      if (runtime.focusedSessionId === sessionId)
        runtime.focusedSessionId = undefined;
    }
    this.clearSessionInteractions(sessionId);
    return runtime.sessions.deleteSession(sessionId);
  }

  async renameSession(
    webContentsId: number,
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId);
    const live = runtime.liveSessions.get(sessionId);
    if (live) {
      const result = await this.agentHost.renameSession(sessionId, name);
      live.summary = result.session;
      return result.session;
    }
    return runtime.sessions.renameSession(sessionId, name);
  }

  async projectEntryPaths(
    webContentsId: number,
    entries: ProjectEntryReference[],
  ): Promise<string[]> {
    const { project } = this.get(webContentsId);
    return Promise.all(
      entries.map((entry) => resolveProjectEntry(project.folders, entry)),
    );
  }

  projectEntryPathForNativeDrag(
    webContentsId: number,
    entry: ProjectEntryReference,
  ): string {
    return resolveProjectEntryForNativeDrag(
      this.get(webContentsId).project.folders,
      entry,
    );
  }

  async operateFile(
    webContentsId: number,
    request: ProjectFileOperation,
    native: ProjectFileNativeActions,
  ): Promise<void> {
    const { project } = this.get(webContentsId);
    await operateProjectFile(project.folders, request, native);
  }

  async listDirectory(
    webContentsId: number,
    folderId: string,
    relativePath: string,
  ): Promise<ProjectEntry[]> {
    const runtime = this.get(webContentsId);
    return listProjectDirectory(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resolveDirectory(
    webContentsId: number,
    folderId: string,
    relativePath: string,
  ): Promise<string> {
    const runtime = this.get(webContentsId);
    return resolveProjectPath(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resume(
    webContentsId: number,
    sessionId: string,
  ): Promise<ResumeSessionResult> {
    const runtime = this.get(webContentsId);
    runtime.focusedSessionId = sessionId;
    const live = runtime.liveSessions.get(sessionId);
    if (live) return { session: live.summary, contextUsage: live.contextUsage };
    const pending = runtime.openingSessions.get(sessionId);
    if (pending) return pending;

    const opening = (async () => {
      const descriptor = await runtime.sessions.describeSession(sessionId);
      if (this.runtimes.get(webContentsId) !== runtime) {
        throw new Error("The active project changed while opening a session.");
      }
      const opened = await this.agentHost.openSession(
        this.location(runtime),
        descriptor.sessionFile,
      );
      runtime.liveSessions.set(opened.session.id, {
        summary: opened.session,
        approvalMode: "auto-approve",
        contextUsage: opened.contextUsage,
      });
      if (this.runtimes.get(webContentsId) !== runtime) {
        throw new Error("The active project changed while opening a session.");
      }
      return { session: opened.session, contextUsage: opened.contextUsage };
    })();
    runtime.openingSessions.set(sessionId, opening);
    try {
      return await opening;
    } finally {
      runtime.openingSessions.delete(sessionId);
    }
  }

  private async createNewSession(
    webContentsId: number,
    approvalMode: PineApprovalMode,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId);
    const creation = this.agentHost
      .createSession({ ...this.location(runtime), approvalMode })
      .then(({ session }) => {
        runtime.liveSessions.set(session.id, {
          summary: session,
          approvalMode,
        });
        if (this.runtimes.get(webContentsId) !== runtime) {
          throw new Error(
            "The active project changed while creating a session.",
          );
        }
        runtime.focusedSessionId = session.id;
        return session;
      });
    runtime.pendingCreations.add(creation);
    try {
      return await creation;
    } finally {
      runtime.pendingCreations.delete(creation);
    }
  }

  async prompt(
    webContentsId: number,
    request: PromptSessionRequest,
  ): Promise<PromptSessionResult> {
    const runtime = this.get(webContentsId);
    const approvalMode = request.approvalMode ?? "auto-approve";
    if (
      request.rewrite &&
      (request.target.kind !== "session" || request.streamingBehavior)
    ) {
      throw new Error("Only an idle existing session can rewrite history.");
    }
    const activeSession =
      request.target.kind === "new"
        ? await this.createNewSession(webContentsId, approvalMode)
        : (await this.resume(webContentsId, request.target.sessionId)).session;
    if (this.runtimes.get(webContentsId) !== runtime) {
      throw new Error("The active project changed before submitting a prompt.");
    }
    const attachedPaths = parseAttachmentMessage(request.message)
      .attachments.map((attachment) => attachment.path)
      .filter((attachmentPath) => attachmentPath.length <= 4_096)
      .slice(0, 100);
    const streamingBehavior =
      request.streamingBehavior === "follow-up"
        ? "followUp"
        : request.streamingBehavior;
    const promptArguments = [
      activeSession.id,
      request.message,
      streamingBehavior,
      attachedPaths.length > 0 ? attachedPaths : undefined,
      approvalMode,
      ...(request.locale ? [request.locale] : []),
    ] as const;
    const result = request.rewrite
      ? await this.agentHost.prompt(
          activeSession.id,
          request.message,
          undefined,
          attachedPaths.length > 0 ? attachedPaths : undefined,
          approvalMode,
          request.locale,
          request.rewrite,
        )
      : await this.agentHost.prompt(...promptArguments);
    const live = runtime.liveSessions.get(result.session.id);
    if (live) {
      live.summary = result.session;
      live.approvalMode = approvalMode;
    }
    return { accepted: result.accepted, session: result.session };
  }

  async abort(
    webContentsId: number,
    sessionId?: string,
  ): Promise<{ aborted: boolean; sessionId?: string }> {
    const live = this.targetSession(webContentsId, sessionId);
    if (!live) return { aborted: false };
    const result = await this.agentHost.abort(live.summary.id);
    return { ...result, sessionId: live.summary.id };
  }

  async compact(
    webContentsId: number,
    sessionId?: string,
  ): Promise<{ compacted: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    return live
      ? this.agentHost.compact(live.summary.id)
      : { compacted: false };
  }

  async dequeueSteering(
    webContentsId: number,
    message: string,
    sessionId?: string,
  ): Promise<{ message?: string; removed: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    return live
      ? this.agentHost.dequeueSteering(live.summary.id, message)
      : { removed: false };
  }

  async setApprovalMode(
    webContentsId: number,
    approvalMode: PineApprovalMode,
    sessionId?: string,
  ): Promise<{ updated: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    if (!live) return { updated: false };
    live.approvalMode = approvalMode;
    return this.agentHost.setApprovalMode(live.summary.id, approvalMode);
  }

  getModelCatalog(): Promise<PineModelCatalog> {
    return this.agentHost.getModelCatalog(this.agentDir);
  }

  refreshModelCatalog(): Promise<PineModelCatalog> {
    return this.agentHost.refreshModelCatalog(this.agentDir);
  }

  addCustomModel(request: AddCustomModelRequest): Promise<PineModelCatalog> {
    return this.agentHost.addCustomModel(this.agentDir, request);
  }

  updateCustomModel(
    request: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.agentHost.updateCustomModel(this.agentDir, request);
  }

  deleteCustomModel(
    request: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog> {
    return this.agentHost.deleteCustomModel(this.agentDir, request);
  }

  updateCustomProvider(
    request: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.agentHost.updateCustomProvider(this.agentDir, request);
  }

  deleteCustomProvider(
    request: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    return this.agentHost.deleteCustomProvider(this.agentDir, request);
  }

  loginProvider(request: LoginProviderRequest): Promise<ProviderLoginResult> {
    return this.agentHost.loginProvider(this.agentDir, request);
  }

  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): Promise<{ accepted: boolean }> {
    return this.agentHost.respondToProviderAuth(loginId, promptId, value);
  }

  cancelProviderAuth(loginId: string): Promise<{ cancelled: boolean }> {
    return this.agentHost.cancelProviderAuth(loginId);
  }

  logoutProvider(providerId: string): Promise<{ disposed: boolean }> {
    return this.agentHost.logoutProvider(this.agentDir, providerId);
  }

  async selectModel(
    webContentsId: number,
    request: SelectModelRequest,
  ): Promise<{ disposed: boolean }> {
    if (request.sessionId) {
      await this.resume(webContentsId, request.sessionId);
    }
    return this.agentHost.selectModel(
      this.agentDir,
      request.providerId,
      request.modelId,
      request.thinkingLevel,
      request.sessionId,
    );
  }

  selectUtilityModel(
    request: SelectUtilityModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectUtilityModel(this.agentDir, request);
  }

  selectImageModel(
    request: SelectImageModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectImageModel(this.agentDir, request);
  }

  setTinyFishApiKey(apiKey: string | undefined): Promise<{ updated: boolean }> {
    return this.agentHost.setTinyFishApiKey(apiKey);
  }

  setContextCompactionStrategy(
    strategy: PineContextCompactionStrategy,
  ): Promise<{ updated: boolean }> {
    const hasActiveSession = [...this.runtimes.values()].some(
      (runtime) => runtime.liveSessions.size > 0,
    );
    if (!hasActiveSession) return Promise.resolve({ updated: true });
    return this.agentHost.setContextCompactionStrategy(strategy);
  }

  setContextCompactionRoute(
    route: PineContextCompactionRoute,
  ): Promise<{ updated: boolean }> {
    const hasActiveSession = [...this.runtimes.values()].some(
      (runtime) => runtime.liveSessions.size > 0,
    );
    if (!hasActiveSession) return Promise.resolve({ updated: true });
    return this.agentHost.setContextCompactionRoute(route);
  }

  ownerOfSession(sessionId: string): number | undefined {
    return this.entryForSession(sessionId)?.webContentsId;
  }

  /**
   * Resolve an absolute path the agent asked to present into a tab target.
   *
   * A path inside a project folder becomes an ordinary project-relative
   * reference, so it keeps flowing through the already validated project-entry
   * channel. Everything else is reported as presented: the caller records it in
   * the window's presented-file grants before the renderer may read it, because
   * nothing else authorizes an absolute path from the agent's side.
   */
  async resolvePresentTarget(
    sessionId: string,
    filePath: string,
  ): Promise<FilePreviewTarget | null> {
    const runtime = this.entryForSession(sessionId)?.runtime;
    if (!runtime) return null;
    return this.resolvePresentTargetForRuntime(runtime, filePath);
  }

  async reopenPresentedToolFile(
    webContentsId: number,
    sessionId: string,
    toolCallId: string,
  ): Promise<FilePreviewTarget | null> {
    const runtime = this.get(webContentsId);
    const filePath = await runtime.sessions.presentedFilePath(
      sessionId,
      toolCallId,
    );
    if (!filePath) return null;
    const canonicalPath = await realpath(filePath).catch(() => null);
    // The original tool result stores its authorized canonical path. Reject a
    // path that has since become a symlink to a different file.
    if (canonicalPath !== path.resolve(filePath)) return null;
    const metadata = await stat(canonicalPath).catch(() => null);
    if (!metadata?.isFile()) return null;
    return this.resolvePresentTargetForRuntime(runtime, canonicalPath);
  }

  private async resolvePresentTargetForRuntime(
    runtime: ProjectRuntime,
    filePath: string,
  ): Promise<FilePreviewTarget | null> {
    if (!path.isAbsolute(filePath) || filePath.includes("\0")) return null;

    // Match against canonical roots so a symlinked folder cannot be escaped
    // with a lexically-contained path.
    const canonicalPath = await realpath(filePath).catch(() => null);
    if (!canonicalPath) return null;

    for (const folder of runtime.project.folders) {
      if (!folder.isAvailable) continue;
      const canonicalRoot = await realpath(folder.path).catch(() => null);
      if (!canonicalRoot) continue;
      if (!pathContains(canonicalRoot, canonicalPath)) continue;
      return {
        folderId: folder.id,
        projectId: runtime.project.id,
        relativePath: toPortableRelativePath(canonicalRoot, canonicalPath),
        source: "project",
      };
    }

    return { path: canonicalPath, source: "presented" };
  }

  updateContextUsage(sessionId: string, contextUsage: PineContextUsage): void {
    const live =
      this.entryForSession(sessionId)?.runtime.liveSessions.get(sessionId);
    if (live) live.contextUsage = contextUsage;
  }

  sessionSummary(sessionId: string): PineSessionSummary | undefined {
    return this.entryForSession(sessionId)?.runtime.liveSessions.get(sessionId)
      ?.summary;
  }

  updateSessionSummary(sessionId: string, summary: PineSessionSummary): void {
    const live =
      this.entryForSession(sessionId)?.runtime.liveSessions.get(sessionId);
    if (live) live.summary = summary;
  }

  /** Remember which window an approval request was routed to. */
  trackApproval(
    requestId: string,
    webContentsId: number,
    sessionId?: string,
  ): void {
    this.pendingApprovals.set(requestId, { webContentsId, sessionId });
  }

  forgetApproval(requestId: string): void {
    this.pendingApprovals.delete(requestId);
  }

  trackQuestionnaire(
    requestId: string,
    webContentsId: number,
    sessionId?: string,
  ): void {
    this.pendingQuestionnaires.set(requestId, { webContentsId, sessionId });
  }

  forgetQuestionnaire(requestId: string): void {
    this.pendingQuestionnaires.delete(requestId);
  }

  respondApproval(
    webContentsId: number,
    request: RespondApprovalRequest,
  ): { accepted: boolean } {
    const owner = this.pendingApprovals.get(request.requestId);
    if (owner === undefined) {
      throw new Error("This approval request is no longer pending.");
    }
    if (owner.webContentsId !== webContentsId) {
      throw new Error("Approval request does not belong to this window.");
    }
    this.agentHost.respondApproval(request.requestId, toGateDecision(request));
    this.pendingApprovals.delete(request.requestId);
    return { accepted: true };
  }

  respondQuestionnaire(
    webContentsId: number,
    request: RespondQuestionnaireRequest,
  ): { accepted: boolean } {
    const owner = this.pendingQuestionnaires.get(request.requestId);
    if (owner === undefined) {
      throw new Error("This questionnaire is no longer pending.");
    }
    if (owner.webContentsId !== webContentsId) {
      throw new Error("Questionnaire does not belong to this window.");
    }
    this.agentHost.respondQuestionnaire(request.requestId, request.submission);
    this.pendingQuestionnaires.delete(request.requestId);
    return { accepted: true };
  }

  clearSessionInteractions(sessionId: string): void {
    for (const [requestId, owner] of this.pendingApprovals) {
      if (owner.sessionId === sessionId)
        this.pendingApprovals.delete(requestId);
    }
    for (const [requestId, owner] of this.pendingQuestionnaires) {
      if (owner.sessionId === sessionId)
        this.pendingQuestionnaires.delete(requestId);
    }
  }

  async dispose(webContentsId: number): Promise<void> {
    const runtime = this.runtimes.get(webContentsId);
    if (!runtime) return;

    for (const [requestId, owner] of this.pendingApprovals) {
      if (owner.webContentsId === webContentsId)
        this.pendingApprovals.delete(requestId);
    }
    for (const [requestId, owner] of this.pendingQuestionnaires) {
      if (owner.webContentsId === webContentsId)
        this.pendingQuestionnaires.delete(requestId);
    }
    this.runtimes.delete(webContentsId);
    await Promise.allSettled([
      ...runtime.pendingCreations,
      ...runtime.openingSessions.values(),
    ]);
    try {
      await Promise.all(
        [...runtime.liveSessions.keys()].map((sessionId) =>
          this.agentHost.disposeSession(sessionId),
        ),
      );
    } finally {
      runtime.liveSessions.clear();
      await runtime.sessions.dispose();
    }
  }

  private entryForSession(
    sessionId: string,
  ): { runtime: ProjectRuntime; webContentsId: number } | undefined {
    for (const [webContentsId, runtime] of this.runtimes) {
      if (runtime.liveSessions.has(sessionId)) {
        return { runtime, webContentsId };
      }
    }
    return undefined;
  }

  private focusedSession(runtime?: ProjectRuntime): RuntimeSession | undefined {
    return runtime?.focusedSessionId
      ? runtime.liveSessions.get(runtime.focusedSessionId)
      : undefined;
  }

  private targetSession(
    webContentsId: number,
    sessionId?: string,
  ): RuntimeSession | undefined {
    const runtime = this.get(webContentsId);
    if (!sessionId) return this.focusedSession(runtime);
    const live = runtime.liveSessions.get(sessionId);
    if (!live) throw new Error("Session does not belong to this window.");
    return live;
  }

  private get(webContentsId: number): ProjectRuntime {
    const runtime = this.runtimes.get(webContentsId);
    if (!runtime) throw new Error("No project is open in this window.");
    return runtime;
  }

  private getFolder(project: PineProject, folderId: string): PineProjectFolder {
    const folder = project.folders.find(
      (candidate) => candidate.id === folderId,
    );
    if (!folder) throw new Error("Folder not found in the active project.");
    return folder;
  }

  private location(runtime: ProjectRuntime) {
    const tinyFishApiKey = this.getTinyFishApiKey();
    const defaultFolder = this.getFolder(
      runtime.project,
      runtime.project.defaultFolderId,
    );
    return {
      agentDir: this.agentDir,
      approvalMode: runtime.approvalMode,
      cwd: defaultFolder.path,
      folders: runtime.project.folders
        .filter((folder) => folder.isAvailable)
        .map(({ access, path: folderPath }) => ({
          access,
          path: folderPath,
        })),
      skillsRoot:
        runtime.dataPaths.skillsRoot ??
        path.join(runtime.dataPaths.projectRoot, "skills"),
      skillsSettingsPath:
        runtime.dataPaths.skillsSettingsPath ??
        path.join(runtime.dataPaths.projectRoot, "skills.json"),
      sessionsRoot: runtime.dataPaths.sessionsRoot,
      ...(tinyFishApiKey ? { tinyFishApiKey } : {}),
    };
  }
}
