// In-memory fakes for WeChat remote tests (plan section 3.8). The runtimes
// fake models which clients hold which runtime object of a project, the live
// sessions in each runtime and their controllers, which is what the actor
// and responder rules (D3) depend on.

import { vi } from "vitest";
import type {
  PineApprovalMode,
  PromptSessionRequest,
  PromptSessionResult,
} from "../../../shared/agent";
import type { SessionArtifact } from "../../../shared/artifacts";
import type { PineAttachment } from "../../../shared/attachments";
import type { PineProject } from "../../../shared/projects";
import type {
  LoadSessionMessagesResult,
  PineContextUsage,
  PineSessionSummary,
} from "../../../shared/sessions";
import { isVirtualClient } from "../../../shared/webControl";
import {
  DEFAULT_WECHAT_SETTINGS,
  WECHAT_CLIENT_ID,
  type WeChatNotification,
  type WeChatSettings,
} from "../../../shared/wechatRemote";
import type { AutomationService } from "../../automation/service";
import type { ProjectRuntimeRegistry } from "../../projectRuntime";
import type {
  ProjectDataPaths,
  ProjectRepository,
} from "../../projects/projectRepository";
import type { ProjectSessionService } from "../../sessions";
import { AskBook } from "../asks";
import type { ChannelSendResult, MessageChannel } from "../channel";
import { HandleTables, Pager } from "../handles";
import { Outbound } from "../outbound";
import type {
  InboundAttachmentsApi,
  StartBackgroundSessionInput,
  WeChatCorePorts,
  WeChatHostPorts,
} from "../ports";
import { RateLimits } from "../rateLimit";
import { render, renderDigest } from "../replies";
import { SessionDirectory } from "../sessionDirectory";
import type { CommandContext } from "../handlers/types";
import type {
  PendingAttachment,
  ReplyLanguage,
  StoredMedia,
  WeChatPersistedState,
  WeChatSecureState,
  WeChatStateStore,
} from "../types";

export const W = WECHAT_CLIENT_ID;
export const OWNER_USER_ID = "owner@im.wechat";
export const BOT_ID = "bot@im.bot";

// ---------------------------------------------------------------------------
// Clock

export interface FakeClock {
  now: () => number;
  set(ms: number): void;
  advance(ms: number): void;
}

export function createClock(start = Date.UTC(2026, 10, 12, 8)): FakeClock {
  let current = start;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Store

export function defaultPersistedState(): WeChatPersistedState {
  return {
    version: 1,
    language: "auto",
    cursor: "",
    seenMessageIds: [],
    inbox: [],
    pendingAttachments: [],
    tracked: [],
    origins: [],
    handles: {},
    nextAsk: 11,
    modeOverride: {},
    outQueue: [],
  };
}

export function defaultSecureState(): WeChatSecureState {
  return {
    version: 1,
    token: "fake-token",
    owner: {
      userId: OWNER_USER_ID,
      botId: BOT_ID,
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundAt: 0,
    },
    settings: { ...DEFAULT_WECHAT_SETTINGS },
    paused: false,
  };
}

export interface MemoryStore extends WeChatStateStore {
  /** How many writes `update` / `updateSecure` made. */
  readonly writes: { plain: number; secure: number };
  /** Replaces the whole sealed blob (for example a local settings change). */
  setSecure(state: WeChatSecureState): void;
  setSettings(patch: Partial<WeChatSettings>): void;
}

export function createMemoryStore(
  initial: {
    state?: Partial<WeChatPersistedState>;
    secure?: Partial<WeChatSecureState>;
  } = {},
): MemoryStore {
  let state: WeChatPersistedState = {
    ...defaultPersistedState(),
    ...structuredClone(initial.state ?? {}),
  };
  let secure: WeChatSecureState = {
    ...defaultSecureState(),
    ...structuredClone(initial.secure ?? {}),
  };
  const writes = { plain: 0, secure: 0 };
  let chain: Promise<void> = Promise.resolve();
  const serial = (work: () => void): Promise<void> => {
    const next = chain.then(work);
    chain = next.catch(() => undefined);
    return next;
  };
  const apply = (mutate: (draft: WeChatPersistedState) => void) => {
    const draft = structuredClone(state);
    mutate(draft);
    state = draft;
  };
  return {
    writes,
    load: () => Promise.resolve("ok"),
    get: () => state,
    update: (mutate) =>
      serial(() => {
        apply(mutate);
        writes.plain += 1;
      }),
    updateSoon: (mutate) => apply(mutate),
    flush: () => serial(() => undefined),
    canEncrypt: () => true,
    secure: () => secure,
    updateSecure: (mutate) =>
      serial(() => {
        const draft = structuredClone(secure);
        mutate(draft);
        secure = draft;
        writes.secure += 1;
      }),
    reloadSecure: () => Promise.resolve("ok"),
    reloadLanguage: () => Promise.resolve(),
    legacyKeepAwake: () => false,
    clearBinding: () =>
      serial(() => {
        const language = state.language;
        state = { ...defaultPersistedState(), language };
        secure = {
          version: 1,
          settings: { ...secure.settings },
          paused: secure.paused,
        };
      }),
    setSecure: (next) => {
      secure = structuredClone(next);
    },
    setSettings: (patch) => {
      secure = { ...secure, settings: { ...secure.settings, ...patch } };
    },
  };
}

// ---------------------------------------------------------------------------
// Channel

export interface FakeChannel extends MessageChannel {
  readonly texts: string[];
  readonly files: { name: string; data: Buffer }[];
  readonly typing: boolean[];
  /** The next sends answer this result. */
  failSends(result: ChannelSendResult | undefined): void;
  media: Map<string, Buffer>;
}

export function createFakeChannel(): FakeChannel {
  const texts: string[] = [];
  const files: { name: string; data: Buffer }[] = [];
  const typing: boolean[] = [];
  let failure: ChannelSendResult | undefined;
  const media = new Map<string, Buffer>();
  return {
    texts,
    files,
    typing,
    media,
    failSends: (result) => {
      failure = result;
    },
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
    wake: vi.fn(),
    sendText: vi.fn((to: string, token: string | undefined, text: string) => {
      void to;
      void token;
      if (failure) return Promise.resolve(failure);
      texts.push(text);
      return Promise.resolve({ ok: true as const });
    }),
    sendFile: vi.fn(
      (
        to: string,
        token: string | undefined,
        file: { name: string; data: Buffer },
      ) => {
        void to;
        void token;
        if (failure) return Promise.resolve(failure);
        files.push(file);
        return Promise.resolve({ ok: true as const });
      },
    ),
    setTyping: vi.fn((to: string, token: string | undefined, on: boolean) => {
      void to;
      void token;
      typing.push(on);
      return Promise.resolve();
    }),
    downloadMedia: vi.fn((ref: string, maxBytes: number) => {
      const data = media.get(ref);
      if (!data) return Promise.reject(new Error("media not found"));
      if (data.length > maxBytes)
        return Promise.reject(new Error("media too large"));
      return Promise.resolve(data);
    }),
  };
}

// ---------------------------------------------------------------------------
// Attachments

export interface FakeAttachments extends InboundAttachmentsApi {
  /** Stages a file directly, as if it had been downloaded. */
  add(name: string, sizeBytes?: number): PendingAttachment;
  readonly pending: PendingAttachment[];
  readonly taken: { root: string; attachments: PineAttachment[] }[];
}

export function createFakeAttachments(now: () => number = Date.now) {
  const pending: PendingAttachment[] = [];
  const taken: { root: string; attachments: PineAttachment[] }[] = [];
  let next = 1;
  const add = (name: string, sizeBytes = 10): PendingAttachment => {
    const id = `att-${next++}`;
    const attachment: PendingAttachment = {
      id,
      name,
      sizeBytes,
      kind: "file",
      stagedPath: `/fake/wechat-inbox/${id}`,
      receivedAtMs: now(),
    };
    pending.push(attachment);
    return attachment;
  };
  const fake: FakeAttachments = {
    pending,
    taken,
    add,
    stage: vi.fn(
      async (
        media: StoredMedia,
        download: (ref: string, maxBytes: number) => Promise<Buffer>,
      ) => {
        const data = await download(media.ref, Number.MAX_SAFE_INTEGER);
        return add(media.fileName ?? "file", data.length);
      },
    ),
    list: () => [...pending],
    take: vi.fn((root: string) => {
      const attachments = pending.splice(0).map((item): PineAttachment => ({
        extension: item.name.includes(".")
          ? (item.name.split(".").pop() ?? "")
          : "",
        kind: "file",
        modifiedAt: new Date(item.receivedAtMs).toISOString(),
        name: item.name,
        path: `${root}/${item.id}`,
        size: item.sizeBytes,
      }));
      taken.push({ root, attachments });
      return Promise.resolve(attachments);
    }),
    drop: vi.fn(() => Promise.resolve(pending.splice(0).length)),
    sweep: vi.fn(() => Promise.resolve()),
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Runtimes

interface FakeRuntime {
  key: number;
  projectId: string;
}

export interface FakeLiveSession {
  sessionId: string;
  projectId: string;
  runtime: FakeRuntime;
  mode: PineApprovalMode;
  summary: PineSessionSummary;
  controllerId?: number;
  contextUsage?: PineContextUsage;
}

export function summary(
  sessionId: string,
  overrides: Partial<PineSessionSummary> = {},
): PineSessionSummary {
  return {
    id: sessionId,
    createdAt: "2026-11-12T08:00:00.000Z",
    updatedAt: "2026-11-12T08:00:00.000Z",
    messageCount: 1,
    name: `Session ${sessionId}`,
    ...overrides,
  };
}

/**
 * The parts of `ProjectRuntimeRegistry` the bridge uses, over plain maps.
 * Every method is a `vi.fn` so tests can assert the client id it was called
 * with.
 */
export class FakeRuntimes {
  private nextRuntime = 1;
  private nextSession = 1;
  /** clientId → projectId → runtime. */
  readonly holders = new Map<number, Map<string, FakeRuntime>>();
  readonly live = new Map<string, FakeLiveSession>();
  readonly artifacts = new Map<string, SessionArtifact[]>();
  readonly transcripts = new Map<string, LoadSessionMessagesResult>();

  /** Opens a runtime for a client; `separate` gives it its own runtime even when another client holds the project. */
  openProject(
    clientId: number,
    projectId: string,
    options: { separate?: boolean } = {},
  ): void {
    const existing = options.separate
      ? undefined
      : this.allRuntimes().find((runtime) => runtime.projectId === projectId);
    const runtime = existing ?? { key: this.nextRuntime++, projectId };
    const projects = this.holders.get(clientId) ?? new Map();
    projects.set(projectId, runtime);
    this.holders.set(clientId, projects);
  }

  /** A live session in the runtime `clientId` holds for the project. */
  addLiveSession(input: {
    sessionId: string;
    projectId: string;
    clientId: number;
    mode?: PineApprovalMode;
    controllerId?: number;
    name?: string;
  }): FakeLiveSession {
    if (!this.isOpen(input.clientId, input.projectId))
      this.openProject(input.clientId, input.projectId);
    const runtime = this.holders.get(input.clientId)?.get(input.projectId);
    if (!runtime) throw new Error("no runtime");
    const session: FakeLiveSession = {
      sessionId: input.sessionId,
      projectId: input.projectId,
      runtime,
      mode: input.mode ?? "auto-approve",
      summary: summary(input.sessionId, {
        approvalMode: input.mode ?? "auto-approve",
        ...(input.name !== undefined ? { name: input.name } : {}),
      }),
      ...(input.controllerId !== undefined
        ? { controllerId: input.controllerId }
        : {}),
    };
    this.live.set(input.sessionId, session);
    return session;
  }

  private allRuntimes(): FakeRuntime[] {
    return [...this.holders.values()].flatMap((projects) => [
      ...projects.values(),
    ]);
  }

  private holdsRuntime(clientId: number, runtime: FakeRuntime): boolean {
    return this.holders.get(clientId)?.get(runtime.projectId) === runtime;
  }

  share = vi.fn((clientId: number, project: PineProject) => {
    if (this.isOpen(clientId, project.id)) return Promise.resolve();
    const virtualHolder = this.clientsOfProject(project.id).find(
      isVirtualClient,
    );
    const existing =
      (virtualHolder === undefined
        ? undefined
        : this.holders.get(virtualHolder)?.get(project.id)) ??
      this.allRuntimes().find((runtime) => runtime.projectId === project.id);
    const runtime = existing ?? {
      key: this.nextRuntime++,
      projectId: project.id,
    };
    const projects = this.holders.get(clientId) ?? new Map();
    projects.set(project.id, runtime);
    this.holders.set(clientId, projects);
    return Promise.resolve();
  });

  isOpen = (clientId: number, projectId: string): boolean =>
    this.holders.get(clientId)?.has(projectId) ?? false;

  clientsOfProject = (projectId: string): number[] =>
    [...this.holders.keys()].filter((id) => this.isOpen(id, projectId));

  projectIdsOf = (clientId: number): string[] => [
    ...(this.holders.get(clientId)?.keys() ?? []),
  ];

  ownerOfProject = (projectId: string): number | undefined => {
    const holders = this.clientsOfProject(projectId);
    return holders.find((id) => !isVirtualClient(id)) ?? holders[0];
  };

  clientsSharingRuntime = (clientId: number, projectId: string): number[] => {
    const runtime = this.holders.get(clientId)?.get(projectId);
    if (!runtime) return [];
    return [...this.holders.keys()].filter(
      (id) => id !== clientId && this.holdsRuntime(id, runtime),
    );
  };

  clientsOfSession = (sessionId: string): number[] => {
    const session = this.live.get(sessionId);
    if (!session) return [];
    return [...this.holders.keys()].filter((id) =>
      this.holdsRuntime(id, session.runtime),
    );
  };

  controllerOfSession = (sessionId: string): number | undefined => {
    const session = this.live.get(sessionId);
    if (!session) return undefined;
    const clients = this.clientsOfSession(sessionId);
    if (clients.length === 0) return undefined;
    return session.controllerId !== undefined &&
      clients.includes(session.controllerId)
      ? session.controllerId
      : clients[0];
  };

  ownerOfSession = (sessionId: string): number | undefined =>
    this.clientsOfSession(sessionId)[0];

  approvalModeOfLiveSession = (
    sessionId: string,
  ): PineApprovalMode | undefined =>
    this.clientsOfSession(sessionId).length > 0
      ? this.live.get(sessionId)?.mode
      : undefined;

  summaryOfLiveSession = (sessionId: string): PineSessionSummary | undefined =>
    this.clientsOfSession(sessionId).length > 0
      ? this.live.get(sessionId)?.summary
      : undefined;

  sessionSummary = this.summaryOfLiveSession;

  projectOfLiveSession = (sessionId: string): PineProject | undefined => {
    const session = this.live.get(sessionId);
    return session && this.clientsOfSession(sessionId).length > 0
      ? project(session.projectId)
      : undefined;
  };

  liveSessionIdsOf = (projectId: string): string[] =>
    [...this.live.values()]
      .filter(
        (session) =>
          session.projectId === projectId &&
          this.clientsOfSession(session.sessionId).length > 0,
      )
      .map((session) => session.sessionId);

  contextUsageOf = (sessionId: string): PineContextUsage | undefined =>
    this.live.get(sessionId)?.contextUsage;

  attachmentsRootFor = (clientId: number, projectId: string) =>
    this.isOpen(clientId, projectId)
      ? dataPaths(projectId).attachmentsRoot
      : undefined;

  private requireOpen(clientId: number, projectId: string): void {
    if (!this.isOpen(clientId, projectId))
      throw new Error("The project is not open in this window.");
  }

  private requireLiveFor(clientId: number, sessionId: string): FakeLiveSession {
    const session = this.live.get(sessionId);
    if (!session || !this.holdsRuntime(clientId, session.runtime))
      throw new Error("Session does not belong to this window.");
    return session;
  }

  prompt = vi.fn(
    (
      clientId: number,
      request: PromptSessionRequest,
      options: { focus?: boolean; parentSessionId?: string } = {},
    ): Promise<PromptSessionResult> => {
      void options;
      this.requireOpen(clientId, request.target.projectId);
      const sessionId =
        request.target.kind === "session"
          ? request.target.sessionId
          : `new-${this.nextSession++}`;
      let session = this.live.get(sessionId);
      if (!session || !this.holdsRuntime(clientId, session.runtime)) {
        session = this.addLiveSession({
          sessionId,
          projectId: request.target.projectId,
          clientId,
        });
      }
      session.mode = request.approvalMode ?? session.mode ?? "auto-approve";
      session.summary = { ...session.summary, approvalMode: session.mode };
      session.controllerId = clientId;
      return Promise.resolve({ accepted: true, session: session.summary });
    },
  );

  abort = vi.fn((clientId: number, sessionId: string) => {
    this.requireLiveFor(clientId, sessionId);
    return Promise.resolve({ aborted: true, sessionId });
  });

  compact = vi.fn((clientId: number, sessionId: string) => {
    this.requireLiveFor(clientId, sessionId);
    return Promise.resolve({ compacted: true });
  });

  dequeueSteering = vi.fn(
    (clientId: number, message: string, sessionId: string) => {
      this.requireLiveFor(clientId, sessionId);
      return Promise.resolve({ message, removed: true });
    },
  );

  sendSteeringNow = vi.fn(
    (clientId: number, message: string, sessionId: string) => {
      void message;
      this.requireLiveFor(clientId, sessionId);
      return Promise.resolve({ sent: true });
    },
  );

  setApprovalMode = vi.fn(
    (clientId: number, mode: PineApprovalMode, sessionId: string) => {
      const session = this.requireLiveFor(clientId, sessionId);
      session.mode = mode;
      session.summary = { ...session.summary, approvalMode: mode };
      return Promise.resolve({ updated: true });
    },
  );

  respondApproval = vi.fn(
    (clientId: number, request: { requestId: string }) => {
      void clientId;
      void request;
      return Promise.resolve();
    },
  );

  respondQuestionnaire = vi.fn(
    (clientId: number, request: { requestId: string }) => {
      void clientId;
      void request;
      return Promise.resolve();
    },
  );

  resolvePresentTarget = vi.fn((sessionId: string, filePath: string) => {
    void sessionId;
    return Promise.resolve(
      filePath.startsWith("/") ? { path: filePath, source: "presented" } : null,
    );
  });

  listArtifacts = vi.fn(
    (clientId: number, projectId: string, sessionId: string) => {
      this.requireOpen(clientId, projectId);
      return Promise.resolve([...(this.artifacts.get(sessionId) ?? [])]);
    },
  );

  loadMessages = vi.fn(
    (clientId: number, projectId: string, sessionId: string) => {
      this.requireOpen(clientId, projectId);
      return Promise.resolve(
        this.transcripts.get(sessionId) ?? { hasMore: false, messages: [] },
      );
    },
  );

  renameSession = vi.fn(
    (clientId: number, projectId: string, sessionId: string, name: string) => {
      this.requireOpen(clientId, projectId);
      const session = this.live.get(sessionId);
      if (session) session.summary = { ...session.summary, name };
      return Promise.resolve(summary(sessionId, { name }));
    },
  );

  deleteSession = vi.fn(
    (clientId: number, projectId: string, sessionId: string) => {
      this.requireOpen(clientId, projectId);
      this.live.delete(sessionId);
      return Promise.resolve({ deleted: true });
    },
  );

  listBackgroundTasks = vi.fn(() => Promise.resolve({ tasks: [] }));
  stopBackgroundTask = vi.fn(() => Promise.reject(new Error("no such task")));
  readBackgroundTaskOutput = vi.fn(() =>
    Promise.reject(new Error("no such task")),
  );
  getModelCatalog = vi.fn(() =>
    Promise.resolve({ models: [], providers: [] } as unknown),
  );
  selectModel = vi.fn(() => Promise.resolve({} as unknown));

  close = vi.fn((clientId: number, projectId: string) => {
    const projects = this.holders.get(clientId);
    projects?.delete(projectId);
    if (projects?.size === 0) this.holders.delete(clientId);
    this.dropOrphans();
    return Promise.resolve();
  });

  dispose = vi.fn((clientId: number) => {
    this.holders.delete(clientId);
    this.dropOrphans();
    return Promise.resolve();
  });

  /** Live sessions whose runtime nobody holds any more end. */
  private dropOrphans(): void {
    for (const [sessionId, session] of this.live) {
      const held = [...this.holders.keys()].some((id) =>
        this.holdsRuntime(id, session.runtime),
      );
      if (!held) this.live.delete(sessionId);
    }
  }

  asRegistry(): ProjectRuntimeRegistry {
    return this as unknown as ProjectRuntimeRegistry;
  }
}

// ---------------------------------------------------------------------------
// Projects, sessions on disk, automations, core

export function project(
  id: string,
  overrides: Partial<PineProject> = {},
): PineProject {
  return {
    id,
    name: `Project ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    defaultFolderId: `${id}-folder`,
    folders: [
      {
        id: `${id}-folder`,
        path: `/fake/projects/${id}`,
        isAvailable: true,
      } as PineProject["folders"][number],
    ],
    schemaVersion: 1,
    ...overrides,
  };
}

export function dataPaths(projectId: string): ProjectDataPaths {
  return {
    attachmentsRoot: `/fake/data/${projectId}/attachments`,
    cacheRoot: `/fake/data/${projectId}/cache`,
    projectRoot: `/fake/data/${projectId}`,
    sessionsRoot: `/fake/data/${projectId}/sessions`,
  };
}

export interface FakeAutomations {
  /** projectId → sessions that are automation runs. */
  readonly runs: Map<string, Set<string>>;
  readonly running: Set<string>;
  service: AutomationService;
  isAutomationSession: ReturnType<typeof vi.fn>;
  runSessions: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  listRuns: ReturnType<typeof vi.fn>;
  setEnabled: ReturnType<typeof vi.fn>;
  runNow: ReturnType<typeof vi.fn>;
  pendingApprovals: ReturnType<typeof vi.fn>;
}

export function createFakeAutomations(): FakeAutomations {
  const runs = new Map<string, Set<string>>();
  const running = new Set<string>();
  const fake = {
    runs,
    running,
    isAutomationSession: vi.fn((sessionId: string) => running.has(sessionId)),
    runSessions: vi.fn((projectId: string) =>
      Promise.resolve(
        new Map(
          [...(runs.get(projectId) ?? [])].map((sessionId) => [
            sessionId,
            {
              automationId: "auto-1",
              runId: `run-${sessionId}`,
              name: "Automation",
              startedAt: "2026-11-12T08:00:00.000Z",
            },
          ]),
        ),
      ),
    ),
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.reject(new Error("Automation not found."))),
    listRuns: vi.fn(() => Promise.resolve([])),
    setEnabled: vi.fn(() => Promise.resolve()),
    runNow: vi.fn(),
    pendingApprovals: vi.fn(() => []),
  };
  return {
    ...fake,
    service: fake as unknown as AutomationService,
  };
}

export interface FakeCore {
  ports: WeChatCorePorts;
  runtimes: FakeRuntimes;
  automations: FakeAutomations;
  /** Projects the repository knows. */
  projects: Map<string, PineProject>;
  /** Stored session summaries: projectId → sessionId → summary. */
  stored: Map<string, Map<string, PineSessionSummary>>;
  startBackgroundSession: ReturnType<typeof vi.fn>;
  notifyLibraryChanged: ReturnType<typeof vi.fn>;
  rememberAttachments: ReturnType<typeof vi.fn>;
  addProject(id: string, overrides?: Partial<PineProject>): PineProject;
  storeSession(projectId: string, session: PineSessionSummary): void;
}

export function createFakeCore(): FakeCore {
  const runtimes = new FakeRuntimes();
  const automations = createFakeAutomations();
  const projects = new Map<string, PineProject>();
  const stored = new Map<string, Map<string, PineSessionSummary>>();
  const addProject = (id: string, overrides: Partial<PineProject> = {}) => {
    const value = project(id, overrides);
    projects.set(id, value);
    return value;
  };
  const requireProject = (id: string) => {
    const value = projects.get(id);
    if (!value) return Promise.reject(new Error("Project not found."));
    return Promise.resolve(value);
  };
  const repository = {
    list: vi.fn(() => Promise.resolve([...projects.values()])),
    get: vi.fn(requireProject),
    open: vi.fn(requireProject),
    dataPaths: vi.fn(dataPaths),
  } as unknown as ProjectRepository;
  const startBackgroundSession = vi.fn(
    async (input: StartBackgroundSessionInput) => {
      await runtimes.share(input.ownerId, input.project);
      return runtimes.prompt(
        input.ownerId,
        {
          target: { kind: "new", projectId: input.project.id },
          message: input.message,
          approvalMode: input.approvalMode,
          locale: input.locale,
        },
        { focus: false },
      );
    },
  );
  const notifyLibraryChanged = vi.fn();
  const rememberAttachments = vi.fn();
  const sessionService = (projectId: string) =>
    ({
      describeSession: (sessionId: string) => {
        const value = stored.get(projectId)?.get(sessionId);
        return value
          ? Promise.resolve({
              sessionFile: `/fake/${sessionId}.jsonl`,
              summary: value,
            })
          : Promise.reject(
              new Error("Session not found in the active project."),
            );
      },
    }) as unknown as ProjectSessionService;
  const ports: WeChatCorePorts = {
    runtimes: runtimes.asRegistry(),
    repository,
    automations: automations.service,
    notifyLibraryChanged,
    rememberAttachments,
    startBackgroundSession,
    sessionLibrary: () => ({
      dataPaths,
      // Like ProjectRuntimeRegistry: only a project some runtime holds open.
      openSessionService: (projectId: string) =>
        projects.has(projectId) &&
        runtimes.clientsOfProject(projectId).length > 0
          ? sessionService(projectId)
          : undefined,
    }),
    listSkills: vi.fn(() =>
      Promise.resolve({ skills: [] } as unknown as Awaited<
        ReturnType<WeChatCorePorts["listSkills"]>
      >),
    ),
    listMcpServers: vi.fn(() =>
      Promise.resolve({ servers: [] } as unknown as Awaited<
        ReturnType<WeChatCorePorts["listMcpServers"]>
      >),
    ),
  };
  return {
    ports,
    runtimes,
    automations,
    projects,
    stored,
    startBackgroundSession,
    notifyLibraryChanged,
    rememberAttachments,
    addProject,
    storeSession: (projectId, session) => {
      const sessions = stored.get(projectId) ?? new Map();
      sessions.set(session.id, session);
      stored.set(projectId, sessions);
    },
  };
}

// ---------------------------------------------------------------------------
// Host

export interface FakeHost extends WeChatHostPorts {
  readonly notifications: WeChatNotification[];
}

export function createFakeHost(
  overrides: Partial<WeChatHostPorts> = {},
): FakeHost {
  const notifications: WeChatNotification[] = [];
  return {
    notifications,
    version: "1.4.2",
    computerName: "Test Mac",
    locale: () => "en-US",
    fetch: () => Promise.reject(new Error("no network in tests")),
    credentialStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(text),
      decryptString: (data: Buffer) => data.toString(),
    },
    dataDirectory: "/fake/data",
    agentDirectory: "/fake/agent",
    localAutomationApprovals: true,
    changed: vi.fn(),
    notify: vi.fn((notification: WeChatNotification) => {
      notifications.push(notification);
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The whole command context

export interface TestContext extends CommandContext {
  readonly fake: {
    clock: FakeClock;
    core: FakeCore;
    store: MemoryStore;
    channel: FakeChannel;
    attachments: FakeAttachments;
    host: FakeHost;
    /** Replaces `ctx.bridge.dispatch` behaviour. */
    dispatch: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };
}

export interface TestContextOverrides {
  lang?: ReplyLanguage;
  clock?: FakeClock;
  store?: MemoryStore;
  core?: FakeCore;
  host?: FakeHost;
  channel?: FakeChannel;
  attachments?: FakeAttachments;
  settings?: Partial<WeChatSettings>;
  inbound?: Partial<CommandContext["inbound"]>;
  confirmed?: CommandContext["confirmed"];
  heldConfirmed?: boolean;
}

/**
 * A complete `CommandContext` over the real AskBook, HandleTables, Pager,
 * RateLimits, Outbound and SessionDirectory, with fakes underneath. The
 * context token is set, so replies and pushes can be sent at once.
 */
export function createTestContext(
  overrides: TestContextOverrides = {},
): TestContext {
  const clock = overrides.clock ?? createClock();
  const lang = overrides.lang ?? "en";
  const store =
    overrides.store ??
    createMemoryStore({
      state: {
        contextToken: {
          value: "ctx-token",
          receivedAtMs: clock.now(),
          sent: 0,
          budgetNoticeSent: false,
        },
      },
    });
  if (overrides.settings) store.setSettings(overrides.settings);
  const core = overrides.core ?? createFakeCore();
  const host = overrides.host ?? createFakeHost();
  const channel = overrides.channel ?? createFakeChannel();
  const attachments = overrides.attachments ?? createFakeAttachments(clock.now);
  const asks = new AskBook({
    now: clock.now,
    nextAsk: store.get().nextAsk,
    onNextAsk: (nextAsk) =>
      store.updateSoon((draft) => {
        draft.nextAsk = nextAsk;
      }),
  });
  const handles = new HandleTables({ now: clock.now });
  const pager = new Pager({ now: clock.now });
  const limits = new RateLimits({ now: clock.now });
  const outbound = new Outbound({
    channel: () => channel,
    ownerUserId: () => store.secure().owner?.userId,
    store,
    now: clock.now,
    renderDigest: (items) => renderDigest(lang, items),
    renderBudgetNotice: () => render("T-BUDGET", lang),
    renderMoreCards: (count) => render("T-MORECARDS", lang, { count }),
  });
  const sessions = new SessionDirectory({
    core: core.ports,
    host,
    store,
    asks,
    outbound,
    attachments,
    settings: () => store.secure().settings,
    lang: () => lang,
    now: clock.now,
  });
  const dispatch = vi.fn(() => Promise.resolve({}));
  const pause = vi.fn(() => Promise.resolve());
  const ctx: TestContext = {
    get now() {
      return clock.now();
    },
    lang,
    inbound: {
      id: "msg-1",
      createdAtMs: clock.now(),
      pollStartedAtMs: clock.now(),
      ...overrides.inbound,
    },
    ...(overrides.confirmed ? { confirmed: overrides.confirmed } : {}),
    heldConfirmed: overrides.heldConfirmed ?? false,
    get settings() {
      return store.secure().settings;
    },
    core: core.ports,
    host,
    store,
    sessions,
    asks,
    handles,
    pager,
    limits,
    outbound,
    attachments,
    bridge: { pause, dispatch },
    fake: { clock, core, store, channel, attachments, host, dispatch, pause },
  };
  return ctx;
}
