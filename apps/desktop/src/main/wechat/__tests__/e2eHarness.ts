// Shared set-up for the WeChat end-to-end and security suites: a real
// ProjectRuntimeRegistry over a mocked agent host, a real ProjectRepository
// on temporary directories, the real WeChatBridge and the real ClawBot channel
// against the mock iLink server. Agent events are routed the way
// `PineCore.routeAgentEvent` routes them.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type MockIlink, startMockIlink } from "@pine/wechat-ilink/testing";
import type { UrlPurpose, WeixinMessage } from "@pine/wechat-ilink";
import { vi } from "vitest";
import type {
  PineAgentEvent,
  PineApprovalTrigger,
} from "../../../shared/agent";
import type { PineProject } from "../../../shared/projects";
import type { PineSessionSummary } from "../../../shared/sessions";
import type {
  WeChatNotification,
  WeChatSettingsPatch,
  WeChatStatus,
} from "../../../shared/wechatRemote";
import type { AgentHost } from "../../agentProcessHost";
import { createAgentHost } from "../../__tests__/agentHostFixture";
import { ProjectRuntimeRegistry } from "../../projectRuntime";
import { ProjectRepository } from "../../projects/projectRepository";
import type { TinyFishSafeStorage } from "../../tinyfishCredentials";
import { WeChatBridge } from "../bridge";
import type { ChannelFactory } from "../channel";
import { createClawBotChannels } from "../clawbotChannel";
import type {
  WeChatBridgeOptions,
  WeChatCorePorts,
  WeChatHostPorts,
} from "../ports";
import type { WeChatStateStore } from "../types";
import { createFakeAutomations, type FakeAutomations } from "./fakes";

export const PAIR_CODE = "482913";
export const OWNER_ID = "mock-user@im.wechat";
export const BOT_ID = "0123456789abcdef@im.bot";
export const WINDOW_ID = 1;

/** Polls until `check` returns a value other than undefined / false. */
export async function waitFor<T>(
  check: () => T | undefined | false,
  timeoutMs = 8000,
  what = "condition",
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fakeStorage(): TinyFishSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) =>
      Buffer.from(`sealed:${Buffer.from(text).toString("hex")}`),
    decryptString: (data) => {
      const text = data.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("cannot decrypt");
      return Buffer.from(text.slice("sealed:".length), "hex").toString("utf8");
    },
  };
}

/** The real bridge, with test access to its store and pipeline. */
export class E2EBridge extends WeChatBridge {
  constructor(options: WeChatBridgeOptions) {
    super(options);
  }

  get state(): WeChatStateStore {
    return this.store;
  }

  idle(): Promise<void> {
    return this.pipeline?.idle() ?? Promise.resolve();
  }

  runSweep(): void {
    this.sweep();
  }
}

export interface HarnessOptions {
  /** Applied before binding (the pairing resets only the permission settings). */
  settings?: WeChatSettingsPatch;
  /** Applied after the pairing (permission settings). */
  afterBind?: WeChatSettingsPatch;
  /** Make the test project WeChat's default project (default true). */
  defaultProject?: boolean;
  /** Bind and pair right away (default true). */
  bind?: boolean;
  /** URL gate for the ClawBot channel; default allows everything. */
  allowUrl?: (url: URL, purpose: UrlPurpose) => boolean;
  /** Reuse directories and the mock of an earlier harness (restart). */
  reuse?: Harness;
}

export interface Harness {
  mock: MockIlink;
  bridge: E2EBridge;
  registry: ProjectRuntimeRegistry;
  agentHost: AgentHost & {
    createSession: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    respondApproval: ReturnType<typeof vi.fn>;
    disposeSession: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  repository: ProjectRepository;
  automations: FakeAutomations;
  project: PineProject;
  projectFolder: string;
  dataDirectory: string;
  agentDirectory: string;
  notifications: WeChatNotification[];
  statuses: WeChatStatus[];
  /** Every URL the channel asked the gate about. */
  gated: { url: string; purpose: UrlPurpose }[];
  core: WeChatCorePorts;
  /** Routes an agent event as PineCore does. */
  emit(event: PineAgentEvent): void;
  /** Texts the mock server received through `sendmessage`. */
  texts(): string[];
  /** Pushes a user message and waits for the next text sent after it. */
  say(
    text: string,
    overrides?: Parameters<MockIlink["pushUserText"]>[1],
  ): Promise<string>;
  /** Pushes a user message without waiting. */
  push(
    text: string,
    overrides?: Parameters<MockIlink["pushUserText"]>[1],
  ): WeixinMessage;
  /** Waits until a sent text matches. */
  sent(match: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  /** Waits until the bridge's pipeline has handled everything delivered so far. */
  settle(): Promise<void>;
  bind(): Promise<void>;
  /** Simulates the agent starting, and later finishing, a run. */
  running(sessionId: string): void;
  finish(sessionId: string, text: string): void;
  approval(
    sessionId: string,
    options?: {
      trigger?: PineApprovalTrigger;
      toolName?: string;
      subject?: string;
      requestId?: string;
      actionDigest?: string;
    },
  ): string;
  /** The session id of the n-th `createSession` call (0-based). */
  createdSession(index?: number): string;
  close(): Promise<void>;
}

const SUMMARY: PineSessionSummary = {
  id: "unused",
  createdAt: "2026-11-12T08:00:00.000Z",
  updatedAt: "2026-11-12T08:00:00.000Z",
  messageCount: 0,
};

export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const reuse = options.reuse;
  const mock = reuse?.mock ?? (await startMockIlink());
  const root =
    reuse?.dataDirectory !== undefined
      ? path.dirname(reuse.dataDirectory)
      : await realpath(
          await mkdtemp(path.join(os.tmpdir(), "pine-wechat-e2e-")),
        );
  const dataDirectory = path.join(root, "data");
  const agentDirectory = path.join(root, "agent");
  const projectFolder = path.join(root, "project");
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await mkdir(projectFolder, { recursive: true });

  const repository = new ProjectRepository(path.join(root, "projects"));
  const project =
    reuse?.project ??
    (await (() => {
      const folderId = randomUUID();
      return repository.create({
        defaultFolderId: folderId,
        folders: [
          {
            access: "read-write",
            id: folderId,
            name: "source",
            path: projectFolder,
          },
        ],
        name: "Garden",
      });
    })());

  const base = createAgentHost(SUMMARY);
  const created: string[] = [];
  const agentHost = Object.assign(base, {
    createSession: vi.fn(() => {
      const id = randomUUID();
      created.push(id);
      return Promise.resolve({ session: { ...SUMMARY, id } });
    }),
    prompt: vi.fn((sessionId: string) =>
      Promise.resolve({
        accepted: true,
        session: { ...SUMMARY, id: sessionId, messageCount: 2 },
      }),
    ),
    respondApproval: vi.fn(
      (requestId: string, decision: { kind: "allow" | "deny" }) => {
        const entry = approvals.get(requestId);
        if (!entry) return;
        approvals.delete(requestId);
        const approved = decision.kind === "allow";
        // The worker reports the decision back, as the agent host does.
        queueMicrotask(() =>
          emit({
            type: "approval-decided",
            sessionId: entry.sessionId,
            requestId,
            toolCallId: entry.toolCallId,
            verdict: approved ? "approved" : "denied",
            decidedBy: "user",
          }),
        );
      },
    ),
    disposeSession: vi.fn(() => Promise.resolve({ disposed: true })),
    abort: vi.fn(() => Promise.resolve({ aborted: true })),
  }) as Harness["agentHost"];
  const approvals = new Map<
    string,
    { sessionId: string; toolCallId: string }
  >();

  const registry = new ProjectRuntimeRegistry(agentHost, agentDirectory);
  const automations = createFakeAutomations();
  const core: WeChatCorePorts = {
    runtimes: registry,
    repository,
    automations: automations.service,
    notifyLibraryChanged: vi.fn(),
    rememberAttachments: vi.fn(),
    // As the extracted core function: share when not held, then prompt.
    startBackgroundSession: async (input) => {
      if (!registry.isOpen(input.ownerId, input.project.id))
        await registry.share(
          input.ownerId,
          await repository.open(input.project.id),
          repository.dataPaths(input.project.id),
        );
      return registry.prompt(
        input.ownerId,
        {
          locale: input.locale,
          message: input.message,
          target: { kind: "new", projectId: input.project.id },
          approvalMode: input.approvalMode,
        },
        { focus: false },
      );
    },
    sessionLibrary: () => ({
      dataPaths: (projectId) => repository.dataPaths(projectId),
      openSessionService: (projectId) => registry.openSessionService(projectId),
    }),
    listSkills: () =>
      Promise.resolve({ skills: [] } as unknown as Awaited<
        ReturnType<WeChatCorePorts["listSkills"]>
      >),
    listMcpServers: () =>
      Promise.resolve({ servers: [] } as unknown as Awaited<
        ReturnType<WeChatCorePorts["listMcpServers"]>
      >),
  };

  const notifications: WeChatNotification[] = [];
  const statuses: WeChatStatus[] = [];
  const host: WeChatHostPorts = {
    version: "1.4.2",
    computerName: "Test Mac",
    locale: () => "en-US",
    fetch: () => Promise.reject(new Error("the host fetch is not used")),
    credentialStorage: fakeStorage(),
    dataDirectory,
    agentDirectory,
    localAutomationApprovals: true,
    changed: (status) => statuses.push(status),
    notify: (notification) => notifications.push(notification),
    keepAwake: vi.fn(),
  };

  const gated: Harness["gated"] = [];
  const allowUrl = options.allowUrl ?? (() => true);
  const channels: ChannelFactory = createClawBotChannels({
    fetch: (url, init) => globalThis.fetch(url, init),
    version: "1.4.2",
    apiBaseUrl: mock.baseUrl,
    cdnBaseUrl: mock.cdnBaseUrl,
    allowUrl: (url, purpose) => {
      gated.push({ url: url.toString(), purpose });
      return allowUrl(url, purpose);
    },
  });

  const bridge = new E2EBridge({
    core,
    host,
    channels,
    randomCode: () => PAIR_CODE,
  });

  const texts = () =>
    mock.sent.flatMap((entry) =>
      entry.text === undefined ? [] : [entry.text],
    );
  const sent = (match: (text: string) => boolean, timeoutMs = 8000) =>
    waitFor(() => texts().find(match), timeoutMs, "a matching WeChat message");

  const emit = (event: PineAgentEvent) => {
    const owner = registry.controllerOfSession(event.sessionId);
    if (owner !== undefined) {
      if (event.type === "approval-request")
        registry.trackApproval(event.requestId, owner, event.sessionId);
      else if (event.type === "approval-decided")
        registry.forgetApproval(event.requestId);
      else if (event.type === "questionnaire-request")
        registry.trackQuestionnaire(event.requestId, owner, event.sessionId);
      else if (event.type === "questionnaire-decided")
        registry.forgetQuestionnaire(event.requestId);
      else if (
        event.type === "run-state" &&
        (event.state === "idle" || event.state === "failed")
      )
        registry.clearSessionInteractions(event.sessionId);
    }
    bridge.observeAgentEvent(event, owner);
  };

  const harness: Harness = {
    mock,
    bridge,
    registry,
    agentHost,
    repository,
    automations,
    project,
    projectFolder,
    dataDirectory,
    agentDirectory,
    notifications,
    statuses,
    gated,
    core,
    emit,
    texts,
    push: (text, overrides) => mock.pushUserText(text, overrides),
    async say(text, overrides) {
      const before = mock.sent.length;
      mock.pushUserText(text, overrides);
      await waitFor(
        () => mock.sent.length > before,
        8000,
        `a reply to ${JSON.stringify(text)}`,
      );
      return mock.sent[before]?.text ?? "";
    },
    sent,
    async settle() {
      await sleep(250);
      await bridge.idle();
    },
    async bind() {
      await bridge.startBinding();
      await waitFor(
        () => bridge.status().binding?.phase === "qr",
        8000,
        "the QR code",
      );
      mock.qr.scan();
      mock.qr.confirm();
      await waitFor(
        () => bridge.status().binding?.phase === "pairing",
        8000,
        "the pairing phase",
      );
      mock.pushUserText(".");
      await sent((text) => text.includes(PAIR_CODE));
      await bridge.submitPairingCode(PAIR_CODE);
      await sent((text) => text.startsWith("Connected to Pine"));
    },
    running(sessionId) {
      emit({ type: "run-state", sessionId, state: "running" });
    },
    finish(sessionId, text) {
      emit({
        type: "message-end",
        sessionId,
        messageId: randomUUID(),
        message: { role: "assistant", content: [{ type: "text", text }] },
      });
      emit({ type: "run-state", sessionId, state: "idle" });
    },
    approval(sessionId, approval = {}) {
      const requestId = approval.requestId ?? randomUUID();
      const toolCallId = randomUUID();
      approvals.set(requestId, { sessionId, toolCallId });
      emit({
        type: "approval-request",
        sessionId,
        requestId,
        toolCallId,
        toolName: approval.toolName ?? "bash",
        trigger: approval.trigger ?? "pre-execution",
        input: {
          subject: approval.subject ?? "npm test",
          description: "Run the tests",
        },
        actionDigest: approval.actionDigest ?? `digest-${requestId}`,
      });
      return requestId;
    },
    createdSession(index = 0) {
      const id = created[index];
      if (id === undefined) throw new Error(`no session ${index} was created`);
      return id;
    },
    async close() {
      await bridge.stop();
      bridge.dispose();
      await bridge.state.flush();
      await registry.dispose(-2).catch(() => undefined);
      await registry.dispose(WINDOW_ID).catch(() => undefined);
      if (!reuse) {
        await mock.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  };

  if (options.defaultProject !== false || options.settings)
    await bridge.setSettings({
      ...(options.defaultProject === false
        ? {}
        : { defaultProjectId: project.id }),
      ...options.settings,
    });
  await bridge.start();
  if (options.bind ?? true) {
    await harness.bind();
    if (options.afterBind) await bridge.setSettings(options.afterBind);
  }
  return harness;
}
