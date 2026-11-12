import type {
  ProjectEntryReference,
  ProjectFileOperation,
  ProjectEntry,
  FilePreviewTarget,
} from "../shared/projectFiles";
import {
  isTemporaryWorkspace,
  type PineProject,
  type PineProjectFolder,
} from "../shared/projects";
import { projectSessionDirectory } from "../shared/sessionPaths";
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
  SelectApprovalModelRequest,
  SelectUtilityModelRequest,
  SelectImageModelRequest,
  SelectVideoModelRequest,
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
import { mkdir, realpath, rename, stat } from "node:fs/promises";
import {
  deleteSideChat,
  deleteSideChatsOf,
  discardUnusedSideChat,
  findSideChat,
  listSideChats,
  sideChatsDirectory,
} from "./sideChats";
import {
  isSideChatAnchor,
  type OpenSideChatRequest,
  type OpenSideChatResult,
  type PineSideChatSummary,
  type PromptSideChatRequest,
} from "../shared/sideChats";
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
  if (request.action === "compact") {
    return {
      kind: "deny",
      reason: "The user chose to compress the conversation first.",
      choice: "compact",
    };
  }
  if (request.action === "abort") {
    return {
      kind: "deny",
      reason: "The user cancelled this activation.",
      choice: "abort",
    };
  }
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
  controllerId?: number;
}

/** A side chat open in a window; it is no session of the project's own. */
interface LiveSideChat {
  runtime: ProjectRuntime;
  parentSessionId: string;
  clientId: number;
  persistent: boolean;
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
  async reloadMcp(webContentsId: number, projectId: string): Promise<void> {
    const runtime = this.get(webContentsId, projectId);
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
    const live = this.liveEntry(webContentsId, sessionId)?.session;
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

  async getMcpStatus(webContentsId: number, projectId: string) {
    const session = this.focusedSession(
      this.runtimes.get(webContentsId)?.get(projectId),
    );
    return session
      ? this.agentHost.getMcpStatus?.(session.summary.id)
      : undefined;
  }
  /** webContentsId → projectId → runtime. A window may hold many projects. */
  private readonly runtimes = new Map<number, Map<string, ProjectRuntime>>();
  private readonly projectOperations = new Map<string, Promise<void>>();
  /** approval requestId → owning webContentsId, for response validation. */
  private readonly pendingApprovals = new Map<
    string,
    { webContentsId: number; sessionId?: string }
  >();
  /** Temporary-workspace session → project it moves to when its run ends. */
  private readonly pendingTeleports = new Map<string, string>();
  private readonly sideChats = new Map<string, LiveSideChat>();
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

  /**
   * Sessions another owner keeps live, such as a running automation. A
   * window can show them, but closing, moving or deleting them here must not
   * end that owner's run.
   */
  heldElsewhere: (sessionId: string) => boolean = () => false;

  private async releaseAgentSession(sessionId: string): Promise<void> {
    if (!this.heldElsewhere(sessionId))
      await this.agentHost.disposeSession(sessionId);
  }

  /** The other owner ended the session; the next use reopens it from disk. */
  forgetSession(sessionId: string): void {
    for (const runtime of this.allRuntimes()) {
      runtime.liveSessions.delete(sessionId);
      if (runtime.focusedSessionId === sessionId)
        runtime.focusedSessionId = undefined;
    }
  }

  private async serializeProject(
    projectId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.projectOperations.get(projectId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.projectOperations.set(projectId, pending);
    try {
      await pending;
    } finally {
      if (this.projectOperations.get(projectId) === pending)
        this.projectOperations.delete(projectId);
    }
  }

  /** Attach another interface to the same execution resources. */
  share(
    clientId: number,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<void> {
    return this.serializeProject(project.id, () =>
      this.shareRuntime(clientId, project, dataPaths),
    );
  }

  private async shareRuntime(
    clientId: number,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<void> {
    if (this.isOpen(clientId, project.id)) return;
    const existing = this.allRuntimes().find(
      (runtime) => runtime.project.id === project.id,
    );
    if (!existing) return this.openRuntime(clientId, project, dataPaths);
    const projects =
      this.runtimes.get(clientId) ?? new Map<string, ProjectRuntime>();
    projects.set(project.id, existing);
    this.runtimes.set(clientId, projects);
  }

  clientsOfSession(sessionId: string): number[] {
    return [...this.runtimes.keys()].filter((id) =>
      this.liveEntry(id, sessionId),
    );
  }

  projectIdsOf(clientId: number): string[] {
    return [...(this.runtimes.get(clientId)?.keys() ?? [])];
  }

  clientsOfProject(projectId: string): number[] {
    return [...this.runtimes.keys()].filter((id) => this.isOpen(id, projectId));
  }

  projectOfInteraction(requestId: string): string | undefined {
    const owner =
      this.pendingApprovals.get(requestId) ??
      this.pendingQuestionnaires.get(requestId);
    return owner?.sessionId
      ? this.projectOfLiveSession(owner.sessionId)?.id
      : undefined;
  }

  refresh(project: PineProject, dataPaths: ProjectDataPaths): Promise<void> {
    return this.serializeProject(project.id, async () => {
      const clients = this.clientsOfProject(project.id);
      await this.closeEverywhere(project.id);
      const first = clients.shift();
      if (first === undefined) return;
      await this.openRuntime(first, project, dataPaths);
      for (const client of clients)
        await this.shareRuntime(client, project, dataPaths);
    });
  }

  async closeEverywhere(projectId: string): Promise<void> {
    for (const clientId of [...this.runtimes.keys()])
      await this.close(clientId, projectId);
  }

  open(
    clientId: number,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<void> {
    return this.serializeProject(project.id, () =>
      this.openRuntime(clientId, project, dataPaths),
    );
  }

  private async openRuntime(
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

    // Reopening applies updated project settings to fresh sessions.
    await this.close(webContentsId, project.id);

    const sessions = await ProjectSessionService.create({
      cacheRoot: dataPaths.cacheRoot,
      cwd: defaultFolder.path,
      sessionsRoot: dataPaths.sessionsRoot,
    });
    const windowRuntimes =
      this.runtimes.get(webContentsId) ?? new Map<string, ProjectRuntime>();
    this.runtimes.set(webContentsId, windowRuntimes);
    windowRuntimes.set(project.id, {
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
    return this.runtimes.get(webContentsId)?.has(projectId) ?? false;
  }

  ownerOfProject(projectId: string): number | undefined {
    for (const [webContentsId, windowRuntimes] of this.runtimes) {
      if (windowRuntimes.has(projectId)) return webContentsId;
    }
    return undefined;
  }

  /** Whether any session of this open project is live in the agent host. */
  hasLiveSessions(webContentsId: number, projectId: string): boolean {
    const runtime = this.runtimes.get(webContentsId)?.get(projectId);
    return Boolean(
      runtime &&
      (runtime.liveSessions.size > 0 ||
        runtime.openingSessions.size > 0 ||
        runtime.pendingCreations.size > 0),
    );
  }

  /** Attachment storage root for one project open in this window. */
  attachmentsRootFor(
    webContentsId: number,
    projectId: string,
  ): string | undefined {
    return this.runtimes.get(webContentsId)?.get(projectId)?.dataPaths
      .attachmentsRoot;
  }

  /**
   * Whether a filesystem path sits inside a folder the user granted to one
   * of the currently open projects. Used to scope which attachment images
   * the `pine-attachment://` protocol is allowed to serve.
   */
  isInsideGrantedFolder(candidatePath: string): boolean {
    const resolvedPath = path.resolve(candidatePath);
    for (const runtime of this.allRuntimes()) {
      for (const folder of runtime.project.folders) {
        if (pathContains(folder.path, resolvedPath)) return true;
      }
    }
    return false;
  }

  /** HTTP resources arrive as canonical paths, including symlinked folder roots. */
  async isInsideCanonicalGrantedFolder(
    candidatePath: string,
  ): Promise<boolean> {
    for (const runtime of this.allRuntimes())
      for (const folder of runtime.project.folders) {
        const root = await realpath(folder.path).catch(() => null);
        if (root && pathContains(root, candidatePath)) return true;
      }
    return false;
  }

  /** A session index some window already has open, so reads can reuse it. */
  openSessionService(projectId: string): ProjectSessionService | undefined {
    return this.allRuntimes().find(
      (runtime) => runtime.project.id === projectId,
    )?.sessions;
  }

  async search(
    webContentsId: number,
    projectId: string,
    query: string,
  ): Promise<SessionSearchResult[]> {
    return this.get(webContentsId, projectId).sessions.search(query);
  }

  async loadMessages(
    webContentsId: number,
    projectId: string,
    sessionId: string,
    before?: string,
    limit?: number,
    includeOutline?: boolean,
  ): Promise<LoadSessionMessagesResult> {
    return this.get(webContentsId, projectId).sessions.loadMessages(
      sessionId,
      before,
      limit,
      includeOutline,
    );
  }

  async attachmentForSession(
    webContentsId: number,
    projectId: string,
    sessionId: string,
  ): Promise<PineAttachment> {
    return this.get(webContentsId, projectId).sessions.attachmentForSession(
      sessionId,
    );
  }

  async exportSession(
    webContentsId: number,
    projectId: string,
    sessionId: string,
  ): Promise<PineSessionExportDocument> {
    const runtime = this.get(webContentsId, projectId);
    const fallbackApprovalMode =
      runtime.liveSessions.get(sessionId)?.approvalMode ?? "auto-approve";
    return runtime.sessions.exportSession(sessionId, fallbackApprovalMode);
  }

  /** The side chat a session id belongs to, if it is one. */
  sideChatOf(
    sessionId: string,
  ): { clientId: number; parentSessionId: string } | undefined {
    const sideChat = this.sideChats.get(sessionId);
    return sideChat
      ? {
          clientId: sideChat.clientId,
          parentSessionId: sideChat.parentSessionId,
        }
      : undefined;
  }

  async listSideChats(
    webContentsId: number,
    projectId: string,
    sessionId: string,
  ): Promise<PineSideChatSummary[]> {
    const runtime = this.get(webContentsId, projectId);
    return listSideChats(
      sideChatsDirectory(runtime.dataPaths.projectRoot, sessionId),
      sessionId,
    );
  }

  async openSideChat(
    webContentsId: number,
    request: OpenSideChatRequest,
  ): Promise<OpenSideChatResult> {
    const runtime = this.get(webContentsId, request.projectId);
    const parentSessionId = request.sessionId;
    const directory = sideChatsDirectory(
      runtime.dataPaths.projectRoot,
      parentSessionId,
    );
    const live = runtime.liveSessions.get(parentSessionId);
    let sideChatFile: string | undefined;
    if (request.sideChatId) {
      const saved = await findSideChat(
        directory,
        parentSessionId,
        request.sideChatId,
      );
      if (!saved) throw new Error("This side chat no longer exists.");
      // Already open: its window gets it back as it is.
      const open = this.sideChats.get(saved.summary.id);
      if (open) await this.disposeSideChat(saved.summary.id);
      sideChatFile = saved.path;
    }
    const parentSessionFile = live
      ? undefined
      : await runtime.sessions
          .describeSession(parentSessionId)
          .then((descriptor) => descriptor.sessionFile)
          .catch(() => undefined);
    const opened = await this.agentHost.openSideChat({
      location: {
        ...this.location(runtime),
        approvalMode: live?.approvalMode ?? runtime.approvalMode,
      },
      parentSessionId,
      ...(parentSessionFile ? { parentSessionFile } : {}),
      sideChatsDirectory: directory,
      ...(sideChatFile ? { sideChatFile } : {}),
      ...(request.anchor ? { anchor: { ...request.anchor } } : {}),
    });
    const persistent =
      sideChatFile !== undefined || request.anchor !== undefined;
    this.sideChats.set(opened.session.id, {
      runtime,
      parentSessionId,
      clientId: webContentsId,
      persistent,
    });
    if (!this.isCurrent(webContentsId, runtime)) {
      await this.disposeSideChat(opened.session.id);
      throw new Error("The project closed while opening a side chat.");
    }
    return {
      sideChatId: opened.session.id,
      parentSessionId,
      persistent,
      ...(isSideChatAnchor(opened.anchor) ? { anchor: opened.anchor } : {}),
      messages: opened.messages,
    };
  }

  private ownSideChat(
    webContentsId: number,
    projectId: string,
    sideChatId: string,
  ): LiveSideChat {
    const sideChat = this.sideChats.get(sideChatId);
    if (
      !sideChat ||
      sideChat.runtime !== this.get(webContentsId, projectId) ||
      sideChat.runtime.project.id !== projectId
    )
      throw new Error("The side chat is not open in this window.");
    sideChat.clientId = webContentsId;
    return sideChat;
  }

  async promptSideChat(
    webContentsId: number,
    request: PromptSideChatRequest,
  ): Promise<{ accepted: boolean }> {
    this.ownSideChat(webContentsId, request.projectId, request.sideChatId);
    const result = await this.agentHost.prompt(
      request.sideChatId,
      request.message,
      undefined,
      undefined,
      undefined,
      request.locale,
      request.rewrite,
    );
    return { accepted: result.accepted };
  }

  async abortSideChat(
    webContentsId: number,
    projectId: string,
    sideChatId: string,
  ): Promise<{ aborted: boolean }> {
    this.ownSideChat(webContentsId, projectId, sideChatId);
    return this.agentHost.abort(sideChatId);
  }

  /** Ends a side chat; one that is not saved is gone with it. */
  async closeSideChat(
    webContentsId: number,
    projectId: string,
    sideChatId: string,
  ): Promise<{ closed: boolean }> {
    const sideChat = this.sideChats.get(sideChatId);
    if (!sideChat) return { closed: false };
    this.ownSideChat(webContentsId, projectId, sideChatId);
    await this.disposeSideChat(sideChatId);
    if (sideChat.persistent)
      await discardUnusedSideChat(
        sideChatsDirectory(
          sideChat.runtime.dataPaths.projectRoot,
          sideChat.parentSessionId,
        ),
        sideChat.parentSessionId,
        sideChatId,
      );
    return { closed: true };
  }

  async deleteSideChat(
    webContentsId: number,
    projectId: string,
    sessionId: string,
    sideChatId: string,
  ): Promise<{ deleted: boolean }> {
    const runtime = this.get(webContentsId, projectId);
    if (this.sideChats.has(sideChatId)) await this.disposeSideChat(sideChatId);
    return {
      deleted: await deleteSideChat(
        sideChatsDirectory(runtime.dataPaths.projectRoot, sessionId),
        sessionId,
        sideChatId,
      ),
    };
  }

  private async disposeSideChat(sideChatId: string): Promise<void> {
    this.sideChats.delete(sideChatId);
    await this.agentHost.disposeSession(sideChatId).catch(() => undefined);
  }

  private async disposeSideChatsOf(
    runtime: ProjectRuntime,
    parentSessionId?: string,
  ): Promise<void> {
    await Promise.all(
      [...this.sideChats]
        .filter(
          ([, sideChat]) =>
            sideChat.runtime === runtime &&
            (parentSessionId === undefined ||
              sideChat.parentSessionId === parentSessionId),
        )
        .map(([sideChatId]) => this.disposeSideChat(sideChatId)),
    );
  }

  async deleteSession(
    webContentsId: number,
    projectId: string,
    sessionId: string,
  ): Promise<boolean> {
    const runtime = this.get(webContentsId, projectId);
    await runtime.openingSessions.get(sessionId);
    if (runtime.liveSessions.has(sessionId)) {
      await this.releaseAgentSession(sessionId);
      runtime.liveSessions.delete(sessionId);
      if (runtime.focusedSessionId === sessionId)
        runtime.focusedSessionId = undefined;
    }
    this.clearSessionInteractions(sessionId);
    await this.disposeSideChatsOf(runtime, sessionId);
    const deleted = await runtime.sessions.deleteSession(sessionId);
    if (deleted)
      await deleteSideChatsOf(
        sideChatsDirectory(runtime.dataPaths.projectRoot, sessionId),
      );
    return deleted;
  }

  async renameSession(
    webContentsId: number,
    projectId: string,
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId, projectId);
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
    return Promise.all(
      entries.map((entry) =>
        resolveProjectEntry(
          this.get(webContentsId, entry.projectId).project.folders,
          entry,
        ),
      ),
    );
  }

  projectEntryPathForNativeDrag(
    webContentsId: number,
    entry: ProjectEntryReference,
  ): string {
    return resolveProjectEntryForNativeDrag(
      this.get(webContentsId, entry.projectId).project.folders,
      entry,
    );
  }

  async operateFile(
    webContentsId: number,
    request: ProjectFileOperation,
    native: ProjectFileNativeActions,
  ): Promise<void> {
    const { project } = this.get(webContentsId, request.target.projectId);
    if (
      request.action === "move" &&
      request.sources.some(
        (source) => source.projectId !== request.target.projectId,
      )
    ) {
      throw new Error("Files can only be moved within one project.");
    }
    await operateProjectFile(project.folders, request, native);
  }

  async listDirectory(
    webContentsId: number,
    projectId: string,
    folderId: string,
    relativePath: string,
  ): Promise<ProjectEntry[]> {
    const runtime = this.get(webContentsId, projectId);
    return listProjectDirectory(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resolveDirectory(
    webContentsId: number,
    projectId: string,
    folderId: string,
    relativePath: string,
  ): Promise<string> {
    const runtime = this.get(webContentsId, projectId);
    return resolveProjectPath(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resume(
    webContentsId: number,
    projectId: string,
    sessionId: string,
  ): Promise<ResumeSessionResult> {
    const runtime = this.get(webContentsId, projectId);
    const owner = this.entryForSession(sessionId);
    if (owner && owner.runtime !== runtime) {
      throw new Error("This session is open in another window.");
    }
    runtime.focusedSessionId = sessionId;
    const live = runtime.liveSessions.get(sessionId);
    if (live) {
      live.controllerId = webContentsId;
      return { session: live.summary, contextUsage: live.contextUsage };
    }
    const pending = runtime.openingSessions.get(sessionId);
    if (pending) return pending;

    const opening = (async () => {
      const descriptor = await runtime.sessions.describeSession(sessionId);
      if (!this.isCurrent(webContentsId, runtime)) {
        throw new Error("The project closed while opening a session.");
      }
      const opened = await this.agentHost.openSession(
        this.location(runtime),
        descriptor.sessionFile,
      );
      runtime.liveSessions.set(opened.session.id, {
        summary: opened.session,
        approvalMode: opened.session.approvalMode ?? "auto-approve",
        contextUsage: opened.contextUsage,
      });
      if (!this.isCurrent(webContentsId, runtime)) {
        throw new Error("The project closed while opening a session.");
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
    projectId: string,
    approvalMode: PineApprovalMode,
    focus: boolean,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId, projectId);
    const creation = this.agentHost
      .createSession({ ...this.location(runtime), approvalMode })
      .then(({ session }) => {
        runtime.liveSessions.set(session.id, {
          summary: session,
          approvalMode,
          controllerId: webContentsId,
        });
        if (!this.isCurrent(webContentsId, runtime)) {
          throw new Error("The project closed while creating a session.");
        }
        if (focus) runtime.focusedSessionId = session.id;
        return session;
      });
    runtime.pendingCreations.add(creation);
    try {
      return await creation;
    } finally {
      runtime.pendingCreations.delete(creation);
    }
  }

  /**
   * Send a message, creating the session first for a new target. A session
   * another session starts in the background leaves the window's focused
   * session as it is.
   */
  async prompt(
    webContentsId: number,
    request: PromptSessionRequest,
    { focus = true }: { focus?: boolean } = {},
  ): Promise<PromptSessionResult> {
    const runtime = this.get(webContentsId, request.target.projectId);
    let approvalMode = request.approvalMode ?? "auto-approve";
    if (
      request.rewrite &&
      (request.target.kind !== "session" || request.streamingBehavior)
    ) {
      throw new Error("Only an idle existing session can rewrite history.");
    }
    const mutators = request.mutators ?? [];
    if (mutators.length > 0 && (request.streamingBehavior || request.rewrite))
      throw new Error("A session can only be changed before a new message.");
    const activeSession =
      request.target.kind === "new"
        ? await this.createNewSession(
            webContentsId,
            request.target.projectId,
            approvalMode,
            focus,
          )
        : (
            await this.resume(
              webContentsId,
              request.target.projectId,
              request.target.sessionId,
            )
          ).session;
    if (!this.isCurrent(webContentsId, runtime)) {
      throw new Error("The project closed before submitting a prompt.");
    }
    approvalMode =
      request.approvalMode ?? activeSession.approvalMode ?? "auto-approve";
    if (mutators.length > 0)
      await this.agentHost.mutateSession(activeSession.id, mutators);
    const attachedPaths = parseAttachmentMessage(request.message)
      .attachments.map((attachment) => attachment.path)
      .filter((attachmentPath) => attachmentPath.length <= 4_096)
      .slice(0, 100);
    const streamingBehavior =
      request.streamingBehavior === "follow-up"
        ? "followUp"
        : request.streamingBehavior;
    const controlled = runtime.liveSessions.get(activeSession.id);
    if (controlled) controlled.controllerId = webContentsId;
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
    sessionId: string,
  ): Promise<{ aborted: boolean; sessionId?: string }> {
    const live = this.targetSession(webContentsId, sessionId);
    if (!live) return { aborted: false };
    const result = await this.agentHost.abort(live.summary.id);
    return { ...result, sessionId: live.summary.id };
  }

  async compact(
    webContentsId: number,
    sessionId: string,
  ): Promise<{ compacted: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    return live
      ? this.agentHost.compact(live.summary.id)
      : { compacted: false };
  }

  async dequeueSteering(
    webContentsId: number,
    message: string,
    sessionId: string,
  ): Promise<{ message?: string; removed: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    return live
      ? this.agentHost.dequeueSteering(live.summary.id, message)
      : { removed: false };
  }

  async sendSteeringNow(
    webContentsId: number,
    message: string,
    sessionId: string,
  ): Promise<{ sent: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    return live
      ? this.agentHost.sendSteeringNow(live.summary.id, message)
      : { sent: false };
  }

  async setApprovalMode(
    webContentsId: number,
    approvalMode: PineApprovalMode,
    sessionId: string,
  ): Promise<{ updated: boolean }> {
    const live = this.targetSession(webContentsId, sessionId);
    if (!live) return { updated: false };
    live.approvalMode = approvalMode;
    live.summary = { ...live.summary, approvalMode };
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
    if (
      request.sessionId &&
      !this.liveEntry(webContentsId, request.sessionId)
    ) {
      const projectId =
        request.projectId ??
        (await this.projectOfStoredSession(webContentsId, request.sessionId));
      if (!projectId)
        throw new Error("Session does not belong to this window.");
      await this.resume(webContentsId, projectId, request.sessionId);
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

  selectApprovalModel(
    request: SelectApprovalModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectApprovalModel(this.agentDir, request);
  }

  selectImageModel(
    request: SelectImageModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectImageModel(this.agentDir, request);
  }
  selectVideoModel(
    request: SelectVideoModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectVideoModel(this.agentDir, request);
  }

  setTinyFishApiKey(apiKey: string | undefined): Promise<{ updated: boolean }> {
    return this.agentHost.setTinyFishApiKey(apiKey);
  }

  setContextCompactionStrategy(
    strategy: PineContextCompactionStrategy,
  ): Promise<{ updated: boolean }> {
    const hasActiveSession = this.allRuntimes().some(
      (runtime) => runtime.liveSessions.size > 0,
    );
    if (!hasActiveSession) return Promise.resolve({ updated: true });
    return this.agentHost.setContextCompactionStrategy(strategy);
  }

  setContextCompactionRoute(
    route: PineContextCompactionRoute,
  ): Promise<{ updated: boolean }> {
    const hasActiveSession = this.allRuntimes().some(
      (runtime) => runtime.liveSessions.size > 0,
    );
    if (!hasActiveSession) return Promise.resolve({ updated: true });
    return this.agentHost.setContextCompactionRoute(route);
  }

  controllerOfSession(sessionId: string): number | undefined {
    const entry = this.entryForSession(sessionId);
    const controller = entry?.runtime.liveSessions.get(sessionId)?.controllerId;
    return controller !== undefined && this.liveEntry(controller, sessionId)
      ? controller
      : entry?.webContentsId;
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
    projectId: string,
    sessionId: string,
    toolCallId: string,
  ): Promise<FilePreviewTarget | null> {
    const runtime = this.get(webContentsId, projectId);
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
    if (
      owner.webContentsId !== webContentsId &&
      (!owner.sessionId || !this.liveEntry(webContentsId, owner.sessionId))
    ) {
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
    if (
      owner.webContentsId !== webContentsId &&
      (!owner.sessionId || !this.liveEntry(webContentsId, owner.sessionId))
    ) {
      throw new Error("Questionnaire does not belong to this window.");
    }
    this.agentHost.respondQuestionnaire(request.requestId, request.submission);
    this.pendingQuestionnaires.delete(request.requestId);
    return { accepted: true };
  }

  clearSessionInteractions(sessionId: string): void {
    this.pendingTeleports.delete(sessionId);
    for (const [requestId, owner] of this.pendingApprovals) {
      if (owner.sessionId === sessionId)
        this.pendingApprovals.delete(requestId);
    }
    for (const [requestId, owner] of this.pendingQuestionnaires) {
      if (owner.sessionId === sessionId)
        this.pendingQuestionnaires.delete(requestId);
    }
  }

  /** Live sessions of a project in every window. */
  liveSessionIdsOf(projectId: string): string[] {
    return [...this.runtimes.values()].flatMap((windowRuntimes) => [
      ...(windowRuntimes.get(projectId)?.liveSessions.keys() ?? []),
    ]);
  }

  /** A live session's current approval mode, if any window holds it. */
  approvalModeOfLiveSession(sessionId: string): PineApprovalMode | undefined {
    return this.entryForSession(sessionId)?.runtime.liveSessions.get(sessionId)
      ?.approvalMode;
  }

  /** The project that owns a live session, if any window holds it. */
  projectOfLiveSession(sessionId: string): PineProject | undefined {
    return this.entryForSession(sessionId)?.runtime.project;
  }

  /** Remember a confirmed move; it runs once the session's run ends. */
  scheduleTeleport(sessionId: string, projectId: string): void {
    const project = this.projectOfLiveSession(sessionId);
    if (!project) throw new Error("The session is no longer open.");
    if (project.id === projectId)
      throw new Error("The session is already in that project.");
    this.pendingTeleports.set(sessionId, projectId);
  }

  takeScheduledTeleport(sessionId: string): string | undefined {
    const projectId = this.pendingTeleports.get(sessionId);
    this.pendingTeleports.delete(sessionId);
    return projectId;
  }

  /**
   * Move an idle session into another project of the same window: release
   * it, move its file into that project's session storage, and let the
   * renderer resume it there with the project's folders.
   */
  async teleportSession(
    sessionId: string,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<{ fromProjectId: string; webContentsId: number }> {
    const entry = this.entryForSession(sessionId);
    if (!entry) throw new Error("The session is no longer open.");
    if (entry.runtime.project.id === project.id)
      throw new Error("The session is already in that project.");
    const { runtime: source, webContentsId } = entry;
    if (!this.isOpen(webContentsId, project.id)) {
      await this.open(webContentsId, project, dataPaths);
    }
    const target = this.get(webContentsId, project.id);
    const descriptor = await source.sessions.describeSession(sessionId);

    await this.releaseAgentSession(sessionId);
    source.liveSessions.delete(sessionId);
    if (source.focusedSessionId === sessionId)
      source.focusedSessionId = undefined;
    this.clearSessionInteractions(sessionId);

    const directory = projectSessionDirectory(
      target.dataPaths.sessionsRoot,
      this.getFolder(target.project, target.project.defaultFolderId).path,
    );
    await mkdir(directory, { recursive: true });
    await rename(
      descriptor.sessionFile,
      path.join(directory, path.basename(descriptor.sessionFile)),
    );
    return { fromProjectId: source.project.id, webContentsId };
  }

  /** Release one project this window no longer shows. */
  async close(webContentsId: number, projectId: string): Promise<void> {
    const windowRuntimes = this.runtimes.get(webContentsId);
    const runtime = windowRuntimes?.get(projectId);
    if (!windowRuntimes || !runtime) return;
    windowRuntimes.delete(projectId);
    if (windowRuntimes.size === 0) this.runtimes.delete(webContentsId);
    if (!this.allRuntimes().includes(runtime))
      await this.disposeRuntime(runtime);
  }

  /** Release every project of a window that closed or reloaded. */
  async dispose(webContentsId: number): Promise<void> {
    await Promise.all(
      [...this.sideChats]
        .filter(([, sideChat]) => sideChat.clientId === webContentsId)
        .map(([sideChatId]) => this.disposeSideChat(sideChatId)),
    );
    const windowRuntimes = this.runtimes.get(webContentsId);
    if (!windowRuntimes) return;

    this.runtimes.delete(webContentsId);
    await Promise.all(
      [...new Set(windowRuntimes.values())]
        .filter((runtime) => !this.allRuntimes().includes(runtime))
        .map((runtime) => this.disposeRuntime(runtime)),
    );
  }

  private async disposeRuntime(runtime: ProjectRuntime): Promise<void> {
    await Promise.allSettled([
      ...runtime.pendingCreations,
      ...runtime.openingSessions.values(),
    ]);
    for (const sessionId of runtime.liveSessions.keys()) {
      this.clearSessionInteractions(sessionId);
    }
    await this.disposeSideChatsOf(runtime);
    try {
      await Promise.all(
        [...runtime.liveSessions.keys()].map((sessionId) =>
          this.releaseAgentSession(sessionId),
        ),
      );
    } finally {
      runtime.liveSessions.clear();
      await runtime.sessions.dispose();
    }
  }

  private allRuntimes(): ProjectRuntime[] {
    return [
      ...new Set(
        [...this.runtimes.values()].flatMap((windowRuntimes) => [
          ...windowRuntimes.values(),
        ]),
      ),
    ];
  }

  private isCurrent(webContentsId: number, runtime: ProjectRuntime): boolean {
    return (
      this.runtimes.get(webContentsId)?.get(runtime.project.id) === runtime ||
      this.allRuntimes().includes(runtime)
    );
  }

  private entryForSession(
    sessionId: string,
  ): { runtime: ProjectRuntime; webContentsId: number } | undefined {
    for (const [webContentsId, windowRuntimes] of this.runtimes) {
      for (const runtime of windowRuntimes.values()) {
        if (runtime.liveSessions.has(sessionId)) {
          return { runtime, webContentsId };
        }
      }
    }
    return undefined;
  }

  /** The open project in this window whose history holds the session. */
  private async projectOfStoredSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<string | undefined> {
    for (const runtime of this.runtimes.get(webContentsId)?.values() ?? []) {
      const found = await runtime.sessions
        .describeSession(sessionId)
        .then(() => true)
        .catch(() => false);
      if (found) return runtime.project.id;
    }
    return undefined;
  }

  /** A live session of any project open in this window. */
  private liveEntry(
    webContentsId: number,
    sessionId: string,
  ): { runtime: ProjectRuntime; session: RuntimeSession } | undefined {
    for (const runtime of this.runtimes.get(webContentsId)?.values() ?? []) {
      const session = runtime.liveSessions.get(sessionId);
      if (session) return { runtime, session };
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
    sessionId: string,
  ): RuntimeSession {
    const live = this.liveEntry(webContentsId, sessionId)?.session;
    if (!live) throw new Error("Session does not belong to this window.");
    return live;
  }

  private get(webContentsId: number, projectId: string): ProjectRuntime {
    const runtime = this.runtimes.get(webContentsId)?.get(projectId);
    if (!runtime) throw new Error("The project is not open in this window.");
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
      ...(isTemporaryWorkspace(runtime.project.id)
        ? { temporaryWorkspace: true }
        : { projectName: runtime.project.name }),
      ...(tinyFishApiKey ? { tinyFishApiKey } : {}),
    };
  }
}
