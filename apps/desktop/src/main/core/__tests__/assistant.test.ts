// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_CLIENT_ID,
  assistantAttachmentId,
} from "../../../shared/assistant";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
  type PineAttachment,
} from "../../../shared/attachments";
import {
  markWeChatMessage,
  readAssistantMessage,
} from "../../../agent/assistant/prompt";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "../../../shared/projects";
import type {
  PineSessionNotice,
  PineSessionSummary,
  PineTextMessage,
} from "../../../shared/sessions";
import { AssistantService } from "../assistant";
import type { PineCore } from "../pineCore";

const startBackgroundSession = vi.hoisted(() => vi.fn());
vi.mock("../requests/sessions", () => ({
  startBackgroundSession,
  sessionLibrary: () => ({}),
}));
const listProjectSessions = vi.hoisted(() => vi.fn());
const listOrchestratorSessions = vi.hoisted(() => vi.fn());
vi.mock("../../recentSessions", () => ({
  listProjectSessions,
  listOrchestratorSessions,
}));

const TEMP = TEMPORARY_WORKSPACE_PROJECT_ID;
const ASSISTANT_SESSION = "11111111-1111-4111-8111-111111111111";
const DISPATCHED = "22222222-2222-4222-8222-222222222222";
const ELSEWHERE = "33333333-3333-4333-8333-333333333333";
const BLOG = "44444444-4444-4444-8444-444444444444";

const noProject = { id: TEMP, name: "No Project" } as unknown as PineProject;

function userMessage(text: string): PineTextMessage {
  return {
    id: "u",
    role: "user",
    createdAt: "2026-11-24T00:00:00.000Z",
    blocks: [{ type: "text", text }],
  } as unknown as PineTextMessage;
}

function reply(text: string): PineTextMessage {
  return {
    role: "assistant",
    createdAt: "2026-11-24T00:00:00.000Z",
    blocks: [{ type: "text", text }],
  } as unknown as PineTextMessage;
}

/** The Assistant's conversation as the session index stores it. */
const storedConversation = {
  id: ASSISTANT_SESSION,
  orchestrator: true,
  updatedAt: "2026-11-24T00:00:00.000Z",
} as PineSessionSummary;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  startBackgroundSession.mockReset();
  startBackgroundSession.mockResolvedValue({
    accepted: true,
    session: { id: DISPATCHED },
  });
  listProjectSessions.mockReset();
  listProjectSessions.mockResolvedValue([]);
  listOrchestratorSessions.mockReset();
  listOrchestratorSessions.mockResolvedValue([]);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-assistant-core-"));
  roots.push(root);
  const blog = {
    id: BLOG,
    name: "Blog",
    folders: [],
    defaultFolderId: "f",
  } as unknown as PineProject;
  const projectOf = new Map<string, PineProject>([
    [ASSISTANT_SESSION, noProject],
    [ELSEWHERE, blog],
    [DISPATCHED, blog],
  ]);
  /** Sessions live in some runtime, with the clients holding it. */
  const live = new Map<string, number[]>([[DISPATCHED, [7]]]);
  const runtimes = {
    projectOfLiveSession: vi.fn((id: string) =>
      live.has(id) || id === ASSISTANT_SESSION ? projectOf.get(id) : undefined,
    ),
    approvalModeOfLiveSession: vi.fn(() => "auto-approve"),
    isOpen: vi.fn(() => true),
    share: vi.fn(() => Promise.resolve()),
    clientsSharingRuntime: vi.fn(() => [ASSISTANT_CLIENT_ID]),
    clientsOfSession: vi.fn((id: string) => live.get(id) ?? []),
    ownerOfProject: vi.fn(() => 7),
    liveSessionIdsOf: vi.fn((projectId: string) =>
      [...live.keys()].filter((id) => projectOf.get(id)?.id === projectId),
    ),
    summaryOfLiveSession: vi.fn((id: string) =>
      id === ASSISTANT_SESSION
        ? { id, orchestrator: true, updatedAt: "2026-11-25T00:00:00.000Z" }
        : { id, name: "修首页" },
    ),
    loadMessages: vi.fn(() =>
      Promise.resolve({ hasMore: false, messages: [reply("首页已修好。")] }),
    ),
    resume: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() =>
      Promise.resolve({ accepted: true, session: { id: ASSISTANT_SESSION } }),
    ),
    setApprovalMode: vi.fn(() => Promise.resolve({ updated: true })),
    selectModel: vi.fn(() => Promise.resolve({ disposed: false })),
    getModelCatalog: vi.fn(() =>
      Promise.resolve({
        models: [],
        providers: [],
        selection: {
          providerId: "p",
          modelId: "default",
          thinkingLevel: "low",
        },
      }),
    ),
    deleteSession: vi.fn(() => Promise.resolve(true)),
    hasPendingApproval: vi.fn(() => true),
  };
  const automations = {
    list: vi.fn(() => Promise.resolve([] as unknown[])),
    get: vi.fn(),
    setEnabled: vi.fn(() => Promise.resolve()),
    runNow: vi.fn(),
    pendingApprovals: vi.fn(() => [] as unknown[]),
  };
  const wechat = {
    status: vi.fn(() => ({
      bound: false,
      paused: false,
      settings: { allowHighRiskApprovals: false },
    })),
    originOf: vi.fn((): "wechat" | "wechat-used" | undefined => undefined),
  };
  const agentHost = {
    notifySession: vi.fn(() => Promise.resolve({ delivered: true })),
  };
  const core = {
    repository: {
      list: vi.fn(() => Promise.resolve([noProject, blog])),
      get: vi.fn((id: string) =>
        Promise.resolve(id === BLOG ? blog : noProject),
      ),
      open: vi.fn((id: string) =>
        Promise.resolve(id === BLOG ? blog : noProject),
      ),
      dataPaths: vi.fn((id: string) => ({
        projectRoot: root,
        attachmentsRoot: path.join(root, "attachments", id),
      })),
    },
    runtimes,
    agentHost,
    automations,
    wechat,
    sessionActivity: vi.fn(() => "running"),
    displayCurrency: vi.fn(() => ({ currency: "USD", rate: 1 })),
    notifyLibraryChanged: vi.fn(),
    notifySessionsDeleted: vi.fn(),
  } as unknown as PineCore;
  /** Links a session to the Assistant's conversation, as a dispatch does. */
  const linkToAssistant = (sessionId: string) => {
    blog.sessionParents = {
      ...blog.sessionParents,
      [sessionId]: ASSISTANT_SESSION,
    };
    blog.sessionParentProjects = {
      ...blog.sessionParentProjects,
      [sessionId]: TEMP,
    };
  };
  return {
    root,
    blog,
    live,
    core,
    runtimes,
    agentHost,
    automations,
    wechat,
    linkToAssistant,
    service: new AssistantService(core),
  };
}

const dispatch = {
  op: "dispatch" as const,
  projectId: BLOG,
  title: "修首页",
  message: "修一下首页样式",
  approvalMode: "auto-approve" as const,
  locale: "zh-CN" as const,
};

const notice = (state: PineSessionNotice["state"]): PineSessionNotice => ({
  sessionId: DISPATCHED,
  projectId: BLOG,
  state,
  title: "修首页",
});

describe("the Assistant's dispatches", () => {
  it("starts a sub-session of its conversation in the project", async () => {
    const { service } = await fixture();
    const dispatched = vi.fn();
    service.onDispatched = dispatched;

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toEqual({
      op: "dispatch",
      sessionId: DISPATCHED,
      projectId: BLOG,
      projectName: "Blog",
      approvalMode: "auto-approve",
    });
    const [, input] = startBackgroundSession.mock.calls[0] as [
      unknown,
      {
        project: PineProject;
        message: string;
        parentSessionId?: string;
        parentProjectId?: string;
      },
    ];
    expect(input.project.id).toBe(BLOG);
    expect(input.parentSessionId).toBe(ASSISTANT_SESSION);
    expect(input.parentProjectId).toBe(TEMP);
    expect(input.message).toMatch(/^\[Dispatched by Pine's Orchestrator\./);
    expect(input.message).toContain("修一下首页样式");
    // Only a WeChat turn's dispatches go to WeChat.
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("hands the attachments it names on: its own files copied, the user's by reference", async () => {
    const { root, runtimes, service } = await fixture();
    const ownRoot = path.join(root, "attachments", TEMP);
    await mkdir(ownRoot, { recursive: true });
    const pasted: PineAttachment = {
      name: "截图.png",
      path: path.join(ownRoot, "pasted.png"),
      extension: "png",
      kind: "file",
      size: 3,
      modifiedAt: "2026-11-20T00:00:00.000Z",
    };
    await writeFile(pasted.path, "png");
    const picked: PineAttachment = {
      name: "q3.csv",
      path: "/Users/me/finance/q3.csv",
      extension: "csv",
      kind: "file",
      size: 4096,
      modifiedAt: "2026-11-20T00:00:00.000Z",
    };
    runtimes.loadMessages.mockResolvedValueOnce({
      hasMore: false,
      messages: [],
      outline: [
        userMessage(serializeAttachmentMessage([pasted, picked], "看看这些")),
      ],
    } as never);

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      {
        ...dispatch,
        attachmentIds: [
          assistantAttachmentId(picked),
          assistantAttachmentId(pasted),
        ],
      },
    );

    expect(result).toMatchObject({ op: "dispatch", attachments: 2 });
    expect(runtimes.loadMessages).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      TEMP,
      ASSISTANT_SESSION,
      undefined,
      1,
      true,
    );
    const [, input] = startBackgroundSession.mock.calls[0] as [
      unknown,
      { message: string },
    ];
    const { attachments, prompt } = parseAttachmentMessage(input.message);
    expect(prompt).toMatch(/^\[Dispatched by Pine's Orchestrator\./);
    expect(prompt).toContain("修一下首页样式");
    expect(attachments[0]).toEqual(picked);
    const copy = attachments[1];
    expect(copy?.name).toBe("截图.png");
    expect(path.dirname(copy?.path ?? "")).toBe(
      path.join(root, "attachments", BLOG),
    );
    expect(await readFile(copy?.path ?? "", "utf8")).toBe("png");
  });

  it("refuses an attachment id the user never sent, before starting anything", async () => {
    const { runtimes, service } = await fixture();
    runtimes.loadMessages.mockResolvedValueOnce({
      hasMore: false,
      messages: [],
      outline: [userMessage("没有附件")],
    } as never);

    await expect(
      service.answer(
        { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
        { ...dispatch, attachmentIds: ["att_0000000000000000"] },
      ),
    ).rejects.toThrow(
      /No attachment att_0000000000000000 in this conversation/,
    );
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("relays a dispatched session's notice in its conversation", async () => {
    const { service, agentHost, runtimes } = await fixture();

    await service.relay(ASSISTANT_SESSION, notice("finished"), "<notice/>");

    // The Assistant was not open, so it is resumed in the background first.
    expect(runtimes.resume).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      TEMP,
      ASSISTANT_SESSION,
      { focus: false },
    );
    expect(agentHost.notifySession).toHaveBeenCalledExactlyOnceWith(
      ASSISTANT_SESSION,
      notice("finished"),
      "<notice/>",
      { triggerTurn: true },
    );
  });

  it("answers no session but the Assistant's", async () => {
    const { service } = await fixture();

    await expect(
      service.answer({ sessionId: ELSEWHERE, ownerId: 7 }, { op: "overview" }),
    ).rejects.toThrow("Only Pine's Orchestrator can use this tool.");
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("never dispatches above its own permission mode", async () => {
    const { service } = await fixture();

    await expect(
      service.answer(
        { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
        { ...dispatch, approvalMode: "YOLO" },
      ),
    ).rejects.toThrow(/cannot dispatch a session in YOLO/);
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("lists projects, running work and its dispatches in the overview", async () => {
    const { service, live, linkToAssistant } = await fixture();
    linkToAssistant(DISPATCHED);
    live.set(ASSISTANT_SESSION, [9]);
    listProjectSessions.mockImplementation((project: PineProject) =>
      Promise.resolve(
        project.id === BLOG
          ? [
              { id: DISPATCHED, name: "修首页", updatedAt: "2026-11-24" },
              { id: ELSEWHERE, name: "改样式", updatedAt: "2026-11-25" },
            ]
          : [],
      ),
    );

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      { op: "overview" },
    );

    expect(result).toMatchObject({
      op: "overview",
      overview: {
        projects: [{ id: TEMP }, { id: BLOG, name: "Blog" }],
        // Its own conversation is not among the work it oversees.
        active: [{ id: DISPATCHED, state: "running", dispatched: true }],
        dispatched: [{ id: DISPATCHED, title: "修首页" }],
        pendingApprovals: 0,
      },
    });
    if (result.op !== "overview") throw new Error(result.op);
    expect(result.overview.dispatched).toHaveLength(1);
  });
});

describe("the Assistant's conversation", () => {
  it("is the newest No Project session flagged as its own", async () => {
    const { service, live } = await fixture();
    await expect(service.thread()).resolves.toBeUndefined();

    const older = { ...storedConversation, id: ELSEWHERE, updatedAt: "2026" };
    listOrchestratorSessions.mockResolvedValue([older, storedConversation]);
    await expect(service.thread()).resolves.toBe(ASSISTANT_SESSION);
    await expect(service.isConversation(ASSISTANT_SESSION, TEMP)).resolves.toBe(
      true,
    );
    // Only in No Project, and only flagged sessions.
    await expect(service.isConversation(ASSISTANT_SESSION, BLOG)).resolves.toBe(
      false,
    );
    live.set(ASSISTANT_SESSION, [9]);
    await expect(service.isConversation(DISPATCHED, TEMP)).resolves.toBe(false);
  });

  it("takes a window's new message for it, and messages to its conversation", async () => {
    const { service } = await fixture();
    listOrchestratorSessions.mockResolvedValue([storedConversation]);

    await expect(
      service.isPromptFor({ kind: "new", projectId: TEMP, orchestrator: true }),
    ).resolves.toBe(true);
    await expect(
      service.isPromptFor({ kind: "new", projectId: TEMP }),
    ).resolves.toBe(false);
    await expect(
      service.isPromptFor({
        kind: "session",
        projectId: TEMP,
        sessionId: ASSISTANT_SESSION,
      }),
    ).resolves.toBe(true);
  });

  it("relays results of the sessions linked to it, and no others", async () => {
    const { service, live, linkToAssistant } = await fixture();
    live.set(ELSEWHERE, [7]);
    linkToAssistant(DISPATCHED);
    listOrchestratorSessions.mockResolvedValue([storedConversation]);

    await expect(service.relaysResultsOf(DISPATCHED)).resolves.toBe(true);
    await expect(service.relaysResultsOf(ELSEWHERE)).resolves.toBe(false);
  });
});

describe("the Assistant's desktop conversation", () => {
  it("starts its conversation like any session, in No Project and the composer's mode", async () => {
    const { service, runtimes } = await fixture();

    await service.prompt(9, {
      locale: "zh-CN",
      message: "看看在跑什么",
      approvalMode: "let-me-review",
    });

    expect(runtimes.prompt).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        target: { kind: "new", projectId: TEMP, orchestrator: true },
        approvalMode: "let-me-review",
      }),
      {},
    );
  });

  it("sends later messages to the same conversation", async () => {
    const { service, runtimes } = await fixture();
    listOrchestratorSessions.mockResolvedValue([storedConversation]);

    await service.prompt(9, { locale: "zh-CN", message: "第二条" });

    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      9,
      expect.objectContaining({
        target: {
          kind: "session",
          projectId: TEMP,
          sessionId: ASSISTANT_SESSION,
        },
        approvalMode: "auto-approve",
      }),
      {},
    );
  });

  it("sends through the client whose runtime runs its conversation", async () => {
    const { service, runtimes, live } = await fixture();
    listOrchestratorSessions.mockResolvedValue([storedConversation]);
    live.set(ASSISTANT_SESSION, [ASSISTANT_CLIENT_ID]);

    await service.prompt(9, { locale: "zh-CN", message: "你好" });

    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.anything(),
      { focus: false },
    );
  });

  it("never runs in YOLO", async () => {
    const { service, runtimes } = await fixture();

    await service.prompt(9, {
      locale: "zh-CN",
      message: "你好",
      approvalMode: "YOLO",
    });

    expect(runtimes.prompt).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ approvalMode: "autonomous" }),
      {},
    );
  });

  it("wakes to relay a finished turn, and lets an approval wait for its card", async () => {
    const { service, agentHost } = await fixture();

    await service.relay(ASSISTANT_SESSION, notice("awaiting-approval"), "a");
    await service.relay(ASSISTANT_SESSION, notice("finished"), "b");

    const calls = agentHost.notifySession.mock.calls as unknown as unknown[][];
    expect(calls.map((call) => call[3])).toEqual([
      { triggerTurn: false },
      { triggerTurn: true },
    ]);
  });

  it("relays in WeChat what was asked there, and on the desktop otherwise", async () => {
    const { service, wechat } = await fixture();
    const notify = vi.fn();
    service.notify = notify;
    service.onWakeForWeChat = vi.fn(() => Promise.resolve(true));
    wechat.originOf.mockReturnValue("wechat");

    await service.relay(ASSISTANT_SESSION, notice("finished"), "c");
    expect(service.onWakeForWeChat).toHaveBeenCalledWith(ASSISTANT_SESSION, {
      sessionId: DISPATCHED,
      projectId: BLOG,
    });
    await service.turnEnded(ASSISTANT_SESSION, "idle");
    expect(notify).not.toHaveBeenCalled();

    // WeChat cannot take it now: the relay shows on the desktop.
    service.onWakeForWeChat = vi.fn(() => Promise.resolve(false));
    await service.relay(ASSISTANT_SESSION, notice("finished"), "c");
    await service.turnEnded(ASSISTANT_SESSION, "idle");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("relays on the desktop a dispatch asked for there", async () => {
    const { service } = await fixture();
    const notify = vi.fn();
    service.notify = notify;
    service.onWakeForWeChat = vi.fn(() => Promise.resolve(true));

    await service.relay(ASSISTANT_SESSION, notice("finished"), "d");
    await service.turnEnded(ASSISTANT_SESSION, "idle");

    expect(service.onWakeForWeChat).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("drops a deleted conversation's pending replies", async () => {
    const { service } = await fixture();
    const notify = vi.fn();
    service.notify = notify;
    await service.relay(ASSISTANT_SESSION, notice("finished"), "e");

    service.sessionsDeleted([ASSISTANT_SESSION]);
    await service.turnEnded(ASSISTANT_SESSION, "idle");

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("the Assistant from WeChat", () => {
  it("starts its conversation as its own client", async () => {
    const { runtimes, service } = await fixture();
    runtimes.isOpen.mockReturnValue(false);

    const sent = await service.send("帮我修一下博客首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });

    expect(sent).toEqual({ sessionId: ASSISTANT_SESSION, projectId: TEMP });
    // It holds No Project while no window does.
    expect(runtimes.share).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      noProject,
      expect.anything(),
    );
    expect(runtimes.prompt).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        // Marked as typed in WeChat, for the prompt's WeChat style.
        message: "[WeChat]\n帮我修一下博客首页",
        target: { kind: "new", projectId: TEMP, orchestrator: true },
        approvalMode: "auto-approve",
      }),
      { focus: false },
    );
  });

  it("steers its running turn with the next message", async () => {
    const { runtimes, service } = await fixture();
    listOrchestratorSessions.mockResolvedValue([storedConversation]);

    await service.send("再加一句", {
      locale: "zh-CN",
      source: "wechat",
      steer: true,
    });

    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        target: {
          kind: "session",
          projectId: TEMP,
          sessionId: ASSISTANT_SESSION,
        },
        message: markWeChatMessage("再加一句"),
        streamingBehavior: "steer",
      }),
      { focus: false },
    );
  });

  it("marks only what came from WeChat", async () => {
    const { runtimes, service } = await fixture();
    const lastMessage = (message: string) =>
      expect(runtimes.prompt).toHaveBeenLastCalledWith(
        ASSISTANT_CLIENT_ID,
        expect.objectContaining({ message }),
        { focus: false },
      );
    await service.send("看看现在在跑啥", {
      locale: "zh-CN",
      source: "desktop",
    });
    lastMessage("看看现在在跑啥");
    await service.send("看看现在在跑啥", { locale: "zh-CN", source: "wechat" });
    const marked = markWeChatMessage("看看现在在跑啥");
    lastMessage(marked);
    expect(readAssistantMessage(marked)).toEqual({
      text: "看看现在在跑啥",
      fromWeChat: true,
    });
  });

  it("dispatches a WeChat turn's work within the WeChat ceiling and hands it to WeChat", async () => {
    const { service } = await fixture();
    const dispatched = vi.fn();
    service.onDispatched = dispatched;
    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toMatchObject({ approvalMode: "let-me-review" });
    expect(startBackgroundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approvalMode: "let-me-review" }),
    );
    expect(dispatched).toHaveBeenCalledWith({
      parentSessionId: ASSISTANT_SESSION,
      sessionId: DISPATCHED,
      projectId: BLOG,
    });
  });

  it("keeps a desktop turn's mode", async () => {
    const { service } = await fixture();
    const dispatched = vi.fn();
    service.onDispatched = dispatched;
    await service.send("修首页", { locale: "zh-CN", source: "desktop" });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toMatchObject({ approvalMode: "auto-approve" });
    expect(dispatched).not.toHaveBeenCalled();
  });
});

describe("the Assistant's one conversation, from the desktop and WeChat", () => {
  it("puts both into the same conversation, each marked with its source", async () => {
    const { runtimes, service } = await fixture();
    await service.prompt(9, { locale: "zh-CN", message: "桌面这条" });
    listOrchestratorSessions.mockResolvedValue([storedConversation]);

    await service.send("微信这条", { locale: "zh-CN", source: "wechat" });

    expect(runtimes.prompt).toHaveBeenNthCalledWith(
      1,
      9,
      expect.objectContaining({ message: "桌面这条" }),
      {},
    );
    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        message: markWeChatMessage("微信这条"),
        target: {
          kind: "session",
          projectId: TEMP,
          sessionId: ASSISTANT_SESSION,
        },
      }),
      { focus: false },
    );
  });

  it("runs WeChat turns in its conversation's mode, and dispatches within the ceiling below it", async () => {
    const { runtimes, service } = await fixture();
    listOrchestratorSessions.mockResolvedValue([storedConversation]);
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");

    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "auto-approve",
    });
    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({ approvalMode: "autonomous" }),
      { focus: false },
    );

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      { ...dispatch, approvalMode: "autonomous" },
    );
    expect(result).toMatchObject({ approvalMode: "auto-approve" });
  });

  it("keeps a WeChat ceiling when the desktop writes into the running turn", async () => {
    const { service } = await fixture();
    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });
    listOrchestratorSessions.mockResolvedValue([storedConversation]);
    await service.prompt(9, {
      locale: "zh-CN",
      message: "顺便看看样式",
      streamingBehavior: "steer",
    });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );
    expect(result).toMatchObject({ approvalMode: "let-me-review" });
  });
});

const ASSISTANT = {
  sessionId: ASSISTANT_SESSION,
  ownerId: ASSISTANT_CLIENT_ID,
};

/** The Assistant's conversation has started and Blog has two sessions. */
async function started() {
  const context = await fixture();
  listOrchestratorSessions.mockResolvedValue([storedConversation]);
  listProjectSessions.mockResolvedValue([
    { id: ELSEWHERE, name: "改样式" },
    { id: DISPATCHED, name: "修首页" },
  ]);
  return context;
}

describe("automations from the Assistant", () => {
  const daily = {
    id: "a-1",
    projectId: BLOG,
    projectName: "Blog",
    name: "日报",
    revision: 1,
    status: "active",
    triggers: ["schedule"],
    running: false,
  };

  it("runs one only within WeChat's two conditions", async () => {
    const { service, automations, runtimes } = await fixture();
    automations.list.mockResolvedValue([daily]);
    const run = {
      op: "automation-run" as const,
      projectId: BLOG,
      automationId: "a-1",
    };

    // Auto Approve is below Autonomous Work, which automations run as.
    await expect(service.answer(ASSISTANT, run)).rejects.toThrow(
      /Autonomous Work/,
    );
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");
    automations.list.mockResolvedValue([{ ...daily, status: "off" }]);
    await expect(service.answer(ASSISTANT, run)).rejects.toThrow(/not on/);
    automations.list.mockResolvedValue([daily]);
    await expect(service.answer(ASSISTANT, run)).resolves.toEqual({
      op: "automation-run",
      name: "日报",
    });
    expect(automations.runNow).toHaveBeenCalledExactlyOnceWith(BLOG, "a-1");
  });

  it("holds a WeChat turn to WeChat's ceiling", async () => {
    const { service, automations, runtimes } = await fixture();
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");
    automations.list.mockResolvedValue([daily]);
    await service.send("跑一下日报", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "auto-approve",
    });
    await expect(
      service.answer(ASSISTANT, {
        op: "automation-run",
        projectId: BLOG,
        automationId: "a-1",
      }),
    ).rejects.toThrow(/auto-approve/);
    expect(automations.runNow).not.toHaveBeenCalled();
  });

  it("turns one off, never on", async () => {
    const { service, automations } = await fixture();
    automations.list.mockResolvedValue([daily]);
    await expect(
      service.answer(ASSISTANT, {
        op: "automation-disable",
        projectId: BLOG,
        automationId: "a-1",
      }),
    ).resolves.toEqual({
      op: "automation-disable",
      name: "日报",
      changed: true,
    });
    expect(automations.setEnabled).toHaveBeenCalledExactlyOnceWith(
      { projectId: BLOG, source: "web" },
      "a-1",
      false,
    );
  });
});

describe("sessions the Assistant may act on", () => {
  it("renames one it dispatched without asking", async () => {
    const { service, runtimes, linkToAssistant } = await started();
    linkToAssistant(DISPATCHED);
    (runtimes as unknown as { renameSession: unknown }).renameSession = vi.fn(
      () => Promise.resolve(),
    );

    await expect(
      service.answer(ASSISTANT, {
        op: "session-rename",
        projectId: BLOG,
        sessionId: DISPATCHED,
        title: "新标题",
        confirmed: false,
      }),
    ).resolves.toEqual({ op: "session-rename", title: "新标题" });
  });

  it("needs the user's confirmation for one it did not dispatch", async () => {
    const { service } = await started();
    await expect(
      service.answer(ASSISTANT, {
        op: "session-rename",
        projectId: BLOG,
        sessionId: ELSEWHERE,
        title: "新标题",
        confirmed: false,
      }),
    ).rejects.toThrow(/has to confirm/);
  });

  it("reads settings it cannot change", async () => {
    const { service } = await fixture();
    const result = await service.answer(ASSISTANT, { op: "settings" });
    if (result.op !== "settings") throw new Error(result.op);
    expect(result.settings).toContainEqual({
      where:
        "Your own permission mode (your conversation's permission mode menu; the most a dispatched session may use)",
      value: "auto-approve",
    });
    expect(
      result.settings.some((fact) =>
        fact.where.includes("Settings › Assistant"),
      ),
    ).toBe(false);
  });
});
