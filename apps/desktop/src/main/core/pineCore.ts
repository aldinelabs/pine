import { SIDE_CHAT_EVENT_CHANNEL } from "../../shared/sideChats";
import { realpath } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import {
  toErrorMessage,
  type AgentHostReply,
  type PineRuntimeEvent,
} from "../../agent/protocol";
import {
  readPineAgentSettings,
  writeWebServerSettings,
  type PineAgentSettings,
} from "../../agent/pineSettings";
import {
  SESSION_EVENT_CHANNEL,
  type PineAgentEvent,
  type PinePresentFileEvent,
  type PineSessionEvent,
  type PineSessionTeleportedEvent,
} from "../../shared/agent";
import { DEFAULT_APPROXIMATE_LOCATION_ENABLED } from "../../shared/approximateLocation";
import { listMcpServers } from "../mcpConfig";
import {
  PROVIDER_AUTH_EVENT_CHANNEL,
  isProviderAuthEvent,
} from "../../shared/models";
import {
  DEFAULT_ATTENTION_NOTIFICATIONS_ENABLED,
  DEFAULT_COMPLETION_SIGNAL_MODE,
  type PineCompletionSignalMode,
} from "../../shared/preferences";
import {
  FILE_PREVIEW_CHANGED_CHANNEL,
  PROJECT_FILES_CHANGED_CHANNEL,
} from "../../shared/projectFiles";
import {
  PROJECT_ATTACHMENTS_DIRECTORY,
  PROJECTS_DIRECTORY,
  isTemporaryWorkspace,
  type PineLibraryChange,
  type PineProject,
} from "../../shared/projects";
import { WEB_CLIENT_ID, isVirtualClient } from "../../shared/webControl";
import { WECHAT_CLIENT_ID } from "../../shared/wechatRemote";
import { AgentProcessHost } from "../agentProcessHost";
import { AutomationService } from "../automation/service";
import { AutomationSecretStore } from "../automation/secrets";
import { AUTOMATION_SECRETS_FILE, AutomationStore } from "../automation/store";
import { PineSkillRepository } from "../../agent/skills/repository";
import { AUTOMATIONS_CHANGED_CHANNEL } from "../../shared/automation";
import { ApproximateLocationService } from "../approximateLocation";
import { FilePreviewWatcherRegistry } from "../filePreviewWatcher";
import { ModelMetadataService } from "../modelMetadata";
import { ExchangeRateService } from "../exchangeRates";
import { ModelRecommendationService } from "../modelRecommendations";
import { PresentedFileRegistry } from "../presentedFiles";
import { ProjectFileWatcherRegistry } from "../projectFileWatcher";
import { ProjectRuntimeRegistry } from "../projectRuntime";
import { ProjectRepository } from "../projects/projectRepository";
import { PineRequestRouter, type PineRequestHandler } from "../requestRouter";
import { RuntimeDiagnostics } from "../runtimeDiagnostics";
import { TinyFishCredentialStore } from "../tinyfishCredentials";
import { WebAccessStore } from "../webAccess";
import { WebApplication } from "../webApplication";
import { RemoteHost } from "../remote/rcHost";
import { DEFAULT_PAGE_ORIGIN, RemoteControlStore } from "../remote/rcStore";
import { WebSessionState } from "../webSessionState";
import { WeChatBridge } from "../wechat/bridge";
import { WorkbenchStateRequests } from "../workbenchStateRequests";
import type { PineHost } from "./host";
import { LibraryChangeThrottle } from "./libraryChangeThrottle";
import {
  PROJECT_ID_PATTERN,
  PresentedFilePreviewRequestSchema,
  ProjectFilePreviewRequestSchema,
} from "./requestSchemas";
import { registerCoreRequests } from "./requests";
import { answerAutomationOperation } from "./requests/automations";
import { answerMcpOperation, listMcpCatalog } from "./requests/mcp";
import { agentHostProject, answerProjectOperation } from "./requests/projects";
import { notifyParentOf, unlinkSession } from "./subSessions";
import {
  answerSessionOperation,
  sessionLibrary,
  startBackgroundSession,
} from "./requests/sessions";
import { listProjectSkills } from "./requests/skills";

/** How long a running agent gets to stop its work before Pine quits anyway. */
const AGENT_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Pine's application: projects, sessions, the agent process and the browser
 * interface, shared by the desktop app and the headless server. Requests from
 * any transport go through `router`; platform capabilities come from `host`.
 */
/** What a side chat may ask of its conversation's sessions: reading only. */
const SIDE_CHAT_SESSION_OPS: ReadonlySet<string> = new Set([
  "search",
  "tree",
  "relatives",
  "read",
]);

export class PineCore {
  readonly router: PineRequestRouter;
  readonly agentDirectory: string;
  /** Root of the Pine-managed projects tree. */
  readonly projectsRoot: string;
  readonly repository: ProjectRepository;
  readonly runtimes: ProjectRuntimeRegistry;
  readonly agentHost: AgentProcessHost;
  readonly automations: AutomationService;
  readonly diagnostics: RuntimeDiagnostics;
  readonly web: WebApplication;
  /** Lets paired devices reach the local web server without port forwarding. */
  readonly remote: RemoteHost;
  /** Lets the bound WeChat account send tasks to Pine. */
  readonly wechat: WeChatBridge;
  readonly presentedFiles = new PresentedFileRegistry();
  readonly workbenchStateRequests = new WorkbenchStateRequests();
  readonly modelRecommendations = new ModelRecommendationService();
  readonly exchangeRates = new ExchangeRateService();
  readonly modelMetadata = new ModelMetadataService();
  readonly filePreviewWatchers: FilePreviewWatcherRegistry;
  /** Provider login id → the client that started it. */
  readonly providerLoginOwners = new Map<string, number>();
  /** Projects mid-open, so a second request joins the first. */
  readonly pendingProjectOpens = new Map<
    string,
    { promise: Promise<PineProject>; clientId: number }
  >();
  completionSignalMode: PineCompletionSignalMode;
  attentionNotificationsEnabled: boolean;

  /**
   * Filesystem paths the user explicitly selected as message attachments, per
   * client. Previewing them mirrors the agent's read-only grant for the same
   * paths, so they may be served even outside granted folders.
   */
  private readonly attachedPreviewPaths = new Map<number, Set<string>>();
  private readonly webSessionState = new WebSessionState();
  private projectFileWatchers: ProjectFileWatcherRegistry | null = null;
  private approximateLocation: ApproximateLocationService | undefined;
  /**
   * Sessions that are mid-run or still own a running background task. Their
   * project's temporary files are in use, so they cannot be cleared.
   */
  private readonly runningSessions = new Set<string>();
  /** Work a session asked for that must wait until its reply ends. */
  private readonly afterReply = new Map<string, () => Promise<void>>();
  private readonly sessionsWithRunningTasks = new Set<string>();
  /** Session list notices caused by a window's sessions, throttled per window. */
  private readonly sessionListChanges = new LibraryChangeThrottle<number>(
    (ownerId) => this.notifyLibraryChanged("sessions", ownerId),
  );

  static async create(host: PineHost): Promise<PineCore> {
    const agentDirectory = path.join(host.dataDirectory, "agent");
    const settings = await readPineAgentSettings(agentDirectory);
    const credentials = new TinyFishCredentialStore(
      path.join(host.dataDirectory, "tinyfish-api-key"),
      host.credentialStorage,
    );
    await credentials.load();
    const webAccess = new WebAccessStore(
      path.join(agentDirectory, "web-access.json"),
    );
    await webAccess.load();
    const remoteStore = new RemoteControlStore(
      path.join(agentDirectory, "remote-control.json"),
    );
    await remoteStore.load();
    const core = new PineCore(
      host,
      settings,
      credentials,
      webAccess,
      remoteStore,
    );
    // Remote Control is optional; a failure to start it must not stop Pine.
    void core.remote.start().catch(() => undefined);
    // Likewise WeChat remote; it reports its own failures in its status.
    void core.wechat.start().catch(() => undefined);
    void core.automations
      .start()
      .catch((error: unknown) =>
        console.error("Automations failed to start.", error),
      );
    return core;
  }

  private constructor(
    readonly host: PineHost,
    /** Settings as Pine started with them. */
    readonly settings: PineAgentSettings,
    readonly credentials: TinyFishCredentialStore,
    webAccess: WebAccessStore,
    remoteStore: RemoteControlStore,
  ) {
    this.agentDirectory = path.join(host.dataDirectory, "agent");
    this.projectsRoot = path.join(host.dataDirectory, PROJECTS_DIRECTORY);
    this.completionSignalMode =
      settings.completionSignalMode ?? DEFAULT_COMPLETION_SIGNAL_MODE;
    this.attentionNotificationsEnabled =
      settings.attentionNotificationsEnabled ??
      DEFAULT_ATTENTION_NOTIFICATIONS_ENABLED;
    this.diagnostics = new RuntimeDiagnostics(
      host.logsDirectory,
      settings.diagnosticLoggingEnabled ?? false,
    );
    this.diagnostics.record("app:start", {
      version: host.version,
      ...host.runtime,
      platform: process.platform,
    });
    this.router = new PineRequestRouter((channel, clientId, run) =>
      this.diagnostics.trace(channel, clientId, run),
    );
    this.filePreviewWatchers = new FilePreviewWatcherRegistry(
      (senderId, target) =>
        target.source === "project"
          ? this.previewPath(senderId, target)
          : this.presentedFilePath(senderId, target),
      (senderId, watchId) => {
        this.sendClientEvent(senderId, FILE_PREVIEW_CHANGED_CHANNEL, {
          watchId,
        });
      },
    );
    this.agentHost = new AgentProcessHost(host.createAgentProcess);
    this.repository = new ProjectRepository(this.projectsRoot);
    const automationStore = new AutomationStore(this.projectsRoot);
    this.automations = new AutomationService({
      store: automationStore,
      secrets: new AutomationSecretStore(
        (projectId) =>
          path.join(
            automationStore.projectRoot(projectId),
            AUTOMATION_SECRETS_FILE,
          ),
        host.credentialStorage,
      ),
      projects: {
        list: () => this.repository.list(),
        dataPaths: (projectId) => this.repository.dataPaths(projectId),
      },
      agent: {
        createSession: async (location) => {
          const result = await this.agentHost.createSession(location);
          return {
            sessionId: result.session.id,
            ...(result.sessionFile ? { sessionFile: result.sessionFile } : {}),
          };
        },
        selectModel: async (sessionId, selection) => {
          const thinkingLevel =
            selection.thinkingLevel ??
            (await this.agentHost.getModelCatalog(this.agentDirectory))
              .selection?.thinkingLevel ??
            "medium";
          await this.agentHost.selectModel(
            this.agentDirectory,
            selection.providerId,
            selection.modelId,
            thinkingLevel,
            sessionId,
          );
        },
        prompt: async (sessionId, message, locale) => {
          await this.agentHost.prompt(
            sessionId,
            message,
            undefined,
            [],
            "autonomous",
            locale,
          );
        },
        abort: async (sessionId) => {
          await this.agentHost.abort(sessionId);
        },
        dispose: async (sessionId) => {
          await this.agentHost.disposeSession(sessionId);
        },
      },
      agentDirectory: this.agentDirectory,
      tinyFishApiKey: () => credentials.getApiKey(),
      fetch: (url, init) => host.fetch(url, init),
      ...(host.automationPower ? { power: host.automationPower } : {}),
      notify: (notification) => host.notifyAutomation?.(notification),
      changed: (event) => {
        host.automationsChanged?.(event);
        this.web.server.publish(AUTOMATIONS_CHANGED_CHANNEL, event);
        this.tellWeChat((wechat) => wechat.automationsChanged());
      },
      sessionsChanged: () => this.notifyLibraryChanged("sessions"),
      sessionReleased: (sessionId) => this.runtimes.forgetSession(sessionId),
      locale: () => host.locale?.() ?? "en-US",
      skills: (projectId) => {
        const dataPaths = this.repository.dataPaths(projectId);
        const repository = new PineSkillRepository({
          disabledGlobalSkillsPath:
            dataPaths.skillsSettingsPath ??
            path.join(dataPaths.projectRoot, "skills.json"),
          global: path.join(this.agentDirectory, "skills"),
          project:
            dataPaths.skillsRoot ?? path.join(dataPaths.projectRoot, "skills"),
        });
        return Promise.resolve(
          repository.listCombined().skills.map(({ skill }) => skill.name),
        );
      },
      // The servers Pine's MCP settings manage. The adapter itself is ESM
      // only and cannot load in the main process. Without a folder only the
      // global servers apply.
      mcpServers: async (folderPath) => [
        ...new Set(
          (await listMcpServers(folderPath ?? this.agentDirectory)).servers
            .filter(({ scope }) => folderPath || scope === "global")
            .map(({ name }) => name),
        ),
      ],
    });
    this.runtimes = new ProjectRuntimeRegistry(
      this.agentHost,
      this.agentDirectory,
      () => credentials.getApiKey(),
    );
    this.runtimes.heldElsewhere = (sessionId) =>
      this.automations.isAutomationSession(sessionId);
    this.web = new WebApplication({
      access: webAccess,
      router: this.router,
      runtimes: this.runtimes,
      state: this.webSessionState,
      rendererRoot: host.renderer.root,
      devUrl: host.renderer.devUrl,
      previewPath: (ownerId, request) => this.previewPath(ownerId, request),
      presentedPath: async (ownerId, request) => {
        const { path: filePath } =
          PresentedFilePreviewRequestSchema.parse(request);
        const snapshots = this.webSessionState.snapshots(
          (id) => this.runtimes.projectOfLiveSession(id)?.id,
        );
        if (
          snapshots.some((snapshot) =>
            snapshot.events.some(
              (event) =>
                event.type === "present-file" &&
                event.target.source === "presented" &&
                event.target.path === filePath,
            ),
          )
        )
          this.presentedFiles.remember(ownerId, filePath);
        return this.presentedFilePath(ownerId, request);
      },
      allowAttachment: (filePath) => this.allowAttachment(filePath),
      rememberAttachments: (ownerId, paths) =>
        this.rememberAttachments(ownerId, paths),
      persistSettings: (webServer) =>
        writeWebServerSettings(this.agentDirectory, webServer),
      releaseSubscriptions: () => {
        this.projectFileWatchers?.disposeSender(WEB_CLIENT_ID);
        this.filePreviewWatchers.disposeSender(WEB_CLIENT_ID);
        this.attachedPreviewPaths.delete(WEB_CLIENT_ID);
        this.presentedFiles.forget(WEB_CLIENT_ID);
      },
      respondWorkbench: (request) => {
        this.workbenchStateRequests.respond(WEB_CLIENT_ID, request);
      },
    });
    this.remote = new RemoteHost({
      store: remoteStore,
      fetch: (url, init) => host.fetch(url, init),
      web: () => this.web.server.loopbackAccess(),
      pageOrigin: process.env.PINE_RC_PAGE_ORIGIN || DEFAULT_PAGE_ORIGIN,
      hostName: hostname().replace(/\.local$/, ""),
      approve: (request) =>
        host.approveRemotePairing?.(request) ?? Promise.resolve(false),
      onChange: () => host.remoteControlChanged?.(this.remote.status()),
    });
    // WeChat calls the core directly, as its own client, never the router.
    this.runtimes.isWeChatSession = (sessionId) =>
      this.wechat.originOf(sessionId) !== undefined;
    this.wechat = new WeChatBridge({
      core: {
        runtimes: this.runtimes,
        repository: this.repository,
        automations: this.automations,
        notifyLibraryChanged: (change, sourceClientId) =>
          this.notifyLibraryChanged(change, sourceClientId),
        rememberAttachments: (clientId, paths) =>
          this.rememberAttachments(clientId, paths),
        startBackgroundSession: (input) => startBackgroundSession(this, input),
        sessionLibrary: () => sessionLibrary(this),
        listSkills: (projectId) => listProjectSkills(this, projectId),
        listMcpServers: (projectId) =>
          listMcpCatalog(this, WECHAT_CLIENT_ID, projectId),
      },
      host: {
        version: host.version,
        computerName: hostname().replace(/\.local$/, ""),
        locale: () => host.locale?.() ?? "en-US",
        fetch: (url, init) => host.fetch(url, init),
        credentialStorage: host.credentialStorage,
        dataDirectory: host.dataDirectory,
        agentDirectory: this.agentDirectory,
        localAutomationApprovals: host.localAutomationApprovals ?? false,
        changed: (status) => host.wechatChanged?.(status),
        notify: (notification) => host.notifyWeChat?.(notification),
      },
    });
    registerCoreRequests(this);
    this.agentHost.subscribe((event) => this.routeAgentEvent(event));
    // Ready before the first message, so no turn waits on the lookup.
    if (
      settings.approximateLocationEnabled ??
      DEFAULT_APPROXIMATE_LOCATION_ENABLED
    )
      void this.location().current();
  }

  handle(channel: string, handler: PineRequestHandler): void {
    this.router.register(channel, handler);
  }

  location(): ApproximateLocationService {
    this.approximateLocation ??= new ApproximateLocationService({
      databasePath: this.host.geoipDatabasePath,
      cachePath: path.join(
        this.host.dataDirectory,
        "approximate-location.json",
      ),
      fetch: (url, init) => this.host.fetch(url, init),
    });
    return this.approximateLocation;
  }

  /** Where a project's tools run, such as its MCP servers. */
  async defaultFolderPath(projectId: string): Promise<string> {
    const project = await this.repository.get(projectId);
    const folder = project.folders.find(
      (entry) => entry.id === project.defaultFolderId,
    );
    if (!folder?.isAvailable)
      throw new Error("The project's default folder is unavailable.");
    return folder.path;
  }

  sendClientEvent(clientId: number, channel: string, value: unknown): void {
    if (clientId === WEB_CLIENT_ID) this.web.server.publish(channel, value);
    // WeChat and any other windowless client hear events through their hooks.
    else if (isVirtualClient(clientId)) return;
    else this.host.sendToClient(clientId, channel, value);
  }

  sendSessionEvent(
    ownerId: number,
    event: PineSessionEvent,
    recipients?: number[],
  ): void {
    const attached =
      recipients ??
      (event.type === "session-reset"
        ? this.runtimes.clientsOfProject(event.projectId)
        : this.runtimes.clientsOfSession(event.sessionId));
    const clients = attached.length ? attached : [ownerId];
    for (const clientId of clients) {
      if (event.type === "present-file" && event.target.source === "presented")
        this.presentedFiles.remember(clientId, event.target.path);
      if (clientId !== WEB_CLIENT_ID)
        this.sendClientEvent(clientId, SESSION_EVENT_CHANNEL, event);
    }
    this.web.publishSession(event);
  }

  /**
   * Tells the other interfaces their session and project lists are stale, so
   * a change made in one shows in every one.
   */
  notifyLibraryChanged(
    change: PineLibraryChange,
    sourceClientId?: number,
  ): void {
    this.host.libraryChanged(change, sourceClientId);
    this.web.libraryChanged(change);
    if (change === "projects") void this.automations.projectsChanged();
  }

  /** Closes the tabs of deleted sessions in every interface. */
  notifySessionsDeleted(sessionIds: string[]): void {
    if (!sessionIds.length) return;
    this.host.sessionsDeleted?.(sessionIds);
    this.web.sessionsDeleted(sessionIds);
  }

  rememberAttachments(
    clientId: number,
    attachmentPaths: readonly string[],
  ): void {
    const registered = this.attachedPreviewPaths.get(clientId) ?? new Set();
    for (const attachmentPath of attachmentPaths)
      registered.add(path.resolve(attachmentPath));
    this.attachedPreviewPaths.set(clientId, registered);
  }

  /**
   * Whether a file may be served as an attachment: either a Pine-managed
   * pasted attachment (`<projectsRoot>/<projectId>/attachments/<file>`) or a
   * file inside a folder granted to one of the currently open projects.
   */
  isServableAttachmentPath(resolvedPath: string): boolean {
    const relativePath = path.relative(this.projectsRoot, resolvedPath);
    if (
      relativePath !== "" &&
      !relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath)
    ) {
      const segments = relativePath.split(path.sep);
      if (
        segments.length === 3 &&
        segments[1] === PROJECT_ATTACHMENTS_DIRECTORY &&
        PROJECT_ID_PATTERN.test(segments[0])
      ) {
        return true;
      }
    }
    if (this.runtimes.isInsideGrantedFolder(resolvedPath)) return true;
    for (const registered of this.attachedPreviewPaths.values()) {
      if (registered.has(resolvedPath)) return true;
    }
    return false;
  }

  private async allowAttachment(filePath: string): Promise<boolean> {
    if (this.isServableAttachmentPath(filePath)) return true;
    if (await this.runtimes.isInsideCanonicalGrantedFolder(filePath))
      return true;
    for (const paths of this.attachedPreviewPaths.values())
      for (const registered of paths)
        if ((await realpath(registered).catch(() => null)) === filePath)
          return true;
    return false;
  }

  async previewPath(ownerId: number, request: unknown): Promise<string> {
    const entry = ProjectFilePreviewRequestSchema.parse(request);
    if (!this.runtimes.isOpen(ownerId, entry.projectId))
      throw new Error("Project is no longer open.");
    const [filePath] = await this.runtimes.projectEntryPaths(ownerId, [entry]);
    if (!this.runtimes.isOpen(ownerId, entry.projectId))
      throw new Error("Project is no longer open.");
    return filePath;
  }

  /**
   * Resolve a presented file for content serving. The path must still be an
   * absolute path this client presented, so a tab can never turn the media
   * protocol into a generic disk read.
   */
  async presentedFilePath(ownerId: number, request: unknown): Promise<string> {
    const { path: requestedPath } =
      PresentedFilePreviewRequestSchema.parse(request);
    const canonicalPath = await realpath(requestedPath).catch(() => null);
    if (!canonicalPath || !this.presentedFiles.allows(ownerId, canonicalPath)) {
      throw new Error("This file was not presented to this window.");
    }
    return canonicalPath;
  }

  projectFileWatchersFor(): ProjectFileWatcherRegistry {
    this.projectFileWatchers ??= new ProjectFileWatcherRegistry(
      (senderId, projectId, folderId, relativePath) =>
        this.runtimes.resolveDirectory(
          senderId,
          projectId,
          folderId,
          relativePath,
        ),
      (senderId, changes) => {
        this.sendClientEvent(senderId, PROJECT_FILES_CHANGED_CHANNEL, {
          folders: changes,
        });
      },
    );
    return this.projectFileWatchers;
  }

  /** Forgets everything a desktop window held once it goes away. */
  releaseClient(clientId: number): void {
    for (const [projectId, pending] of this.pendingProjectOpens) {
      if (pending.clientId === clientId)
        this.pendingProjectOpens.delete(projectId);
    }
    this.attachedPreviewPaths.delete(clientId);
    this.presentedFiles.forget(clientId);
    this.projectFileWatchers?.disposeSender(clientId);
    this.filePreviewWatchers.disposeSender(clientId);
    void this.runtimes.dispose(clientId);
  }

  /** Sessions still running or holding a running background task. */
  runningWorkCount(): number {
    return new Set([...this.runningSessions, ...this.sessionsWithRunningTasks])
      .size;
  }

  /** A sub-session's parent hears each turn it ends and each approval it needs. */
  private reportToParent(
    sessionId: string,
    state: "finished" | "failed" | "awaiting-approval",
  ): void {
    void notifyParentOf(this, sessionId, state).catch((error: unknown) =>
      console.error("Failed to tell a session about its sub-session.", error),
    );
  }

  /** What a session is doing now, as its relatives see it. */
  sessionActivity(sessionId: string): "running" | "awaiting-approval" | "idle" {
    if (this.runtimes.hasPendingApproval(sessionId)) return "awaiting-approval";
    return this.runningSessions.has(sessionId) ? "running" : "idle";
  }

  /** Whether a session of the project, other than `except`, is working. */
  projectHasRunningWork(projectId: string, except?: string): boolean {
    return this.runtimes
      .liveSessionIdsOf(projectId)
      .some(
        (sessionId) =>
          sessionId !== except &&
          (this.runningSessions.has(sessionId) ||
            this.sessionsWithRunningTasks.has(sessionId)),
      );
  }

  /**
   * Runs `update` once the session's reply ends. An update of a session's
   * own project restarts that project's sessions, so it cannot run mid-turn.
   */
  scheduleAfterReply(sessionId: string, update: () => Promise<void>): void {
    this.afterReply.set(sessionId, update);
  }

  /** Stop the agent process and its tools, and close browser access. */
  async stop(): Promise<void> {
    this.sessionListChanges.dispose();
    this.remote.stop();
    await this.wechat.stop().catch(() => undefined);
    await this.automations.stop().catch(() => undefined);
    const stopped = Promise.allSettled([
      this.agentHost.dispose(),
      this.stopWeb(),
    ]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      stopped,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, AGENT_SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeout);
  }

  /** Releases watchers and processes as Pine exits, without waiting. */
  dispose(): void {
    this.sessionListChanges.dispose();
    this.remote.stop();
    this.tellWeChat((wechat) => wechat.dispose());
    void this.automations.stop();
    void this.stopWeb();
    this.projectFileWatchers?.dispose();
    this.filePreviewWatchers.dispose();
    void this.agentHost.dispose();
  }

  private stopWeb() {
    return this.web.configure({ ...this.web.server.status(), enabled: false });
  }

  /**
   * Reports something to WeChat remote from an event path. The bridge is
   * optional: its failure must never break routing or the caller.
   */
  private tellWeChat(report: (wechat: WeChatBridge) => void): void {
    try {
      report(this.wechat);
    } catch (error) {
      console.error("WeChat remote failed to observe Pine.", error);
    }
  }

  private trackSessionWork(agentEvent: PineAgentEvent): void {
    if (agentEvent.type === "run-state") {
      if (agentEvent.state === "running" || agentEvent.state === "aborting")
        this.runningSessions.add(agentEvent.sessionId);
      else this.runningSessions.delete(agentEvent.sessionId);
    } else if (agentEvent.type === "background-tasks") {
      if (agentEvent.tasks.some((task) => task.status === "running"))
        this.sessionsWithRunningTasks.add(agentEvent.sessionId);
      else this.sessionsWithRunningTasks.delete(agentEvent.sessionId);
    }
  }

  private routeAgentEvent(agentEvent: PineRuntimeEvent): void {
    if (isProviderAuthEvent(agentEvent)) {
      const ownerId = this.providerLoginOwners.get(agentEvent.loginId);
      if (ownerId !== undefined)
        this.sendClientEvent(ownerId, PROVIDER_AUTH_EVENT_CHANNEL, agentEvent);
      return;
    }
    // Automation runs belong to no window; only the service sees them.
    if (this.automations.observeAgentEvent(agentEvent)) {
      if (agentEvent.type === "host-request")
        void this.answerAutomationRequest(agentEvent, true);
      return;
    }
    const sideChat = this.runtimes.sideChatOf(agentEvent.sessionId);
    if (sideChat) {
      this.routeSideChatEvent(agentEvent, sideChat);
      return;
    }
    const ownerId = this.runtimes.controllerOfSession(agentEvent.sessionId);
    if (ownerId === undefined) {
      this.host.observeAgentEvent?.(agentEvent, undefined);
      this.tellWeChat((wechat) =>
        wechat.observeAgentEvent(agentEvent, undefined),
      );
      return;
    }
    this.trackSessionWork(agentEvent);
    this.host.observeAgentEvent?.(agentEvent, ownerId);
    this.tellWeChat((wechat) => wechat.observeAgentEvent(agentEvent, ownerId));
    if (agentEvent.type === "present-file") {
      void this.forwardPresentedFile(agentEvent, ownerId);
      return;
    }
    if (agentEvent.type === "host-request") {
      void this.answerHostRequest(agentEvent, ownerId);
      return;
    }
    if (agentEvent.type === "context-usage") {
      this.runtimes.updateContextUsage(agentEvent.sessionId, {
        tokens: agentEvent.tokens,
        contextWindow: agentEvent.contextWindow,
        percent: agentEvent.percent,
        cost: agentEvent.cost,
        cacheHitRate: agentEvent.cacheHitRate,
      });
    } else if (agentEvent.type === "session-updated") {
      this.runtimes.updateSessionSummary(
        agentEvent.sessionId,
        agentEvent.summary,
      );
    } else if (agentEvent.type === "approval-request") {
      this.runtimes.trackApproval(
        agentEvent.requestId,
        ownerId,
        agentEvent.sessionId,
      );
      this.reportToParent(agentEvent.sessionId, "awaiting-approval");
    } else if (agentEvent.type === "approval-decided") {
      this.runtimes.forgetApproval(agentEvent.requestId);
    } else if (agentEvent.type === "questionnaire-request") {
      this.runtimes.trackQuestionnaire(
        agentEvent.requestId,
        ownerId,
        agentEvent.sessionId,
      );
    } else if (agentEvent.type === "questionnaire-decided") {
      this.runtimes.forgetQuestionnaire(agentEvent.requestId);
    }
    const finished =
      agentEvent.type === "run-state" &&
      (agentEvent.state === "idle" || agentEvent.state === "failed");
    let teleportProjectId: string | undefined;
    if (finished) {
      teleportProjectId = this.runtimes.takeScheduledTeleport(
        agentEvent.sessionId,
      );
      this.runtimes.clearSessionInteractions(agentEvent.sessionId);
    }
    this.sendSessionEvent(ownerId, agentEvent);
    // A new session, a new title, or a finished run moves it in every list.
    // The agent sends `session-updated` per appended entry, so those are
    // throttled per window; a finished run sends what is pending at once.
    if (agentEvent.type === "session-updated")
      this.sessionListChanges.notify(ownerId);
    else if (finished && !this.sessionListChanges.flush(ownerId))
      this.notifyLibraryChanged("sessions", ownerId);
    if (teleportProjectId)
      void this.teleportSession(agentEvent.sessionId, teleportProjectId);
    else if (finished)
      this.reportToParent(
        agentEvent.sessionId,
        agentEvent.state === "failed" ? "failed" : "finished",
      );
    const scheduled = finished && this.afterReply.get(agentEvent.sessionId);
    if (scheduled) {
      this.afterReply.delete(agentEvent.sessionId);
      void scheduled().catch((error: unknown) =>
        console.error("Failed to apply a change the agent asked for.", error),
      );
    }
  }

  /**
   * A side chat's events go only to the window that opened it. Its tools ask
   * the host on behalf of the conversation it forked; it can never move.
   */
  private routeSideChatEvent(
    agentEvent: PineAgentEvent,
    sideChat: { clientId: number; parentSessionId: string },
  ): void {
    if (agentEvent.type === "host-request") {
      const parentOwner = this.runtimes.controllerOfSession(
        sideChat.parentSessionId,
      );
      if (
        agentEvent.request.kind === "teleport" ||
        agentEvent.request.kind === "project" ||
        (agentEvent.request.kind === "session" &&
          !SIDE_CHAT_SESSION_OPS.has(agentEvent.request.operation.op)) ||
        parentOwner === undefined
      ) {
        this.agentHost.respondHostRequest(agentEvent.requestId, {
          ok: false,
          error: "A side chat cannot do this.",
        });
        return;
      }
      void this.answerHostRequest(
        { ...agentEvent, sessionId: sideChat.parentSessionId },
        parentOwner,
      );
      return;
    }
    if (agentEvent.type === "present-file") return;
    this.sendClientEvent(
      sideChat.clientId,
      SIDE_CHAT_EVENT_CHANNEL,
      agentEvent,
    );
  }

  /**
   * Resolve a presented file into a tab target and forward it to its client.
   * The renderer only ever sees the resolved target: the core is the only
   * place that knows which project folder a path belongs to, and the only
   * place allowed to grant read access to a file outside those folders.
   */
  private async forwardPresentedFile(
    event: Extract<PineAgentEvent, { type: "present-file" }>,
    ownerId: number,
  ): Promise<void> {
    const target = await this.runtimes.resolvePresentTarget(
      event.sessionId,
      event.path,
    );
    // An unresolvable path (folder removed, file deleted, project gone) never
    // becomes a tab, so the renderer cannot be handed a raw absolute path.
    if (!target) return;
    const projectId = this.runtimes.projectOfLiveSession(event.sessionId)?.id;
    if (!projectId) return;
    if (target.source === "presented")
      this.presentedFiles.remember(ownerId, target.path);
    this.sendSessionEvent(ownerId, {
      ...event,
      projectId,
      target,
    } satisfies PinePresentFileEvent);
  }

  /**
   * Answer a tool that needs the host: live workbench state, the project
   * library, or a confirmed move to another project. A move only checks and
   * records the target here; it happens once the session's current run ends.
   */
  private async answerHostRequest(
    event: Extract<PineAgentEvent, { type: "host-request" }>,
    ownerId: number,
  ): Promise<void> {
    if (event.request.kind === "automation") {
      await this.answerAutomationRequest(event, false);
      return;
    }
    if (event.request.kind === "session") {
      let sessionReply: AgentHostReply;
      try {
        const result = await answerSessionOperation(
          this,
          { sessionId: event.sessionId, ownerId },
          event.request.operation,
        );
        sessionReply = { ok: true, response: { kind: "session", result } };
        if (result.op === "start")
          this.tellWeChat((wechat) =>
            wechat.sessionSpawned(
              event.sessionId,
              result.sessionId,
              result.projectId,
            ),
          );
      } catch (error) {
        sessionReply = { ok: false, error: toErrorMessage(error) };
      }
      this.agentHost.respondHostRequest(event.requestId, sessionReply);
      return;
    }
    if (event.request.kind === "project") {
      let projectReply: AgentHostReply;
      try {
        const result = await answerProjectOperation(
          this,
          { sessionId: event.sessionId, ownerId },
          event.request.operation,
        );
        projectReply = { ok: true, response: { kind: "project", result } };
      } catch (error) {
        projectReply = { ok: false, error: toErrorMessage(error) };
      }
      this.agentHost.respondHostRequest(event.requestId, projectReply);
      return;
    }
    if (event.request.kind === "mcp") {
      const { operation } = event.request;
      let mcpReply: AgentHostReply;
      try {
        const projectId = this.runtimes.projectOfLiveSession(
          event.sessionId,
        )?.id;
        if (!projectId) throw new Error("This conversation has no project.");
        const result = await answerMcpOperation(
          this,
          { sessionId: event.sessionId, projectId },
          operation,
        );
        mcpReply = { ok: true, response: { kind: "mcp", result } };
      } catch (error) {
        mcpReply = { ok: false, error: toErrorMessage(error) };
      }
      this.agentHost.respondHostRequest(event.requestId, mcpReply);
      return;
    }
    const reply = await (async (): Promise<AgentHostReply> => {
      try {
        if (event.request.kind === "workbench-state") {
          const state = await this.workbenchStateRequests.request(
            ownerId,
            event.sessionId,
            (request) => {
              if (ownerId === WEB_CLIENT_ID) {
                this.sendClientEvent(ownerId, SESSION_EVENT_CHANNEL, request);
                return;
              }
              if (
                !this.host.sendToClient(ownerId, SESSION_EVENT_CHANNEL, request)
              )
                throw new Error("The session's Pine window is unavailable.");
            },
          );
          return { ok: true, response: { kind: "workbench-state", state } };
        }
        if (event.request.kind === "approximate-location") {
          const enabled =
            (await readPineAgentSettings(this.agentDirectory))
              .approximateLocationEnabled ??
            DEFAULT_APPROXIMATE_LOCATION_ENABLED;
          return {
            ok: true,
            response: {
              kind: "approximate-location",
              location: enabled ? await this.location().current() : null,
            },
          };
        }
        const projects = (await this.repository.list()).filter(
          (project) => !isTemporaryWorkspace(project.id),
        );
        if (event.request.kind === "list-projects") {
          const currentId = this.runtimes.projectOfLiveSession(
            event.sessionId,
          )?.id;
          return {
            ok: true,
            response: {
              kind: "list-projects",
              projects: projects.map((project) =>
                agentHostProject(project, currentId),
              ),
            },
          };
        }
        if (event.request.kind !== "teleport")
          throw new Error("Unknown host request.");
        const { projectId } = event.request;
        const project = projects.find(
          (candidate) => candidate.id === projectId,
        );
        if (!project) throw new Error("That project does not exist.");
        const defaultFolder = project.folders.find(
          (folder) => folder.id === project.defaultFolderId,
        );
        if (!defaultFolder?.isAvailable)
          throw new Error("The project's default folder is unavailable.");
        // Only another window holding the project refuses the move; a
        // windowless holder such as WeChat shares the runtime instead.
        if (
          this.runtimes
            .clientsOfProject(project.id)
            .some((id) => !isVirtualClient(id) && id !== ownerId)
        )
          throw new Error("That project is open in another Pine window.");
        this.runtimes.scheduleTeleport(event.sessionId, project.id);
        return {
          ok: true,
          response: {
            kind: "teleport",
            projectName: project.name,
            cwd: defaultFolder.path,
          },
        };
      } catch (error) {
        return { ok: false, error: toErrorMessage(error) };
      }
    })();
    this.agentHost.respondHostRequest(event.requestId, reply);
  }

  private async answerAutomationRequest(
    event: Extract<PineAgentEvent, { type: "host-request" }>,
    isRun: boolean,
  ): Promise<void> {
    let reply: AgentHostReply;
    try {
      if (event.request.kind !== "automation")
        throw new Error("Automation runs cannot use this tool.");
      const projectId = isRun
        ? this.automations.projectOfRun(event.sessionId)
        : this.runtimes.projectOfLiveSession(event.sessionId)?.id;
      // No Project is a project too: its automations live with its workspace.
      if (!projectId) throw new Error("This conversation has no project.");
      const result = await answerAutomationOperation(
        this,
        { sessionId: event.sessionId, projectId },
        event.request.operation,
        isRun,
      );
      reply = { ok: true, response: { kind: "automation", result } };
    } catch (error) {
      reply = { ok: false, error: toErrorMessage(error) };
    }
    this.agentHost.respondHostRequest(event.requestId, reply);
  }

  private async teleportSession(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    try {
      const project = await this.repository.open(projectId);
      const dataPaths = this.repository.dataPaths(projectId);
      const recipients = this.runtimes.clientsOfSession(sessionId);
      const { fromProjectId, webContentsId } =
        await this.runtimes.teleportSession(sessionId, project, dataPaths);
      this.tellWeChat((wechat) =>
        wechat.sessionMoved(sessionId, fromProjectId, projectId),
      );
      // Sub-sessions stay in their project; a moved session leaves the tree.
      await unlinkSession(this, fromProjectId, sessionId);
      for (const clientId of recipients)
        await this.runtimes.share(clientId, project, dataPaths);
      this.sendSessionEvent(
        webContentsId,
        {
          type: "session-teleported",
          sessionId,
          fromProjectId,
          projectId,
        } satisfies PineSessionTeleportedEvent,
        recipients,
      );
    } catch (error) {
      console.error("Failed to move a session to another project.", error);
    }
  }
}
